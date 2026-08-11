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
  var justStamped = {};   // 押した直後のコマだけ判子アニメを再生する(id → true)

  var $ = function (id) { return document.getElementById(id); };

  /* ===== 初期化・PINゲート ===== */

  document.addEventListener("DOMContentLoaded", function () {
    $("store-name").textContent = cfg.STORE_NAME;
    Core.setupDemoBanner(storage.mode === "local");
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
      if (k === "OK") btn.style.fontSize = "0.95rem";
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
      '<div class="dialog-title">管理者トークン</div>' +
      '<p class="lede">' + Core.escapeHtml(message) + '</p>' +
      '<div class="dialog-body"><input type="password" id="token-input" placeholder="トークン"></div>' +
      '<div class="dialog-actions">' +
      '<button type="button" class="btn" data-role="skip">閲覧のみ</button>' +
      '<button type="button" class="btn btn-ink" data-role="save">保存</button>' +
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
    renderBulkButton();
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
    $("bulk-btn").addEventListener("click", onBulkConfirm);
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
    el.innerHTML = '提出 <span class="num">' + count + "/" + active.length + '</span>';
    el.className = "note-mark" + (active.length > 0 && count === active.length ? " is-done" : " is-pending");
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
      badge.className = "note-mark";
      badge.textContent = "下書き";
      btn.textContent = "スタッフに公開";
    } else if (hasChangesAfterPublish()) {
      badge.className = "note-mark is-pending";
      badge.textContent = "公開済み(変更あり)";
      btn.textContent = "変更を公開";
    } else {
      badge.className = "note-mark is-done";
      badge.innerHTML = Core.stampHtml(false) + " 公開済み";
      btn.textContent = "共有する";
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
    var bands = cfg.COVERAGE || [];

    grid.style.gridTemplateColumns = "168px repeat(7, minmax(116px, 1fr))";
    var html = "";

    // 見出し帯 — 日付と、その日の充足をタリーで示す
    html += '<div class="cell cell-head cell-corner">' +
      '<span class="corner-title">スタッフ</span>' +
      '<span class="corner-sub">' + activeCount + '名 / 週7日</span></div>';
    dates.forEach(function (date) {
      var p = Core.dateParts(date);
      var weekend = p.dowIndex === 0 || p.dowIndex === 6;
      html += '<div class="cell cell-head' + (date === today ? " is-today" : "") +
        (weekend ? " is-weekend" : "") + '">' +
        '<span class="head-date">' + p.md + '</span><span class="head-dow">' + p.dow + '</span>';
      html += '<div class="head-tallies">';
      bands.forEach(function (band) {
        html += Core.tallyHtml(countCoverage(date, band), band.need, band.label);
      });
      html += '</div></div>';
    });

    // スタッフの行 — 名前と提出時刻
    emps.forEach(function (emp) {
      var note = notes[emp.id];
      var when = submitStamp(emp.id);
      var color = Core.tagColor(emp.color, emp.sortOrder);
      html += '<div class="cell cell-name' + (emp.active ? "" : " is-inactive") + '"' +
        (note ? ' data-action="show-note" data-emp="' + emp.id + '" style="cursor:pointer;" title="' + Core.escapeHtml(note) + '"' : "") + '>' +
        '<span class="tag-dot" style="background:' + color + '"></span>' +
        '<span class="name-block">' +
        '<span class="name-main">' + Core.escapeHtml(emp.name) + (emp.active ? "" : "(無効)") +
        (note ? ' <span title="備考あり">✎</span>' : "") + '</span>' +
        (when
          ? '<span class="name-sub">' + when + ' 提出</span>'
          : '<span class="name-sub is-pending">未提出</span>') +
        '</span></div>';
      dates.forEach(function (date) {
        var p = Core.dateParts(date);
        html += renderSlotCell(emp, date, color, p.dowIndex === 0 || p.dowIndex === 6);
      });
    });

    grid.innerHTML = html;
    justStamped = {};   // アニメは押した直後の1回だけ
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

  // 固定の時間帯と完全一致する枠を返す(なければnull)。
  // 「時間指定」の枠はラベルを持たせず、時刻をそのまま見せる
  function findDef(start, end) {
    for (var i = 0; i < cfg.BLOCKS.length; i++) {
      var d = cfg.BLOCKS[i];
      if (!d.custom && d.start === start && d.end === end) return d;
    }
    return null;
  }

  // 記入の中身(1行目=時間帯の名前 / 2行目=時刻。定義外の時間は時刻のみ)
  function markInner(start, end) {
    var def = findDef(start, end);
    if (def) {
      return '<span class="mark-label">' + Core.escapeHtml(def.label) + '</span>' +
        '<span class="mark-time">' + start + "–" + end + '</span>';
    }
    return '<span class="mark-label">' + start + "–" + end + '</span>';
  }

  function renderSlotCell(emp, date, color, isWeekend) {
    var assignments = weekData.assignments
      .filter(function (a) { return a.employeeId === emp.id && a.date === date; })
      .sort(function (a, b) { return Core.timeToMin(a.start) - Core.timeToMin(b.start); });
    var request = weekData.requests.find(function (r) {
      return r.employeeId === emp.id && r.date === date;
    });

    var marks = "";

    // 確定 — 判子を押した記入
    assignments.forEach(function (a) {
      marks += '<div class="mark mark-fixed" style="--tag:' + color + '"' +
        ' data-action="open-assigned" data-id="' + a.id + '" title="タップで時間の変更・取り消し">' +
        markInner(a.start, a.end) +
        (a.note ? '<span class="mark-memo">' + Core.escapeHtml(a.note) + '</span>' : "") +
        Core.stampHtml(!!justStamped[a.id]) +
        '</div>';
    });

    // 希望 — 鉛筆書き。すでに確定と重なっている希望は出さない
    if (request) {
      if (request.status === "off") {
        marks += '<div class="mark mark-off" title="休み希望">休み</div>';
      } else {
        Core.parseBlocks(request.blocks).forEach(function (b) {
          var covered = assignments.some(function (a) {
            return Core.timeToMin(a.start) < Core.timeToMin(b.end) &&
                   Core.timeToMin(b.start) < Core.timeToMin(a.end);
          });
          if (covered) return;
          marks += '<div class="mark mark-wish" style="--tag:' + color + '"' +
            ' data-action="promote" data-emp="' + emp.id + '" data-date="' + date +
            '" data-start="' + b.start + '" data-end="' + b.end + '" title="タップで確定">' +
            markInner(b.start, b.end) + '</div>';
        });
      }
    }

    return '<div class="cell cell-slot' + (isWeekend ? " is-weekend" : "") +
      '" data-action="add-shift" data-emp="' + emp.id +
      '" data-date="' + date + '" title="空いているところをタップで追加">' + marks + '</div>';
  }

  /* ===== グリッド操作 ===== */

  function onGridClick(e) {
    var el = e.target.closest("[data-action]");
    if (!el) return;
    var action = el.dataset.action;

    if (action === "promote") {
      // 希望をタップ: 時間を調整してから確定してもらう
      openShiftDialog({
        employeeId: el.dataset.emp,
        date: el.dataset.date,
        start: el.dataset.start,
        end: el.dataset.end
      });
    } else if (action === "open-assigned") {
      // 確定をタップ: 時間の変更と取り消し
      var a = weekData.assignments.find(function (x) { return x.id === el.dataset.id; });
      if (a) {
        openShiftDialog({
          employeeId: a.employeeId, date: a.date,
          start: a.start, end: a.end, assignmentId: a.id
        });
      }
    } else if (action === "add-shift") {
      var def = cfg.BLOCKS.find(function (b) { return b.custom; }) || cfg.BLOCKS[0];
      openShiftDialog({
        employeeId: el.dataset.emp,
        date: el.dataset.date,
        start: def.start,
        end: def.end
      });
    } else if (action === "show-note") {
      var emp = employees.find(function (x) { return x.id === el.dataset.emp; });
      var note = notesByEmployee()[el.dataset.emp] || "";
      Core.openModal(
        '<div class="dialog-title">' + Core.escapeHtml(emp ? emp.name : "") + ' さんのメモ</div>' +
        '<p>' + Core.escapeHtml(note) + '</p>'
      );
    }
  }

  function addAssignment(employeeId, date, start, end, note) {
    var id = Core.uid("asg");
    justStamped[id] = true;   // このコマだけ判子が押されるアニメを再生する
    weekData.assignments.push({
      id: id,
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
    renderBulkButton();
    storage.saveAssignments(weekStart, weekData.assignments).catch(handleError);
  }

  /* ===== 記入ダイアログ ===== */

  // 時刻ステッパー(開始/終了のペア)。state.set(start, end) で外から入れ替えられる
  function buildTimeSteppers(container, initial) {
    var state = { start: initial.start, end: initial.end };
    container.innerHTML =
      stepperHtml("開始", "start", state.start) +
      stepperHtml("終了", "end", state.end);

    function paint() {
      container.querySelector('[data-value="start"]').textContent = state.start;
      container.querySelector('[data-value="end"]').textContent = state.end;
    }

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
      paint();
    });

    state.set = function (s, e) { state.start = s; state.end = e; paint(); };
    return state;
  }

  function stepperHtml(label, field, value) {
    return '<div class="adjuster-line">' +
      '<span class="adjuster-label">' + label + '</span>' +
      '<div class="stepper">' +
      '<button type="button" class="stepper-btn" data-field="' + field + '" data-dir="-1" aria-label="' + label + 'を15分もどす">−</button>' +
      '<span class="stepper-value num" data-value="' + field + '">' + value + '</span>' +
      '<button type="button" class="stepper-btn" data-field="' + field + '" data-dir="1" aria-label="' + label + 'を15分すすめる">＋</button>' +
      '</div></div>';
  }

  // 記入をタップしたときのダイアログ。
  // 希望をタップ → 時間を調整して確定 / 確定をタップ → 変更・取り消し /
  // 空欄をタップ → 追加。どの入口でも「時間を決めてから押す」形に揃えている。
  function openShiftDialog(opts) {
    var emp = employees.find(function (x) { return x.id === opts.employeeId; });
    var p = Core.dateParts(opts.date);
    var existing = opts.assignmentId
      ? weekData.assignments.find(function (a) { return a.id === opts.assignmentId; })
      : null;

    // その日に出ている希望(「希望どおり」に戻すために使う)
    var request = weekData.requests.find(function (r) {
      return r.employeeId === opts.employeeId && r.date === opts.date;
    });
    var wishes = request && request.status === "work" ? Core.parseBlocks(request.blocks) : [];
    var wantsOff = !!(request && request.status === "off");

    var wishLine;
    if (wantsOff) {
      wishLine = '<p class="lede-warn">この日は「休み」の希望が出ています</p>';
    } else if (wishes.length) {
      wishLine = '<p class="wish-line">希望 ' + wishes.map(function (b) {
        return '<span class="num">' + b.start + '–' + b.end + '</span>';
      }).join(" / ") + '</p>';
    } else {
      wishLine = '<p class="lede">この日の希望は出ていません</p>';
    }

    // ワンタップで入れ直せる時間
    var presets = wishes.map(function (b, i) {
      return { key: "wish" + i, label: "希望どおり", start: b.start, end: b.end };
    });
    cfg.BLOCKS.filter(function (d) { return !d.custom; }).forEach(function (d) {
      presets.push({ key: d.id, label: d.label, start: d.start, end: d.end });
    });
    var presetHtml = presets.map(function (ps) {
      return '<button type="button" class="btn preset" data-preset="' + ps.key +
        '" data-start="' + ps.start + '" data-end="' + ps.end + '">' +
        Core.escapeHtml(ps.label) + ' <span class="num">' + ps.start + '–' + ps.end + '</span></button>';
    }).join("");

    var actions = existing
      ? '<button type="button" class="btn btn-danger" data-role="delete">確定を取り消す</button>' +
        '<span class="spacer"></span>' +
        '<button type="button" class="btn" data-role="cancel">やめる</button>' +
        '<button type="button" class="btn btn-stamp" data-role="ok">' + Core.stampHtml(false) + ' 変更する</button>'
      : '<button type="button" class="btn" data-role="cancel">やめる</button>' +
        '<button type="button" class="btn btn-stamp" data-role="ok">' + Core.stampHtml(false) + ' 確定する</button>';

    var m = Core.openModal(
      '<div class="dialog-title">' + Core.escapeHtml(emp ? emp.name : "") +
        ' <span class="num">' + p.md + '</span>(' + p.dow + ')</div>' +
      '<div class="dialog-body">' +
      wishLine +
      '<div><span class="field-label">時間</span><div id="dlg-steppers"></div></div>' +
      (presetHtml ? '<div class="preset-row">' + presetHtml + '</div>' : "") +
      '<div><span class="field-label">備考(任意)</span>' +
      '<input type="text" id="edit-note" maxlength="40" value="' +
        Core.escapeHtml(existing ? (existing.note || "") : "") + '"></div>' +
      '</div>' +
      '<div class="dialog-actions">' + actions + '</div>'
    );

    var timeState = buildTimeSteppers(m.el.querySelector("#dlg-steppers"),
      { start: opts.start, end: opts.end });

    m.el.querySelectorAll("[data-preset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        timeState.set(btn.dataset.start, btn.dataset.end);
      });
    });

    m.el.querySelector('[data-role="cancel"]').addEventListener("click", m.close);

    var del = m.el.querySelector('[data-role="delete"]');
    if (del) {
      del.addEventListener("click", function () {
        m.close();
        removeAssignment(existing.id);
      });
    }

    m.el.querySelector('[data-role="ok"]').addEventListener("click", function () {
      var note = m.el.querySelector("#edit-note").value.trim();
      m.close();
      if (existing) {
        updateAssignment(existing.id, { start: timeState.start, end: timeState.end, note: note });
      } else {
        addAssignment(opts.employeeId, opts.date, timeState.start, timeState.end, note);
      }
    });
  }

  /* ===== 一括確定 ===== */

  // まだ確定していない希望を集める(確定と時間が重なっているものは済みとみなす)
  function pendingWishes() {
    var out = [];
    weekData.requests.forEach(function (r) {
      if (r.status !== "work") return;
      Core.parseBlocks(r.blocks).forEach(function (b) {
        var covered = weekData.assignments.some(function (a) {
          return a.employeeId === r.employeeId && a.date === r.date &&
            Core.timeToMin(a.start) < Core.timeToMin(b.end) &&
            Core.timeToMin(b.start) < Core.timeToMin(a.end);
        });
        if (!covered) {
          out.push({ employeeId: r.employeeId, date: r.date, start: b.start, end: b.end });
        }
      });
    });
    return out;
  }

  function onBulkConfirm() {
    var pending = pendingWishes();
    if (!pending.length) {
      Core.toast("まだ確定していない希望はありません");
      return;
    }

    // 日ごとに何件つくかを見せてから押してもらう
    var byDate = {};
    pending.forEach(function (w) { byDate[w.date] = (byDate[w.date] || 0) + 1; });
    var lines = Core.weekDates(weekStart).filter(function (d) { return byDate[d]; })
      .map(function (d) {
        var p = Core.dateParts(d);
        return '<li>' + p.md + '(' + p.dow + ') <span class="num">' + byDate[d] + '</span>件</li>';
      }).join("");

    var m = Core.openModal(
      '<div class="dialog-title">希望どおりまとめて確定</div>' +
      '<div class="dialog-body">' +
      '<p class="lede">出された時間のまま、<b class="num">' + pending.length +
        '</b>件を確定します。すでに確定しているコマはそのままです。</p>' +
      '<ul class="bulk-list">' + lines + '</ul>' +
      '<p class="lede">確定したあと、1件ずつタップして時間を直すこともできます。</p>' +
      '</div>' +
      '<div class="dialog-actions">' +
      '<button type="button" class="btn" data-role="cancel">やめる</button>' +
      '<button type="button" class="btn btn-stamp" data-role="ok">' + Core.stampHtml(false) +
        ' まとめて確定</button>' +
      '</div>'
    );
    m.el.querySelector('[data-role="cancel"]').addEventListener("click", m.close);
    m.el.querySelector('[data-role="ok"]').addEventListener("click", function () {
      m.close();
      pending.forEach(function (w) {
        var id = Core.uid("asg");
        justStamped[id] = true;
        weekData.assignments.push({
          id: id,
          weekStart: weekStart,
          employeeId: w.employeeId,
          date: w.date,
          start: w.start,
          end: w.end,
          note: "",
          updatedAt: Core.nowIso()
        });
      });
      persistAssignments();
      Core.toast(pending.length + "件を確定しました");
    });
  }

  // 未確定の希望が無いときはボタンを休ませる
  function renderBulkButton() {
    var btn = $("bulk-btn");
    if (!btn) return;
    var n = pendingWishes().length;
    btn.disabled = n === 0;
    btn.textContent = n ? "希望どおり確定 (" + n + ")" : "希望どおり確定";
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
    var bands = cfg.COVERAGE || [];
    Core.weekDates(weekStart).forEach(function (date) {
      var p = Core.dateParts(date);
      bands.forEach(function (band) {
        var count = countCoverage(date, band);
        if (count < band.need) {
          warnings.push(p.md + "(" + p.dow + ") " + band.label + " " + count + "/" + band.need + "人");
        }
      });
    });

    var warnHtml = warnings.length
      ? '<p class="lede-warn">人数が足りていないコマがあります<br>' +
        warnings.map(Core.escapeHtml).join("<br>") + '</p>'
      : '<p class="lede-ok">すべてのコマで必要人数を満たしています。</p>';

    var m = Core.openModal(
      '<div class="dialog-title">この週をスタッフに公開しますか?</div>' +
      '<div class="dialog-body">' + warnHtml +
      '<p class="lede">確定すると、スタッフの画面に確定シフトが出るようになります。</p></div>' +
      '<div class="dialog-actions">' +
      '<button type="button" class="btn" data-role="cancel">やめる</button>' +
      '<button type="button" class="btn btn-stamp" data-role="ok">公開する</button>' +
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
      // 固定の時間帯は名前をまとめる。時間指定の人は個別に時刻を書く
      cfg.BLOCKS.filter(function (d) { return !d.custom; }).forEach(function (def) {
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
      '<div class="dialog-title">確定シフトを共有</div>' +
      '<div class="dialog-body">' +
      '<button type="button" class="btn btn-block" data-role="copy-url">従業員ページのURLをコピー</button>' +
      '<button type="button" class="btn btn-block" data-role="copy-text">共有テキストをコピー(LINE貼り付け用)</button>' +
      '<div class="share-preview">' + Core.escapeHtml(text) + '</div>' +
      '</div>' +
      '<div class="dialog-actions">' +
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
      '<div class="dialog-title">スタッフ管理</div>' +
      '<div class="dialog-body">' +
      '<div class="roster-edit" id="emp-list"></div>' +
      '<div class="emp-add-row">' +
      '<input type="text" id="emp-add-name" placeholder="名前を入力して追加" maxlength="20">' +
      '<button type="button" class="btn" id="emp-add-btn">追加</button>' +
      '</div>' +
      (storage.mode === "local"
        ? '<button type="button" class="btn btn-danger" id="emp-clear-btn">サンプルデータを全消去</button>'
        : "") +
      '</div>' +
      '<div class="dialog-actions"><button type="button" class="btn" data-role="close">閉じる</button></div>'
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
        return '<div class="roster-edit-row' + (emp.active ? "" : " is-inactive") + '">' +
          '<span class="dot" style="background:' + emp.color + ';color:' + emp.color + '"></span>' +
          '<span class="emp-name">' + Core.escapeHtml(emp.name) + '</span>' +
          (emp.active
            ? '<button type="button" class="btn" data-move="-1" data-id="' + emp.id + '">▲</button>' +
              '<button type="button" class="btn" data-move="1" data-id="' + emp.id + '">▼</button>' +
              '<button type="button" class="btn btn-danger" data-off="' + emp.id + '">無効化</button>'
            : '<button type="button" class="btn" data-on="' + emp.id + '">有効化</button>') +
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
          '<div class="dialog-title">全データを消去しますか?</div>' +
          '<p class="lede">このブラウザに保存されたスタッフ・希望・確定シフトをすべて削除します。元に戻せません。</p>' +
          '<div class="dialog-actions">' +
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
