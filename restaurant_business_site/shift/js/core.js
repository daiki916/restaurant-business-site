/*
 * Shift Sync - 共通ユーティリティ
 * 日付・週の計算、時間帯ブロックの直列化、UI部品(トースト/モーダル)など。
 * 依存: なし(config.js より後、store.js より前に読み込む)
 */
(function () {
  "use strict";

  var DOW_JP = ["日", "月", "火", "水", "木", "金", "土"];

  // スタッフの識別色。名札の色から採った8色で、朱肉の色とは重ならない
  var NAMETAG_PALETTE = [
    "#5B8FB9", // 空
    "#6E9B58", // 若草
    "#8878B0", // 藤
    "#C4972F", // 山吹
    "#4E9E96", // 浅葱
    "#C2707F", // 桃
    "#A0714C", // 鳶
    "#6B7A8C"  // 鉛
  ];

  /* ===== 日付・週 ===== */

  // Date → "YYYY-MM-DD"(ローカルタイム基準)
  function toDateStr(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  // "YYYY-MM-DD" → Date(ローカルタイム0時)
  function fromDateStr(s) {
    var p = s.split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function todayStr() {
    return toDateStr(new Date());
  }

  // 指定日を含む週の開始日("YYYY-MM-DD")を返す
  function getWeekStart(date, weekStartsOn) {
    var d = typeof date === "string" ? fromDateStr(date) : new Date(date);
    var diff = (d.getDay() - weekStartsOn + 7) % 7;
    d.setDate(d.getDate() - diff);
    return toDateStr(d);
  }

  function addDays(dateStr, n) {
    var d = fromDateStr(dateStr);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }

  // 週開始日 → 7日分の日付文字列配列
  function weekDates(weekStart) {
    var out = [];
    for (var i = 0; i < 7; i++) out.push(addDays(weekStart, i));
    return out;
  }

  // その月の全日付("YYYY-MM-DD" の配列)。month は 1〜12
  function monthDates(year, month) {
    var out = [];
    var d = new Date(year, month - 1, 1);
    while (d.getMonth() === month - 1) {
      out.push(toDateStr(d));
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  // その月に重なる週の開始日を並べる(月は5〜6週にまたがる)
  function monthWeekStarts(year, month, weekStartsOn) {
    var dates = monthDates(year, month);
    var first = getWeekStart(dates[0], weekStartsOn);
    var last = getWeekStart(dates[dates.length - 1], weekStartsOn);
    var out = [];
    var w = first;
    while (w <= last) {
      out.push(w);
      w = addDays(w, 7);
    }
    return out;
  }

  // 月を1つ進める/戻す
  function shiftMonth(year, month, delta) {
    var d = new Date(year, month - 1 + delta, 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1 };
  }

  // "2026-08-12" → { md: "8/12", dow: "水", dowIndex: 3 }
  function dateParts(dateStr) {
    var d = fromDateStr(dateStr);
    return {
      md: (d.getMonth() + 1) + "/" + d.getDate(),
      dow: DOW_JP[d.getDay()],
      dowIndex: d.getDay()
    };
  }

  /* ===== 時刻 ===== */

  function timeToMin(t) {
    var p = t.split(":");
    return Number(p[0]) * 60 + Number(p[1]);
  }

  function minToTime(min) {
    var h = Math.floor(min / 60);
    var m = min % 60;
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  /* ===== 時間帯ブロックの直列化 ===== */
  // 保存形式: "11:00-15:00|17:00-22:00"(スプレッドシート1セルに収まる)

  function parseBlocks(str) {
    if (!str) return [];
    return str.split("|").filter(Boolean).map(function (part) {
      var p = part.split("-");
      return { start: p[0], end: p[1] };
    });
  }

  function serializeBlocks(blocks) {
    return blocks.map(function (b) { return b.start + "-" + b.end; }).join("|");
  }

  // 固定の時間帯とぴったり一致すればそのラベルを返す(例: "1日")。
  // 「時間指定」の枠は時刻そのものが中身なので、ラベルには使わない
  function blockLabel(block, config) {
    var defs = (config && config.BLOCKS) || [];
    for (var i = 0; i < defs.length; i++) {
      if (!defs[i].custom && defs[i].start === block.start && defs[i].end === block.end) {
        return defs[i].label;
      }
    }
    return block.start + "-" + block.end;
  }

  /* ===== ID・その他 ===== */

  function uid(prefix) {
    var s = "";
    var chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return prefix + "_" + s;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function pickColor(index) {
    return NAMETAG_PALETTE[index % NAMETAG_PALETTE.length];
  }

  // 旧テーマのネオン色は保存済みデータに焼き付いているため、読み出し時に名札色へ移す
  var LEGACY_COLORS = {
    "#00E5FF": "#5B8FB9", "#FF2EC8": "#C2707F", "#B4FF39": "#6E9B58",
    "#FFC53D": "#C4972F", "#8C6BFF": "#8878B0", "#FF7A45": "#A0714C",
    "#3DFFB8": "#4E9E96", "#FF5C8A": "#C2707F"
  };

  // 色を必ず #RRGGBB に正規化して返す(style属性に差し込むため、値の検証も兼ねる)
  function tagColor(value, index) {
    var v = String(value || "").trim().toUpperCase();
    if (LEGACY_COLORS[v]) return LEGACY_COLORS[v];
    if (/^#[0-9A-F]{6}$/.test(v)) return v;
    return pickColor(index || 0);
  }

  // 名札色を薄く敷くための rgba(記入済みのマスの地に使う)
  function tint(hex, alpha) {
    var h = hex.replace("#", "");
    var r = parseInt(h.substring(0, 2), 16);
    var g = parseInt(h.substring(2, 4), 16);
    var b = parseInt(h.substring(4, 6), 16);
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  /* ===== タリー ===== */
  // 人数の充足を色ではなく形で示す。塗られていない丸が残れば不足が一目で分かる。
  // 例: 2/3 → ●●○

  function tallyHtml(count, target, label) {
    var dots = "";
    var shown = Math.max(count, target);
    for (var i = 0; i < shown; i++) {
      var cls = i < count ? (i < target ? " class=\"is-on\"" : " class=\"is-over\"") : "";
      dots += "<i" + cls + "></i>";
    }
    var short = count < target;
    return '<span class="tally-row' + (short ? " is-short" : "") + '">' +
      '<span class="tally-label">' + escapeHtml(label) + '</span>' +
      '<span class="tally">' + dots + '</span>' +
      '<span class="tally-num">' + count + "/" + target + '</span>' +
      '</span>';
  }

  /* ===== 判子 ===== */
  // 押した直後だけ pressed を付けて、押し込むアニメーションを一度だけ再生する

  function stampHtml(isPressed, large) {
    return '<span class="stamp-mark' + (large ? " stamp-mark-lg" : "") +
      (isPressed ? " is-pressed" : "") + '" aria-hidden="true">印</span>';
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* ===== UI部品: トースト ===== */

  function toast(message, isError) {
    var container = document.querySelector(".toast-stack");
    if (!container) {
      container = document.createElement("div");
      container.className = "toast-stack";
      document.body.appendChild(container);
    }
    var el = document.createElement("div");
    el.className = "toast" + (isError ? " is-error" : "");
    el.textContent = message;
    container.appendChild(el);
    setTimeout(function () {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.3s ease";
      setTimeout(function () { el.remove(); }, 320);
    }, isError ? 4000 : 2200);
  }

  /* ===== UI部品: モーダル ===== */
  // openModal(innerHTML) → { el, close }
  // オーバーレイのクリックで閉じる。閉じたら onClose を呼ぶ。

  function openModal(innerHtml, opts) {
    opts = opts || {};
    var overlay = document.createElement("div");
    overlay.className = "overlay";
    var modal = document.createElement("div");
    modal.className = "dialog";
    modal.innerHTML = innerHtml;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    function close() {
      overlay.remove();
      if (opts.onClose) opts.onClose();
    }

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay && !opts.noBackdropClose) close();
    });

    return { el: modal, overlay: overlay, close: close };
  }

  /* ===== デモモードバナー(タップで閉じる・セッション中は再表示しない) ===== */

  function setupDemoBanner(isDemo) {
    var el = document.getElementById("demo-banner");
    if (!el || !isDemo) return;
    var KEY = "shiftapp:v1:demoBannerClosed";
    if (sessionStorage.getItem(KEY) === "1") return;
    el.classList.remove("hidden");
    el.addEventListener("click", function () {
      el.classList.add("hidden");
      sessionStorage.setItem(KEY, "1");
    });
  }

  /* ===== クリップボード ===== */

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    // 非HTTPS環境向けフォールバック
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        resolve();
      } catch (err) {
        reject(err);
      } finally {
        ta.remove();
      }
    });
  }

  /* ===== ファイルの保存 ===== */

  // 端末が共有に対応していれば共有シートを出し、だめならダウンロードする
  function saveBlob(blob, filename) {
    if (navigator.canShare && window.File) {
      try {
        var file = new File([blob], filename, { type: blob.type });
        if (navigator.canShare({ files: [file] })) {
          return navigator.share({ files: [file] }).catch(function () {
            download(blob, filename);
          });
        }
      } catch (e) { /* 共有が使えなければ下のダウンロードへ */ }
    }
    download(blob, filename);
    return Promise.resolve();
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ===== 印刷 ===== */

  // @page は class で切り替えられないので、style要素ごと差し替える
  function printWith(orientation) {
    var id = "page-size";
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = "@page { size: A4 " + orientation + "; margin: 10mm; }";
    window.print();
  }

  /* ===== SHA-256(PINゲート用) ===== */

  function sha256Hex(text) {
    var data = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", data).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) {
        return b.toString(16).padStart(2, "0");
      }).join("");
    });
  }

  window.ShiftCore = {
    DOW_JP: DOW_JP,
    NAMETAG_PALETTE: NAMETAG_PALETTE,
    toDateStr: toDateStr,
    fromDateStr: fromDateStr,
    todayStr: todayStr,
    getWeekStart: getWeekStart,
    addDays: addDays,
    weekDates: weekDates,
    monthDates: monthDates,
    monthWeekStarts: monthWeekStarts,
    shiftMonth: shiftMonth,
    dateParts: dateParts,
    timeToMin: timeToMin,
    minToTime: minToTime,
    parseBlocks: parseBlocks,
    serializeBlocks: serializeBlocks,
    blockLabel: blockLabel,
    uid: uid,
    nowIso: nowIso,
    pickColor: pickColor,
    tagColor: tagColor,
    tint: tint,
    tallyHtml: tallyHtml,
    stampHtml: stampHtml,
    escapeHtml: escapeHtml,
    toast: toast,
    openModal: openModal,
    setupDemoBanner: setupDemoBanner,
    copyText: copyText,
    saveBlob: saveBlob,
    printWith: printWith,
    sha256Hex: sha256Hex
  };
})();
