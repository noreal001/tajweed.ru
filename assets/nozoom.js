/* Фиксированный масштаб на телефоне.

   Мета-тега `user-scalable=no` мало: Safari на iOS игнорирует его с
   десятой версии, поэтому щипок там всё равно масштабирует страницу.
   Здесь гасим сами жесты — щипок (gesture*), двойное касание и
   масштабирование двумя пальцами.

   Скрипт грузится как обычный <script defer> и ничего не экспортирует. */

(function () {
  'use strict';

  /* Щипок в Safari приходит отдельными событиями gesture*. Отменяем все
     три: без gesturechange страница успевает дёрнуться и вернуться. */
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (name) {
    document.addEventListener(name, function (event) {
      event.preventDefault();
    }, { passive: false });
  });

  /* Двойное касание масштабирует даже там, где жестов gesture* нет.
     Порог 300 мс — стандартное окно двойного тапа; обычные быстрые
     нажатия по кнопкам в него не попадают, потому что между ними
     сменяется цель касания. */
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (event) {
    var now = Date.now();
    if (now - lastTouchEnd <= 300) event.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });

  /* Касание двумя пальцами по странице: на некоторых прошивках Android
     это тоже запускает масштабирование. Прокрутку одним пальцем не
     трогаем — иначе страница перестанет листаться. */
  document.addEventListener('touchmove', function (event) {
    if (event.touches && event.touches.length > 1) event.preventDefault();
  }, { passive: false });
})();
