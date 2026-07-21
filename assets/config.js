/* Конфигурация фронтенда.
   API_BASE — адрес бэкенда (Railway). Пустая строка отключает сеть:
   результаты можно будет только скопировать и отправить вручную. */
window.TAJWEED_CONFIG = {
  API_BASE: /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    ? 'http://localhost:3000'
    : 'https://tajweed-backend-production.up.railway.app',
  SITE_URL: 'https://таджвид.рф'
};
