/* Конфигурация фронтенда.
   API_BASE — адрес бэкенда (Railway). Пустая строка отключает сеть:
   результаты можно будет только скопировать и отправить вручную. */
window.TAJWEED_CONFIG = {
  API_BASE: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:3000'
    : 'https://tajweed-backend-production.up.railway.app',
  SITE_URL: 'https://таджвид.рф'
};

/* Те же полноразмерные SVG-флаги, что используются в языковом меню
   wiki.bahur.store: одна круглая маска без системного emoji и подложек. */
window.TAJWEED_LANGUAGES = [
  ['ru', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="32" fill="#fff"/><rect y="11" width="32" height="11" fill="#0039a6"/><rect y="21" width="32" height="11" fill="#d52b1e"/></svg>', 'Русский'],
  ['en', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="32" fill="#fff"/><g fill="#b22234"><rect width="32" height="2.46"/><rect y="4.92" width="32" height="2.46"/><rect y="9.84" width="32" height="2.46"/><rect y="14.76" width="32" height="2.46"/><rect y="19.68" width="32" height="2.46"/><rect y="24.6" width="32" height="2.46"/><rect y="29.52" width="32" height="2.48"/></g><rect width="14" height="17.2" fill="#3c3b6e"/></svg>', 'English'],
  ['ar', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="32" fill="#006c35"/><rect x="6" y="13" width="20" height="2.4" rx="1.2" fill="#fff"/><rect x="8" y="18" width="12" height="1.6" rx="0.8" fill="#fff"/></svg>', 'العربية'],
  ['tr', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="32" fill="#e30a17"/><circle cx="14" cy="16" r="6" fill="#fff"/><circle cx="15.7" cy="16" r="4.8" fill="#e30a17"/><path d="M21 12.6l1 2.4 2.5.2-1.9 1.6.6 2.5-2.2-1.4-2.2 1.4.6-2.5-1.9-1.6 2.5-.2z" fill="#fff"/></svg>', 'Türkçe'],
  ['az', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="10.7" fill="#0092bc"/><rect y="10.7" width="32" height="10.6" fill="#e4002b"/><rect y="21.3" width="32" height="10.7" fill="#3f9c35"/><circle cx="15" cy="16" r="3.2" fill="#fff"/><circle cx="16.4" cy="16" r="2.6" fill="#e4002b"/></svg>', 'Azərbaycan'],
  ['kk', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="32" fill="#00afca"/><circle cx="16" cy="15" r="5" fill="#fec50c"/></svg>', 'Қазақша'],
  ['uz', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="32" fill="#fff"/><rect width="32" height="10.3" fill="#0099b5"/><rect y="21.7" width="32" height="10.3" fill="#1eb53a"/><circle cx="8" cy="5.2" r="3" fill="#fff"/><circle cx="9.4" cy="5.2" r="2.6" fill="#0099b5"/></svg>', 'Oʻzbekcha'],
  ['ky', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="32" fill="#e8112d"/><circle cx="16" cy="16" r="6.5" fill="none" stroke="#ffef00" stroke-width="1.3"/><circle cx="16" cy="16" r="4" fill="#ffef00"/></svg>', 'Кыргызча'],
  ['tg', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="9" fill="#cc0000"/><rect y="9" width="32" height="14" fill="#fff"/><rect y="23" width="32" height="9" fill="#006600"/><rect x="12.5" y="14.6" width="7" height="2.2" fill="#f8c300"/><rect x="13.6" y="12.9" width="4.8" height="1.5" fill="#f8c300"/></svg>', 'Тоҷикӣ'],
  ['tk', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="32" fill="#28ae66"/><rect x="4" width="5.5" height="32" fill="#b02b2c"/><rect x="5" y="3.5" width="3.5" height="10" rx="0.6" fill="#fff" fill-opacity="0.45"/></svg>', 'Türkmençe'],
  ['hy', '<svg viewBox="0 0 32 32" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="32" height="10.7" fill="#d90012"/><rect y="10.7" width="32" height="10.6" fill="#0033a0"/><rect y="21.3" width="32" height="10.7" fill="#f2a800"/></svg>', 'Հայերեն']
];

window.TAJWEED_TRANSLATIONS = {
  ru: { examTitle: 'Экзамен по <em>таджвиду</em>' },
  en: { examTitle: '<em>Tajweed</em> exam' },
  ar: { examTitle: 'اختبار <em>التجويد</em>' },
  tr: { examTitle: '<em>Tecvid</em> sınavı' },
  az: { examTitle: '<em>Təcvid</em> imtahanı' },
  kk: { examTitle: '<em>Тәжуид</em> емтиханы' },
  uz: { examTitle: '<em>Tajvid</em> imtihoni' },
  ky: { examTitle: '<em>Тажвид</em> экзамени' },
  tg: { examTitle: 'Имтиҳони <em>таҷвид</em>' },
  tk: { examTitle: '<em>Tejwid</em> synagy' },
  hy: { examTitle: '<em>Թաջվիդի</em> քննություն' }
};

/* Выбор языка хранится отдельно от служебной cookie Google Translate.
   Так флаг и выбранный язык не сбрасываются, даже если браузер очистил cookie. */
window.TAJWEED_I18N = (function () {
  var STORAGE_KEY = 'tajweed_language';

  function isAllowed(code) {
    return (window.TAJWEED_LANGUAGES || []).some(function (item) {
      return item[0] === code;
    });
  }

  function cookieLanguage() {
    var match = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]).split('/').pop();
    } catch (error) {
      return '';
    }
  }

  function current() {
    var stored = '';
    try { stored = localStorage.getItem(STORAGE_KEY) || ''; } catch (error) {}
    if (isAllowed(stored)) return stored;
    var cookie = cookieLanguage();
    return isAllowed(cookie) ? cookie : 'ru';
  }

  function clearTranslateCookies() {
    var domains = ['', location.hostname, '.' + location.hostname];
    domains.filter(function (domain, index) {
      return domains.indexOf(domain) === index;
    }).forEach(function (domain) {
      document.cookie = 'googtrans=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/' +
        (domain ? '; domain=' + domain : '') + '; SameSite=Lax';
    });
  }

  function writeTranslateCookie(code) {
    clearTranslateCookies();
    if (code === 'ru') return;
    document.cookie = 'googtrans=/ru/' + code +
      '; path=/; max-age=31536000; SameSite=Lax' +
      (location.protocol === 'https:' ? '; Secure' : '');
  }

  function set(code) {
    var next = isAllowed(code) ? code : 'ru';
    try { localStorage.setItem(STORAGE_KEY, next); } catch (error) {}
    writeTranslateCookie(next);
    return next;
  }

  function ensureTranslateCookie(code) {
    if (code !== 'ru' && cookieLanguage() !== code) writeTranslateCookie(code);
  }

  function text(key) {
    var code = current();
    var translations = window.TAJWEED_TRANSLATIONS || {};
    var selected = translations[code] || translations.ru || {};
    var fallback = translations.ru || {};
    return selected[key] || fallback[key] || '';
  }

  return {
    current: current,
    set: set,
    ensureTranslateCookie: ensureTranslateCookie,
    text: text
  };
})();

/* Аяты для шапки. Только ЦЕЛЫЕ аяты, без обрезков; текст сверен
   посимвольно по двум независимым источникам мусхафной орфографии
   (Tanzil-Uthmani и КФГQPC) — по памяти арабский здесь не набирается.
   Подборка — о чтении Корана, его сохранности и знании. */
window.TAJWEED_AYAHS = [
  { text: 'أَوْ زِدْ عَلَيْهِ وَرَتِّلِ ٱلْقُرْءَانَ تَرْتِيلًا', ref: 'Аль-Муззаммиль, 73:4' },
  { text: 'ٱقْرَأْ بِٱسْمِ رَبِّكَ ٱلَّذِى خَلَقَ', ref: 'Аль-Аляк, 96:1' },
  { text: 'وَلَقَدْ يَسَّرْنَا ٱلْقُرْءَانَ لِلذِّكْرِ فَهَلْ مِن مُّدَّكِرٍ', ref: 'Аль-Камар, 54:17' },
  { text: 'إِنَّا نَحْنُ نَزَّلْنَا ٱلذِّكْرَ وَإِنَّا لَهُۥ لَحَـٰفِظُونَ', ref: 'Аль-Хиджр, 15:9' }
];
