/*
 * Shift Sync - Google Apps Script バックエンド
 *
 * このファイルをスプレッドシートの Apps Script エディタに貼り付けて
 * 「ウェブアプリ」としてデプロイします。手順は SETUP.md を参照してください。
 *
 * - シート構成: Employees / Requests / Assignments / Meta(初回実行時に自動作成)
 * - 認証: 管理者用アクション(saveEmployee, deactivateEmployee, saveAssignments,
 *   publishWeek)はスクリプトプロパティ ADMIN_TOKEN との一致が必要
 * - レスポンスは常に HTTP 200 の JSON {ok, data?, error?}
 *   (GASはHTTPステータスコードを制御できないため)
 */

var SHEETS = {
  Employees:   ["id", "name", "color", "active", "sortOrder", "updatedAt"],
  Requests:    ["id", "weekStart", "employeeId", "date", "status", "blocks", "note", "updatedAt"],
  Assignments: ["id", "weekStart", "employeeId", "date", "start", "end", "note", "updatedAt"],
  Meta:        ["weekStart", "published", "publishedAt"]
};

// 管理者トークンが必要なアクション
var ADMIN_ACTIONS = {
  saveEmployee: true,
  deactivateEmployee: true,
  saveAssignments: true,
  publishWeek: true
};

/* ===== エントリポイント ===== */

// ヘルスチェック用(ブラウザでURLを開いて疎通確認)
function doGet() {
  return jsonOutput_({ ok: true, service: "shift-sync", version: 1 });
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var payload = body.payload || {};

    if (ADMIN_ACTIONS[action]) {
      var expected = PropertiesService.getScriptProperties().getProperty("ADMIN_TOKEN");
      if (!expected) {
        return jsonOutput_({ ok: false, error: "サーバー設定エラー: スクリプトプロパティ ADMIN_TOKEN が未設定です" });
      }
      if (body.token !== expected) {
        return jsonOutput_({ ok: false, error: "認証エラー: 管理者トークンが正しくありません" });
      }
    }

    var data;
    switch (action) {
      case "ping":
        data = { pong: true };
        break;
      case "listEmployees":
        data = listEmployees_();
        break;
      case "getWeek":
        data = getWeek_(payload.weekStart);
        break;
      case "saveRequests":
        data = withLock_(function () {
          return saveRequests_(payload.weekStart, payload.employeeId, payload.requests || []);
        });
        break;
      case "saveEmployee":
        data = withLock_(function () { return saveEmployee_(payload.employee || {}); });
        break;
      case "deactivateEmployee":
        data = withLock_(function () { return deactivateEmployee_(payload.employeeId); });
        break;
      case "saveAssignments":
        data = withLock_(function () {
          return saveAssignments_(payload.weekStart, payload.assignments || []);
        });
        break;
      case "publishWeek":
        data = withLock_(function () { return publishWeek_(payload.weekStart); });
        break;
      default:
        return jsonOutput_({ ok: false, error: "不明なアクション: " + action });
    }

    return jsonOutput_({ ok: true, data: data });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

/* ===== アクション実装 ===== */

function listEmployees_() {
  return sheetToObjects_("Employees");
}

function getWeek_(weekStart) {
  if (!weekStart) throw new Error("weekStart がありません");
  var requests = sheetToObjects_("Requests").filter(function (r) {
    return r.weekStart === weekStart;
  });
  var assignments = sheetToObjects_("Assignments").filter(function (a) {
    return a.weekStart === weekStart;
  });
  var meta = sheetToObjects_("Meta").filter(function (m) {
    return m.weekStart === weekStart;
  })[0] || { weekStart: weekStart, published: false, publishedAt: "" };
  return { requests: requests, assignments: assignments, meta: meta };
}

// 従業員×週の希望を全置換
function saveRequests_(weekStart, employeeId, requests) {
  if (!weekStart || !employeeId) throw new Error("weekStart / employeeId がありません");
  var all = sheetToObjects_("Requests");
  var kept = all.filter(function (r) {
    return !(r.weekStart === weekStart && r.employeeId === employeeId);
  });
  objectsToSheet_("Requests", kept.concat(requests));
  return { saved: requests.length };
}

function saveEmployee_(employee) {
  var employees = sheetToObjects_("Employees");
  if (!employee.id) {
    employee.id = uid_("emp");
    if (!employee.color) {
      var palette = ["#00E5FF", "#FF2EC8", "#B4FF39", "#FFC53D", "#8C6BFF", "#FF7A45", "#3DFFB8", "#FF5C8A"];
      employee.color = palette[employees.length % palette.length];
    }
    if (!employee.sortOrder) employee.sortOrder = employees.length + 1;
    if (employee.active === undefined || employee.active === "") employee.active = true;
  }
  employee.updatedAt = new Date().toISOString();
  var found = false;
  for (var i = 0; i < employees.length; i++) {
    if (employees[i].id === employee.id) {
      employees[i] = employee;
      found = true;
      break;
    }
  }
  if (!found) employees.push(employee);
  objectsToSheet_("Employees", employees);
  return employee;
}

function deactivateEmployee_(employeeId) {
  if (!employeeId) throw new Error("employeeId がありません");
  var employees = sheetToObjects_("Employees");
  employees.forEach(function (e) {
    if (e.id === employeeId) {
      e.active = false;
      e.updatedAt = new Date().toISOString();
    }
  });
  objectsToSheet_("Employees", employees);
  return {};
}

// 週の確定シフトを全置換
function saveAssignments_(weekStart, assignments) {
  if (!weekStart) throw new Error("weekStart がありません");
  var all = sheetToObjects_("Assignments");
  var kept = all.filter(function (a) { return a.weekStart !== weekStart; });
  objectsToSheet_("Assignments", kept.concat(assignments));
  return { saved: assignments.length };
}

function publishWeek_(weekStart) {
  if (!weekStart) throw new Error("weekStart がありません");
  var meta = { weekStart: weekStart, published: true, publishedAt: new Date().toISOString() };
  var all = sheetToObjects_("Meta").filter(function (m) { return m.weekStart !== weekStart; });
  all.push(meta);
  objectsToSheet_("Meta", all);
  return meta;
}

/* ===== 共通ユーティリティ ===== */

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// 書き込みは全置換方式のため、ロックで直列化する
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// シートが無ければヘッダ付きで作成して返す
// シート全体を書式「書式なしテキスト」にして、"11:00" や "2026-08-10" が
// 時刻型・日付型に自動変換されるのを防ぐ
function ensureSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).setNumberFormat("@");
    sheet.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]);
  }
  return sheet;
}

// シート → オブジェクト配列(1行目ヘッダ=フィールド名)
function sheetToObjects_(name) {
  var sheet = ensureSheet_(name);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1).filter(function (row) {
    return row.some(function (v) { return v !== "" && v !== null; });
  }).map(function (row) {
    var obj = {};
    headers.forEach(function (h, i) {
      obj[h] = normalizeCell_(row[i]);
    });
    return obj;
  });
}

// オブジェクト配列 → シート全置換
function objectsToSheet_(name, rows) {
  var sheet = ensureSheet_(name);
  var headers = SHEETS[name];
  sheet.clearContents();
  var data = [headers];
  rows.forEach(function (obj) {
    data.push(headers.map(function (h) {
      var v = obj[h];
      return v === undefined || v === null ? "" : v;
    }));
  });
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
}

// セル値をアプリで使う形に正規化
// (手動編集などで時刻型・日付型に変換されてしまったセルも文字列に戻す)
function normalizeCell_(v) {
  if (v instanceof Date) {
    var tz = Session.getScriptTimeZone();
    // 1899年基準のDate = 時刻のみのセル("11:00" など)
    if (v.getFullYear() < 1970) {
      return Utilities.formatDate(v, tz, "HH:mm");
    }
    return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  }
  if (typeof v === "boolean") return v;
  if (v === "TRUE") return true;
  if (v === "FALSE") return false;
  return v;
}

function uid_(prefix) {
  var s = "";
  var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return prefix + "_" + s;
}
