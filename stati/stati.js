/* Статичные страницы базы знаний: тема и язык — те же, что на сайте.
   Приложение (app.js) сюда не грузится, поэтому переключатели собраны
   отдельно, но работают через тот же localStorage и тот же список
   языков из config.js — переключил язык в статье, вернулся на главную,
   язык сохранился. */
(function () {
  'use strict';

  /* ── Тема ─────────────────────────────────────────────── */

  function currentTheme() {
    try {
      return localStorage.getItem('tajweed_theme') === 'dark' ? 'dark' : 'light';
    } catch (e) { return 'light'; }
  }

  var themeButton = document.getElementById('kbTheme');
  if (themeButton) {
    themeButton.onclick = function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('tajweed_theme', next); } catch (e) { /* ок */ }
    };
  }

  /* ── Язык ─────────────────────────────────────────────── */

  var button = document.getElementById('kbLanguageButton');
  var menu = document.getElementById('kbLanguageMenu');
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
