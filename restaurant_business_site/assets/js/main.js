/*!
 * 品書き（SHINAGAKI） — main.js
 * 依存ライブラリなし。読み込みは <script defer> を想定。
 * 機能: 1) ヘッダー固定表示  2) モバイルドロワー  3) スクロールリビール
 *       4) モバイル固定CTA   5) お問い合わせフォームの検証と送信完了表示
 */
(function () {
  'use strict';

  var root = document.documentElement;
  root.classList.remove('no-js');

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------------
     1) ヘッダー：スクロールで境界線を出す
     ------------------------------------------------------------------ */
  var header = document.querySelector('[data-header]');
  if (header) {
    var sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'position:absolute;top:0;height:1px;width:1px;';
    document.body.prepend(sentinel);

    new IntersectionObserver(function (entries) {
      header.classList.toggle('is-stuck', !entries[0].isIntersecting);
    }).observe(sentinel);
  }

  /* ------------------------------------------------------------------
     2) モバイルドロワー
     ------------------------------------------------------------------ */
  var toggle = document.querySelector('[data-nav-toggle]');
  var drawer = document.querySelector('[data-drawer]');

  if (toggle && drawer) {
    var setDrawer = function (open) {
      toggle.setAttribute('aria-expanded', String(open));
      drawer.classList.toggle('is-open', open);
      drawer.setAttribute('aria-hidden', String(!open));
      document.body.classList.toggle('is-locked', open);
      toggle.querySelector('[data-nav-toggle-label]').textContent = open ? '閉じる' : 'メニュー';
    };

    setDrawer(false);

    toggle.addEventListener('click', function () {
      var willOpen = toggle.getAttribute('aria-expanded') !== 'true';
      setDrawer(willOpen);
      if (willOpen) {
        var first = drawer.querySelector('a, button');
        if (first) first.focus({ preventScroll: true });
      }
    });

    drawer.addEventListener('click', function (e) {
      if (e.target.closest('a')) setDrawer(false);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
        setDrawer(false);
        toggle.focus();
      }
    });

    // デスクトップ幅に戻ったら必ず閉じる
    window.matchMedia('(min-width: 1000px)').addEventListener('change', function (e) {
      if (e.matches) setDrawer(false);
    });
  }

  /* ------------------------------------------------------------------
     3) スクロールリビール（transform / opacity のみ）
     ------------------------------------------------------------------ */
  var targets = document.querySelectorAll('.reveal');
  if (targets.length) {
    if (reduceMotion || !('IntersectionObserver' in window)) {
      targets.forEach(function (el) { el.classList.add('is-visible'); });
    } else {
      var io = new IntersectionObserver(function (entries, obs) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          obs.unobserve(entry.target);
        });
      }, { rootMargin: '0px 0px -12% 0px', threshold: 0.05 });
      targets.forEach(function (el) { io.observe(el); });
    }
  }

  /* ------------------------------------------------------------------
     4) モバイル固定CTA（一定量スクロールで出現／フッター手前で退避）
     ------------------------------------------------------------------ */
  var stickyCta = document.querySelector('[data-sticky-cta]');
  var footer = document.querySelector('[data-footer]');
  if (stickyCta) {
    var footerVisible = false;

    if (footer && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        footerVisible = entries[0].isIntersecting;
        update();
      }, { rootMargin: '0px 0px -20% 0px' }).observe(footer);
    }

    var ticking = false;
    var update = function () {
      var show = window.scrollY > 480 && !footerVisible;
      stickyCta.classList.toggle('is-shown', show);
      stickyCta.setAttribute('aria-hidden', String(!show));
      ticking = false;
    };
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    }, { passive: true });
    update();
  }

  /* ------------------------------------------------------------------
     5) お問い合わせフォーム
     ------------------------------------------------------------------ */
  var form = document.querySelector('[data-contact-form]');
  if (!form) return;

  var summary = form.querySelector('[data-form-summary]');
  var done = document.querySelector('[data-form-done]');

  var RULES = {
    email: {
      test: function (v) { return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v); },
      message: 'メールアドレスの形式が正しくありません。（例：info@example.com）'
    },
    tel: {
      test: function (v) { return v === '' || /^[0-9+\-() ]{9,20}$/.test(v); },
      message: '電話番号は半角数字とハイフンで入力してください。'
    }
  };

  var fieldOf = function (input) { return input.closest('.field, .consent-field'); };

  var errorNodeOf = function (input) {
    var wrap = fieldOf(input);
    return wrap ? wrap.querySelector('[data-error]') : null;
  };

  var showError = function (input, message) {
    var node = errorNodeOf(input);
    input.setAttribute('aria-invalid', 'true');
    if (node) {
      node.querySelector('[data-error-text]').textContent = message;
      node.classList.add('is-shown');
    }
  };

  var clearError = function (input) {
    var node = errorNodeOf(input);
    input.removeAttribute('aria-invalid');
    if (node) node.classList.remove('is-shown');
  };

  var validate = function (input) {
    var value = (input.value || '').trim();
    var label = input.dataset.label || 'この項目';

    if (input.type === 'checkbox') {
      if (input.required && !input.checked) {
        showError(input, label + 'にご同意ください。');
        return false;
      }
      clearError(input);
      return true;
    }

    if (input.required && value === '') {
      showError(input, label + 'を入力してください。');
      return false;
    }

    var rule = RULES[input.dataset.rule];
    if (rule && value !== '' && !rule.test(value)) {
      showError(input, rule.message);
      return false;
    }

    clearError(input);
    return true;
  };

  var inputs = Array.prototype.slice.call(
    form.querySelectorAll('input[name], select[name], textarea[name]')
  ).filter(function (el) { return el.type !== 'hidden'; });

  inputs.forEach(function (input) {
    // 入力中はうるさくしない。離れたとき／エラー修正中のみ検証する。
    input.addEventListener('blur', function () { validate(input); });
    input.addEventListener('change', function () {
      if (input.type === 'checkbox' || input.tagName === 'SELECT') validate(input);
    });
    input.addEventListener('input', function () {
      if (input.getAttribute('aria-invalid') === 'true') validate(input);
    });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();

    var invalid = inputs.filter(function (input) { return !validate(input); });

    if (invalid.length) {
      if (summary) {
        summary.querySelector('[data-form-summary-text]').textContent =
          '未入力または形式に誤りのある項目が ' + invalid.length + ' 件あります。内容をご確認ください。';
        summary.classList.add('is-shown');
      }
      invalid[0].focus();
      invalid[0].scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      return;
    }

    if (summary) summary.classList.remove('is-shown');

    var submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '送信しています…';
    }

    /* --------------------------------------------------------------
       ここは送信のデモ実装です。
       実運用ではこのブロックを fetch(form.action, {...}) などに置き換え、
       成功時に showDone()、失敗時にエラー表示を行ってください。
       -------------------------------------------------------------- */
    window.setTimeout(function () {
      form.hidden = true;
      if (done) {
        done.classList.add('is-shown');
        done.setAttribute('tabindex', '-1');
        done.focus({ preventScroll: true });
        done.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
      }
    }, 700);
  });
})();
