/*
 * Shift Sync - 従業員画面ロジック
 * 流れ: 名前をタップ(初回のみ) → 日ごとに時間帯ブロックをタップ → 送信
 * 依存: config.js / core.js / store.js
 */
(function () {
  "use strict";

  var cfg = window.SHIFT_CONFIG;
  var Core = window.ShiftCore;
  var storage = window.ShiftStore.createStorage(cfg);

  var DEVICE_KEY = window.ShiftStore.PREFIX + "device";

  // ---- 状態 ----
  var employees = [];
  var me = null;
  var selectedWeekStart = Core.getWeekStart(Core.addDays(Core.todayStr(), 7), cfg.WEEK_STARTS_ON); // デフォルトは来週
  var weekData = { requests: [], assignments: [], meta: { published: false } };
  var draft = {};          // { date: { status: "none"|"work"|"off", blocks: { defId: {start,end} } } }
  var weekNote = "";
  var openEditor = null;   // { date, defId }
  var mode = "request";    // "request" | "result"
  var showEveryone = false;

  // ---- 要素 ----
  var $ = function (id) { return document.getElementById(id); };

  /* ===== 初期化 ===== */

  document.addEventListener("DOMContentLoaded", function () {
    $("store-name").textContent = cfg.STORE_NAME;
    $("deadline-note").textContent = cfg.SUBMIT_DEADLINE_TEXT || "";
    if (storage.mode === "local") $("demo-banner").classList.remove("hidden");

    bindEvents();

    storage.init()
      .then(function () { return storage.listEmployees(); })
      .then(function (list) {
        employees = list.filter(function (e) { return e.active; });
        var device = readDevice();
        if (device && device.employeeId) {
          me = employees.find(function (e) { return e.id === device.employeeId; }) || null;
        }
        if (me) {
          showMainView();
        } else {
          showNameView();
        }
      })
      .catch(function (err) {
        Core.toast("読み込みに失敗しました: " + err.message, true);
        showNameView();
      });
  });

  function readDevice() {
    try {
      return JSON.parse(localStorage.getItem(DEVICE_KEY) || "null");
    } catch (e) { return null; }
  }

  function writeDevice(employeeId) {
    localStorage.setItem(DEVICE_KEY, JSON.stringify({ employeeId: employeeId }));
  }

  /* ===== ビューA: 名前選択 ===== */

  function showNameView() {
    $("view-name").classList.remove("hidden");
    $("view-main").classList.add("hidden");
    $("submit-bar").classList.add("hidden");
    $("me-chip").classList.add("hidden");
    $("submit-badge").classList.add("hidden");

    var grid = $("name-grid");
    grid.innerHTML = "";
    if (employees.length === 0) {
      $("name-empty").classList.remove("hidden");
    } else {
      $("name-empty").classList.add("hidden");
      employees.forEach(function (emp) {
        var btn = document.createElement("button");
        btn.className = "name-card glass";
        btn.type = "button";
        btn.innerHTML = '<span class="dot" style="color:' + emp.color + ';background:' + emp.color + '"></span>' +
          Core.escapeHtml(emp.name);
        btn.addEventListener("click", function () { selectEmployee(emp); });
        grid.appendChild(btn);
      });
    }

    if (cfg.ALLOW_SELF_REGISTER) $("self-register").classList.remove("hidden");
  }

  function selectEmployee(emp) {
    me = emp;
    writeDevice(emp.id);
    showMainView();
  }

  /* ===== ビューB: メイン(週入力/確定閲覧) ===== */

  function showMainView() {
    $("view-name").classList.add("hidden");
    $("view-main").classList.remove("hidden");
    $("me-chip").classList.remove("hidden");
    $("me-name").textContent = me.name;
    $("me-dot").style.background = me.color;
    $("me-dot").style.color = me.color;
    renderWeekSelector();
    loadWeek();
  }

  function renderWeekSelector() {
    var sel = $("week-selector");
    sel.innerHTML = "";
    var labels = ["今週", "来週", "翌々週"];
    labels.forEach(function (label, i) {
      var ws = Core.getWeekStart(Core.addDays(Core.todayStr(), i * 7), cfg.WEEK_STARTS_ON);
      var p = Core.dateParts(ws);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "week-tab" + (ws === selectedWeekStart ? " is-active" : "");
      btn.innerHTML = label + '<br><span class="text-xs">' + p.md + '〜</span>';
      btn.addEventListener("click", function () {
        if (selectedWeekStart === ws) return;
        selectedWeekStart = ws;
        openEditor = null;
        showEveryone = false;
        renderWeekSelector();
        loadWeek();
      });
      sel.appendChild(btn);
    });
  }

  function loadWeek() {
    storage.getWeek(selectedWeekStart)
      .then(function (data) {
        weekData = data;
        buildDraft();
        // 公開済みの週はまず確定シフトを見せる
        mode = weekData.meta && weekData.meta.published ? "result" : "request";
        renderMain();
      })
      .catch(function (err) {
        Core.toast("読み込みに失敗しました: " + err.message, true);
      });
  }

  // 保存済みの自分の希望から下書きを組み立てる
  function buildDraft() {
    draft = {};
    weekNote = "";
    var myRequests = weekData.requests.filter(function (r) { return r.employeeId === me.id; });
    Core.weekDates(selectedWeekStart).forEach(function (date) {
      var rec = myRequests.find(function (r) { return r.date === date; });
      if (!rec) {
        draft[date] = { status: "none", blocks: {} };
      } else if (rec.status === "off") {
        draft[date] = { status: "off", blocks: {} };
      } else {
        draft[date] = { status: "work", blocks: mapBlocksToDefs(Core.parseBlocks(rec.blocks)) };
      }
    });
    myRequests.forEach(function (r) {
      if (!weekNote && r.note) weekNote = r.note;
    });
    $("week-note").value = weekNote;
    if (weekNote) {
      $("note-body").classList.remove("hidden");
      $("note-toggle-mark").textContent = "▲";
    }
  }

  // 保存された実時刻ブロックを設定のブロック定義に対応付ける
  // (完全一致 → 重なりが最大の定義、の順で割り当て)
  function mapBlocksToDefs(blocks) {
    var result = {};
    var used = {};
    blocks.forEach(function (b) {
      var def = null;
      for (var i = 0; i < cfg.BLOCKS.length; i++) {
        var d = cfg.BLOCKS[i];
        if (!used[d.id] && d.start === b.start && d.end === b.end) { def = d; break; }
      }
      if (!def) {
        var best = null, bestOverlap = -Infinity;
        cfg.BLOCKS.forEach(function (d) {
          if (used[d.id]) return;
          var ov = Math.min(Core.timeToMin(d.end), Core.timeToMin(b.end)) -
                   Math.max(Core.timeToMin(d.start), Core.timeToMin(b.start));
          if (ov > bestOverlap) { bestOverlap = ov; best = d; }
        });
        def = best;
      }
      if (def) {
        used[def.id] = true;
        result[def.id] = { start: b.start, end: b.end };
      }
    });
    return result;
  }

  function renderMain() {
    var published = weekData.meta && weekData.meta.published;
    var tabs = $("mode-tabs");
    if (published) {
      tabs.classList.remove("hidden");
      $("tab-request").classList.toggle("is-active", mode === "request");
      $("tab-result").classList.toggle("is-active", mode === "result");
    } else {
      tabs.classList.add("hidden");
      mode = "request";
    }

    renderBadge();

    if (mode === "request") {
      $("request-view").classList.remove("hidden");
      $("result-view").classList.add("hidden");
      $("submit-bar").classList.remove("hidden");
      renderDays();
      renderSubmitBar();
    } else {
      $("request-view").classList.add("hidden");
      $("result-view").classList.remove("hidden");
      $("submit-bar").classList.add("hidden");
      renderResult();
    }
  }

  function renderBadge() {
    var badge = $("submit-badge");
    badge.classList.remove("hidden");
    var myRequests = weekData.requests.filter(function (r) { return r.employeeId === me.id; });
    if (myRequests.length > 0) {
      var latest = myRequests.reduce(function (a, b) {
        return a.updatedAt > b.updatedAt ? a : b;
      });
      var d = new Date(latest.updatedAt);
      var stamp = (d.getMonth() + 1) + "/" + d.getDate() + " " +
        String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
      badge.className = "badge is-ok";
      badge.textContent = "提出済み " + stamp;
    } else {
      badge.className = "badge is-warn";
      badge.textContent = "未提出";
    }
  }

  /* ===== 希望入力ビュー ===== */

  function renderDays() {
    var list = $("day-list");
    var today = Core.todayStr();
    var html = "";

    Core.weekDates(selectedWeekStart).forEach(function (date) {
      var d = draft[date];
      var p = Core.dateParts(date);
      var dowClass = p.dowIndex === 0 ? " is-sun" : (p.dowIndex === 6 ? " is-sat" : "");
      var statusText = d.status === "work" ? "出勤希望" : (d.status === "off" ? "休み希望" : "未定");

      html += '<div class="day-card glass' + (date === today ? " is-today" : "") + '">';
      html += '<div class="day-head">';
      html += '<span class="day-date">' + p.md + '<span class="dow' + dowClass + '">(' + p.dow + ')</span></span>';
      html += '<span class="day-status">' + statusText + '</span>';
      html += '</div>';

      // ブロック選択ボタン列
      html += '<div class="block-row">';
      cfg.BLOCKS.forEach(function (def) {
        var on = d.status === "work" && d.blocks[def.id];
        html += '<button type="button" class="block-btn' + (on ? " is-on" : "") + '"' +
          ' data-action="toggle" data-date="' + date + '" data-def="' + def.id + '">' +
          '<span class="block-icon">' + Core.escapeHtml(def.icon || "") + '</span>' +
          Core.escapeHtml(def.label) + '</button>';
      });
      var offOn = d.status === "off";
      html += '<button type="button" class="block-btn block-off' + (offOn ? " is-on" : "") + '"' +
        ' data-action="toggle" data-date="' + date + '" data-def="__off__">' +
        '<span class="block-icon">✕</span>休み</button>';
      html += '</div>';

      // 選択済みブロックの時刻表示
      if (d.status === "work") {
        html += '<div class="time-summary">';
        cfg.BLOCKS.forEach(function (def) {
          var b = d.blocks[def.id];
          if (!b) return;
          html += '<button type="button" class="time-pill" data-action="edit" data-date="' + date +
            '" data-def="' + def.id + '">' + b.start + '-' + b.end +
            ' <span class="edit-mark">調整 ▾</span></button>';
        });
        html += '</div>';
      }

      // 時刻微調整エディタ(開いている場合)
      if (openEditor && openEditor.date === date && d.status === "work" && d.blocks[openEditor.defId]) {
        var eb = d.blocks[openEditor.defId];
        html += '<div class="time-editor">';
        html += stepperRowHtml("開始", date, openEditor.defId, "start", eb.start);
        html += stepperRowHtml("終了", date, openEditor.defId, "end", eb.end);
        html += '<div class="time-editor-actions">' +
          '<button type="button" class="btn btn-sm" data-action="reset-time" data-date="' + date +
          '" data-def="' + openEditor.defId + '">リセット</button>' +
          '<button type="button" class="btn btn-sm" data-action="close-editor">完了</button>' +
          '</div>';
        html += '</div>';
      }

      html += '</div>';
    });

    list.innerHTML = html;
  }

  function stepperRowHtml(label, date, defId, field, value) {
    return '<div class="stepper-row">' +
      '<span class="stepper-label">' + label + '</span>' +
      '<div class="stepper">' +
      '<button type="button" class="stepper-btn" data-action="step" data-date="' + date +
      '" data-def="' + defId + '" data-field="' + field + '" data-dir="-1">−</button>' +
      '<span class="stepper-value">' + value + '</span>' +
      '<button type="button" class="stepper-btn" data-action="step" data-date="' + date +
      '" data-def="' + defId + '" data-field="' + field + '" data-dir="1">＋</button>' +
      '</div></div>';
  }

  function renderSubmitBar() {
    var workDays = 0, offDays = 0;
    Object.keys(draft).forEach(function (date) {
      if (draft[date].status === "work") workDays++;
      if (draft[date].status === "off") offDays++;
    });
    var noneDays = 7 - workDays - offDays;
    $("submit-summary").innerHTML =
      '<strong>出勤 ' + workDays + '日</strong><br>休み ' + offDays + '日・未入力 ' + noneDays + '日';
  }

  /* ===== 操作(イベント委譲) ===== */

  function bindEvents() {
    $("day-list").addEventListener("click", function (e) {
      var el = e.target.closest("[data-action]");
      if (!el) return;
      var action = el.dataset.action;
      var date = el.dataset.date;
      var defId = el.dataset.def;

      if (action === "toggle") toggleBlock(date, defId);
      else if (action === "edit") {
        openEditor = (openEditor && openEditor.date === date && openEditor.defId === defId)
          ? null : { date: date, defId: defId };
        renderDays();
      }
      else if (action === "step") stepTime(date, defId, el.dataset.field, Number(el.dataset.dir));
      else if (action === "reset-time") resetTime(date, defId);
      else if (action === "close-editor") { openEditor = null; renderDays(); }
    });

    $("note-toggle").addEventListener("click", function () {
      var body = $("note-body");
      var opened = body.classList.toggle("hidden");
      $("note-toggle-mark").textContent = opened ? "▼" : "▲";
    });

    $("submit-btn").addEventListener("click", submit);

    $("me-chip").addEventListener("click", function () {
      var m = Core.openModal(
        '<div class="modal-title">名前を変更しますか?</div>' +
        '<p class="text-mid text-xs">この端末に記憶された名前をリセットして、名前選択に戻ります。</p>' +
        '<div class="modal-actions">' +
        '<button type="button" class="btn" data-role="cancel">キャンセル</button>' +
        '<button type="button" class="btn btn-primary" data-role="ok">変更する</button>' +
        '</div>'
      );
      m.el.querySelector('[data-role="cancel"]').addEventListener("click", m.close);
      m.el.querySelector('[data-role="ok"]').addEventListener("click", function () {
        m.close();
        localStorage.removeItem(DEVICE_KEY);
        me = null;
        showNameView();
      });
    });

    $("tab-request").addEventListener("click", function () { mode = "request"; renderMain(); });
    $("tab-result").addEventListener("click", function () { mode = "result"; renderMain(); });

    $("toggle-everyone").addEventListener("click", function () {
      showEveryone = !showEveryone;
      renderResult();
    });

    $("self-register-btn").addEventListener("click", function () {
      var name = $("self-register-name").value.trim();
      if (!name) { Core.toast("名前を入力してください", true); return; }
      storage.saveEmployee({ name: name })
        .then(function (emp) {
          employees.push(emp);
          selectEmployee(emp);
          Core.toast("登録しました");
        })
        .catch(function (err) { Core.toast("登録に失敗しました: " + err.message, true); });
    });
  }

  function toggleBlock(date, defId) {
    var d = draft[date];

    if (defId === "__off__") {
      // 休みは単独選択(全ブロックを解除)
      if (d.status === "off") {
        d.status = "none";
      } else {
        d.status = "off";
        d.blocks = {};
      }
    } else if (d.status === "work" && d.blocks[defId]) {
      // 選択解除
      delete d.blocks[defId];
      if (Object.keys(d.blocks).length === 0) d.status = "none";
    } else {
      // 選択: 時間帯が重なる既存ブロックは解除する(例: 終日⇔ランチ/ディナー)
      var def = cfg.BLOCKS.find(function (b) { return b.id === defId; });
      if (!def) return;
      Object.keys(d.blocks).forEach(function (otherId) {
        var other = d.blocks[otherId];
        var overlap = Core.timeToMin(other.start) < Core.timeToMin(def.end) &&
                      Core.timeToMin(def.start) < Core.timeToMin(other.end);
        if (overlap) delete d.blocks[otherId];
      });
      d.blocks[defId] = { start: def.start, end: def.end };
      d.status = "work";
    }

    if (openEditor && openEditor.date === date &&
        (d.status !== "work" || !d.blocks[openEditor.defId])) {
      openEditor = null;
    }
    renderDays();
    renderSubmitBar();
  }

  function stepTime(date, defId, field, dir) {
    var b = draft[date] && draft[date].blocks[defId];
    if (!b) return;
    var step = cfg.TIME_STEP_MIN;
    var min = Core.timeToMin(b[field]) + dir * step;
    if (field === "start") {
      min = Math.max(cfg.OPEN_HOUR * 60, Math.min(min, Core.timeToMin(b.end) - step));
    } else {
      min = Math.min(cfg.CLOSE_HOUR * 60, Math.max(min, Core.timeToMin(b.start) + step));
    }
    b[field] = Core.minToTime(min);
    renderDays();
  }

  function resetTime(date, defId) {
    var def = cfg.BLOCKS.find(function (b) { return b.id === defId; });
    var b = draft[date] && draft[date].blocks[defId];
    if (def && b) {
      b.start = def.start;
      b.end = def.end;
      renderDays();
    }
  }

  /* ===== 送信 ===== */

  function submit() {
    var note = $("week-note").value.trim();
    var requests = [];
    var noteAttached = false;

    Core.weekDates(selectedWeekStart).forEach(function (date) {
      var d = draft[date];
      if (d.status === "none") return;
      var blocks = [];
      if (d.status === "work") {
        cfg.BLOCKS.forEach(function (def) {
          if (d.blocks[def.id]) blocks.push(d.blocks[def.id]);
        });
        blocks.sort(function (a, b) { return Core.timeToMin(a.start) - Core.timeToMin(b.start); });
      }
      requests.push({
        id: Core.uid("req"),
        weekStart: selectedWeekStart,
        employeeId: me.id,
        date: date,
        status: d.status,
        blocks: Core.serializeBlocks(blocks),
        note: noteAttached ? "" : note,
        updatedAt: Core.nowIso()
      });
      noteAttached = true;
    });

    if (requests.length === 0) {
      Core.toast("希望する日をタップしてから送信してください", true);
      return;
    }

    var btn = $("submit-btn");
    btn.disabled = true;
    btn.textContent = "送信中…";

    storage.saveRequests(selectedWeekStart, me.id, requests)
      .then(function () {
        btn.classList.add("is-success");
        btn.textContent = "✓ 送信しました";
        Core.toast("希望を送信しました");
        return storage.getWeek(selectedWeekStart);
      })
      .then(function (data) {
        weekData = data;
        renderBadge();
        setTimeout(function () {
          btn.classList.remove("is-success");
          btn.disabled = false;
          btn.textContent = "希望を送信";
        }, 1800);
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "希望を送信";
        Core.toast("送信に失敗しました: " + err.message + " — もう一度お試しください", true);
      });
  }

  /* ===== ビューC: 確定シフト ===== */

  function renderResult() {
    var list = $("result-list");
    var html = "";
    var myAssignments = weekData.assignments.filter(function (a) { return a.employeeId === me.id; });

    Core.weekDates(selectedWeekStart).forEach(function (date) {
      var p = Core.dateParts(date);
      var dowClass = p.dowIndex === 0 ? " is-sun" : (p.dowIndex === 6 ? " is-sat" : "");
      var mine = myAssignments.filter(function (a) { return a.date === date; })
        .sort(function (a, b) { return Core.timeToMin(a.start) - Core.timeToMin(b.start); });

      html += '<div class="result-row glass">';
      html += '<span class="result-date">' + p.md + '<span class="dow' + dowClass + ' text-xs">(' + p.dow + ')</span></span>';
      html += '<div class="result-chips">';
      if (mine.length === 0) {
        html += '<span class="shift-chip is-off">休み</span>';
      } else {
        mine.forEach(function (a) {
          var label = Core.blockLabel({ start: a.start, end: a.end }, cfg);
          var text = label === a.start + "-" + a.end ? label : label + " " + a.start + "-" + a.end;
          html += '<span class="shift-chip">' + Core.escapeHtml(text) + '</span>';
        });
      }
      html += '</div></div>';
    });
    list.innerHTML = html;

    // 全員分の簡易表
    var everyone = $("everyone-list");
    $("toggle-everyone").textContent = showEveryone ? "全員分を閉じる" : "全員分を見る";
    if (!showEveryone) {
      everyone.classList.add("hidden");
      return;
    }
    everyone.classList.remove("hidden");
    var ehtml = "";
    Core.weekDates(selectedWeekStart).forEach(function (date) {
      var p = Core.dateParts(date);
      var todays = weekData.assignments.filter(function (a) { return a.date === date; })
        .sort(function (a, b) { return Core.timeToMin(a.start) - Core.timeToMin(b.start); });
      ehtml += '<div class="result-row glass">';
      ehtml += '<span class="result-date">' + p.md + '<span class="text-xs text-mid">(' + p.dow + ')</span></span>';
      ehtml += '<div class="result-chips">';
      if (todays.length === 0) {
        ehtml += '<span class="text-xs text-mid">—</span>';
      } else {
        todays.forEach(function (a) {
          var emp = employees.find(function (e) { return e.id === a.employeeId; });
          var name = emp ? emp.name : "?";
          var color = emp ? emp.color : "#93A5C4";
          ehtml += '<span class="shift-chip" style="border-color:' + color + ';color:' + color +
            ';box-shadow:0 0 8px ' + color + '44">' +
            Core.escapeHtml(name) + " " + a.start + "-" + a.end + '</span>';
        });
      }
      ehtml += '</div></div>';
    });
    everyone.innerHTML = ehtml;
  }
})();
