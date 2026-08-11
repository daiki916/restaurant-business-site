/*
 * Shift Sync - ストレージアダプタ
 * 画面側は createStorage(config) が返すアダプタのメソッドだけを呼ぶ。
 *  - GAS_URL 未設定 → LocalStorageAdapter(デモモード: このブラウザ内のみ)
 *  - GAS_URL 設定済 → GasAdapter(Google スプレッドシートに保存・端末間共有)
 *
 * 共通インターフェース(全メソッド Promise を返す):
 *   init() / listEmployees() / saveEmployee(emp) / deactivateEmployee(id)
 *   getWeek(weekStart) → {requests, assignments, meta}
 *   saveRequests(weekStart, employeeId, requests)  … 従業員×週の全置換
 *   saveAssignments(weekStart, assignments)        … 週の全置換
 *   publishWeek(weekStart) / setAdminToken(token)
 */
(function () {
  "use strict";

  var Core = window.ShiftCore;
  var PREFIX = "shiftapp:v1:";

  /* =========================================================
   * LocalStorageAdapter(デモモード)
   * ========================================================= */

  function LocalStorageAdapter(config) {
    this.mode = "local";
    this.config = config;
  }

  LocalStorageAdapter.prototype._read = function (key, fallback) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  };

  LocalStorageAdapter.prototype._write = function (key, value) {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  };

  // 初回はサンプルデータを投入して、開いた瞬間に動きが見えるようにする
  LocalStorageAdapter.prototype.init = function () {
    if (this._read("employees", null) === null) {
      this._seedDemo();
    }
    return Promise.resolve();
  };

  LocalStorageAdapter.prototype._seedDemo = function () {
    var names = ["田中", "佐藤", "鈴木", "山本"];
    var employees = names.map(function (name, i) {
      return {
        id: Core.uid("emp"),
        name: name,
        color: Core.pickColor(i),
        active: true,
        sortOrder: i + 1,
        updatedAt: Core.nowIso()
      };
    });
    this._write("employees", employees);

    // 来週分のサンプル希望(管理画面の「自動転記」がすぐ見えるように)
    var cfg = this.config;
    var nextWeek = Core.getWeekStart(Core.addDays(Core.todayStr(), 7), cfg.WEEK_STARTS_ON);
    var dates = Core.weekDates(nextWeek);
    var lunch = cfg.BLOCKS[0] || { start: "11:00", end: "15:00" };
    var dinner = cfg.BLOCKS[1] || { start: "17:00", end: "22:00" };
    var patterns = [
      // [dayIndex, employeeIndex, status, blocks]
      [0, 0, "work", [lunch]], [0, 1, "work", [dinner]],
      [1, 0, "work", [lunch, dinner]], [1, 2, "work", [dinner]], [1, 3, "off", []],
      [2, 1, "work", [lunch]], [2, 3, "work", [dinner]],
      [3, 0, "off", []], [3, 2, "work", [lunch, dinner]],
      [4, 1, "work", [dinner]], [4, 3, "work", [lunch]],
      [5, 0, "work", [dinner]], [5, 2, "work", [dinner]]
    ];
    var requests = patterns.map(function (p) {
      return {
        id: Core.uid("req"),
        weekStart: nextWeek,
        employeeId: employees[p[1]].id,
        date: dates[p[0]],
        status: p[2],
        blocks: Core.serializeBlocks(p[3]),
        note: "",
        updatedAt: Core.nowIso()
      };
    });
    this._write("requests:" + nextWeek, requests);
    this._write("demoSeeded", true);
  };

  // デモデータの全消去(従業員管理モーダルから使用)
  LocalStorageAdapter.prototype.clearAll = function () {
    var keys = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) keys.push(k);
    }
    keys.forEach(function (k) { localStorage.removeItem(k); });
    this._write("employees", []);
    return Promise.resolve();
  };

  LocalStorageAdapter.prototype.listEmployees = function () {
    return Promise.resolve(this._read("employees", []));
  };

  LocalStorageAdapter.prototype.saveEmployee = function (employee) {
    var employees = this._read("employees", []);
    if (!employee.id) {
      employee.id = Core.uid("emp");
      employee.color = employee.color || Core.pickColor(employees.length);
      employee.sortOrder = employee.sortOrder || (employees.length + 1);
      employee.active = employee.active !== false;
    }
    employee.updatedAt = Core.nowIso();
    var found = false;
    for (var i = 0; i < employees.length; i++) {
      if (employees[i].id === employee.id) {
        employees[i] = employee;
        found = true;
        break;
      }
    }
    if (!found) employees.push(employee);
    this._write("employees", employees);
    return Promise.resolve(employee);
  };

  LocalStorageAdapter.prototype.deactivateEmployee = function (employeeId) {
    var employees = this._read("employees", []);
    employees.forEach(function (e) {
      if (e.id === employeeId) {
        e.active = false;
        e.updatedAt = Core.nowIso();
      }
    });
    this._write("employees", employees);
    return Promise.resolve();
  };

  LocalStorageAdapter.prototype.getWeek = function (weekStart) {
    return Promise.resolve({
      requests: this._read("requests:" + weekStart, []),
      assignments: this._read("assignments:" + weekStart, []),
      meta: this._read("meta:" + weekStart, { weekStart: weekStart, published: false, publishedAt: "" })
    });
  };

  LocalStorageAdapter.prototype.saveRequests = function (weekStart, employeeId, requests) {
    var all = this._read("requests:" + weekStart, []);
    var others = all.filter(function (r) { return r.employeeId !== employeeId; });
    this._write("requests:" + weekStart, others.concat(requests));
    return Promise.resolve();
  };

  LocalStorageAdapter.prototype.saveAssignments = function (weekStart, assignments) {
    this._write("assignments:" + weekStart, assignments);
    return Promise.resolve();
  };

  LocalStorageAdapter.prototype.publishWeek = function (weekStart) {
    var meta = { weekStart: weekStart, published: true, publishedAt: Core.nowIso() };
    this._write("meta:" + weekStart, meta);
    return Promise.resolve(meta);
  };

  LocalStorageAdapter.prototype.setAdminToken = function () { /* デモモードでは不要 */ };

  /* =========================================================
   * GasAdapter(本番モード: Google Apps Script + スプレッドシート)
   * ========================================================= */

  function GasAdapter(config) {
    this.mode = "gas";
    this.config = config;
    this.token = "";
  }

  GasAdapter.prototype.setAdminToken = function (token) {
    this.token = token || "";
  };

  // すべてのAPI呼び出しをここに集約。
  // Content-Type は text/plain にする(application/json だとCORSプリフライトが
  // 発生し、GASはOPTIONSに応答できず失敗するため)。
  GasAdapter.prototype._call = function (action, payload) {
    var body = JSON.stringify({
      action: action,
      payload: payload || {},
      token: this.token
    });
    return fetch(this.config.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: body,
      redirect: "follow"
    }).then(function (res) {
      if (!res.ok) throw new Error("通信エラー (HTTP " + res.status + ")");
      return res.json();
    }).then(function (json) {
      if (!json || json.ok !== true) {
        throw new Error((json && json.error) || "サーバーエラー");
      }
      return json.data;
    });
  };

  GasAdapter.prototype.init = function () {
    return this._call("ping");
  };

  GasAdapter.prototype.listEmployees = function () {
    return this._call("listEmployees");
  };

  GasAdapter.prototype.saveEmployee = function (employee) {
    return this._call("saveEmployee", { employee: employee });
  };

  GasAdapter.prototype.deactivateEmployee = function (employeeId) {
    return this._call("deactivateEmployee", { employeeId: employeeId });
  };

  GasAdapter.prototype.getWeek = function (weekStart) {
    return this._call("getWeek", { weekStart: weekStart });
  };

  GasAdapter.prototype.saveRequests = function (weekStart, employeeId, requests) {
    return this._call("saveRequests", {
      weekStart: weekStart,
      employeeId: employeeId,
      requests: requests
    });
  };

  GasAdapter.prototype.saveAssignments = function (weekStart, assignments) {
    return this._call("saveAssignments", {
      weekStart: weekStart,
      assignments: assignments
    });
  };

  GasAdapter.prototype.publishWeek = function (weekStart) {
    return this._call("publishWeek", { weekStart: weekStart });
  };

  /* ===== ファクトリ ===== */

  function createStorage(config) {
    return config.GAS_URL
      ? new GasAdapter(config)
      : new LocalStorageAdapter(config);
  }

  window.ShiftStore = { createStorage: createStorage, PREFIX: PREFIX };
})();
