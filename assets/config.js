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
