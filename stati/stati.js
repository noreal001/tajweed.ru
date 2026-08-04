/* Статичные страницы базы знаний: шапка у них та же, что на сайте, но
   приложение (app.js) сюда не грузится. Поэтому аят, тема и язык
   собраны здесь — через тот же localStorage, тот же список языков и тот
   же список аятов из config.js. Переключил язык или тему в статье,
   вернулся на главную — состояние сохранилось. */
(function () {
  'use strict';

  /* ── Тема ─────────────────────────────────────────────── */

  function currentTheme() {
    try {
      return localStorage.getItem('tajweed_theme') === 'dark' ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }

  var themeButton = document.getElementById('themeToggle');
  var themeLabel = document.getElementById('themeLabel');

  function syncTheme() {
    var light = currentTheme() === 'light';
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    if (themeLabel) themeLabel.textContent = light ? 'Светлая' : 'Тёмная';
    if (themeButton) {
      themeButton.setAttribute('aria-pressed', light ? 'true' : 'false');
      themeButton.setAttribute('aria-label', 'Тема оформления: ' + (light ? 'светлая' : 'тёмная') +
        '. Переключить на ' + (light ? 'тёмную' : 'светлую'));
    }
  }

  syncTheme();

  if (themeButton) {
    themeButton.onclick = function () {
      var next = currentTheme() === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('tajweed_theme', next); } catch (e) { /* ок */ }
      syncTheme();
    };
  }

  /* ── Аят дня ──────────────────────────────────────────── */

  (function ayah() {
    var host = document.getElementById('ayah');
    var textNode = document.getElementById('ayahText');
    var refNode = document.getElementById('ayahRef');
    var list = window.TAJWEED_AYAHS || [];
    if (!host || !textNode || !refNode || !list.length) return;

    var start = new Date(new Date().getFullYear(), 0, 0);
    var dayOfYear = Math.floor((Date.now() - start.getTime()) / 86400000);
    var idx = ((dayOfYear % list.length) + list.length) % list.length;
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function paint() {
      textNode.textContent = list[idx].text;
      refNode.textContent = list[idx].ref;
    }

    paint();
    host.hidden = false;
    if (list.length < 2) return;

    setInterval(function () {
      if (document.hidden) return;
      idx = (idx + 1) % list.length;
      if (calm) return paint();
      host.classList.add('is-fading');
      setTimeout(function () {
        paint();
        host.classList.remove('is-fading');
      }, 320);
    }, 25000);
  })();

  /* ── Язык ─────────────────────────────────────────────── */

  var button = document.getElementById('languageButton');
  var menu = document.getElementById('languageMenu');
  var languages = window.TAJWEED_LANGUAGES || [];
  var i18n = window.TAJWEED_I18N;
  if (!button || !menu || !languages.length) return;

  var current = i18n ? i18n.current() : 'ru';
  var selected = languages.filter(function (item) { return item[0] === current; })[0] || languages[0];

  function flag(svg, small) {
    return '<span class="language-flag' + (small ? ' is-small' : '') +
      '" aria-hidden="true">' + svg + '</span>';
  }

  button.innerHTML = flag(selected[1], false) +
    '<span class="language-code">' + selected[0].toUpperCase() + '</span>' +
    '<svg class="language-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>' +
    '<span class="visually-hidden">' + selected[2] + '</span>';
  button.setAttribute('aria-label', 'Язык: ' + selected[2] + '. Выбрать другой');

  menu.innerHTML = languages.map(function (item) {
    return '<button class="language-option" type="button" role="menuitem" data-language="' + item[0] +
      '" aria-current="' + (item[0] === current ? 'true' : 'false') + '">' +
      flag(item[1], true) + '<span>' + item[2] + '</span></button>';
  }).join('');

  button.onclick = function (event) {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    button.setAttribute('aria-expanded', String(!menu.hidden));
  };

  menu.onclick = function (event) {
    var option = event.target.closest('[data-language]');
    if (!option) return;
    var code = option.getAttribute('data-language');
    if (i18n) code = i18n.set(code);
    document.documentElement.setAttribute('lang', code);
    document.documentElement.setAttribute('dir', code === 'ar' ? 'rtl' : 'ltr');
    location.reload();
  };

  document.addEventListener('click', function () {
    menu.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  });

  document.documentElement.setAttribute('lang', current);
  document.documentElement.setAttribute('dir', current === 'ar' ? 'rtl' : 'ltr');

  /* Перевод страницы. Арабские примеры помечены notranslate — их
     переводить нельзя ни при каком языке интерфейса. */
  if (current !== 'ru') {
    if (i18n) i18n.ensureTranslateCookie(current);
    var host = document.createElement('div');
    host.id = 'google_translate_element';
    host.hidden = true;
    document.body.appendChild(host);
    window.googleTranslateElementInit = function () {
      new google.translate.TranslateElement({
        pageLanguage: 'ru',
        includedLanguages: 'en,ar,tr,az,kk,uz,ky,tg,tk,hy',
        autoDisplay: false
      }, 'google_translate_element');
    };
    var script = document.createElement('script');
    script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit';
    document.body.appendChild(script);
  }
})();

/* ── Случайные вопросы после статьи ────────────────────────────────
   Решение владельца 04.08.2026: «чтобы они генерировались разные
   вопросы» — при каждом заходе ученик видит другую пятёрку.

   Сервер отдаёт ВЕСЬ банк вопросов; здесь остаются случайные N
   (data-quiz-show), остальные удаляются, номера проставляются заново.
   Без JS видны все вопросы — деградация мягкая, ничего не ломается. */
(function () {
  var quiz = document.getElementById('kb-quiz');
  if (!quiz) return;
  var show = parseInt(quiz.getAttribute('data-quiz-show'), 10) || 5;
  var all = Array.prototype.slice.call(quiz.querySelectorAll('.kb-q'));
  if (all.length <= show) return;            // банк ещё не вырос — трогать нечего

  for (var i = all.length - 1; i > 0; i--) { // тасование Фишера—Йетса
    var j = Math.floor(Math.random() * (i + 1));
    var t = all[i]; all[i] = all[j]; all[j] = t;
  }
  all.slice(show).forEach(function (el) { el.remove(); });
  quiz.querySelectorAll('.kb-q-num').forEach(function (el, k) {
    el.textContent = 'Вопрос ' + (k + 1);
  });
  var cnt = quiz.querySelector('.kb-quiz-count');
  if (cnt) {
    var n = show, w = n % 10 === 1 && n % 100 !== 11 ? 'вопрос'
          : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) ? 'вопроса' : 'вопросов';
    cnt.textContent = n + ' ' + w;
  }
})();
