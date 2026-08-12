/*
 * Shift Sync - 月間シフト表
 *
 * 週単位で保存されているデータから1か月分を組み立て、
 *  - 画面と印刷(PDF)には <table> を、
 *  - 画像(PNG)には Canvas を、
 * 同じ「行列」から描き分ける。外部ライブラリは使わない。
 *
 * このページは確定シフトを見るだけなので、暗証番号も管理者トークンも要らない
 * (スタッフは自分の画面でも全員分の確定シフトを見られる)。
 */
(function () {
  "use strict";

  var cfg = window.SHIFT_CONFIG;
  var Core = window.ShiftCore;
  var storage = window.ShiftStore.createStorage(cfg);
  var DEVICE_KEY = window.ShiftStore.PREFIX + "device";

  // ---- 状態 ----
  var today = new Date();
  var year = today.getFullYear();
  var month = today.getMonth() + 1;
  var scope = "all";          // "all" | "me"
  var me = null;              // 端末に記憶されたスタッフ
  var employees = [];
  var matrix = null;          // 組み立てた行列

  var $ = function (id) { return document.getElementById(id); };

  /* ===== 初期化 ===== */

  document.addEventListener("DOMContentLoaded", function () {
    $("store-name").textContent = cfg.STORE_NAME;
    $("print-store").textContent = cfg.STORE_NAME;
    Core.setupDemoBanner(storage.mode === "local");
    bindControls();

    storage.init()
      .then(function () { return storage.listEmployees(); })
      .then(function (list) {
        employees = list;
        var device = readDevice();
        if (device && device.employeeId) {
          me = employees.find(function (e) { return e.id === device.employeeId; }) || null;
        }
        if (me) {
          $("scope-tabs").classList.remove("hidden");
          // 自分の名前が分かっている端末(スタッフのスマホ)は自分の分から見せる
          // ("#me" は通常のページ、"#month-me" は1枚版デモの入口)
          var h = location.hash;
          if (h === "#me" || h.slice(-3) === "-me") scope = "me";
        }
        load();
      })
      .catch(function (err) {
        Core.toast("読み込みに失敗しました: " + err.message, true);
      });
  });

  function readDevice() {
    try { return JSON.parse(localStorage.getItem(DEVICE_KEY) || "null"); }
    catch (e) { return null; }
  }

  function bindControls() {
    $("month-prev").addEventListener("click", function () { moveMonth(-1); });
    $("month-next").addEventListener("click", function () { moveMonth(1); });
    $("month-today").addEventListener("click", function () {
      var d = new Date();
      year = d.getFullYear();
      month = d.getMonth() + 1;
      load();
    });
    $("scope-all").addEventListener("click", function () { setScope("all"); });
    $("scope-me").addEventListener("click", function () { setScope("me"); });
    $("print-btn").addEventListener("click", onPrint);
    $("image-btn").addEventListener("click", onSaveImage);
  }

  function moveMonth(delta) {
    var m = Core.shiftMonth(year, month, delta);
    year = m.year;
    month = m.month;
    load();
  }

  function setScope(next) {
    if (scope === next) return;
    scope = next;
    render();
  }

  /* ===== データの組み立て ===== */

  // 月に重なる週をまとめて取り、1か月分の行列にする。
  // GASモードではここで5〜6リクエスト走る(月をめくったときだけなので許容)
  function load() {
    var weeks = Core.monthWeekStarts(year, month, cfg.WEEK_STARTS_ON);
    $("month-body").innerHTML = '<p class="blank-state">読み込み中…</p>';

    Promise.all(weeks.map(function (w) { return storage.getWeek(w); }))
      .then(function (results) {
        matrix = buildMatrix(results, weeks);
        render();
      })
      .catch(function (err) {
        $("month-body").innerHTML = '<p class="blank-state">読み込みに失敗しました</p>';
        Core.toast("読み込みに失敗しました: " + err.message, true);
      });
  }

  function buildMatrix(weekResults, weeks) {
    var dates = Core.monthDates(year, month);
    var inMonth = {};
    dates.forEach(function (d) { inMonth[d] = true; });

    // その月に落ちる確定シフトと休み希望だけを集める
    var assignments = [];
    var offDays = {};        // employeeId|date → true
    var unpublished = [];
    weekResults.forEach(function (res, i) {
      res.assignments.forEach(function (a) {
        if (inMonth[a.date]) assignments.push(a);
      });
      res.requests.forEach(function (r) {
        if (inMonth[r.date] && r.status === "off") offDays[r.employeeId + "|" + r.date] = true;
      });
      if (!(res.meta && res.meta.published)) unpublished.push(weeks[i]);
    });

    // 表に出すスタッフ(自分だけモードなら自分のみ)
    var worked = {};
    assignments.forEach(function (a) { worked[a.employeeId] = true; });
    var people = employees
      .filter(function (e) { return e.active || worked[e.id]; })
      .sort(function (a, b) {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (a.sortOrder || 0) - (b.sortOrder || 0);
      });

    var rows = people.map(function (emp) {
      var cells = dates.map(function (date) {
        var mine = assignments
          .filter(function (a) { return a.employeeId === emp.id && a.date === date; })
          .sort(function (a, b) { return Core.timeToMin(a.start) - Core.timeToMin(b.start); });
        if (mine.length) {
          return {
            kind: "work",
            texts: mine.map(cellText),
            minutes: mine.reduce(function (sum, a) {
              return sum + (Core.timeToMin(a.end) - Core.timeToMin(a.start));
            }, 0),
            times: mine.map(function (a) { return a.start + "–" + a.end; })
          };
        }
        if (offDays[emp.id + "|" + date]) return { kind: "off", texts: ["休"], minutes: 0, times: [] };
        return { kind: "none", texts: [], minutes: 0, times: [] };
      });

      var days = cells.filter(function (c) { return c.kind === "work"; }).length;
      var minutes = cells.reduce(function (s, c) { return s + c.minutes; }, 0);
      return { employee: emp, cells: cells, days: days, minutes: minutes };
    });

    // 日ごとの人数
    var perDay = dates.map(function (date) {
      var seen = {};
      assignments.forEach(function (a) { if (a.date === date) seen[a.employeeId] = true; });
      return Object.keys(seen).length;
    });

    return { dates: dates, rows: rows, perDay: perDay, unpublished: unpublished };
  }

  // セルの表記: 決まった時間帯に一致すればその名前、そうでなければ詰めた時刻
  function cellText(a) {
    var label = Core.blockLabel({ start: a.start, end: a.end }, cfg);
    if (label !== a.start + "-" + a.end) return label;
    return compact(a.start) + "-" + compact(a.end);
  }

  // "13:00" → "13" / "08:30" → "8:30"(列を詰めるため)
  function compact(hhmm) {
    var p = hhmm.split(":");
    var h = String(Number(p[0]));
    return p[1] === "00" ? h : h + ":" + p[1];
  }

  function minutesText(min) {
    var h = Math.floor(min / 60);
    var m = min % 60;
    return m ? h + "." + Math.round(m / 6) + "h" : h + "h";
  }

  /* ===== 画面と印刷(table) ===== */

  function render() {
    if (!matrix) return;

    $("month-label").textContent = year + "年" + month + "月";
    $("print-title").textContent = year + "年" + month + "月 シフト表";
    $("scope-all").classList.toggle("is-active", scope === "all");
    $("scope-me").classList.toggle("is-active", scope === "me");

    var note = $("print-note");
    if (matrix.unpublished.length) {
      var list = matrix.unpublished.map(function (w) {
        var p = Core.dateParts(w);
        return p.md + "〜";
      }).join("、");
      note.textContent = "※ " + list + " の週はまだ公開していません(下書きの内容を含みます)";
      note.classList.remove("hidden");
    } else {
      note.classList.add("hidden");
    }

    $("hint").textContent = scope === "me"
      ? "自分の1か月分です。「画像で保存」でスマホに保存したり、そのまま送れます。"
      : "全員分の1か月です。A4横で印刷できます。スタッフごとの出勤日数と時間も右端に出ます。";

    $("month-body").innerHTML = scope === "me" ? personalTableHtml() : monthTableHtml();
    document.body.classList.toggle("is-personal", scope === "me");
  }

  function monthTableHtml() {
    if (!matrix.rows.length) return '<p class="blank-state">この月に出せるシフトがありません</p>';

    var html = '<table class="month-table"><thead><tr>';
    html += '<th class="mt-name">スタッフ</th>';
    matrix.dates.forEach(function (date) {
      var p = Core.dateParts(date);
      var weekend = p.dowIndex === 0 || p.dowIndex === 6;
      html += '<th class="mt-day' + (weekend ? " is-weekend" : "") + '">' +
        '<span class="mt-d">' + date.split("-")[2].replace(/^0/, "") + '</span>' +
        '<span class="mt-w">' + p.dow + '</span></th>';
    });
    html += '<th class="mt-total">日数</th><th class="mt-total">時間</th></tr></thead><tbody>';

    matrix.rows.forEach(function (row) {
      var color = Core.tagColor(row.employee.color, row.employee.sortOrder);
      html += '<tr><th class="mt-name" scope="row">' +
        '<span class="tag-dot" style="background:' + color + '"></span>' +
        Core.escapeHtml(row.employee.name) + '</th>';
      row.cells.forEach(function (c, i) {
        var p = Core.dateParts(matrix.dates[i]);
        var weekend = p.dowIndex === 0 || p.dowIndex === 6;
        html += '<td class="mt-cell mt-' + c.kind + (weekend ? " is-weekend" : "") + '">' +
          c.texts.map(Core.escapeHtml).join("<br>") + '</td>';
      });
      html += '<td class="mt-total">' + row.days + '</td>' +
        '<td class="mt-total">' + minutesText(row.minutes) + '</td></tr>';
    });

    html += '</tbody><tfoot><tr><th class="mt-name" scope="row">人数</th>';
    matrix.perDay.forEach(function (n, i) {
      var p = Core.dateParts(matrix.dates[i]);
      var weekend = p.dowIndex === 0 || p.dowIndex === 6;
      html += '<td class="mt-cell' + (weekend ? " is-weekend" : "") + '">' + (n || "") + '</td>';
    });
    html += '<td class="mt-total"></td><td class="mt-total"></td></tr></tfoot></table>';
    return html;
  }

  // 自分だけのときは、1行31列ではなく日付を縦に並べる(スマホでも紙でも読める)
  function personalTableHtml() {
    var row = matrix.rows.find(function (r) { return me && r.employee.id === me.id; });
    if (!row) return '<p class="blank-state">この月のシフトはありません</p>';

    var html = '<table class="person-table"><tbody>';
    matrix.dates.forEach(function (date, i) {
      var p = Core.dateParts(date);
      var weekend = p.dowIndex === 0 || p.dowIndex === 6;
      var c = row.cells[i];
      var text = c.kind === "work" ? c.times.join(" / ") : (c.kind === "off" ? "休み" : "—");
      html += '<tr class="' + (weekend ? "is-weekend " : "") +
        (c.kind === "work" ? "is-work" : "") + '">' +
        '<td class="pt-date">' + date.split("-")[2].replace(/^0/, "") + '</td>' +
        '<td class="pt-dow">' + p.dow + '</td>' +
        '<td class="pt-time">' + Core.escapeHtml(text) + '</td></tr>';
    });
    html += '</tbody></table>' +
      '<p class="person-total">出勤 <b>' + row.days + '</b>日 ・ 合計 <b>' +
      minutesText(row.minutes) + '</b></p>';
    return html;
  }

  /* ===== PDF(印刷) ===== */

  function onPrint() {
    Core.printWith(scope === "me" ? "portrait" : "landscape");
  }

  /* ===== 画像(Canvas 手描き) ===== */

  function onSaveImage() {
    if (!matrix || !matrix.rows.length) {
      Core.toast("出せるシフトがありません", true);
      return;
    }
    var btn = $("image-btn");
    btn.disabled = true;
    btn.textContent = "作成中…";

    // 埋め込み書体で描くために、読み込み完了を待つ
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
      .then(function () {
        var canvas = scope === "me" ? drawPersonal() : drawMonth();
        return new Promise(function (resolve) { canvas.toBlob(resolve, "image/png"); });
      })
      .then(function (blob) {
        // ファイル名はASCIIにする(日本語だと名前ごと無視される端末があるため)
        var name = "shift-" + year + "-" + String(month).padStart(2, "0") +
          (scope === "me" ? "-mine" : "") + ".png";
        return Core.saveBlob(blob, name).then(function () { return name; });
      })
      .then(function (name) { Core.toast(name + " を保存しました"); })
      .catch(function (err) { Core.toast("画像の作成に失敗しました: " + err.message, true); })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = "画像で保存";
      });
  }

  // 紙とインクの色(CSSのトークンと合わせる)
  var C = {
    paper: "#FFFFFF",
    band: "#F1F2EC",
    rule: "#D5DBE0",
    ruleBold: "#7A8DA0",
    ink: "#1E2F45",
    ink2: "#5A6E85",
    ink3: "#93A3B4"
  };

  function newCanvas(w, h) {
    var scale = Math.min(2, (window.devicePixelRatio || 1) * 2);
    var canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    var ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = "middle";
    canvas.ctx = ctx;
    return canvas;
  }

  function line(ctx, x1, y1, x2, y2, color, width) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1;
    ctx.beginPath();
    // 0.5ずらして罫線をくっきり出す
    ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
    ctx.stroke();
  }

  var UI = '"BIZ UDPGothic", system-ui, sans-serif';
  var MONO = '"IBM Plex Mono", monospace';
  var MINCHO = '"Zen Old Mincho", serif';

  function drawMonth() {
    var n = matrix.dates.length;
    var nameW = 96, dayW = 30, totalW = 42;
    var headH = 34, rowH = 30, titleH = 54, footH = 30, pad = 20;
    var w = pad * 2 + nameW + dayW * n + totalW * 2;
    var h = pad * 2 + titleH + headH + rowH * matrix.rows.length + footH + 22;

    var canvas = newCanvas(w, h);
    var ctx = canvas.ctx;
    var x0 = pad, y0 = pad + titleH;
    var tableW = nameW + dayW * n + totalW * 2;

    // 表題
    ctx.fillStyle = C.ink;
    ctx.font = '700 22px ' + MINCHO;
    ctx.textAlign = "left";
    ctx.fillText(year + "年" + month + "月 シフト表", pad, pad + 16);
    ctx.fillStyle = C.ink2;
    ctx.font = '13px ' + UI;
    ctx.fillText(cfg.STORE_NAME, pad, pad + 38);

    // 見出し帯
    ctx.fillStyle = C.band;
    ctx.fillRect(x0, y0, tableW, headH);

    var cx = x0 + nameW;
    ctx.textAlign = "center";
    matrix.dates.forEach(function (date, i) {
      var p = Core.dateParts(date);
      var weekend = p.dowIndex === 0 || p.dowIndex === 6;
      if (weekend) {
        ctx.fillStyle = "#E9EBE3";
        ctx.fillRect(cx + dayW * i, y0, dayW, headH);
      }
      ctx.fillStyle = C.ink;
      ctx.font = '500 13px ' + MONO;
      ctx.fillText(String(Number(date.split("-")[2])), cx + dayW * i + dayW / 2, y0 + 12);
      ctx.fillStyle = weekend ? C.ink2 : C.ink3;
      ctx.font = '10px ' + UI;
      ctx.fillText(p.dow, cx + dayW * i + dayW / 2, y0 + 25);
    });
    ctx.fillStyle = C.ink2;
    ctx.font = '11px ' + UI;
    ctx.fillText("日数", x0 + nameW + dayW * n + totalW / 2, y0 + headH / 2);
    ctx.fillText("時間", x0 + nameW + dayW * n + totalW * 1.5, y0 + headH / 2);
    ctx.textAlign = "left";
    ctx.fillStyle = C.ink;
    ctx.font = '700 12px ' + UI;
    ctx.fillText("スタッフ", x0 + 8, y0 + headH / 2);

    // 各行
    matrix.rows.forEach(function (row, ri) {
      var ry = y0 + headH + rowH * ri;
      matrix.dates.forEach(function (date, i) {
        var p = Core.dateParts(date);
        if (p.dowIndex === 0 || p.dowIndex === 6) {
          ctx.fillStyle = C.band;
          ctx.fillRect(cx + dayW * i, ry, dayW, rowH);
        }
      });

      // 名前と名札色
      var color = Core.tagColor(row.employee.color, row.employee.sortOrder);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x0 + 10, ry + rowH / 2, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = C.ink;
      ctx.font = '12px ' + UI;
      ctx.textAlign = "left";
      ctx.fillText(row.employee.name, x0 + 20, ry + rowH / 2);

      // セル
      ctx.textAlign = "center";
      row.cells.forEach(function (c, i) {
        if (!c.texts.length) return;
        ctx.fillStyle = c.kind === "off" ? C.ink3 : C.ink;
        ctx.font = (c.kind === "off" ? "" : "500 ") + "10px " + MONO;
        var mid = cx + dayW * i + dayW / 2;
        if (c.texts.length === 1) {
          ctx.fillText(c.texts[0], mid, ry + rowH / 2, dayW - 3);
        } else {
          c.texts.slice(0, 2).forEach(function (t, k) {
            ctx.fillText(t, mid, ry + rowH / 2 - 6 + k * 13, dayW - 3);
          });
        }
      });

      // 合計
      ctx.fillStyle = C.ink;
      ctx.font = '500 12px ' + MONO;
      ctx.fillText(String(row.days), x0 + nameW + dayW * n + totalW / 2, ry + rowH / 2);
      ctx.fillText(minutesText(row.minutes), x0 + nameW + dayW * n + totalW * 1.5, ry + rowH / 2);
    });

    // 人数の行
    var fy = y0 + headH + rowH * matrix.rows.length;
    ctx.fillStyle = C.band;
    ctx.fillRect(x0, fy, tableW, footH);
    ctx.fillStyle = C.ink2;
    ctx.font = '11px ' + UI;
    ctx.textAlign = "left";
    ctx.fillText("人数", x0 + 8, fy + footH / 2);
    ctx.textAlign = "center";
    ctx.font = '500 11px ' + MONO;
    matrix.perDay.forEach(function (v, i) {
      if (!v) return;
      ctx.fillStyle = C.ink;
      ctx.fillText(String(v), cx + dayW * i + dayW / 2, fy + footH / 2);
    });

    // 罫線
    var bottom = fy + footH;
    for (var r = 0; r <= matrix.rows.length; r++) {
      var yy = y0 + headH + rowH * r;
      line(ctx, x0, yy, x0 + tableW, yy, C.rule);
    }
    line(ctx, x0, y0, x0 + tableW, y0, C.ruleBold);
    line(ctx, x0, y0 + headH, x0 + tableW, y0 + headH, C.ruleBold);
    line(ctx, x0, bottom, x0 + tableW, bottom, C.ruleBold);
    line(ctx, x0, y0, x0, bottom, C.ruleBold);
    line(ctx, x0 + nameW, y0, x0 + nameW, bottom, C.ruleBold);
    for (var i2 = 1; i2 < n; i2++) {
      line(ctx, cx + dayW * i2, y0, cx + dayW * i2, bottom, C.rule);
    }
    line(ctx, cx + dayW * n, y0, cx + dayW * n, bottom, C.ruleBold);
    line(ctx, cx + dayW * n + totalW, y0, cx + dayW * n + totalW, bottom, C.rule);
    line(ctx, x0 + tableW, y0, x0 + tableW, bottom, C.ruleBold);

    // 脚注
    ctx.fillStyle = C.ink3;
    ctx.font = '10px ' + UI;
    ctx.textAlign = "left";
    ctx.fillText("Shift Sync", x0, bottom + 14);

    return canvas;
  }

  function drawPersonal() {
    var row = matrix.rows.find(function (r) { return me && r.employee.id === me.id; });
    var dates = matrix.dates;
    var pad = 22, titleH = 56, rowH = 26;
    var w = 380;
    var h = pad * 2 + titleH + rowH * dates.length + 44;

    var canvas = newCanvas(w, h);
    var ctx = canvas.ctx;

    ctx.fillStyle = C.ink;
    ctx.font = '700 20px ' + MINCHO;
    ctx.textAlign = "left";
    ctx.fillText(year + "年" + month + "月 " + (me ? me.name : "") + " さんのシフト", pad, pad + 14);
    ctx.fillStyle = C.ink2;
    ctx.font = '12px ' + UI;
    ctx.fillText(cfg.STORE_NAME, pad, pad + 36);

    var y0 = pad + titleH;
    var tableW = w - pad * 2;
    line(ctx, pad, y0, pad + tableW, y0, C.ruleBold);

    dates.forEach(function (date, i) {
      var p = Core.dateParts(date);
      var weekend = p.dowIndex === 0 || p.dowIndex === 6;
      var c = row ? row.cells[i] : { kind: "none", times: [] };
      var ry = y0 + rowH * i;

      if (weekend) {
        ctx.fillStyle = C.band;
        ctx.fillRect(pad, ry, tableW, rowH);
      }

      ctx.fillStyle = C.ink;
      ctx.font = '500 14px ' + MONO;
      ctx.textAlign = "right";
      ctx.fillText(String(Number(date.split("-")[2])), pad + 26, ry + rowH / 2);

      ctx.fillStyle = C.ink2;
      ctx.font = '11px ' + UI;
      ctx.textAlign = "left";
      ctx.fillText(p.dow, pad + 34, ry + rowH / 2);

      if (c.kind === "work") {
        ctx.fillStyle = C.ink;
        ctx.font = '500 13px ' + MONO;
        ctx.fillText(c.times.join(" / "), pad + 62, ry + rowH / 2);
      } else {
        ctx.fillStyle = C.ink3;
        ctx.font = '12px ' + UI;
        ctx.fillText(c.kind === "off" ? "休み" : "—", pad + 62, ry + rowH / 2);
      }

      line(ctx, pad, ry + rowH, pad + tableW, ry + rowH, C.rule);
    });

    var bottom = y0 + rowH * dates.length;
    line(ctx, pad, bottom, pad + tableW, bottom, C.ruleBold);

    ctx.fillStyle = C.ink;
    ctx.font = '13px ' + UI;
    ctx.textAlign = "left";
    ctx.fillText("出勤 " + (row ? row.days : 0) + "日 ・ 合計 " +
      minutesText(row ? row.minutes : 0), pad, bottom + 22);

    return canvas;
  }
})();
