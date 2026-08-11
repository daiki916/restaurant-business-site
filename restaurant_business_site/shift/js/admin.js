/*
 * Shift Sync - 管理者ダッシュボードロジック
 * 週グリッドに従業員の希望が自動転記され、タップで確定に昇格 → 公開・共有する。
 * 依存: config.js / core.js / store.js
 */
(function () {
  "use strict";

  var cfg = window.SHIFT_CONFIG;
  var Core = window.ShiftCore;
  var storage = window.ShiftStore.createStorage(cfg);

  var TOKEN_KEY = window.ShiftStore.PREFIX + "adminToken";
  var UNLOCK_KEY = window.ShiftStore.PREFIX + "adminUnlocked";

  // ---- 状態 ----
  var employees = [];
  var weekStart = Core.getWeekStart(Core.addDays(Core.todayStr(), 7), cfg.WEEK_STARTS_ON); // デフォルトは来週
  var weekData = { requests: [], assignments: [], meta: { published: false, publishedAt: "" } };
  var pollTimer = null;

  var $ = function (id) { return document.getElementById(id); };

  /* ===== 初期化・PINゲート ===== */

  document.addEventListener("DOMContentLoaded", function () {
    $("store-name").textContent = cfg.STORE_NAME;
    if (storage.mode === "local") $("demo-banner").classList.remove("hidden");
    bindToolbar();

    if (cfg.ADMIN_PIN_HASH && sessionStorage.getItem(UNLOCK_KEY) !== "1") {
      showPinGate();
    } else {
      boot();
    }
  });

  function showPinGate() {
    var gate = $("pin-gate");
    gate.classList.remove("hidden");
    var entered = "";
    var dots = $("pin-dots");
    var pad = $("pin-pad");

    function renderDots() {
      dots.innerHTML = "";
      var n = Math.max(4, entered.length);
      for (var i = 0; i < n; i++) {
        var d = document.createElement("span");
        d.className = "pin-dot" + (i < entered.length ? " is-filled" : "");
        dots.appendChild(d);
      }
    }

    var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "OK"];
    pad.innerHTML = "";
    keys.forEach(function (k) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pin-key";
      btn.textContent = k;
      if (k === "OK") btn.style.fontSize = "1rem";
      btn.addEventListener("click", function () {
        if (k === "C") {
          entered = "";
          renderDots();
        } else if (k === "OK") {
          Core.sha256Hex(entered).then(function (hex) {
            if (hex === cfg.ADMIN_PIN_HASH) {
              sessionStorage.setItem(UNLOCK_KEY, "1");
              gate.classList.add("hidden");
              boot();
            } else {
              dots.classList.add("is-error");
              setTimeout(function () {
                dots.classList.remove("is-error");
                entered = "";
                renderDots();
              }, 450);
            }
          });
        } else if (entered.length < 8) {
          entered += k;
          renderDots();
        }
      });
      pad.appendChild(btn);
    });
    renderDots();
  }

  function boot() {
    $("admin-root").classList.remove("hidden");

    if (storage.mode === "gas") {
      var token = localStorage.getItem(TOKEN_KEY) || "";
      if (token) {
        storage.setAdminToken(token);
      } else {
        promptToken("管理者トークンを入力してください(スプレッドシートのスクリプトプロパティ ADMIN_TOKEN と同じ値)");
      }
    }

    storage.init()
      .then(loadAll)
      .catch(function (err) {
        Core.toast("接続に失敗しました: " + err.message, true);
      });

    if (storage.mode === "gas") {
      // 従業員の送信をゆるやかに自動反映(週の全データを1リクエストで取得)
      pollTimer = setInterval(function () { loadAll(true); }, 60000);
    }
  }

  function promptToken(message) {
    var m = Core.openModal(
      '<div class="modal-title">管理者トークン</div>' +
      '<p class="text-mid text-xs">' + Core.escapeHtml(message) + '</p>' +
      '<div class="modal-body"><input type="password" id="token-input" placeholder="トークン"></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn" data-role="skip">閲覧のみ</button>' +
      '<button type="button" class="btn btn-primary" data-role="save">保存</button>' +
      '</div>'
    );
    m.el.querySelector('[data-role="skip"]').addEventListener("click", m.close);
    m.el.querySelector('[data-role="save"]').addEventListener("click", function () {
      var token = m.el.querySelector("#token-input").value.trim();
      if (!token) return;
      localStorage.setItem(TOKEN_KEY, token);
      storage.setAdminToken(token);
      m.close();
      Core.toast("トークンを保存しました");
    });
  }

  function handleError(err) {
    if (storage.mode === "gas" && /認証|token/i.test(err.message)) {
      promptToken("トークンが正しくありません。設定し直してください。");
    }
    Core.toast(err.message, true);
    loadAll(true);
  }

  /* ===== データ読み込み ===== */

  function loadAll(silent) {
    return Promise.all([storage.listEmployees(), storage.getWeek(weekStart)])
      .then(function (results) {
        employees = results[0];
        weekData = results[1];
        renderAll();
      })
      .catch(function (err) {
        if (!silent) Core.toast("読み込みに失敗しました: " + err.message, true);
      });
  }

  function renderAll() {
    renderWeekLabel();
    renderSubmitCounter();
    renderPublishState();
    renderGrid();
  }

  /* ===== ツールバー ===== */

  function bindToolbar() {
    $("week-prev").addEventListener("click", function () { moveWeek(-7); });
    $("week-next").addEventListener("click", function () { moveWeek(7); });
    $("week-today").addEventListener("click", function () {
      weekStart = Core.getWeekStart(Core.todayStr(), cfg.WEEK_STARTS_ON);
      loadAll();
    });
    $("reload-btn").addEventListener("click", function () {
      loadAll().then(function () { Core.toast("最新の状態に更新しました"); });
    });
    $("emp-btn").addEventListener("click", openEmployeeModal);
    $("publish-btn").addEventListener("click", onPublishClick);
    $("shift-grid").addEventListener("click", onGridClick);
  }

  function moveWeek(days) {
    weekStart = Core.addDays(weekStart, days);
    loadAll();
  }

  function renderWeekLabel() {
    var end = Core.addDays(weekStart, 6);
    var s = Core.dateParts(weekStart);
    var e = Core.dateParts(end);
    var label = $("week-label");
    label.textContent = s.md + " 〜 " + e.md;
    label.title = weekStart.split("-")[0] + "年";

    // 今週からのオフセットでサブラベルを出す
    var current = Core.getWeekStart(Core.todayStr(), cfg.WEEK_STARTS_ON);
    var diff = Math.round(
      (Core.fromDateStr(weekStart) - Core.fromDateStr(current)) / (7 * 24 * 60 * 60 * 1000)
    );
    var sub;
    if (diff === 0) sub = "今週";
    else if (diff === 1) sub = "来週";
    else if (diff === 2) sub = "翌々週";
    else if (diff === -1) sub = "先週";
    else sub = diff > 0 ? diff + "週後" : (-diff) + "週前";
    $("week-sublabel").textContent = sub;
  }

  // 提出カウンタ「提出 5/6」(希望を出した有効従業員数 / 有効従業員数)
  function renderSubmitCounter() {
    var active = employees.filter(function (e) { return e.active; });
    var submitted = {};
    weekData.requests.forEach(function (r) { submitted[r.employeeId] = true; });
    var count = active.filter(function (e) { return submitted[e.id]; }).length;
    var el = $("submit-counter");
    el.textContent = "提出 " + count + "/" + active.length;
    el.className = "badge" + (active.length > 0 && count === active.length ? " is-ok" : "");
  }

  function hasChangesAfterPublish() {
    var meta = weekData.meta || {};
    if (!meta.published || !meta.publishedAt) return false;
    return weekData.assignments.some(function (a) { return a.updatedAt > meta.publishedAt; });
  }

  function renderPublishState() {
    var badge = $("publish-badge");
    var btn = $("publish-btn");
    var meta = weekData.meta || {};
    if (!meta.published) {
      badge.className = "badge";
      badge.textContent = "下書き";
      btn.textContent = "この週を確定して公開";
    } else if (hasChangesAfterPublish()) {
      badge.className = "badge is-warn";
      badge.textContent = "公開済み(変更あり)";
      btn.textContent = "変更を再公開";
    } else {
      badge.className = "badge is-ok";
      badge.textContent = "公開済み";
      btn.textContent = "共有";
    }
  }

  /* ===== 週グリッド ===== */

  function visibleEmployees() {
    // 有効な従業員 + この週にデータが残っている無効化済み従業員
    var withData = {};
    weekData.requests.concat(weekData.assignments).forEach(function (r) {
      withData[r.employeeId] = true;
    });
    return employees
      .filter(function (e) { return e.active || withData[e.id]; })
      .sort(function (a, b) {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
  }

  // 週単位メモ(従業員×週の最初の非空noteを拾う)
  function notesByEmployee() {
    var notes = {};
    weekData.requests.forEach(function (r) {
      if (r.note && !notes[r.employeeId]) notes[r.employeeId] = r.note;
    });
    return notes;
  }

  function renderGrid() {
    var grid = $("shift-grid");
    var dates = Core.weekDates(weekStart);
    var today = Core.todayStr();
    var emps = visibleEmployees();
    var notes = notesByEmployee();
    var activeCount = employees.filter(function (e) { return e.active; }).length;
    var targets = cfg.BLOCKS.filter(function (d) { return cfg.TARGET_HEADCOUNT[d.id]; });

    grid.style.gridTemplateColumns = "150px repeat(7, minmax(100px, 1fr))";
    var html = "";

    // ヘッダー行(日付+カバレッジピルを統合)
    html += '<div class="grid-cell grid-head" style="text-align:left;">スタッフ' +
      '<div class="text-xs text-mid" style="font-weight:400;">' + activeCount + '名 / 週7日</div></div>';
    dates.forEach(function (date) {
      var p = Core.dateParts(date);
      var dowClass = p.dowIndex === 0 ? " is-sun" : (p.dowIndex === 6 ? " is-sat" : "");
      html += '<div class="grid-cell grid-head' + (date === today ? " is-today" : "") + '">' +
        '<span class="head-date">' + p.md + '</span> <span class="dow' + dowClass + '">' + p.dow + '</span>';
      html += '<div class="cov-pills">';
      targets.forEach(function (def) {
        var target = cfg.TARGET_HEADCOUNT[def.id];
        var count = countCoverage(date, def);
        var cls = count >= target ? " is-ok" : " is-short";
        html += '<span class="cov-pill' + cls + '">' + Core.escapeHtml(def.icon || def.label) +
          " " + count + "/" + target + '</span>';
      });
      html += '</div></div>';
    });

    // 従業員行(名前+提出タイムスタンプ)
    html += "";
    emps.forEach(function (emp) {
      var note = notes[emp.id];
      var stamp = submitStamp(emp.id);
      html += '<div class="grid-cell grid-emp' + (emp.active ? "" : " is-inactive") + '"' +
        (note ? ' data-action="show-note" data-emp="' + emp.id + '" style="cursor:pointer;" title="' + Core.escapeHtml(note) + '"' : "") + '>' +
        '<span class="dot" style="background:' + emp.color + ';color:' + emp.color + '"></span>' +
        '<div class="emp-info">' +
        '<span class="emp-name">' + Core.escapeHtml(emp.name) + (emp.active ? "" : " (無効)") +
        (note ? ' <span title="メモあり">✎</span>' : "") + '</span>' +
        (stamp
          ? '<span class="emp-sub">' + stamp + ' 提出</span>'
          : '<span class="emp-sub is-missing">未提出</span>') +
        '</div></div>';
      dates.forEach(function (date) {
        html += renderSlotCell(emp, date);
      });
    });

    grid.innerHTML = html;
  }

  // 従業員の最終提出日時("8/9 21:14" 形式)。未提出なら空文字
  function submitStamp(employeeId) {
    var latest = "";
    weekData.requests.forEach(function (r) {
      if (r.employeeId === employeeId && r.updatedAt > latest) latest = r.updatedAt;
    });
    if (!latest) return "";
    var d = new Date(latest);
    return (d.getMonth() + 1) + "/" + d.getDate() + " " +
      String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  // 確定シフトが時間帯定義と重なっていれば人数にカウント
  function countCoverage(date, def) {
    var ds = Core.timeToMin(def.start);
    var de = Core.timeToMin(def.end);
    var seen = {};
    weekData.assignments.forEach(function (a) {
      if (a.date !== date || seen[a.employeeId]) return;
      if (Core.timeToMin(a.start) < de && ds < Core.timeToMin(a.end)) {
        seen[a.employeeId] = true;
      }
    });
    return Object.keys(seen).length;
  }

  // 時間帯定義と完全一致するブロック定義を返す(なければnull)
  function findDef(start, end) {
    for (var i = 0; i < cfg.BLOCKS.length; i++) {
      if (cfg.BLOCKS[i].start === start && cfg.BLOCKS[i].end === end) return cfg.BLOCKS[i];
    }
    return null;
  }

  // チップの中身(1行目=アイコン+ラベル / 2行目=時刻。カスタム時間は時刻のみ)
  function chipInner(start, end, moreHtml) {
    var def = findDef(start, end);
    if (def) {
      return '<span class="chip-label">' + Core.escapeHtml((def.icon ? def.icon + " " : "") + def.label) +
        (moreHtml || "") + '</span><span class="chip-time">' + start + "-" + end + '</span>';
    }
    return '<span class="chip-label">' + start + "-" + end + (moreHtml || "") + '</span>';
  }

  function renderSlotCell(emp, date) {
    var assignments = weekData.assignments
      .filter(function (a) { return a.employeeId === emp.id && a.date === date; })
      .sort(function (a, b) { return Core.timeToMin(a.start) - Core.timeToMin(b.start); });
    var request = weekData.requests.find(function (r) {
      return r.employeeId === emp.id && r.date === date;
    });

    var chips = "";

    // 確定チップ(実線・発光)
    assignments.forEach(function (a) {
      var more = '<span class="chip-more" data-action="edit-asg" data-id="' + a.id +
        '" title="時刻・メモを編集"> …</span>';
      chips += '<div class="cell-chip is-assigned" style="border-color:' + emp.color + ';color:' + emp.color +
        ';box-shadow:0 0 9px ' + emp.color + '55;background:' + emp.color + '1A"' +
        ' data-action="unassign" data-id="' + a.id + '" title="タップで確定解除 / …で編集">' +
        chipInner(a.start, a.end, more) +
        (a.note ? '<span class="chip-note">' + Core.escapeHtml(a.note) + '</span>' : "") +
        '</div>';
    });

    // 希望チップ(点線・半透明)。すでに確定と重なっている希望は表示しない
    if (request) {
      if (request.status === "off") {
        chips += '<div class="cell-chip is-off-request" title="休み希望">休</div>';
      } else {
        Core.parseBlocks(request.blocks).forEach(function (b) {
          var covered = assignments.some(function (a) {
            return Core.timeToMin(a.start) < Core.timeToMin(b.end) &&
                   Core.timeToMin(b.start) < Core.timeToMin(a.end);
          });
          if (covered) return;
          chips += '<div class="cell-chip is-request" style="border-color:' + emp.color + ';color:' + emp.color + '"' +
            ' data-action="promote" data-emp="' + emp.id + '" data-date="' + date +
            '" data-start="' + b.start + '" data-end="' + b.end + '" title="タップで確定">' +
            chipInner(b.start, b.end) + '</div>';
        });
      }
    }

    return '<div class="grid-cell grid-slot" data-action="add-shift" data-emp="' + emp.id +
      '" data-date="' + date + '" title="空き部分をタップで追加">' + chips + '</div>';
  }

  /* ===== グリッド操作 ===== */

  function onGridClick(e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.dataset.action;

    if (action === "promote") {
      addAssignment(el.dataset.emp, el.dataset.date, el.dataset.start, el.dataset.end, "");
    } else if (action === "edit-asg") {
      e.stopPropagation();
      openEditModal(el.dataset.id);
    } else if (action === "unassign") {
      removeAssignment(el.dataset.id);
    } else if (action === "add-shift") {
      openAddModal(el.dataset.emp, el.dataset.date);
    } else if (action === "show-note") {
      var emp = employees.find(function (x) { return x.id === el.dataset.emp; });
      var note = notesByEmployee()[el.dataset.emp] || "";
      Core.openModal(
        '<div class="modal-title">' + Core.escapeHtml(emp ? emp.name : "") + ' さんのメモ</div>' +
        '<p>' + Core.escapeHtml(note) + '</p>'
      );
    }
  }

  function addAssignment(employeeId, date, start, end, note) {
    weekData.assignments.push({
      id: Core.uid("asg"),
      weekStart: weekStart,
      employeeId: employeeId,
      date: date,
      start: start,
      end: end,
      note: note || "",
      updatedAt: Core.nowIso()
    });
    persistAssignments();
  }

  function removeAssignment(id) {
    weekData.assignments = weekData.assignments.filter(function (a) { return a.id !== id; });
    persistAssignments();
  }

  function updateAssignment(id, fields) {
    weekData.assignments.forEach(function (a) {
      if (a.id !== id) return;
      Object.keys(fields).forEach(function (k) { a[k] = fields[k]; });
      a.updatedAt = Core.nowIso();
    });
    persistAssignments();
  }

  // 楽観的更新: 先に描画してから保存。失敗したら再読込して巻き戻す
  function persistAssignments() {
    renderPublishState();
    renderGrid();
    storage.saveAssignments(weekStart, weekData.assignments).catch(handleError);
  }

  /* ===== 追加・編集モーダル ===== */

  // モーダル内の時刻ステッパー部品(開始/終了のペア)
  function buildTimeSteppers(container, initial) {
    var state = { start: initial.start, end: initial.end };
    container.innerHTML =
      stepperHtml("開始", "start", state.start) +
      stepperHtml("終了", "end", state.end);

    container.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-field]");
      if (!btn) return;
      var field = btn.dataset.field;
      var dir = Number(btn.dataset.dir);
      var min = Core.timeToMin(state[field]) + dir * cfg.TIME_STEP_MIN;
      if (field === "start") {
        min = Math.max(cfg.OPEN_HOUR * 60, Math.min(min, Core.timeToMin(state.end) - cfg.TIME_STEP_MIN));
      } else {
        min = Math.min(cfg.CLOSE_HOUR * 60, Math.max(min, Core.timeToMin(state.start) + cfg.TIME_STEP_MIN));
      }
      state[field] = Core.minToTime(min);
      container.querySelector('[data-value="' + field + '"]').textContent = state[field];
    });
    return state;
  }

  function stepperHtml(label, field, value) {
    return '<div class="stepper-row">' +
      '<span class="stepper-label">' + label + '</span>' +
      '<div class="stepper">' +
      '<button type="button" class="stepper-btn" data-field="' + field + '" data-dir="-1">−</button>' +
      '<span class="stepper-value" data-value="' + field + '">' + value + '</span>' +
      '<button type="button" class="stepper-btn" data-field="' + field + '" data-dir="1">＋</button>' +
      '</div></div>';
  }

  // 空セルタップ: 希望がない従業員にもシフトを追加できる
  function openAddModal(employeeId, date) {
    var emp = employees.find(function (x) { return x.id === employeeId; });
    var p = Core.dateParts(date);
    var blockBtns = cfg.BLOCKS.map(function (def) {
      return '<button type="button" class="btn" data-block="' + def.id + '">' +
        Core.escapeHtml(def.label) + ' ' + def.start + '-' + def.end + '</button>';
    }).join("");

    var m = Core.openModal(
      '<div class="modal-title">' + Core.escapeHtml(emp ? emp.name : "") + ' — ' + p.md + '(' + p.dow + ')に追加</div>' +
      '<div class="modal-body">' +
      '<div><span class="field-label">時間帯をタップで追加</span>' +
      '<div style="display:flex;flex-direction:column;gap:0.5rem;">' + blockBtns + '</div></div>' +
      '<div><span class="field-label">またはカスタム時間</span>' +
      '<div id="add-steppers"></div></div>' +
      '</div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn" data-role="cancel">キャンセル</button>' +
      '<button type="button" class="btn btn-primary" data-role="custom-add">カスタムで追加</button>' +
      '</div>'
    );

    var firstDef = cfg.BLOCKS[0] || { start: "11:00", end: "15:00" };
    var timeState = buildTimeSteppers(m.el.querySelector("#add-steppers"),
      { start: firstDef.start, end: firstDef.end });

    m.el.querySelectorAll("[data-block]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var def = cfg.BLOCKS.find(function (b) { return b.id === btn.dataset.block; });
        m.close();
        addAssignment(employeeId, date, def.start, def.end, "");
      });
    });
    m.el.querySelector('[data-role="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-role="custom-add"]').addEventListener("click", function () {
      m.close();
      addAssignment(employeeId, date, timeState.start, timeState.end, "");
    });
  }

  // 確定チップの「…」: 時刻・メモ編集/削除
  function openEditModal(assignmentId) {
    var a = weekData.assignments.find(function (x) { return x.id === assignmentId; });
    if (!a) return;
    var emp = employees.find(function (x) { return x.id === a.employeeId; });
    var p = Core.dateParts(a.date);

    var m = Core.openModal(
      '<div class="modal-title">' + Core.escapeHtml(emp ? emp.name : "") + ' — ' + p.md + '(' + p.dow + ')を編集</div>' +
      '<div class="modal-body">' +
      '<div id="edit-steppers"></div>' +
      '<div><span class="field-label">メモ(任意)</span>' +
      '<input type="text" id="edit-note" maxlength="40" value="' + Core.escapeHtml(a.note || "") + '"></div>' +
      '</div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-danger" data-role="delete">削除</button>' +
      '<button type="button" class="btn" data-role="cancel">キャンセル</button>' +
      '<button type="button" class="btn btn-primary" data-role="save">保存</button>' +
      '</div>'
    );

    var timeState = buildTimeSteppers(m.el.querySelector("#edit-steppers"),
      { start: a.start, end: a.end });

    m.el.querySelector('[data-role="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-role="delete"]').addEventListener("click", function () {
      m.close();
      removeAssignment(assignmentId);
    });
    m.el.querySelector('[data-role="save"]').addEventListener("click", function () {
      var note = m.el.querySelector("#edit-note").value.trim();
      m.close();
      updateAssignment(assignmentId, { start: timeState.start, end: timeState.end, note: note });
    });
  }

  /* ===== 公開・共有 ===== */

  function onPublishClick() {
    var meta = weekData.meta || {};
    if (meta.published && !hasChangesAfterPublish()) {
      openShareModal();
      return;
    }

    // 不足コマの警告(公開自体は可能)
    var warnings = [];
    var targets = cfg.BLOCKS.filter(function (d) { return cfg.TARGET_HEADCOUNT[d.id]; });
    Core.weekDates(weekStart).forEach(function (date) {
      var p = Core.dateParts(date);
      targets.forEach(function (def) {
        var target = cfg.TARGET_HEADCOUNT[def.id];
        var count = countCoverage(date, def);
        if (count < target) {
          warnings.push(p.md + "(" + p.dow + ") " + def.label + " " + count + "/" + target + "人");
        }
      });
    });

    var warnHtml = warnings.length
      ? '<p class="text-xs" style="color:var(--neon-amber);">⚠ 人数が不足しているコマがあります:<br>' +
        warnings.map(Core.escapeHtml).join("<br>") + '</p>'
      : '<p class="text-xs" style="color:var(--neon-lime);">すべてのコマで必要人数を満たしています。</p>';

    var m = Core.openModal(
      '<div class="modal-title">この週を確定して公開しますか?</div>' +
      '<div class="modal-body">' + warnHtml +
      '<p class="text-mid text-xs">公開すると、従業員ページに確定シフトが表示されるようになります。</p></div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn" data-role="cancel">キャンセル</button>' +
      '<button type="button" class="btn btn-primary" data-role="ok">公開する</button>' +
      '</div>'
    );
    m.el.querySelector('[data-role="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-role="ok"]').addEventListener("click", function () {
      m.close();
      storage.publishWeek(weekStart)
        .then(function (meta) {
          weekData.meta = meta;
          renderPublishState();
          Core.toast("公開しました");
          openShareModal();
        })
        .catch(handleError);
    });
  }

  function employeeUrl() {
    return location.href.replace(/admin\.html.*$/, "");
  }

  function buildShareText() {
    var p = Core.dateParts(weekStart);
    var lines = ["【" + p.md + "週 確定シフト】" + cfg.STORE_NAME];
    Core.weekDates(weekStart).forEach(function (date) {
      var todays = weekData.assignments.filter(function (a) { return a.date === date; });
      if (todays.length === 0) return;
      var dp = Core.dateParts(date);
      var parts = [];
      var listed = {};
      cfg.BLOCKS.forEach(function (def) {
        var names = todays.filter(function (a) {
          return a.start === def.start && a.end === def.end;
        }).map(function (a) {
          listed[a.id] = true;
          var emp = employees.find(function (x) { return x.id === a.employeeId; });
          return emp ? emp.name : "?";
        });
        if (names.length) parts.push(def.label + ":" + names.join(","));
      });
      todays.filter(function (a) { return !listed[a.id]; })
        .sort(function (a, b) { return Core.timeToMin(a.start) - Core.timeToMin(b.start); })
        .forEach(function (a) {
          var emp = employees.find(function (x) { return x.id === a.employeeId; });
          parts.push((emp ? emp.name : "?") + " " + a.start + "-" + a.end);
        });
      lines.push(dp.md + "(" + dp.dow + ") " + parts.join(" / "));
    });
    return lines.join("\n");
  }

  function openShareModal() {
    var text = buildShareText();
    var m = Core.openModal(
      '<div class="modal-title">確定シフトを共有</div>' +
      '<div class="modal-body">' +
      '<button type="button" class="btn btn-block" data-role="copy-url">従業員ページのURLをコピー</button>' +
      '<button type="button" class="btn btn-block" data-role="copy-text">共有テキストをコピー(LINE貼り付け用)</button>' +
      '<div class="share-preview">' + Core.escapeHtml(text) + '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn" data-role="close">閉じる</button>' +
      '</div>'
    );
    m.el.querySelector('[data-role="close"]').addEventListener("click", m.close);
    m.el.querySelector('[data-role="copy-url"]').addEventListener("click", function () {
      Core.copyText(employeeUrl()).then(function () { Core.toast("URLをコピーしました"); });
    });
    m.el.querySelector('[data-role="copy-text"]').addEventListener("click", function () {
      Core.copyText(text).then(function () { Core.toast("共有テキストをコピーしました"); });
    });
  }

  /* ===== 従業員管理モーダル ===== */

  function openEmployeeModal() {
    var m = Core.openModal(
      '<div class="modal-title">従業員管理</div>' +
      '<div class="modal-body">' +
      '<div class="emp-list" id="emp-list"></div>' +
      '<div class="emp-add-row">' +
      '<input type="text" id="emp-add-name" placeholder="名前を入力して追加" maxlength="20">' +
      '<button type="button" class="btn" id="emp-add-btn">追加</button>' +
      '</div>' +
      (storage.mode === "local"
        ? '<button type="button" class="btn btn-danger btn-sm" id="emp-clear-btn">サンプルデータを全消去</button>'
        : "") +
      '</div>' +
      '<div class="modal-actions"><button type="button" class="btn" data-role="close">閉じる</button></div>'
    );

    m.el.querySelector('[data-role="close"]').addEventListener("click", function () {
      m.close();
      loadAll(true);
    });

    function renderList() {
      var list = m.el.querySelector("#emp-list");
      var sorted = employees.slice().sort(function (a, b) {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });
      list.innerHTML = sorted.map(function (emp) {
        return '<div class="emp-row' + (emp.active ? "" : " is-inactive") + '">' +
          '<span class="dot" style="background:' + emp.color + ';color:' + emp.color + '"></span>' +
          '<span class="emp-name">' + Core.escapeHtml(emp.name) + '</span>' +
          (emp.active
            ? '<button type="button" class="btn btn-sm" data-move="-1" data-id="' + emp.id + '">▲</button>' +
              '<button type="button" class="btn btn-sm" data-move="1" data-id="' + emp.id + '">▼</button>' +
              '<button type="button" class="btn btn-sm btn-danger" data-off="' + emp.id + '">無効化</button>'
            : '<button type="button" class="btn btn-sm" data-on="' + emp.id + '">有効化</button>') +
          '</div>';
      }).join("");
    }

    m.el.querySelector("#emp-list").addEventListener("click", function (e) {
      var btn = e.target.closest("button");
      if (!btn) return;

      if (btn.dataset.off) {
        storage.deactivateEmployee(btn.dataset.off)
          .then(function () { return storage.listEmployees(); })
          .then(function (list) { employees = list; renderList(); })
          .catch(handleError);
      } else if (btn.dataset.on) {
        var emp = employees.find(function (x) { return x.id === btn.dataset.on; });
        emp.active = true;
        storage.saveEmployee(emp)
          .then(function () { return storage.listEmployees(); })
          .then(function (list) { employees = list; renderList(); })
          .catch(handleError);
      } else if (btn.dataset.move) {
        moveEmployee(btn.dataset.id, Number(btn.dataset.move)).then(renderList);
      }
    });

    m.el.querySelector("#emp-add-btn").addEventListener("click", function () {
      var input = m.el.querySelector("#emp-add-name");
      var name = input.value.trim();
      if (!name) return;
      storage.saveEmployee({ name: name })
        .then(function () { return storage.listEmployees(); })
        .then(function (list) {
          employees = list;
          input.value = "";
          renderList();
          Core.toast("追加しました");
        })
        .catch(handleError);
    });

    var clearBtn = m.el.querySelector("#emp-clear-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        var c = Core.openModal(
          '<div class="modal-title">全データを消去しますか?</div>' +
          '<p class="text-mid text-xs">このブラウザに保存された従業員・希望・確定シフトをすべて削除します。元に戻せません。</p>' +
          '<div class="modal-actions">' +
          '<button type="button" class="btn" data-role="cancel">キャンセル</button>' +
          '<button type="button" class="btn btn-danger" data-role="ok">消去する</button>' +
          '</div>'
        );
        c.el.querySelector('[data-role="cancel"]').addEventListener("click", c.close);
        c.el.querySelector('[data-role="ok"]').addEventListener("click", function () {
          c.close();
          storage.clearAll().then(function () {
            employees = [];
            renderList();
            loadAll(true);
            Core.toast("消去しました");
          });
        });
      });
    }

    renderList();
  }

  // 並べ替え: 隣の従業員と sortOrder を入れ替える
  function moveEmployee(id, dir) {
    var active = employees.filter(function (e) { return e.active; })
      .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
    var idx = active.findIndex(function (e) { return e.id === id; });
    var swapIdx = idx + dir;
    if (idx < 0 || swapIdx < 0 || swapIdx >= active.length) return Promise.resolve();
    var a = active[idx], b = active[swapIdx];
    var tmp = a.sortOrder;
    a.sortOrder = b.sortOrder;
    b.sortOrder = tmp;
    return Promise.all([storage.saveEmployee(a), storage.saveEmployee(b)])
      .then(function () { return storage.listEmployees(); })
      .then(function (list) { employees = list; })
      .catch(handleError);
  }
})();
