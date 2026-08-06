/* Экзамен по таджвиду · логика одностраничника.
   Экраны рендерятся в #app; ответы копятся локально и уходят на сервер,
   где хранится ключ и считается процент. */

(function () {
  'use strict';

  var CFG = window.TAJWEED_CONFIG || { API_BASE: '', SITE_URL: '' };
  var API = (CFG.API_BASE || '').replace(/\/+$/, '');
  var LS_KEY = 'tajweed_exam_v1';

  /* В приватном режиме запись в localStorage бросает исключение. Проверяем
     один раз, чтобы не обещать ученику сохранение, которого не будет. */
  var storageWorks = (function () {
    try {
      localStorage.setItem('tajweed_probe', '1');
      localStorage.removeItem('tajweed_probe');
      return true;
    } catch (e) { return false; }
  })();
  var STUDENT_KEY = 'tajweed_student_token';
  var GUEST_KEY = 'tajweed_guest_token';
  var QUESTION_TIME = 180; // секунд на вопрос

  /* Аяты для шапки лежат в config.js: их читают и приложение,
     и статичные страницы базы знаний. */
  var AYAHS = window.TAJWEED_AYAHS || [];
  var app = document.getElementById('app');
  var topbar = document.getElementById('topbar');
  var topbarLabel = document.getElementById('topbarLabel');
  var topbarTimer = document.getElementById('topbarTimer');
  var timebar = document.getElementById('timebar');
  var WEEK_DAYS = [
    { value: 'mon', short: 'Пн', full: 'Понедельник' },
    { value: 'tue', short: 'Вт', full: 'Вторник' },
    { value: 'wed', short: 'Ср', full: 'Среда' },
    { value: 'thu', short: 'Чт', full: 'Четверг' },
    { value: 'fri', short: 'Пт', full: 'Пятница' },
    { value: 'sat', short: 'Сб', full: 'Суббота' },
    { value: 'sun', short: 'Вс', full: 'Воскресенье' }
  ];
  var scheduleAudioContext = null;

  /* Второй уровень существует, но сервер откроет его только после 100%
     за первый. Следующие уровни остаются без обещаний по содержанию. */
  var LEVELS = [
    {
      n: 1,
      title: 'Первый уровень',
      topic: 'Основа произношения и правил чтения',
      outline: [
        'Буквы, названия и огласовки',
        'Слоги, сифаты и составление слов',
        'Проверка правил и чтение вслух'
      ],
      open: true
    },
    {
      n: 2,
      title: 'Второй уровень',
      topic: 'Продолжение правил и практики чтения',
      outline: [
        'Термины, определения и танвин',
        'Мадд, звуковые отрезки и сифаты',
        'Составление слов, диктант и чтение'
      ],
      open: false
    },
    { n: 3, open: false },
    { n: 4, open: false },
    { n: 5, open: false },
    { n: 6, open: false }
  ];

  /* Поколение экрана: запрос, начатый на одном экране, не должен
     дорисовываться поверх другого. Уход по вкладкам увеличивает счётчик,
     и «опоздавший» ответ просто отбрасывается. */
  var navSeq = 0;

  function screenToken() {
    navSeq += 1;
    return navSeq;
  }

  function isStale(token) {
    return token !== navSeq;
  }

  /* Короткое объявление для экранной читалки через уже существующий
     live-регион: используется там, где смена текста кнопки объявляется
     ненадёжно, а действие необратимо. */
  function announce(text) {
    var region = document.getElementById('timeAlert');
    if (!region) return;
    region.textContent = '';
    setTimeout(function () { region.textContent = text; }, 60);
  }

  /* Ошибка поля: класс, aria-invalid и ТЕКСТ в live-регионе включаются
     вместе. Текст вставляется только в момент ошибки — иначе role="alert"
     ничего не объявляет (содержимое не менялось), а aria-describedby
     заставляет читалку зачитывать ошибку у корректного поля. */
  function markInvalid(field, bad) {
    if (!field) return;
    field.classList.toggle('is-invalid', !!bad);
    var box = field.querySelector('.err');
    if (box) box.textContent = bad ? (box.getAttribute('data-msg') || '') : '';
    var input = field.querySelector('input, select, textarea');
    if (input) input.setAttribute('aria-invalid', bad ? 'true' : 'false');
  }

  /* Единый экран ожидания: заголовок экрана остаётся на месте, меняется
     только пояснение — иначе при загрузке h1 прыгает с одного текста на
     другой. Единый экран ошибки: одна вёрстка на все сбои загрузки. */
  function loadingScreen(title, note) {
    render('<h1>' + esc(title) + '</h1><p class="lede">' + esc(note) + '</p>');
  }

  function errorScreen(title, note, onRetry) {
    render('<h1>' + esc(title) + '</h1>' +
      '<p class="lede">' + esc(note) + '</p>' +
      '<div class="btn-row">' +
        (onRetry ? '<button class="btn" id="retryBtn">Повторить</button>' : '') +
        '<button class="btn is-ghost" id="homeBtn">На главную</button></div>');
    if (onRetry) document.getElementById('retryBtn').onclick = onRetry;
    document.getElementById('homeBtn').onclick = function () {
      if (history.replaceState) history.replaceState(null, '', location.pathname);
      state.phase = 'welcome';
      show();
    };
  }

  /* Приводные метки — компонент .marks с вики.
     marks('is-out') выносит уголки наружу рамки, как у баннера прайса. */
  function marks(extra) {
    return '<div class="marks' + (extra ? ' ' + extra : '') + '" aria-hidden="true">' +
      '<span class="tick tl-v"></span><span class="tick tl-h"></span>' +
      '<span class="tick tr-v"></span><span class="tick tr-h"></span>' +
      '<span class="tick bl-v"></span><span class="tick bl-h"></span>' +
      '<span class="tick br-v"></span><span class="tick br-h"></span>' +
      '<span class="hatch tr"></span><span class="hatch bl"></span>' +
    '</div>';
  }

  /* Сетка обложки повторяет plaque из wiki: 6×3 на широком экране,
     4×2 на планшете и 3×2 на телефоне. Узлы стоят на всех пересечениях. */
  function blueprintLayer(cols, rows, extra) {
    var cells = '';
    var nodes = '';
    var i;
    var row;
    var col;
    for (i = 0; i < cols * rows; i++) {
      cells += '<span class="blueprint-cell"></span>';
    }
    for (row = 0; row <= rows; row++) {
      for (col = 0; col <= cols; col++) {
        nodes += '<span style="left:' + (col / cols * 100) +
          '%;top:' + (row / rows * 100) + '%"></span>';
      }
    }
    return '<div class="blueprint-layer ' + extra +
      '" style="--blueprint-cols:' + cols + ';--blueprint-rows:' + rows +
      '" aria-hidden="true"><div class="blueprint-cells">' + cells +
      '</div><div class="blueprint-nodes">' + nodes + '</div></div>';
  }

  function blueprintLayers() {
    return blueprintLayer(6, 3, 'is-desktop') +
      blueprintLayer(4, 2, 'is-tablet') +
      blueprintLayer(3, 2, 'is-mobile');
  }

  /* Внутренняя сетка маленькой карточки — 2×2. Прежние 3×2 давали шесть
     клеток: для карточки такого размера это дробно и шумно. */
  function levelDecor() {
    return marks('is-level') + blueprintLayer(2, 2, 'is-level');
  }

  /* Цвет уровня по проценту: от тревожного красного к неоновой зелени. */
  function scoreColor(percent, lightness) {
    var p = Math.max(0, Math.min(100, Number(percent) || 0));
    var hue = Math.round(4 + (p / 100) * 142);
    return 'hsl(' + hue + ' 92% ' + (lightness || 58) + '%)';
  }

  function scoreVerdict(percent) {
    var p = Number(percent) || 0;
    if (p >= 90) return 'уровень освоен';
    if (p >= 75) return 'уровень почти освоен';
    if (p >= 50) return 'половина пройдена';
    return 'нужно повторить материал';
  }

  function progressFromResults(results) {
    var progress = { level1: null, level2: null, canOpen2: false };
    (results || []).forEach(function (result) {
      var level = Number(result.examLevel) || 1;
      var key = level === 2 ? 'level2' : 'level1';
      if (!progress[key] || Number(result.percent) > Number(progress[key].percent)) progress[key] = result;
    });
    progress.canOpen2 = !!(progress.level1 && Math.round(Number(progress.level1.percent)) === 100);
    return progress;
  }

  function normalizedProgress(value) {
    if (value && Object.prototype.hasOwnProperty.call(value, 'level1')) return value;
    return {
      level1: value || null,
      level2: null,
      canOpen2: !!(value && Math.round(Number(value.percent)) === 100)
    };
  }

  function wireLevelActions() {
    [].slice.call(app.querySelectorAll('[data-open-level="2"]')).forEach(function (button) {
      button.onclick = function () { location.href = 'level2.html'; };
    });
  }

  function levelOutline(level) {
    var items = level && Array.isArray(level.outline) ? level.outline : [];
    if (!items.length) return '';
    return '<ul class="level-outline">' +
      items.map(function (item) {
        return '<li>' + esc(item) + '</li>';
      }).join('') +
    '</ul>';
  }

  function levelLadder(value) {
    var progress = normalizedProgress(value);
    var best = progress.level1;
    var locked = LEVELS.filter(function (lv) { return lv.n > 2; });
    var html = '<ol class="levels">';
    var first = LEVELS[0];
    if (!best) {
      html += '<li class="level is-level-one is-open is-empty">' +
        levelDecor() +
        '<div class="level-head"><span class="level-n">1</span>' +
        '<span class="level-name">Уровень</span>' +
        '<span class="level-lock is-ready">доступен</span></div>' +
        '<p class="level-topic">' + esc(first.topic) + '</p>' +
        levelOutline(first) +
        '<p class="level-hint">Экзамен ещё не сдан</p>' +
      '</li>';
    } else {
      var pct = Math.round(best.percent);
      html += '<li class="level is-level-one is-open is-scored" style="--score-color: ' + scoreColor(pct) + '">' +
        levelDecor() +
        '<div class="level-head"><span class="level-n">1</span>' +
        '<span class="level-name">Уровень</span>' +
        '<span class="level-verdict">' + scoreVerdict(pct) + '</span></div>' +
        '<p class="level-topic">' + esc(first.topic) + '</p>' +
        levelOutline(first) +
        '<div class="level-score"><span class="level-percent">' + pct + '<i>%</i></span>' +
          '<span class="level-points">' + esc(best.points) + ' из ' + esc(best.max) + ' баллов письменной части</span></div>' +
        '<div class="level-bar"><span style="width: ' + pct + '%"></span></div>' +
      '</li>';
    }

    var second = LEVELS[1];
    if (progress.canOpen2) {
      var level2 = progress.level2;
      html += '<li><button class="level level-button is-level-two is-open' + (level2 ? ' is-submitted' : ' is-empty') +
        '" type="button" data-open-level="2">' +
        levelDecor() +
        '<div class="level-head"><span class="level-n">2</span>' +
          '<span class="level-name">Уровень</span>' +
          '<span class="level-lock is-ready">' + (level2 ? 'отправлен' : 'открыт') + '</span></div>' +
        '<p class="level-topic">' + esc(second.topic) + '</p>' +
        levelOutline(second) +
        '<p class="level-hint">' + (level2
          ? 'Работа ожидает проверки преподавателем →'
          : 'Результат 100% подтверждён. Начать экзамен →') + '</p>' +
      '</button></li>';
    } else {
      html += '<li class="level is-level-two is-locked">' +
        levelDecor() +
        '<div class="level-head"><span class="level-n">2</span>' +
          '<span class="level-name">Уровень</span>' +
          '<span class="level-lock"><svg class="level-lock-icon" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ' +
            'focusable="false" aria-hidden="true"><circle cx="12" cy="16" r="1"></circle>' +
            '<rect x="3" y="10" width="18" height="12" rx="2"></rect>' +
            '<path d="M7 10V7a5 5 0 0 1 10 0v3"></path></svg>закрыт</span></div>' +
        '<p class="level-topic">' + esc(second.topic) + '</p>' +
        levelOutline(second) +
        '<p class="level-hint">Откроется после результата 100% за первый уровень</p>' +
      '</li>';
    }
    html += '</ol>';

    // Закрытые уровни — узкая штрихованная полоса без обещаний по темам
    if (locked.length) {
      html += '<div class="levels-locked" role="group" aria-label="Следующие уровни пока закрыты">' +
        locked.map(function (lv) {
          return '<span class="locked-chip"><b>' + lv.n + '</b></span>';
        }).join('') +
        '<span class="locked-note">Следующие уровни откроет преподаватель</span>' +
      '</div>';
    }
    return html;
  }

  /* Уровни в кабинете: подробно показываем только те, где что-то
     происходит (первый и второй). Закрытые 3-6 сворачиваются в одну
     строку — иначе вкладка «Результаты» не помещалась в экран телефона,
     а шесть одинаковых строк «закрыт» ничего не сообщали. */
  function profileLevels(value) {
    var progress = normalizedProgress(value);
    var shown = LEVELS.filter(function (level) { return level.n <= 2; });
    var hidden = LEVELS.filter(function (level) { return level.n > 2; });
    var items = shown.map(function (level) {
      var pct = 0;
      var status = 'закрыт';
      var kind = 'is-future';
      if (level.n === 1) {
        pct = progress.level1 ? Math.round(Number(progress.level1.percent) || 0) : 0;
        status = progress.level1 ? pct + '%' : 'не сдан';
        kind = 'is-primary';
      } else if (level.n === 2 && !progress.canOpen2) {
        pct = 100;
        status = 'закрыт';
        kind = 'is-blocked';
      } else if (level.n === 2 && progress.level2) {
        if (progress.level2.gradingStatus === 'pending') {
          pct = 100;
          status = 'на проверке';
          kind = 'is-blocked';
        } else {
          pct = Math.round(Number(progress.level2.percent) || 0);
          status = pct + '%';
          kind = 'is-primary';
        }
      } else if (level.n === 2 && progress.canOpen2) {
        status = 'доступен';
        kind = 'is-ready';
      }
      pct = Math.max(0, Math.min(100, pct));
      /* Строка на уровень: крупный номер, название состояния и одна
         заполненная линия. Прежние трёхсекционные «батарейки» из
         квадратиков читались как мусор и ничего не сообщали. */
      return '<li class="profile-level ' + kind + '">' +
        '<span class="profile-level-n">' + level.n + '</span>' +
        '<span class="profile-level-body">' +
          '<span class="profile-level-head"><span>Уровень ' + level.n + '</span>' +
            '<strong>' + status + '</strong></span>' +
          '<span class="profile-level-meter" style="--meter-progress:' + pct + '%" ' +
            'role="img" aria-label="Уровень ' + level.n + ': ' + status + '">' +
            '<span class="profile-meter-fill" aria-hidden="true"></span>' +
          '</span>' +
        '</span>' +
      '</li>';
    });

    /* Свёрнутая строка: номера закрытых уровней и пояснение, кто их
       откроет. Так же, как на главной под карточками уровней. */
    if (hidden.length) {
      items.push('<li class="profile-level is-rest">' +
        '<span class="profile-rest-chips">' +
          hidden.map(function (level) {
            return '<span class="profile-rest-chip">' + level.n + '</span>';
          }).join('') +
        '</span>' +
        '<span class="profile-rest-note">Откроет преподаватель</span>' +
      '</li>');
    }

    return '<ol class="profile-levels">' + items.join('') + '</ol>';
  }

  function profileInitials(student) {
    var first = String(student.firstName || '').trim().charAt(0);
    var last = String(student.lastName || '').trim().charAt(0);
    return (first + last || 'Т').toUpperCase();
  }

  function profileAvatar(student) {
    if (student.avatarDataUrl) {
      return '<img src="' + esc(student.avatarDataUrl) + '" alt="">';
    }
    return '<span aria-hidden="true">' + esc(profileInitials(student)) + '</span>';
  }

  function prepareAvatar(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type || '')) {
        return reject(new Error('Выберите JPEG, PNG или WebP.'));
      }
      if (file.size > 8 * 1024 * 1024) return reject(new Error('Фотография больше 8 МБ.'));
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Не удалось прочитать фотографию.')); };
      reader.onload = function () {
        var image = new Image();
        image.onerror = function () { reject(new Error('Не удалось открыть фотографию.')); };
        image.onload = function () {
          var side = Math.min(image.naturalWidth, image.naturalHeight);
          if (!side) return reject(new Error('Фотография повреждена.'));
          var canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          var context = canvas.getContext('2d');
          if (!context) return reject(new Error('Не удалось обработать фотографию.'));
          context.drawImage(image,
            (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side,
            0, 0, 256, 256);
          var dataUrl = canvas.toDataURL('image/jpeg', 0.84);
          if (dataUrl.length > 550 * 1024) return reject(new Error('Не удалось достаточно уменьшить фотографию.'));
          resolve(dataUrl);
        };
        image.src = String(reader.result || '');
      };
      reader.readAsDataURL(file);
    });
  }

  /* ── Состояние ─────────────────────────────────────────── */

  var steps = buildSteps();
  var state = {
    phase: 'welcome', // welcome | lead | leadDone | reg | exam | done
    stepIdx: 0,
    student: null,
    startedAt: null,
    submissionId: null,
    attemptPassId: null,
    attemptRequestId: null,
    answers: freshAnswers()
  };

  /* Журнал поведения: скриншот в браузере не заблокировать, поэтому
     фиксируем уходы со вкладки и показываем их преподавателю. */
  var integrity = { away: 0, awayMs: 0, events: [] };
  var awayAt = 0;
  /* Системный диалог (запрос микрофона, confirm) тоже снимает фокус с окна.
     Это штатное действие самого экзамена, а не уход на подсказки — иначе
     преподаватель увидит «улику» там, где ученик просто разрешил микрофон. */
  var systemDialog = false;

  function watchIntegrity() {
    function leave() {
      if (state.phase !== 'exam' || awayAt || systemDialog) return;
      awayAt = Date.now();
    }
    function back() {
      if (!awayAt) return;
      var ms = Date.now() - awayAt;
      awayAt = 0;
      if (ms < 400) return; // моргание фокуса при тапе — не считаем
      integrity.away += 1;
      integrity.awayMs += ms;
      if (integrity.events.length < 60) {
        integrity.events.push({ step: state.stepIdx, ms: ms, at: new Date().toISOString() });
      }
      save();
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) leave(); else back();
    });
    window.addEventListener('blur', leave);
    window.addEventListener('focus', back);
  }

  var audioBlob = null;
  var audioMime = '';
  var timerId = null;
  var deadline = 0;
  var cur = null; // { collect: fn } — сборщик ответа текущего экрана
  var screenCleanup = null;
  var serverResult = null;
  var submitError = null;

  /* ── Утилиты ───────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function fmtMinutes(value) {
    var minutes = Number(value) || 0;
    var hours = Math.floor(minutes / 60);
    var rest = minutes % 60;
    return (hours < 10 ? '0' : '') + hours + ':' + (rest < 10 ? '0' : '') + rest;
  }

  function uuid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  }

  function freshAnswers() {
    return {
      match: {},
      syllables: EXAM.tasks[1].words.map(function () { return null; }),
      sifat: {},
      compose: EXAM.tasks[3].items.map(function () { return ''; }),
      yesno: EXAM.tasks[4].statements.map(function () { return null; }),
      readingRecorded: false
    };
  }

  function shuffled(arr, seed) {
    var a = arr.slice();
    var r = seed * 2654435761 % 4294967296;
    for (var i = a.length - 1; i > 0; i--) {
      r = (r * 1103515245 + 12345) % 2147483648;
      var j = r % (i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* Черновик экзамена. resumable=true означает «экзамен начат и не сдан»:
     по нему на главной появляется кнопка «Продолжить экзамен». Отдельный
     флаг нужен потому, что при выходе на главную state.phase становится
     'welcome', а сам черновик обязан пережить выход — это ровно то, что
     обещает текст подтверждения выхода. */
  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        phase: state.phase,
        resumable: state.phase === 'exam' || state.resumable === true,
        stepIdx: state.stepIdx,
        student: state.student,
        startedAt: state.startedAt,
        submissionId: state.submissionId,
        attemptPassId: state.attemptPassId,
        attemptRequestId: state.attemptRequestId,
        answers: state.answers,
        integrity: integrity
      }));
    } catch (e) { /* приватный режим — работаем без сохранения */ }
  }

  /* Черновик лежит в localStorage, который правится руками и переживает
     правки data.js. Поэтому каждое поле проверяем по форме, а не по факту
     наличия: иначе строка вместо массива уронит сбор ответов. */
  function sameShape(saved, sample) {
    if (Array.isArray(sample)) {
      return Array.isArray(saved) && saved.length === sample.length;
    }
    if (sample && typeof sample === 'object') {
      /* match и sifat — словари, где значение обязано быть строкой или
         массивом строк: иначе клик по варианту падает с TypeError,
         а генерация отчёта — на .join(). */
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return false;
      for (var key in saved) {
        if (!Object.prototype.hasOwnProperty.call(saved, key)) continue;
        var v = saved[key];
        var okValue = typeof v === 'string' ||
          (Array.isArray(v) && v.every(function (item) { return typeof item === 'string'; }));
        if (!okValue) return false;
      }
      return true;
    }
    return typeof saved === typeof sample;
  }

  function restore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (!saved || !saved.student) return;
      var live = saved.phase === 'exam' || saved.phase === 'done';
      if (!live && !saved.resumable) return;

      state.resumable = saved.resumable === true || saved.phase === 'exam';
      state.phase = live ? saved.phase : 'welcome';
      state.stepIdx = Math.min(Math.max(0, saved.stepIdx | 0), steps.length - 1);
      state.student = saved.student;
      state.startedAt = saved.startedAt;
      state.submissionId = saved.submissionId || uuid();
      state.attemptPassId = /^[0-9a-f-]{36}$/i.test(String(saved.attemptPassId || ''))
        ? saved.attemptPassId : null;
      state.attemptRequestId = /^[0-9a-f-]{36}$/i.test(String(saved.attemptRequestId || ''))
        ? saved.attemptRequestId : null;

      var fresh = freshAnswers();
      if (saved.answers) {
        for (var k in fresh) {
          if (!Object.prototype.hasOwnProperty.call(fresh, k)) continue;
          if (sameShape(saved.answers[k], fresh[k])) state.answers[k] = saved.answers[k];
        }
      }
      if (saved.integrity && typeof saved.integrity === 'object') {
        integrity.away = saved.integrity.away | 0;
        integrity.awayMs = saved.integrity.awayMs | 0;
        integrity.events = Array.isArray(saved.integrity.events) ? saved.integrity.events : [];
      }
      // аудио живёт только в памяти — после перезагрузки записи нет
      state.answers.readingRecorded = false;
    } catch (e) { /* повреждённое сохранение игнорируем */ }
  }

  function api(path, body, timeout) {
    if (!API) return Promise.reject(new Error('API не настроен'));
    return fetchWithTimeout(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }, timeout || 15000).then(function (r) {
      if (!r.ok) {
        var error = new Error('HTTP ' + r.status);
        error.status = r.status;
        throw error;
      }
      return r.json();
    });
  }

  /* Контейнер на Railway засыпает, и первый запрос после простоя может
     не успеть. Отправка ответов давно ходит с повторами; чтение профиля
     и кабинета — тоже GET, повтор для него безопасен. */
  function apiGet(path, attempt) {
    if (!API) return Promise.reject(new Error('API не настроен'));
    var n = attempt || 1;
    return fetchWithTimeout(API + path, {}, 20000).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status);
        err.status = r.status;
        throw err;
      }
      return r.json();
    }).catch(function (err) {
      // 4xx повторять бессмысленно: ответ не изменится
      if (err && err.status && err.status >= 400 && err.status < 500) throw err;
      if (n >= 3) throw err;
      return new Promise(function (resolve) {
        setTimeout(resolve, n * 2000);
      }).then(function () { return apiGet(path, n + 1); });
    });
  }

  function courseworkFileMime(file) {
    if (file.type) return file.type;
    var extension = String(file.name || '').split('.').pop().toLowerCase();
    return ({
      pdf: 'application/pdf', txt: 'text/plain', mp3: 'audio/mpeg', m4a: 'audio/mp4',
      wav: 'audio/wav', ogg: 'audio/ogg', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    })[extension] || 'application/octet-stream';
  }

  function uploadHomeworkFile(homeworkId, token, file) {
    return fetchWithTimeout(API + '/api/homework/' + homeworkId + '/files', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Student-Token': token,
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Type': courseworkFileMime(file)
      },
      body: file
    }, 60000).then(function (response) {
      if (response.ok) return response.json();
      return response.json().catch(function () { return {}; }).then(function (data) {
        var error = new Error(data.error || 'Не удалось загрузить файл');
        error.status = response.status;
        throw error;
      });
    });
  }

  function openCourseworkFile(id, name, token) {
    return fetchWithTimeout(API + '/api/learning-files/' + encodeURIComponent(id), {
      headers: { 'X-Student-Token': token }
    }, 60000).then(function (response) {
      if (!response.ok) throw new Error('Не удалось открыть файл');
      return response.blob();
    }).then(function (blob) {
      var href = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = href;
      link.download = name || 'material';
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 30000);
    });
  }

  function courseworkFilesHtml(files, label) {
    if (!files || !files.length) return '';
    return '<div class="coursework-files"><p>' + esc(label || 'Файлы') + '</p>' +
      files.map(function (file) {
        var size = Number(file.size) || 0;
        var textSize = size >= 1024 * 1024
          ? (size / 1024 / 1024).toFixed(1) + ' МБ' : Math.max(1, Math.round(size / 1024)) + ' КБ';
        return '<button class="coursework-file" type="button" data-coursework-file="' + esc(file.id) +
          '" data-coursework-name="' + esc(file.name) + '"><span>' + esc(file.name) + '</span><small>' +
          esc(textSize) + '</small></button>';
      }).join('') + '</div>';
  }

  function fetchWithTimeout(url, options, timeout) {
    if (typeof AbortController === 'undefined') return fetch(url, options);
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout || 15000);
    var requestOptions = Object.assign({}, options || {}, { signal: controller.signal });
    return fetch(url, requestOptions).then(function (response) {
      clearTimeout(timer);
      return response;
    }, function (error) {
      clearTimeout(timer);
      throw error;
    });
  }

  function hit() {
    if (!API) return;
    // text/plain — «простой» запрос без CORS-preflight
    fetch(API + '/api/hit', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ p: location.pathname, r: document.referrer }),
      keepalive: true
    }).catch(function () { /* статистика не критична */ });
  }

  /* ── Шаги экзамена ─────────────────────────────────────── */

  function buildSteps() {
    var list = [];
    EXAM.tasks.forEach(function (task) {
      list.push({ t: 'intro', task: task });
      if (task.kind === 'match') list.push({ t: 'q', task: task, sub: 0 });
      if (task.kind === 'syllables') task.words.forEach(function (w, i) { list.push({ t: 'q', task: task, sub: i }); });
      if (task.kind === 'sifat') task.letters.forEach(function (l, i) { list.push({ t: 'q', task: task, sub: i }); });
      if (task.kind === 'compose') task.items.forEach(function (it, i) { list.push({ t: 'q', task: task, sub: i }); });
      if (task.kind === 'yesno') task.statements.forEach(function (s, i) { list.push({ t: 'q', task: task, sub: i }); });
      if (task.kind === 'reading') list.push({ t: 'q', task: task, sub: 0 });
    });
    return list;
  }

  function questionNumber(step) {
    // порядковый номер вопроса внутри задания (с 1)
    return step.sub + 1;
  }

  /* ── Таймер ────────────────────────────────────────────── */

  var warned30 = false;

  function startTimer(seconds, onExpire) {
    stopTimer();
    warned30 = false;
    var alertEl = document.getElementById('timeAlert');
    if (alertEl) alertEl.textContent = '';
    topbarTimer.textContent = fmtTime(seconds);
    topbarTimer.classList.remove('is-low');
    deadline = Date.now() + seconds * 1000;
    topbarTimer.hidden = false;
    timebar.hidden = false;
    timebar.max = seconds;
    timebar.value = seconds;
    timerId = setInterval(function () {
      var left = deadline - Date.now();
      if (left <= 0) {
        stopTimer();
        topbarTimer.textContent = '0:00';
        timebar.value = 0;
        onExpire();
        return;
      }
      var sec = Math.ceil(left / 1000);
      topbarTimer.textContent = fmtTime(sec);
      topbarTimer.classList.toggle('is-low', sec <= 30);
      timebar.value = sec;
      if (sec === 30 && !warned30) {
        warned30 = true;
        var alert = document.getElementById('timeAlert');
        if (alert) alert.textContent = 'Осталось 30 секунд';
      }
    }, 200);
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = null; }
  }

  function hideTimer() {
    stopTimer();
    topbarTimer.hidden = true;
    timebar.hidden = true;
    topbarTimer.classList.remove('is-low');
  }

  /* ── Рендер ────────────────────────────────────────────── */

  function render(html) {
    if (screenCleanup) {
      try { screenCleanup(); } catch (e) { /* экран всё равно должен смениться */ }
      screenCleanup = null;
    }
    document.documentElement.classList.remove('is-auth');
    cur = null;
    app.innerHTML = '<div class="screen">' + html + '</div>';
    window.scrollTo(0, 0);
    var heading = app.querySelector('h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      try { heading.focus({ preventScroll: true }); } catch (e) { heading.focus(); }
    }
  }

  var BASE_TITLE = 'Экзамен по таджвиду · Первый уровень';

  /* Заголовок вкладки следует за экраном: иначе во всех вкладках и во всей
     истории браузера висит одно и то же название. */
  function setBar(label) {
    document.title = label ? label + ' · таджвид.рф' : BASE_TITLE;
    if (!label) { topbar.hidden = true; return; }
    topbar.hidden = false;
    topbarLabel.textContent = label;
  }

  /* ── Навигация ─────────────────────────────────────────── */

  /* Три постоянных пункта: главная всегда под рукой, кабинет — карточкой
     на главной, чтобы навигация не менялась под пользователем. */
  function navItems() {
    return [
      { id: 'home', label: 'Главная', act: function () { state.phase = 'welcome'; show(); },
        on: function () { return state.phase === 'welcome'; } },
      /* Если экзамен начат и не сдан, вкладка возвращает к нему, а не гонит
         анкету заново: иначе ответы незаметно обнулятся на шаге onDone. */
      { id: 'exam', label: 'Экзамен',
        act: function () {
          /* Пункт меню больше не запускает попытку случайным касанием:
             сначала ученик видит уровни и отдельно подтверждает старт. */
          state.phase = 'exams';
          save();
          show();
        },
        on: function () { return state.phase === 'exams' || state.phase === 'reg' || state.phase === 'exam'; } },
      { id: 'lead', label: 'Уроки',
        act: function () {
          if (studentToken()) {
            state.phase = 'lessons';
          } else {
            state.phase = 'lead';
          }
          show();
        },
        on: function () {
          return state.phase === 'lead' || state.phase === 'leadDone' ||
            state.phase === 'lessons';
        } },
      /* База знаний — статичные страницы: у них свои адреса, чтобы
         поисковики видели статьи без выполнения скриптов. */
      { id: 'kb', label: 'Статьи',
        act: function () { location.href = 'stati/'; },
        on: function () { return false; } },
      { id: 'profile', label: 'Профиль',
        act: function () { state.phase = 'profile'; show(); },
        on: function () { return state.phase === 'profile'; } }
    ];
  }

  /* Постоянные разделы отражаются в адресе: иначе после F5 одностраничник
     всегда создаётся с phase=welcome. Служебные ссылки результата, кабинета
     и Яндекс OAuth по-прежнему имеют собственные hash-маршруты ниже. */
  function sectionHash(phase) {
    if (phase === 'lead' || phase === 'leadDone' || phase === 'lessons') return '#lessons';
    /* У кабинета три вкладки, и каждая имеет свой адрес: после F5 ученик
       возвращается ровно туда, где был, а не на первую вкладку. */
    if (phase === 'profile') return profileTabInfo(profileTab).hash;
    if (phase === 'exams' || phase === 'reg') return '#exam';
    if (phase === 'welcome') return '';
    return null;
  }

  function syncSectionHash() {
    var target = sectionHash(state.phase);
    if (target == null || location.hash === target || !history.replaceState) return;
    history.replaceState(null, '', location.pathname + location.search + target);
  }

  /* ── Профиль ───────────────────────────────────────────── */

  function studentToken() {
    try { return localStorage.getItem(STUDENT_KEY) || ''; } catch (e) { return ''; }
  }

  function guestToken() {
    try { return localStorage.getItem(GUEST_KEY) || ''; } catch (e) { return ''; }
  }

  function examOwnerToken() {
    return studentToken() || guestToken();
  }

  /* Кабинет разложен на три вкладки-пилюльки: «Профиль», «Настройки»,
     «Результаты». Так каждый раздел влезает в экран телефона целиком —
     раньше это была одна длинная простыня, которую приходилось листать. */
  var PROFILE_TABS = [
    { id: 'me', label: 'Профиль', hash: '#profile' },
    { id: 'classes', label: 'Классы', hash: '#profile/classes' },
    { id: 'results', label: 'Результаты', hash: '#profile/results' },
    { id: 'settings', label: 'Настройки', hash: '#profile/settings' }
  ];
  var profileTab = 'me';
  var lessonView = 'lessons';

  function formatDueDate(value) {
    try {
      return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
        .format(new Date(value + 'T00:00:00'));
    } catch (e) {
      return value;
    }
  }

  function formatLessonDate(value) {
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        weekday: 'long', day: 'numeric', month: 'long'
      }).format(new Date(value + 'T00:00:00'));
    } catch (e) {
      return value;
    }
  }

  function lessonClock(value) {
    var minute = Number(value);
    if (!Number.isInteger(minute)) return '';
    return String(Math.floor(minute / 60)).padStart(2, '0') + ':' +
      String(minute % 60).padStart(2, '0');
  }

  function classScheduleText(item) {
    var days = (item.scheduleDays || []).map(function (value) {
      var day = WEEK_DAYS.filter(function (candidate) { return candidate.value === value; })[0];
      return day ? day.short : value;
    }).join(', ');
    var start = lessonClock(item.scheduleTimeMinute);
    var end = lessonClock(item.scheduleEndMinute);
    if (days || start) return [days, start && end ? start + '—' + end : start].filter(Boolean).join(' · ');
    return item.schedule || 'Расписание уточняется';
  }

  function profileTabInfo(id) {
    for (var i = 0; i < PROFILE_TABS.length; i++) {
      if (PROFILE_TABS[i].id === id) return PROFILE_TABS[i];
    }
    return PROFILE_TABS[0];
  }

  function profileTabsHtml(active) {
    return '<div class="profile-tabs" role="tablist" aria-label="Разделы кабинета">' +
      PROFILE_TABS.map(function (tab) {
        var on = tab.id === active;
        return '<button class="profile-tab' + (on ? ' is-on' : '') + '" type="button" role="tab"' +
          ' id="ptab-' + tab.id + '" aria-selected="' + (on ? 'true' : 'false') + '"' +
          ' aria-controls="profilePane" data-profile-tab="' + tab.id + '">' +
          esc(tab.label) + '</button>';
      }).join('') +
    '</div>';
  }


  /* ── Вступление в класс по ссылке ──────────────────────────
     Преподаватель присылает ссылку вида #join=КОД. Сначала показываем,
     во что человек вступает, и только потом отправляем заявку: код
     сам по себе ничего не открывает, пока преподаватель не одобрит. */
  function joinClass(code) {
    state.phase = 'join';
    paintNav();
    setBar(null);
    document.title = 'Вступить в класс · таджвид.рф';
    loadingScreen('Класс', 'Проверяем приглашение…');
    var seq = screenToken();

    apiGet('/api/class/' + encodeURIComponent(code)).then(function (d) {
      if (isStale(seq)) return;
      if (!d.ok) throw new Error(d.error || 'Класс не найден');
      var token = studentToken();
      app.innerHTML = '<div class="screen"><h1>Вступить в класс</h1>' +
        '<p class="lede">' + esc(d.class.name) + '</p>' +
        (token
          ? '<p class="profile-standing-note">Преподаватель увидит заявку и примет вас. ' +
            'После этого домашние задания появятся в кабинете.</p>' +
            '<div class="btn-row"><button class="btn" id="joinGo">Отправить заявку</button>' +
            '<button class="btn is-ghost" id="joinSkip">Не сейчас</button></div>'
          : '<p class="profile-standing-note">Чтобы вступить в класс, сначала войдите в свой ' +
            'кабинет — по нему преподаватель вас и узнает.</p>' +
            '<div class="btn-row"><button class="btn" id="joinLogin">Войти в кабинет</button></div>') +
        '<p class="notice" id="joinState" role="status" aria-live="polite" hidden></p></div>';

      var skip = document.getElementById('joinSkip');
      if (skip) skip.onclick = function () { clearHash(); showProfile(); };
      var login = document.getElementById('joinLogin');
      if (login) {
        login.onclick = function () {
          /* Код держим до возврата: после входа ученик дожимает вступление
             одной кнопкой, а не ищет письмо с ссылкой заново. */
          try { sessionStorage.setItem('tajweed_join', code); } catch (e) { /* ок */ }
          showLogin();
        };
      }
      var go = document.getElementById('joinGo');
      if (go) {
        go.onclick = function () {
          go.disabled = true;
          var note = document.getElementById('joinState');
          api('/api/class/join', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code, token: token })
          }).then(function (r) {
            if (!r.ok) throw new Error(r.error || 'Не получилось');
            try { sessionStorage.removeItem('tajweed_join'); } catch (e) { /* ок */ }
            note.hidden = false;
            note.textContent = r.status === 'active'
              ? 'Вы уже в этом классе.'
              : 'Заявка отправлена. Преподаватель её увидит.';
            go.textContent = 'Готово';
            setTimeout(function () {
              clearHash();
              profileTab = 'classes';
              showProfile();
            }, 1400);
          }).catch(function (error) {
            go.disabled = false;
            note.hidden = false;
            note.textContent = error.message || 'Не получилось отправить заявку.';
          });
        };
      }
    }).catch(function (error) {
      if (isStale(seq)) return;
      app.innerHTML = '<div class="screen"><h1>Класс не найден</h1>' +
        '<p class="lede">' + esc(error.message || 'Ссылка устарела.') + '</p>' +
        '<p class="profile-standing-note">Попросите у преподавателя свежую ссылку.</p>' +
        '<div class="btn-row"><button class="btn" id="joinBack">На главную</button></div></div>';
      document.getElementById('joinBack').onclick = function () { clearHash(); showProfile(); };
    });
  }

  function clearHash() {
    if (history.replaceState) history.replaceState(null, '', location.pathname);
  }

  function showProfile() {
    if (state.phase === 'exam') return;
    var standaloneLessons = state.phase === 'lessons';
    if (!standaloneLessons && profileTabInfo(profileTab).id !== profileTab) profileTab = 'me';
    state.phase = standaloneLessons ? 'lessons' : 'profile';
    paintNav();
    var token = studentToken();
    /* Полоса экрана не нужна: заголовок «Профиль» и так стоит первой
       строкой, а лишний ярус съедает высоту, которой на телефоне нет. */
    setBar(null);
    document.title = (standaloneLessons ? 'Мои уроки' : 'Профиль') + ' · таджвид.рф';
    if (!token) {
      if (standaloneLessons) {
        state.phase = 'lead';
        return showLead();
      }
      return showLogin();
    }

    loadingScreen(standaloneLessons ? 'Мои уроки' : 'Профиль', 'Загружаем ваши данные…');
    var seq = screenToken();
    apiGet('/api/student/' + encodeURIComponent(token)).then(function (d) {
      if (isStale(seq)) return;
      if (!d.ok) throw new Error('нет данных');
      var s = d.student;
      var results = d.results || [];
      var progress = progressFromResults(results);
      var best = progress.level1;

      /* ── Вкладка «Профиль»: кто я и как сдал ── */
      function paneMe() {
        var pct = best ? Math.round(Number(best.percent) || 0) : 0;
        return '<section class="frame profile-card profile-summary">' +
          '<div class="profile-avatar-pane">' +
            '<button class="profile-avatar" id="avatarPick" type="button" aria-label="Изменить фотографию профиля">' +
              profileAvatar(s) + '</button>' +
            '<input class="visually-hidden" id="avatarInput" type="file" accept="image/jpeg,image/png,image/webp">' +
            '<button class="profile-text-action" id="avatarPickText" type="button">Изменить фото</button>' +
            (s.avatarDataUrl
              ? '<button class="profile-text-action is-muted" id="avatarRemove" type="button">Удалить</button>'
              : '') +
          '</div>' +
          '<div class="profile-summary-body">' +
            '<p class="kicker">Ученик<span class="cur">_</span></p>' +
            '<p class="profile-name">' + esc(s.lastName) + ' ' + esc(s.firstName) + '</p>' +
            '<dl class="profile-meta">' +
              '<div><dt>Город</dt><dd>' + esc(s.city) + '</dd></div>' +
              '<div><dt>Телефон</dt><dd>' + esc(formatPhone(s.phone)) + '</dd></div>' +
            '</dl>' +
            '<button class="profile-edit-action" id="editProfile" type="button">Изменить имя</button>' +
          '</div>' +
        '</section>' +
        '<section class="profile-editor" id="profileEditor" hidden>' +
          '<form class="form profile-editor-form" id="profileForm" novalidate>' +
            '<div class="field" data-f="firstName"><label for="profileFirstName">Имя</label>' +
              '<input id="profileFirstName" name="firstName" autocomplete="given-name" maxlength="60" value="' +
                esc(s.firstName) + '">' +
              '<span class="err" data-msg="Введите имя" role="alert"></span></div>' +
            '<div class="field" data-f="lastName"><label for="profileLastName">Фамилия</label>' +
              '<input id="profileLastName" name="lastName" autocomplete="family-name" maxlength="60" value="' +
                esc(s.lastName) + '">' +
              '<span class="err" data-msg="Введите фамилию" role="alert"></span></div>' +
            '<p class="notice is-error" id="profileEditError" role="status" aria-live="polite" hidden></p>' +
            '<div class="profile-editor-actions"><button class="btn" type="submit">Сохранить</button>' +
              '<button class="btn is-ghost" id="cancelProfileEdit" type="button">Отмена</button></div>' +
          '</form>' +
        '</section>' +
        '<p class="profile-avatar-status" id="avatarStatus" role="status" aria-live="polite" hidden></p>' +
        '<section class="profile-standing"' +
          (best ? ' style="--score-color: ' + scoreColor(pct) + '"' : '') + '>' +
          '<p class="kicker">Мой экзамен<span class="cur">_</span></p>' +
          (best
            ? '<p class="profile-standing-head"><span>Уровень 1</span><b>' + pct + '%</b></p>' +
              '<div class="level-bar"><span style="width: ' + pct + '%"></span></div>' +
              '<p class="profile-standing-note">' + esc(scoreVerdict(pct)) + '</p>'
            : '<p class="profile-standing-note">Экзамен первого уровня ещё не сдан.</p>' +
              '<p class="profile-standing-note">Экзамен запускается из отдельного раздела нижнего меню.</p>') +
        '</section>';
      }

      /* ── Вкладка «Настройки»: пароль и выход ── */
      function paneSettings() {
        var wallet = d.wallet || { balance: 0, prices: { instantRetake: 100, hint: 50 }, transactions: [], topups: [] };
        var pending = (wallet.topups || []).filter(function (item) { return item.status === 'pending'; });
        var transactionLabels = {
          teacher_adjustment: 'Корректировка преподавателем',
          topup: 'Пополнение', instant_retake: 'Мгновенная попытка', exam_hint: 'Подсказка'
        };
        var history = (wallet.transactions || []).slice(0, 8).map(function (item) {
          var when = '';
          try {
            when = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
              .format(new Date(item.createdAt));
          } catch (error) { when = item.createdAt || ''; }
          return '<div class="wallet-operation"><div><b>' + esc(transactionLabels[item.kind] || item.note || 'Операция') +
            '</b><span>' + esc(when) + '</span></div><strong class="' + (item.amount > 0 ? 'is-plus' : '') + '">' +
            (item.amount > 0 ? '+' : '') + esc(item.amount) + '</strong></div>';
        }).join('');
        return '<section class="wallet-card">' +
          '<div class="wallet-balance"><p>Мой кошелёк</p><div><b>' + esc(wallet.balance) + '</b><span>нуров</span></div></div>' +
          '<p class="wallet-intro">Нуры дают удобство, но не закрывают обучение: повторный экзамен бесплатен через 48 часов. ' +
            'Сейчас начать раньше стоит ' + esc(wallet.prices.instantRetake) + ', подсказка — ' + esc(wallet.prices.hint) + ' нуров.</p>' +
          '<div class="wallet-prices"><div><span>Быстрая пересдача</span><b>' + esc(wallet.prices.instantRetake) + '</b></div>' +
            '<div><span>Подсказка</span><b>' + esc(wallet.prices.hint) + '</b></div></div>' +
          '<div class="wallet-topup"><p class="kicker">Пополнить<span class="cur">_</span></p>' +
            '<div class="wallet-topup-options">' + [100, 300, 500, 1000].map(function (amount) {
              return '<button type="button" data-wallet-topup="' + amount + '">+' + amount + '</button>';
            }).join('') + '</div>' +
            '<p class="wallet-topup-note" id="walletTopupState" role="status" aria-live="polite">' +
              (pending.length ? 'Ожидает подтверждения: ' + pending.map(function (item) { return item.amount; }).join(', ') + ' нуров.'
                : 'Заявка уйдёт преподавателю. После подтверждения нуры сразу появятся на балансе.') + '</p></div>' +
          '<div class="wallet-history"><p class="kicker">История<span class="cur">_</span></p>' +
            (history || '<p class="profile-standing-note">Операций пока нет.</p>') + '</div>' +
          '<p class="wallet-fineprint">Нуры — внутренние учебные единицы без вывода и перевода другому ученику. Реальные онлайн-платежи появятся только после подключения защищённого платёжного провайдера.</p>' +
        '</section>' +
        '<div class="settings wallet-settings">' +
          '<button class="setting-row" id="' + (s.hasPassword ? 'changePass' : 'setPass') + '" type="button">' +
            '<span><b>Пароль</b><small>Вход с другого телефона</small></span>' +
            '<span class="setting-value">' + (s.hasPassword ? 'Изменить' : 'Задать') + '</span></button>' +
          '<button class="setting-row" id="logout" type="button">' +
            '<span><b>Выйти</b><small>Данные останутся у преподавателя</small></span>' +
            '<span class="setting-value">Выйти</span></button>' +
        '</div>';
      }

      function homeworkItemHtml(h) {
        var workStatus = h.status || (h.done ? 'accepted' : 'assigned');
        var statusLabels = {
          assigned: 'не сдано', submitted: 'отправлено', in_review: 'проверяется',
          changes_requested: 'нужно доработать', accepted: 'принято'
        };
        var canSubmit = workStatus === 'assigned' || workStatus === 'changes_requested';
        return '<article class="hw-item' + (workStatus === 'accepted' ? ' is-done' : '') + '">' +
          '<p class="hw-head"><b>' + esc(h.title) + '</b>' +
            '<span class="hw-flag">' + esc(statusLabels[workStatus] || workStatus) + '</span></p>' +
          '<p class="hw-meta">' + esc(h.className) +
            (h.dueDate ? ' · до ' + esc(formatDueDate(h.dueDate)) : ' · без срока') + '</p>' +
          (h.score != null ? '<p class="hw-score"><b>' + esc(h.score) + '</b><span>из 100</span></p>' : '') +
          (h.body ? '<p class="hw-text">' + esc(h.body) + '</p>' : '') +
          courseworkFilesHtml(h.files || [], 'Приложенная работа') +
          (h.feedback ? '<div class="hw-feedback"><b>Отзыв преподавателя</b><p>' + esc(h.feedback) + '</p></div>' : '') +
          (workStatus === 'submitted' || workStatus === 'in_review'
            ? '<p class="hw-state-note">Работа у преподавателя. Когда он её проверит, здесь появится отзыв.</p>' : '') +
          (canSubmit ? '<form class="hw-submit" data-homework-submit="' + h.id + '" data-existing-files="' + (h.files || []).length + '">' +
            '<label for="hw-answer-' + h.id + '">Ответ</label>' +
            '<textarea id="hw-answer-' + h.id + '" name="responseText" maxlength="8000" placeholder="Что вы сделали, где было трудно">' + esc(h.responseText || '') + '</textarea>' +
            '<label for="hw-files-' + h.id + '">Фото, аудио, видео или файл</label>' +
            '<input id="hw-files-' + h.id + '" name="files" type="file" multiple accept="image/*,audio/*,video/*,.pdf,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx">' +
            '<small class="hw-file-hint">До 8 файлов, каждый не больше 20 МБ.</small>' +
            '<button class="btn" type="submit">' + (workStatus === 'changes_requested' ? 'Отправить заново' : 'Сдать работу') + '</button>' +
            '<p class="hw-submit-state" role="status" aria-live="polite"></p></form>' : '') +
        '</article>';
      }

      /* ── Вкладка «Уроки»: расписание, журнал занятий и материалы ── */
      function paneLessons() {
        var classes = (d.classes || []).filter(function (item) { return item.status === 'active'; });
        var lessons = (d.lessons || []).slice().sort(function (a, b) {
          return String(b.date || '').localeCompare(String(a.date || ''));
        });
        var homework = d.homework || [];
        var html = '';

        if (lessonView === 'homework') {
          html += '<section class="profile-section lesson-assignments"><div class="profile-section-head">' +
            '<h2 class="kicker">Задания<span class="cur">_</span></h2>' +
            '<p>' + (homework.length || 'Пока пусто') + '</p></div>';
          if (!classes.length) {
            return html + '<p class="profile-standing-note">Когда преподаватель добавит вас в класс, ' +
              'здесь появятся задания.</p></section>';
          }
          if (!homework.length) {
            return html + '<p class="profile-standing-note">Преподаватель ещё не выдал заданий.</p></section>';
          }
          return html + '<div class="hw-list">' + homework.map(homeworkItemHtml).join('') + '</div></section>';
        }

        html += '<section class="lesson-overview"><div class="profile-section-head">' +
          '<h2 class="kicker">Расписание<span class="cur">_</span></h2>' +
          '<p>' + (classes.length ? classes.length + (classes.length === 1 ? ' группа' : ' группы') : 'Нет группы') + '</p></div>';

        if (!classes.length) {
          return html + '<p class="profile-standing-note">Когда преподаватель добавит вас в класс, ' +
            'здесь появятся расписание, материалы уроков и домашние задания.</p>' +
            '<div class="btn-row"><button class="btn" id="requestLessons" type="button">Записаться на уроки</button></div></section>';
        }

        html += '<div class="lesson-class-list">';
        classes.forEach(function (item) {
          html += '<article class="lesson-class"><div><b>' + esc(item.name) + '</b>' +
            (item.level ? '<span>' + esc(item.level) + '</span>' : '') + '</div>' +
            '<p>' + esc(classScheduleText(item)) + '</p></article>';
        });
        html += '</div><button class="profile-text-action lesson-request" id="requestLessons" type="button">Записаться в другую группу</button></section>';

        html += '<section class="profile-section lesson-journal"><div class="profile-section-head">' +
          '<h2 class="kicker">Журнал занятий<span class="cur">_</span></h2>' +
          '<p>' + (lessons.length || 'Пока пусто') + '</p></div>';
        if (!lessons.length) {
          return html + '<p class="profile-standing-note">Преподаватель ещё не добавил проведённые уроки.</p></section>';
        }

        html += '<div class="lesson-feed">';
        lessons.forEach(function (lesson) {
          html += '<article class="lesson-entry">' +
            '<header class="lesson-entry-head"><div><p class="lesson-date">' + esc(formatLessonDate(lesson.date)) + '</p>' +
              '<h3>' + esc(lesson.title) + '</h3></div>' +
              '<p class="lesson-time">' + esc(lesson.className) +
                (lesson.startMinute != null ? '<br>' + esc(lessonClock(lesson.startMinute)) +
                  (lesson.endMinute != null ? '—' + esc(lessonClock(lesson.endMinute)) : '') : '') + '</p></header>' +
            (lesson.summary ? '<p class="lesson-summary">' + esc(lesson.summary) + '</p>' : '') +
            ((lesson.materials || []).length ? '<div class="lesson-materials"><p>Материалы урока</p>' +
              lesson.materials.map(function (material) {
                return material.url
                  ? '<a class="lesson-material" href="' + esc(material.url) + '" target="_blank" rel="noopener">' + esc(material.title) + '<span aria-hidden="true">↗</span></a>'
                  : '<span class="lesson-material">' + esc(material.title) + '</span>';
              }).join('') + '</div>' : '') +
            courseworkFilesHtml(lesson.files || [], 'Материалы урока') +
          '</article>';
        });
        return html + '</div></section>';
      }

      /* ── Вкладка «Классы»: группы ученика и что в них задано ── */
      function paneClasses() {
        var classes = d.classes || [];
        var homework = d.homework || [];
        var html = '';

        if (!classes.length) {
          return '<section class="profile-section"><div class="profile-section-head">' +
            '<h2 class="kicker">Классы<span class="cur">_</span></h2>' +
            '<p>Пока ни одного</p></div>' +
            '<p class="profile-standing-note">Вы не состоите ни в одном классе. ' +
            'Преподаватель добавит вас сам или пришлёт ссылку-приглашение.</p></section>';
        }

        html += '<section class="profile-section"><div class="profile-section-head">' +
          '<h2 class="kicker">Мои классы<span class="cur">_</span></h2>' +
          '<p>' + classes.length + '</p></div><div class="class-list">';
        classes.forEach(function (c) {
          var waiting = c.status === 'pending';
          var classHomework = homework.filter(function (item) { return Number(item.classId) === Number(c.id); });
          var accepted = classHomework.filter(function (item) {
            return item.status === 'accepted' || item.done;
          }).length;
          var progressPercent = classHomework.length ? Math.round(accepted / classHomework.length * 100) : 0;
          html += '<div class="class-row' + (waiting ? ' is-waiting' : '') + '">' +
            '<span class="class-name">' + esc(c.name) + '</span>' +
            (waiting
              ? '<span class="class-state">ждёт одобрения</span>'
              : '<span class="class-state">' + (classHomework.length
                ? accepted + ' из ' + classHomework.length + ' · ' + progressPercent + '%'
                : 'заданий пока нет') + '</span>') +
            (!waiting ? '<span class="class-progress" aria-label="Выполнено ' + progressPercent + ' процентов">' +
              '<span style="width:' + progressPercent + '%"></span></span>' : '') +
            (c.note ? '<span class="class-note">' + esc(c.note) + '</span>' : '') +
          '</div>';
        });
        html += '</div></section>';

        return html;
      }

      /* ── Вкладка «Результаты»: уровни и все попытки ── */
      function paneResults() {
        var html = '<section class="profile-section"><div class="profile-section-head">' +
          '<h2 class="kicker">Уровни<span class="cur">_</span></h2>' +
          '<p>Прогресс обучения</p></div>' + profileLevels(progress) + '</section>';

        if (results.length) {
          html += '<section class="profile-section"><div class="profile-section-head">' +
            '<h2 class="kicker">Попытки<span class="cur">_</span></h2>' +
            '<p>' + results.length + ' сохранено</p></div><div class="result-list">';
          results.forEach(function (r) {
            var level = Number(r.examLevel) || 1;
            /* Содержимое лежит в обёртке: сама кнопка не может быть
               grid-контейнером — браузер заворачивает её содержимое
               в анонимный блок, и колонка с процентом уезжает под текст. */
            html += '<button class="result-item" data-result-id="' + esc(r.id) + '">' +
              '<span class="result-item-body">' +
                '<span><b>Экзамен ' + (level === 2 ? 'второго' : 'первого') + ' уровня</b><br><span class="meta">' +
                esc(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(r.createdAt))) +
                '</span></span>' +
                (r.gradingStatus === 'pending'
                  ? '<span class="score">на проверке</span>'
                  : '<span class="score">' + Math.round(r.percent) + '%</span>') +
              '</span>' +
              '</button>';
          });
          html += '</div></section>';
        }

        return html + (best ? '<div class="btn-row"><button class="btn" data-open-result="' +
          esc(best.id) + '">Разбор и отчёт</button></div>' : '');
      }

      /* Переключение вкладок не ходит на сервер: данные уже загружены,
         меняется только содержимое панели. */
      function paintPane() {
        var pane = document.getElementById('profilePane');
        if (!pane) return;
        pane.innerHTML = standaloneLessons ? paneLessons()
          : profileTab === 'settings' ? paneSettings()
          : profileTab === 'results' ? paneResults()
          : profileTab === 'classes' ? paneClasses()
          : paneMe();
        pane.setAttribute('aria-labelledby', standaloneLessons ? 'lessonsTitle' : 'ptab-' + profileTab);
        [].slice.call(app.querySelectorAll('[data-profile-tab]')).forEach(function (button) {
          var on = button.getAttribute('data-profile-tab') === profileTab;
          button.classList.toggle('is-on', on);
          button.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        [].slice.call(app.querySelectorAll('[data-lesson-view]')).forEach(function (button) {
          var on = button.getAttribute('data-lesson-view') === lessonView;
          button.classList.toggle('is-on', on);
          button.setAttribute('aria-selected', on ? 'true' : 'false');
        });
        syncSectionHash();
        wirePane();
      }

      render(standaloneLessons
        ? '<h1 class="profile-title" id="lessonsTitle">Мои уроки</h1>' +
          '<div class="lesson-view-tabs" role="tablist" aria-label="Уроки и задания">' +
            '<button class="lesson-view-tab' + (lessonView === 'lessons' ? ' is-on' : '') + '" type="button" role="tab" ' +
              'aria-selected="' + (lessonView === 'lessons' ? 'true' : 'false') + '" data-lesson-view="lessons">Уроки</button>' +
            '<button class="lesson-view-tab' + (lessonView === 'homework' ? ' is-on' : '') + '" type="button" role="tab" ' +
              'aria-selected="' + (lessonView === 'homework' ? 'true' : 'false') + '" data-lesson-view="homework">Задания</button>' +
          '</div><div class="profile-pane lesson-standalone-pane" id="profilePane" role="tabpanel" tabindex="-1"></div>'
        : '<h1 class="profile-title">Профиль</h1>' + profileTabsHtml(profileTab) +
          '<div class="profile-pane" id="profilePane" role="tabpanel" tabindex="-1"></div>');

      [].slice.call(app.querySelectorAll('[data-profile-tab]')).forEach(function (button) {
        button.onclick = function () {
          profileTab = button.getAttribute('data-profile-tab');
          paintPane();
        };
      });
      [].slice.call(app.querySelectorAll('[data-lesson-view]')).forEach(function (button) {
        button.onclick = function () {
          lessonView = button.getAttribute('data-lesson-view');
          paintPane();
        };
      });

      function wirePane() {
      wireLevelActions();
      [].slice.call(app.querySelectorAll('[data-homework-submit]')).forEach(function (form) {
        form.onsubmit = function (event) {
          event.preventDefault();
          var files = [].slice.call(form.elements.files.files || []);
          var button = form.querySelector('button[type="submit"]');
          var note = form.querySelector('.hw-submit-state');
          if (files.length > 8 || files.some(function (file) { return file.size > 20 * 1024 * 1024; })) {
            note.textContent = 'Выберите до 8 файлов, каждый не больше 20 МБ.';
            return;
          }
          button.disabled = true;
          button.textContent = 'Отправляем…';
          note.textContent = '';
          api('/api/homework/' + form.getAttribute('data-homework-submit') + '/submit', {
            studentToken: token,
            responseText: form.responseText.value,
            hasFiles: files.length > 0 || Number(form.getAttribute('data-existing-files')) > 0
          }).then(function () {
            var chain = Promise.resolve();
            files.forEach(function (file) {
              chain = chain.then(function () {
                note.textContent = 'Загружаем «' + file.name + '»…';
                return uploadHomeworkFile(form.getAttribute('data-homework-submit'), token, file);
              });
            });
            return chain;
          }).then(function () {
            note.textContent = 'Работа отправлена.';
            setTimeout(showProfile, 500);
          }).catch(function (error) {
            button.disabled = false;
            button.textContent = 'Отправить ещё раз';
            note.textContent = error && error.status === 400
              ? 'Напишите ответ или приложите файл.'
              : 'Не удалось отправить. Попробуйте ещё раз.';
          });
        };
      });
      [].slice.call(app.querySelectorAll('[data-coursework-file]')).forEach(function (button) {
        button.onclick = function () {
          button.disabled = true;
          openCourseworkFile(button.getAttribute('data-coursework-file'),
            button.getAttribute('data-coursework-name'), token)
            .catch(function () { window.alert('Не удалось открыть файл. Попробуйте ещё раз.'); })
            .then(function () { button.disabled = false; });
        };
      });
      [].slice.call(app.querySelectorAll('[data-result-id], [data-open-result]')).forEach(function (b) {
        b.onclick = function () {
          showSavedResult(b.getAttribute('data-result-id') || b.getAttribute('data-open-result'), token);
        };
      });
      [].slice.call(app.querySelectorAll('[data-wallet-topup]')).forEach(function (button) {
        button.onclick = function () {
          var amount = Number(button.getAttribute('data-wallet-topup'));
          var note = document.getElementById('walletTopupState');
          button.disabled = true;
          note.textContent = 'Отправляем заявку…';
          api('/api/wallet/topups', {
            studentToken: token,
            amount: amount,
            requestId: uuid()
          }).then(function () {
            note.textContent = 'Заявка на ' + amount + ' нуров отправлена преподавателю.';
            setTimeout(showProfile, 700);
          }).catch(function (error) {
            button.disabled = false;
            note.textContent = error.message || 'Не удалось отправить заявку.';
          });
        };
      });
      var again = document.getElementById('againBtn');
      if (again) again.onclick = function () { state.phase = 'reg'; show(); };
      var requestLessons = document.getElementById('requestLessons');
      if (requestLessons) requestLessons.onclick = function () {
        state.phase = 'lead';
        paintNav();
        showLead(true);
      };
      var editor = document.getElementById('profileEditor');
      var editButton = document.getElementById('editProfile');
      if (editButton) editButton.onclick = function () {
        editor.hidden = false;
        editButton.hidden = true;
        document.getElementById('profileFirstName').focus();
      };
      if (editor) document.getElementById('cancelProfileEdit').onclick = function () {
        editor.hidden = true;
        editButton.hidden = false;
      };
      if (editor) document.getElementById('profileForm').onsubmit = function (event) {
        event.preventDefault();
        var form = event.currentTarget;
        var firstName = form.firstName.value.trim();
        var lastName = form.lastName.value.trim();
        markInvalid(form.querySelector('[data-f="firstName"]'), !firstName);
        markInvalid(form.querySelector('[data-f="lastName"]'), !lastName);
        if (!firstName || !lastName) return;
        var submit = form.querySelector('button[type="submit"]');
        var error = document.getElementById('profileEditError');
        submit.disabled = true;
        submit.textContent = 'Сохраняем…';
        api('/api/student/profile', {
          studentToken: token,
          firstName: firstName,
          lastName: lastName
        }).then(showProfile).catch(function () {
          submit.disabled = false;
          submit.textContent = 'Сохранить';
          error.hidden = false;
          error.textContent = 'Не удалось сохранить имя. Попробуйте ещё раз.';
        });
      };
      var avatarInput = document.getElementById('avatarInput');
      var avatarPick = document.getElementById('avatarPick');
      var avatarPickText = document.getElementById('avatarPickText');
      var avatarStatus = document.getElementById('avatarStatus');
      function chooseAvatar() { if (avatarInput) avatarInput.click(); }
      function saveAvatar(dataUrl) {
        avatarPick.disabled = true;
        avatarPickText.disabled = true;
        avatarStatus.hidden = false;
        avatarStatus.classList.remove('is-error');
        avatarStatus.textContent = 'Сохраняем фотографию…';
        return api('/api/student/profile', {
          studentToken: token,
          firstName: s.firstName,
          lastName: s.lastName,
          avatarDataUrl: dataUrl
        }).then(showProfile).catch(function () {
          avatarPick.disabled = false;
          avatarPickText.disabled = false;
          avatarStatus.classList.add('is-error');
          avatarStatus.textContent = 'Не удалось сохранить фотографию.';
        });
      }
      if (avatarPick) avatarPick.onclick = chooseAvatar;
      if (avatarPickText) avatarPickText.onclick = chooseAvatar;
      if (avatarInput) avatarInput.onchange = function () {
        var file = avatarInput.files && avatarInput.files[0];
        if (!file) return;
        avatarStatus.hidden = false;
        avatarStatus.classList.remove('is-error');
        avatarStatus.textContent = 'Обрабатываем фотографию…';
        prepareAvatar(file).then(saveAvatar).catch(function (error) {
          avatarStatus.classList.add('is-error');
          avatarStatus.textContent = error.message || 'Не удалось обработать фотографию.';
          avatarInput.value = '';
        });
      };
      var avatarRemove = document.getElementById('avatarRemove');
      if (avatarRemove) avatarRemove.onclick = function () { saveAvatar(''); };
      var pass = document.getElementById('setPass') || document.getElementById('changePass');
      if (pass) pass.onclick = function () { showSetPassword(token, s.hasPassword); };
      var logout = document.getElementById('logout');
      if (logout) logout.onclick = function () {
        if (!window.confirm('Выйти из профиля на этом устройстве?')) return;
        try { localStorage.removeItem(STUDENT_KEY); localStorage.removeItem('tajweed_last_result'); } catch (e) { /* ок */ }
        state.phase = 'welcome';
        show();
      };
      }

      paintPane();
    }).catch(function () {
      if (isStale(seq)) return;
      errorScreen('Профиль недоступен',
        'Не удалось загрузить данные. Проверьте интернет и попробуйте ещё раз.', showProfile);
    });
  }

  function formatPhone(digits) {
    var d = String(digits || '').replace(/\D/g, '');
    if (d.length === 11) return '+' + d[0] + ' ' + d.slice(1, 4) + ' ' + d.slice(4, 7) + '-' + d.slice(7, 9) + '-' + d.slice(9);
    return d ? '+' + d : '—';
  }

  function showLogin(startupError) {
    setBar(null);
    document.title = 'Вход в профиль · таджвид.рф';
    render(
      '<section class="auth-glass" aria-labelledby="authPhoneTitle">' +
        '<div class="auth-brand" aria-hidden="true"><span class="auth-brand-mark">ت</span></div>' +
        '<header class="auth-heading">' +
          '<h1 id="authPhoneTitle">Вход в профиль</h1>' +
          '<p>Ваши результаты и разбор ошибок.</p>' +
        '</header>' +
        '<p class="notice is-error" id="loginErr" role="status" aria-live="polite"' +
          (startupError ? '>' + esc(startupError) : ' hidden>') + '</p>' +
        '<div class="auth-phone-panel">' +
          '<form class="form auth-phone-form" id="loginForm" novalidate>' +
            '<div class="field" data-f="phone"><label for="lPhone">Телефон</label>' +
              '<input id="lPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00" maxlength="20">' +
              '<span class="err" data-msg="Введите номер целиком" role="alert"></span></div>' +
            '<div class="field" data-f="password">' +
              '<div class="auth-field-head"><label for="lPass">Пароль</label>' +
                '<button class="auth-inline-action" id="forgotPassword" type="button" aria-expanded="false" aria-controls="forgotHint">Забыли пароль?</button></div>' +
              '<input id="lPass" name="password" type="password" autocomplete="current-password" maxlength="200">' +
              '<span class="err" data-msg="Введите пароль" role="alert"></span></div>' +
            '<button class="btn btn-block auth-submit" type="submit">Войти</button>' +
          '</form>' +
          '<p class="auth-register">Нет профиля? ' +
            '<button class="auth-text-action" id="phoneRegister" type="button">Зарегистрироваться</button></p>' +
          '<p class="auth-recovery" id="forgotHint" role="status" aria-live="polite" hidden>' +
            'Восстановление по SMS подключается. Пока можно войти через Яндекс: если там указан тот же номер, профиль откроется автоматически.</p>' +
          '<div class="auth-divider" aria-hidden="true"><span>или</span></div>' +
          '<button class="auth-provider-secondary" id="yandexBtn" type="button" aria-describedby="yandexHint">' +
            '<span class="yandex-mark" aria-hidden="true">Я</span>' +
            '<span>Войти с помощью Яндекса</span>' +
          '</button>' +
          '<p class="login-provider-hint" id="yandexHint" role="status" hidden></p>' +
        '</div>' +
        '<p class="auth-legal">Продолжая, вы принимаете ' +
          '<a href="legal.html#terms">Условия использования</a> и ' +
          '<a href="legal.html#privacy">Политику конфиденциальности</a>.</p>' +
      '</section>'
    );
    document.documentElement.classList.add('is-auth');

    var yandexButton = document.getElementById('yandexBtn');
    var yandexHint = document.getElementById('yandexHint');
    var forgotPassword = document.getElementById('forgotPassword');
    var forgotHint = document.getElementById('forgotHint');

    forgotPassword.onclick = function () {
      forgotHint.hidden = !forgotHint.hidden;
      forgotPassword.setAttribute('aria-expanded', String(!forgotHint.hidden));
    };

    /* Переход доступен сразу: медленная или неудачная фоновая проверка
       больше не превращает рабочий Яндекс-вход в неактивную карточку. */
    yandexButton.onclick = function () {
      location.href = API + '/api/auth/yandex/start';
    };

    document.getElementById('phoneRegister').onclick = function () {
      state.phase = 'reg';
      show();
    };

    /* Яндекс остаётся одной из двух равноправных точек входа. Когда OAuth
       не настроен, карточка не исчезает и честно показывает причину. */
    apiGet('/api/auth/yandex/enabled').then(function (d) {
      if (!yandexButton || !yandexHint) return;
      if (!d || !d.enabled) {
        yandexButton.disabled = true;
        yandexHint.textContent = 'Вход через Яндекс временно недоступен.';
        yandexHint.hidden = false;
        return;
      }
      yandexHint.hidden = true;
    }).catch(function () {
      if (yandexHint) {
        yandexHint.textContent = 'Не удалось проверить статус. Можно продолжить вход через Яндекс.';
        yandexHint.hidden = false;
      }
    });

    var form = document.getElementById('loginForm');
    form.onsubmit = function (e) {
      e.preventDefault();
      var phone = form.phone.value.trim();
      var password = form.password.value;
      var bad = false;
      [['phone', phone.replace(/\D/g, '').length >= 10], ['password', !!password]].forEach(function (p) {
        var field = form.querySelector('[data-f="' + p[0] + '"]');
        markInvalid(field, !p[1]);
        if (!p[1]) bad = true;
      });
      if (bad) return;

      var btn = form.querySelector('button[type="submit"]');
      var err = document.getElementById('loginErr');
      btn.disabled = true;
      btn.textContent = 'Проверяем…';
      err.hidden = true;
      apiWithRetry('/api/auth/login', { phone: phone, password: password }, 3).then(function (res) {
        try { localStorage.setItem(STUDENT_KEY, res.studentToken); } catch (e2) { /* ок */ }
        showProfile();
      }).catch(function (e2) {
        btn.disabled = false;
        btn.textContent = 'Войти';
        err.hidden = false;
        err.classList.add('is-error');
        err.textContent = e2 && e2.status === 429
          ? 'Слишком много попыток. Попробуйте через 15 минут.'
          : e2 && (e2.status === 401 || e2.status === 404)
            ? 'Неверный номер или пароль. Для нового профиля выберите «Зарегистрироваться».'
          : 'Не получилось войти. Проверьте интернет и попробуйте ещё раз.';
      });
    };
  }

  /* hasPassword=true → пароль уже стоит, и сервер потребует текущий:
     знать ссылку на кабинет недостаточно, чтобы сменить вход. */
  function showSetPassword(token, hasPassword) {
    setBar('Пароль профиля');
    render(
      '<h1>Пароль профиля</h1>' +
      '<p class="lede">С паролем вы откроете свой профиль с любого устройства — по номеру телефона.</p>' +
      '<form class="form" id="passForm" novalidate>' +
        (hasPassword
          ? '<div class="field" data-f="current"><label for="pCur">Текущий пароль</label>' +
              '<input id="pCur" name="currentPassword" type="password" autocomplete="current-password" maxlength="200">' +
              '<span class="err" data-msg="Введите текущий пароль" role="alert"></span></div>'
          : '') +
        '<div class="field" data-f="password"><label for="pNew">Новый пароль</label>' +
          '<input id="pNew" name="password" type="password" autocomplete="new-password" maxlength="200">' +
          '<span class="err" data-msg="Не короче шести знаков" role="alert"></span></div>' +
        '<p class="notice" id="passErr" role="status" aria-live="polite" hidden></p>' +
        '<div class="btn-row"><button class="btn btn-block" type="submit">Сохранить пароль</button></div>' +
      '</form>' +
      '<div class="btn-row"><button class="btn is-quiet" id="backBtn">← В профиль</button></div>'
    );
    document.getElementById('backBtn').onclick = showProfile;
    var form = document.getElementById('passForm');
    form.onsubmit = function (e) {
      e.preventDefault();
      var pass = form.password.value;
      var field = form.querySelector('[data-f="password"]');
      markInvalid(field, pass.length < 6);
      if (pass.length < 6) return;
      var current = hasPassword ? form.currentPassword.value : '';
      if (hasPassword && !current) {
        markInvalid(form.querySelector('[data-f="current"]'), true);
        return;
      }
      var btn = form.querySelector('button[type="submit"]');
      var err = document.getElementById('passErr');
      btn.disabled = true;
      btn.textContent = 'Сохраняем…';
      api('/api/auth/password', {
        studentToken: token, password: pass, currentPassword: current
      }).then(function () {
        showProfile();
      }).catch(function (e2) {
        btn.disabled = false;
        btn.textContent = 'Сохранить пароль';
        err.hidden = false;
        err.classList.add('is-error');
        err.textContent = e2 && e2.status === 429
          ? 'Слишком много попыток. Попробуйте через 15 минут.'
          : e2 && e2.status === 401 ? 'Текущий пароль неверен.'
          : e2 && e2.status === 400 && !hasPassword
            ? 'На этом кабинете уже стоит пароль — откройте профиль заново, чтобы ввести текущий.'
          : e2 && e2.status === 400 ? 'Введите текущий пароль.'
          : 'Не получилось сохранить пароль. Попробуйте ещё раз.';
      });
    };
  }

  /* Единый набор навигационных пиктограмм на сетке 24×24.
     Контуры взяты из Lucide (ISC), но чуть утолщены для небольших экранов. */
  function navIcon(id) {
    var paths = {
      home: '<path class="icon-bolt" d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"></path>',
      exam: '<rect width="8" height="4" x="8" y="2" rx="1" ry="1"></rect>' +
        '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>' +
        '<path d="m9 14 2 2 4-4"></path>',
      lead: '<path d="M12 7v14"></path>' +
        '<path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"></path>',
      kb: '<path d="m16 6 4 14"></path><path d="M12 6v14"></path>' +
        '<path d="M8 8v12"></path><path d="M4 4v16"></path>',
      profile: '<circle cx="12" cy="8" r="5"></circle>' +
        '<path d="M20 21a8 8 0 0 0-16 0"></path>'
    };
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" ' +
      'focusable="false" aria-hidden="true">' + (paths[id] || paths.home) + '</svg>';
  }

  function paintNav() {
    var isExam = state.phase === 'exam';
    var exit = document.getElementById('examExit');
    if (exit) {
      exit.hidden = !isExam;
      exit.onclick = function () {
        systemDialog = true; // confirm снимает фокус с окна — это не уход со вкладки
        var leave = window.confirm('Выйти из экзамена? Ответы сохранятся на этом устройстве, ' +
          'с главной можно будет продолжить с текущего вопроса. Время по нему пойдёт заново.');
        systemDialog = false;
        if (!leave) return;
        stopTimer();
        state.resumable = true; // черновик остаётся, экзамен можно продолжить
        state.phase = 'welcome';
        save();
        show();
      };
    }
    document.documentElement.classList.toggle('is-exam', isExam);
    document.documentElement.classList.add('has-tabbar');

    var items = navItems();
    [document.getElementById('tabbar'), document.getElementById('sitenavTabs')].forEach(function (host) {
      if (!host) return;
      host.replaceChildren();
      items.forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tab tab-' + item.id + (item.on() ? ' is-on' : '');
        var icon = document.createElement('span');
        icon.className = 'tab-icon is-' + item.id;
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = navIcon(item.id);
        var label = document.createElement('span');
        label.className = 'tab-label';
        label.textContent = item.label;
        b.appendChild(icon);
        b.appendChild(label);
        b.setAttribute('aria-label', item.label);
        if (item.on()) b.setAttribute('aria-current', 'page');
        b.onclick = function () {
          if (state.phase === 'exam') {
            systemDialog = true;
            var leaveExam = window.confirm('Выйти из экзамена? Ответы сохранятся, и вы сможете вернуться позже.');
            systemDialog = false;
            if (!leaveExam) return;
            stopTimer();
            state.resumable = true;
            save();
          }
          item.act();
        };
        host.appendChild(b);
      });
    });
  }

  function show() {
    hideTimer();
    screenToken();
    syncSectionHash();
    paintNav();
    if (state.phase === 'welcome') return showWelcome();
    if (state.phase === 'lead') return showLead();
    if (state.phase === 'leadDone') return showLeadDone();
    if (state.phase === 'lessons') return showProfile();
    if (state.phase === 'exams') return showExamCatalog();
    if (state.phase === 'reg') return showReg();
    if (state.phase === 'profile') return showProfile();
    if (state.phase === 'exam') return showStep();
    if (state.phase === 'done') return showDone();
  }

  /* ── Экраны: вход ──────────────────────────────────────── */

  function showWelcome() {
    setBar(null);
    var lastId = '';
    var studentTok = '';
    try {
      lastId = localStorage.getItem('tajweed_last_result') || '';
      studentTok = localStorage.getItem(STUDENT_KEY) || '';
    } catch (e) { /* ок */ }

    /* Экзамен начат и не сдан: с главной надо предложить продолжить
       ровно с того вопроса, а не гнать анкету по второму кругу. */
    var draft = state.resumable === true && !!state.student;
    var doneCount = draft ? Math.min(state.stepIdx + 1, steps.length) : 0;
    var donePct = draft ? Math.round((doneCount / steps.length) * 100) : 0;

    /* Продолжение экзамена — одна и та же кнопка на обоих баннерах, и она
       же показывает, сколько пройдено: заливка идёт слоем ПОД текстом,
       поэтому надпись остаётся читаемой в любой теме. */
    function examButton(id) {
      if (!draft) return '<button class="btn" id="' + id + '">Выбрать экзамен →</button>';
      return '<button class="btn is-progress" id="' + id + '" ' +
        'style="--progress: ' + donePct + '%" ' +
        'aria-label="Продолжить экзамен, пройдено ' + donePct + ' процентов">' +
        '<span class="btn-fill" aria-hidden="true"></span>' +
        '<span class="btn-text">Продолжить экзамен · ' + donePct + '%</span>' +
      '</button>';
    }

    /* Главная — как баннер прайса: сетка одинаковых квадратов,
       штриховка сверху, заголовок, кикер, одна вдавленная кнопка.
       Ничего лишнего: уроки и кабинет живут в меню. */
    render(
      '<section class="welcome-hero" aria-labelledby="welcomeTitle">' +
        '<span class="hero-hatch" aria-hidden="true"></span>' +
        marks('is-out') +
        blueprintLayers() +
        '<h1 id="welcomeTitle" class="notranslate" translate="no">' +
          (window.TAJWEED_I18N ? window.TAJWEED_I18N.text('examTitle')
                              : 'Экзамен по <em>таджвиду</em>') + '</h1>' +
        '<p class="kicker is-under">' +
          (draft ? 'Экзамен начат · шаг ' + doneCount + ' из ' + steps.length
                 : 'Наука чтения Корана · Первый уровень') +
          '<span class="cur">_</span></p>' +
        '<div class="hero-actions">' + examButton('heroExam') + '</div>' +
        '<div class="hero-meta">' +
          '<span class="crosshair" aria-hidden="true"></span>' +
          '<span class="hero-meta-lines">' +
            '<span class="hero-meta-site">ТАДЖВИД.РФ // 2026</span>' +
            '<span class="hero-meta-teacher">ПРЕПОДАВАТЕЛЬ ДЕАБ АНАС Т. ' +
              '<span class="teacher-flag" role="img" aria-label="Палестина">' +
                '<svg viewBox="0 0 60 40" preserveAspectRatio="xMidYMid slice" ' +
                  'focusable="false" aria-hidden="true">' +
                  '<rect width="60" height="14" fill="#101012"></rect>' +
                  '<rect y="14" width="60" height="13" fill="#ffffff"></rect>' +
                  '<rect y="27" width="60" height="13" fill="#149954"></rect>' +
                  '<path d="M0 0 25 20 0 40Z" fill="#e4312b"></path>' +
                '</svg>' +
              '</span>' +
            '</span>' +
          '</span>' +
        '</div>' +
      '</section>' +
      '<section class="levels-teaser" aria-labelledby="levelsTitle">' +
        '<p class="kicker" id="levelsTitle">Уровни программы<span class="cur">_</span></p>' +
        '<div id="welcomeLevels">' + levelLadder(null) + '</div>' +
        (studentTok || lastId
          ? '<div class="btn-row"><button class="btn is-pill" id="goSaved">' +
            (studentTok ? 'Мой кабинет →' : 'Мой результат →') + '</button></div>'
          : '') +
      '</section>' +
      '<section class="cta-banner" aria-labelledby="ctaTitle">' +
        '<span class="hero-hatch" aria-hidden="true"></span>' +
        marks('is-out') +
        blueprintLayers() +
        '<h2 id="ctaTitle">' + (draft ? 'Вернуться к экзамену' : 'Проверьте себя') + '</h2>' +
        '<p class="kicker is-under">' +
          (draft ? 'Ответы сохранены на этом устройстве'
                 : '51 вопрос и чтение вслух · до 3 минут на вопрос') +
          '<span class="cur">_</span></p>' +
        '<div class="hero-actions">' + examButton('ctaExam') +
          (draft ? '<button class="btn is-ghost" id="startOver">Начать заново</button>' : '') +
        '</div>' +
      '</section>' +
      /* База знаний внизу главной: обычные ссылки на статичные статьи —
         и людям по пути, и поисковикам видно без выполнения скриптов. */
      '<section class="kb-teaser" aria-labelledby="kbTitle">' +
        '<p class="kicker" id="kbTitle">База знаний<span class="cur">_</span></p>' +
        '<ul class="kb-teaser-list">' +
          '<li><a href="stati/chto-takoe-tadzhvid/">Что такое таджвид</a></li>' +
          '<li><a href="stati/pravila-tadzhvida/">Правила таджвида</a></li>' +
          '<li><a href="stati/tadzhvid-dlya-nachinayushchih/">Таджвид для начинающих</a></li>' +
          '<li><a href="stati/uroki-tadzhvida/">Уроки таджвида</a></li>' +
          '<li><a href="stati/chtenie-korana-s-tadzhvidom/">Чтение Корана с таджвидом</a></li>' +
        '</ul>' +
        '<div class="btn-row"><a class="btn is-pill kb-teaser-all" href="stati/">Все статьи →</a></div>' +
      '</section>'
    );
    var startExam = function () { state.phase = 'exams'; show(); };
    /* Незаконченный экзамен продолжаем с того же вопроса — именно это
       обещает текст при выходе, поэтому анкету заново не показываем. */
    var resume = function () {
      state.phase = 'exam';
      save();
      show();
    };
    var heroBtn = document.getElementById('heroExam');
    var ctaBtn = document.getElementById('ctaExam');
    heroBtn.onclick = draft ? resume : startExam;
    ctaBtn.onclick = draft ? resume : startExam;
    var fresh = document.getElementById('startOver');
    if (fresh) fresh.onclick = function () {
      if (!window.confirm('Начать экзамен заново? Ответы текущей попытки будут удалены.')) return;
      startExam();
    };
    var goSaved = document.getElementById('goSaved');
    if (goSaved) goSaved.onclick = function () {
      if (studentTok) return showStudentCabinet(studentTok);
      showSavedResult(lastId);
    };
    wireLevelActions();
    if (studentTok) {
      apiGet('/api/student/' + encodeURIComponent(studentTok)).then(function (data) {
        var host = document.getElementById('welcomeLevels');
        if (!host || state.phase !== 'welcome' || !data.ok) return;
        host.innerHTML = levelLadder(progressFromResults(data.results || []));
        wireLevelActions();
      }).catch(function () { /* без сети остаётся безопасно закрытым */ });
    }
  }

  function showStudentCabinet(token) {
    try { localStorage.setItem(STUDENT_KEY, token); } catch (e) { /* ок */ }
    if (history.replaceState) history.replaceState(null, '', '#profile');
    state.phase = 'profile';
    showProfile();
  }

  function resultClaimHtml() {
    return '<section class="result-claim" id="resultClaim" aria-labelledby="resultClaimTitle">' +
      '<p class="kicker">Сохранить результат<span class="cur">_</span></p>' +
      '<h2 id="resultClaimTitle">Забрать результат в свой кабинет</h2>' +
      '<p class="lede">Процент уже показан. Регистрация нужна только для истории, пересдач и связи с преподавателем.</p>' +
      '<button class="auth-provider-secondary result-claim-yandex" id="claimYandex" type="button">' +
        '<span class="yandex-mark" aria-hidden="true">Я</span><span>Продолжить через Яндекс</span>' +
      '</button>' +
      '<p class="result-claim-status" id="claimYandexStatus" role="status" hidden></p>' +
      '<button class="btn is-ghost result-claim-manual" id="claimManualToggle" type="button">Ввести данные вручную</button>' +
      '<form class="result-claim-form" id="claimForm" hidden novalidate>' +
        '<label>Имя<input id="claimFirstName" name="firstName" autocomplete="given-name" required></label>' +
        '<label>Фамилия<input id="claimLastName" name="lastName" autocomplete="family-name" required></label>' +
        '<label>Город<input id="claimCity" name="city" autocomplete="address-level2" required></label>' +
        '<label>Телефон<input id="claimPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required></label>' +
        '<p class="result-claim-status" id="claimFormStatus" role="status" aria-live="polite"></p>' +
        '<button class="btn" type="submit">Сохранить результат</button>' +
      '</form>' +
      '<p class="wallet-fineprint">Можно пропустить: ссылка на результат останется на этом устройстве.</p>' +
    '</section>';
  }

  function wireResultClaim(submissionId, savedResult) {
    var host = document.getElementById('resultClaim');
    var guest = guestToken();
    if (!host || !guest || !submissionId) return;
    var yandex = document.getElementById('claimYandex');
    var yandexStatus = document.getElementById('claimYandexStatus');
    var manual = document.getElementById('claimManualToggle');
    var form = document.getElementById('claimForm');

    function complete(token, identity) {
      try {
        localStorage.setItem(STUDENT_KEY, token);
        localStorage.removeItem(GUEST_KEY);
      } catch (error) { /* кабинет всё равно открыт в текущей вкладке */ }
      if (serverResult) {
        serverResult.studentToken = token;
        serverResult.isGuest = false;
      }
      if (identity) {
        state.student = {
          firstName: identity.firstName,
          lastName: identity.lastName,
          city: identity.city,
          phone: identity.phone,
          registered: true
        };
        if (savedResult) {
          savedResult.firstName = identity.firstName;
          savedResult.lastName = identity.lastName;
          savedResult.city = identity.city;
          savedResult.phone = identity.phone;
          savedResult.studentToken = token;
          savedResult.isGuest = false;
          wireReportButtons(reportFromResult(savedResult), identity.lastName);
        } else {
          wireReportButtons(reportText(), identity.lastName);
        }
      }
      host.innerHTML = '<p class="kicker">Результат сохранён<span class="cur">_</span></p>' +
        '<h2>Кабинет готов</h2>' +
        '<p class="lede">Экзамен добавлен в историю. Теперь доступны кошелёк, занятия и будущие результаты.</p>' +
        '<button class="btn" id="claimCabinet" type="button">Открыть кабинет</button>';
      document.getElementById('claimCabinet').onclick = function () { showStudentCabinet(token); };
    }

    yandex.onclick = function () {
      location.href = API + '/api/auth/yandex/start?guestToken=' + encodeURIComponent(guest) +
        '&submissionId=' + encodeURIComponent(submissionId);
    };
    apiGet('/api/auth/yandex/enabled').then(function (result) {
      if (result.enabled) return;
      yandex.disabled = true;
      yandexStatus.hidden = false;
      yandexStatus.textContent = 'Вход через Яндекс временно недоступен — используйте короткую форму ниже.';
    }).catch(function () { /* кнопка всё равно ведёт на сервер, который покажет точный статус */ });

    manual.onclick = function () {
      form.hidden = !form.hidden;
      manual.textContent = form.hidden ? 'Ввести данные вручную' : 'Скрыть ручную форму';
      if (!form.hidden) document.getElementById('claimFirstName').focus();
    };
    form.onsubmit = function (event) {
      event.preventDefault();
      var submit = form.querySelector('button[type="submit"]');
      var status = document.getElementById('claimFormStatus');
      var data = {
        guestToken: guest,
        firstName: document.getElementById('claimFirstName').value.trim(),
        lastName: document.getElementById('claimLastName').value.trim(),
        city: document.getElementById('claimCity').value.trim(),
        phone: document.getElementById('claimPhone').value.trim()
      };
      if (!data.firstName || !data.lastName || !data.city || data.phone.replace(/\D/g, '').length < 10) {
        status.textContent = 'Заполните четыре поля и проверьте номер телефона.';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Сохраняем…';
      status.textContent = '';
      api('/api/result/' + encodeURIComponent(submissionId) + '/claim', data).then(function (result) {
        complete(result.studentToken, data);
      }).catch(function (error) {
        submit.disabled = false;
        submit.textContent = 'Сохранить результат';
        status.textContent = error.message || 'Не удалось сохранить. Попробуйте ещё раз.';
      });
    };
  }

  function showSavedResult(id, cabinetToken) {
    /* Полоса «Мой результат» дублировала заголовок «Результат экзамена»
       строкой ниже и съедала 44 px в самом верху — там, где ученик
       ищет свой процент. Название экрана остаётся во вкладке браузера. */
    setBar(null);
    document.title = 'Мой результат · таджвид.рф';
    loadingScreen('Результат экзамена', 'Загружаем результат…');
    var seq = screenToken();
    apiGet('/api/result/' + encodeURIComponent(id))
      .then(function (d) {
        if (isStale(seq)) return;
        if (!d.ok) throw new Error('нет данных');
        var res = d.result;
        var pct = Math.round(res.percent);
        var level = Number(res.examLevel) || 1;
        var pending = res.gradingStatus === 'pending';
        var html = '<h1>Результат экзамена</h1>' +
          '<p class="lede">' + (res.isGuest ? ''
            : esc(res.lastName) + ' ' + esc(res.firstName) + ' (' + esc(res.city) + ') · ') +
            new Date(res.createdAt).toLocaleString('ru-RU') + '</p>';
        if (pending) {
          html += '<div class="score-hero frame">' +
            '<p class="kicker">Второй уровень</p>' +
            '<h2>На проверке у преподавателя</h2>' +
            '<p class="score-points">Автопроверка: ' + esc(res.points) + ' из ' + esc(res.max) +
              '. Это не итоговая оценка.</p></div>';
        } else {
          html += '<div class="score-hero is-scored frame" style="--score-color: ' + scoreColor(pct) + '">' +
            '<div class="score-percent">' + pct + '<i>%</i></div>' +
            '<p class="score-caption">' + (level === 2 ? 'Второй' : 'Первый') + ' уровень · ' + scoreVerdict(pct) + '</p>' +
            '<div class="level-bar"><span style="width: ' + pct + '%"></span></div>' +
            '<p class="score-points">Письменная часть: ' + esc(res.points) + ' из ' + esc(res.max) + ' баллов</p>' +
          '</div>';
        }
        if (res.breakdown && res.breakdown.length) {
          html += '<div class="breakdown">';
          res.breakdown.forEach(function (b) {
            html += '<div class="breakdown-row"><span>' + esc(b.label) + '</span>' +
              '<span class="pts">' + esc(b.points) + ' / ' + esc(b.max) + '</span></div>';
          });
          html += '<div class="breakdown-row is-muted"><span>' +
            (level === 2 ? 'Мадд, слоги, диктант и устное чтение' : 'Устное чтение и диктант') +
            '</span><span class="pts">оценит преподаватель</span></div>';
          html += '</div>';
        }
        if (!cabinetToken && res.isGuest && guestToken()) html += resultClaimHtml();
        html += '<hr class="rule"><h2 class="kicker">Отчёт для преподавателя</h2>' +
          '<p class="lede">Отчёт уже у преподавателя. Эти кнопки нужны, если хотите сохранить копию себе или переслать её сами.</p>' +
          reportButtonsHtml();
        html += (cabinetToken ? '' : '<p class="notice">Сохраните адрес этой страницы — по нему результат откроется снова.</p>') +
          '<div class="btn-row"><button class="btn is-ghost" id="homeBtn">' +
          (cabinetToken ? '← В кабинет' : '← На главную') + '</button></div>';
        render(html);
        wireResultClaim(id, res);
        wireReportButtons(reportFromResult(res), res.lastName);
        document.getElementById('homeBtn').onclick = function () {
          if (history.replaceState) history.replaceState(null, '', location.pathname);
          if (cabinetToken) return showStudentCabinet(cabinetToken);
          state.phase = 'welcome'; show();
        };
      })
      .catch(function () {
        if (isStale(seq)) return;
        errorScreen('Результат не найден',
          'Ссылка устарела или сервер недоступен. Попробуйте позже.',
          function () { showSavedResult(id, cabinetToken); });
      });
  }

  function scheduleFields() {
    var days = WEEK_DAYS.map(function (day, index) {
      return '<div class="schedule-wheel-option' + (index === 0 ? ' is-selected' : '') + '"' +
        ' id="wheelDay' + day.value + '" role="option" data-value="' + day.value + '"' +
        ' aria-selected="' + (index === 0 ? 'true' : 'false') + '">' + day.full + '</div>';
    }).join('');
    var hours = '';
    for (var hour = 5; hour <= 23; hour++) {
      var hourText = String(hour).padStart(2, '0') + ':00';
      hours += '<div class="schedule-wheel-option' + (hour === 18 ? ' is-selected' : '') + '"' +
        ' id="wheelTime' + hour + '" role="option" data-value="' + (hour * 60) + '"' +
        ' aria-selected="' + (hour === 18 ? 'true' : 'false') + '">' + hourText + '</div>';
    }
    return '<fieldset class="schedule-picker" data-schedule aria-describedby="daysHint errScheduleDays">' +
      /* Заголовок вопроса стоит рядом в <h1>: легенда нужна только
         для программ чтения с экрана, глазами её видеть незачем. */
      '<legend class="visually-hidden">Когда удобно заниматься?</legend>' +
      '<p class="field-hint" id="daysHint">Прокрутите столбики: день и время.</p>' +
      '<div class="schedule-dual-wheel">' +
        '<section class="schedule-wheel-field" aria-labelledby="scheduleDayLabel">' +
          '<span class="schedule-wheel-label" id="scheduleDayLabel">День</span>' +
          '<div class="schedule-wheel">' +
            '<span class="schedule-wheel-focus" aria-hidden="true"></span>' +
            '<div class="schedule-wheel-column is-days" role="listbox" tabindex="0" ' +
              'aria-labelledby="scheduleDayLabel" aria-activedescendant="wheelDaymon" data-schedule-unit="day">' +
              days + '</div>' +
          '</div>' +
        '</section>' +
        '<section class="schedule-wheel-field" aria-labelledby="scheduleTimeLabel">' +
          '<span class="schedule-wheel-label" id="scheduleTimeLabel">Время</span>' +
          '<div class="schedule-wheel">' +
            '<span class="schedule-wheel-focus" aria-hidden="true"></span>' +
            '<div class="schedule-wheel-column is-time" role="listbox" tabindex="0" ' +
              'aria-labelledby="scheduleTimeLabel" aria-activedescendant="wheelTime18" data-schedule-unit="time">' +
              hours + '</div>' +
          '</div>' +
        '</section>' +
      '</div>' +
      '<p class="schedule-selection" id="scheduleSummary" aria-live="polite">Понедельник · 18:00</p>' +
      '<input id="scheduleDay" name="scheduleDay" type="hidden" value="mon">' +
      '<input id="scheduleTime" name="scheduleTimeMinutes" type="hidden" value="1080">' +
      '<input id="timeZone" name="timeZone" type="hidden" value="Europe/Moscow">' +
      '<span class="err" id="errScheduleDays" data-msg="Выберите хотя бы один день" role="alert"></span>' +
    '</fieldset>';
  }

  /* ── Пошаговая анкета ──────────────────────────────────── */

  var WIZARD_STEPS = [
    { f: 'firstName', label: 'Как вас зовут?', hint: 'Имя', ac: 'given-name', err: 'Укажите имя' },
    { f: 'lastName', label: 'Ваша фамилия', hint: 'Фамилия', ac: 'family-name', err: 'Укажите фамилию' },
    { f: 'city', label: 'Из какого вы города?', hint: 'Город', ac: 'address-level2', err: 'Укажите город' },
    { f: 'phone', label: 'Номер телефона', hint: 'По нему преподаватель пришлёт разбор', ac: 'tel',
      type: 'tel', mode: 'tel', ph: '+7 900 000-00-00', err: 'Введите номер целиком, с кодом' }
  ];

  function personWizard(opts) {
    var data = { firstName: '', lastName: '', city: '', phone: '' };
    var idx = 0;
    var extraStep = opts.extraStep ? 1 : 0;
    var total = WIZARD_STEPS.length + extraStep;

    function scale() {
      var cells = '';
      for (var i = 0; i < total; i++) {
        cells += '<span class="wstep' + (i < idx ? ' is-done' : i === idx ? ' is-now' : '') + '"></span>';
      }
      return '<div class="wizard-steps" aria-hidden="true">' + cells + '</div>';
    }

    function draw() {
      if (idx >= WIZARD_STEPS.length) return drawExtra();
      var st = WIZARD_STEPS[idx];
      // на последнем шаге честно говорим, что фиксируется во время экзамена
      var rules = (idx === 0 && opts.isExam)
        ? '<p class="notice">Вопросы идут по одному, вернуться к предыдущему нельзя. На каждый — до 3 минут. ' +
          (storageWorks
            ? 'Ответы сохраняются на этом устройстве, экзамен можно продолжить после перезагрузки.'
            : 'Браузер запретил сохранение (приватный режим): при перезагрузке ответы пропадут — проходите экзамен за один раз.') +
          '</p>'
        : '';
      var honesty = (idx === WIZARD_STEPS.length - 1 && opts.isExam)
        ? '<p class="notice">Имя, фамилия, город и телефон уйдут преподавателю Деабу Анасу Т. вместе с ответами — чтобы он знал, чью работу проверяет, и мог связаться. Ещё сайт отметит, сколько раз вы уходили со вкладки, и покажет это ему. Больше никуда данные не передаются.</p>'
        : '';
      /* Первый экран анкеты объясняет, куда человек попал. Без этого
         запись на урок открывалась вопросом «Как вас зовут?» — владелец
         06.08 сказал прямо: непонятно, что это вообще и зачем спрашивают. */
      var intro = (idx === 0 && opts.intro) ? opts.intro : '';
      render(
        '<section class="wizard">' +
          scale() +
          '<p class="kicker">' +
            (opts.title ? esc(opts.title) + ' · ' : '') +
            'Шаг ' + (idx + 1) + ' из ' + total + '<span class="cur">_</span></p>' +
          intro +
          '<h1 class="wizard-q">' + esc(st.label) + '</h1>' +
          '<div class="field wizard-field">' +
            '<label class="visually-hidden" for="wInput">' + esc(st.hint) + '</label>' +
            '<input id="wInput" name="' + st.f + '" type="' + (st.type || 'text') + '"' +
              (st.mode ? ' inputmode="' + st.mode + '"' : '') +
              ' autocomplete="' + st.ac + '" maxlength="60" enterkeyhint="next"' +
              (st.ph ? ' placeholder="' + esc(st.ph) + '"' : '') +
              ' value="' + esc(data[st.f]) + '" aria-describedby="wErr">' +
            '<span class="wizard-hint">' + esc(st.hint) + '</span>' +
            '<span class="err" id="wErr" data-msg="' + esc(st.err) + '" role="alert"></span>' +
          '</div>' + rules + honesty +
          '<div class="btn-row">' +
            '<button class="btn btn-block" id="wNext">' +
              (idx === total - 1 ? esc(opts.finishLabel) : 'Далее') + '</button>' +
          '</div>' +
          /* На первом шаге кнопки возврата нет: уйти с экрана можно
             нижним меню, а лишняя строка съедала высоту экрана. */
          (idx === 0 ? '' :
            '<div class="btn-row wizard-back">' +
              '<button class="btn is-quiet" id="wBack">← Предыдущий шаг</button>' +
            '</div>') +
        '</section>'
      );

      var input = document.getElementById('wInput');
      var field = input.closest('.field');
      window.scrollTo(0, 0);
      /* На телефоне не выбрасываем клавиатуру при входе в анкету:
         сначала человек видит вопрос целиком, фокус — по касанию поля.
         На следующих шагах клавиатура уже открыта — фокус сохраняем. */
      var coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
      if (!(coarse && idx === 0)) {
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      }

      function ok() {
        var v = input.value.trim();
        if (!v) return false;
        if (st.f === 'phone' && v.replace(/\D/g, '').length < 10) return false;
        return true;
      }

      function forward() {
        if (!ok()) {
          markInvalid(field, true);
          input.focus();
          return;
        }
        data[st.f] = input.value.trim();
        idx += 1;
        draw();
      }

      input.oninput = function () {
        markInvalid(field, false);
      };
      input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); forward(); } };
      document.getElementById('wNext').onclick = forward;
      var back = document.getElementById('wBack');
      if (back) back.onclick = function () {
        data[st.f] = input.value.trim();
        idx -= 1;
        draw();
      };
    }

    function drawExtra() {
      if (!opts.extraStep) return opts.onDone(data);
      opts.extraStep(data, scale(), function () { idx -= 1; draw(); });
    }

    draw();
  }

  function playScheduleTick(value) {
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    try {
      if (!scheduleAudioContext) scheduleAudioContext = new AudioCtor();
      if (scheduleAudioContext.state === 'suspended') scheduleAudioContext.resume();
      var now = scheduleAudioContext.currentTime;
      var oscillator = scheduleAudioContext.createOscillator();
      var gain = scheduleAudioContext.createGain();
      var step = Number(value);
      if (!Number.isFinite(step)) step = 0;
      oscillator.type = 'triangle';
      oscillator.frequency.value = 720 + ((Math.round(step / 60) % 6) * 18);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.008, now + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
      oscillator.connect(gain);
      gain.connect(scheduleAudioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.024);
    } catch (e) { /* звук — необязательное улучшение */ }
  }

  function initSchedule(form) {
    var picker = form.querySelector('[data-schedule]');
    if (!picker) return;
    var dayInput = form.scheduleDay;
    var timeInput = form.scheduleTimeMinutes;
    var summary = document.getElementById('scheduleSummary');
    var wheelColumns = [].slice.call(picker.querySelectorAll('[data-schedule-unit]'));
    var dayColumn = picker.querySelector('[data-schedule-unit="day"]');
    var timeColumn = picker.querySelector('[data-schedule-unit="time"]');
    var lastTickAt = 0;
    var wheelFrame = 0;
    var ignoreWheelUntil = 0;
    try { form.timeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'; } catch (e) { /* ок */ }

    function primeScheduleSound() {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;
      try {
        if (!scheduleAudioContext) scheduleAudioContext = new AudioCtor();
        if (scheduleAudioContext.state === 'suspended') scheduleAudioContext.resume();
      } catch (e) { /* барабан остаётся рабочим и без звука */ }
    }

    function selectedOption(column) {
      return column.querySelector('.schedule-wheel-option.is-selected');
    }

    function markWheelOption(column, option) {
      var options = [].slice.call(column.querySelectorAll('.schedule-wheel-option'));
      var selectedIndex = options.indexOf(option);
      options.forEach(function (item, index) {
        var distance = Math.abs(index - selectedIndex);
        var selected = item === option;
        item.classList.toggle('is-selected', selected);
        item.classList.toggle('is-near', distance === 1);
        item.classList.toggle('is-far', distance > 1);
        item.setAttribute('aria-selected', selected ? 'true' : 'false');
      });
      if (option) column.setAttribute('aria-activedescendant', option.id);
    }

    function nearestWheelOption(column) {
      var options = [].slice.call(column.querySelectorAll('.schedule-wheel-option'));
      var center = column.scrollTop + column.clientHeight / 2;
      return options.reduce(function (best, option) {
        var optionCenter = option.offsetTop + option.offsetHeight / 2;
        var distance = Math.abs(optionCenter - center);
        return !best || distance < best.distance ? { option: option, distance: distance } : best;
      }, null).option;
    }

    function scrollWheelTo(column, value, smooth) {
      var option = column.querySelector('[data-value="' + value + '"]');
      if (!option) return;
      if (!smooth) markWheelOption(column, option);
      ignoreWheelUntil = Date.now() + (smooth ? 0 : 80);
      column.scrollTo({
        top: option.offsetTop - (column.clientHeight - option.offsetHeight) / 2,
        behavior: smooth ? 'smooth' : 'auto'
      });
    }

    function updateSummary() {
      var day = WEEK_DAYS.filter(function (item) { return item.value === dayInput.value; })[0];
      summary.textContent = (day ? day.full : dayInput.value) + ' · ' + fmtMinutes(timeInput.value);
      if (dayInput.value) markInvalid(picker, false);
    }

    function commitWheel(column, playTick) {
      var option = selectedOption(column);
      if (!option) return;
      var value = option.getAttribute('data-value');
      if (column === dayColumn) dayInput.value = value;
      if (column === timeColumn) timeInput.value = value;
      updateSummary();
      var now = Date.now();
      if (playTick && now - lastTickAt >= 45) {
        lastTickAt = now;
        var options = [].slice.call(column.querySelectorAll('.schedule-wheel-option'));
        playScheduleTick(column === timeColumn ? value : options.indexOf(option) * 60);
      }
    }

    function onWheelScroll(column) {
      if (Date.now() < ignoreWheelUntil) return;
      if (wheelFrame) cancelAnimationFrame(wheelFrame);
      wheelFrame = requestAnimationFrame(function () {
        wheelFrame = 0;
        var option = nearestWheelOption(column);
        var before = selectedOption(column);
        markWheelOption(column, option);
        commitWheel(column, before !== option);
      });
    }

    wheelColumns.forEach(function (column) {
      column.addEventListener('pointerdown', primeScheduleSound, { passive: true });
      column.addEventListener('scroll', function () { onWheelScroll(column); }, { passive: true });
      column.addEventListener('keydown', function (event) {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' &&
            event.key !== 'PageUp' && event.key !== 'PageDown' &&
            event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        var options = [].slice.call(column.querySelectorAll('.schedule-wheel-option'));
        var current = selectedOption(column);
        var index = Math.max(0, options.indexOf(current));
        if (event.key === 'ArrowUp') index -= 1;
        if (event.key === 'ArrowDown') index += 1;
        if (event.key === 'PageUp') index -= 3;
        if (event.key === 'PageDown') index += 3;
        if (event.key === 'Home') index = 0;
        if (event.key === 'End') index = options.length - 1;
        index = Math.max(0, Math.min(options.length - 1, index));
        scrollWheelTo(column, options[index].getAttribute('data-value'), true);
      });
      [].slice.call(column.querySelectorAll('.schedule-wheel-option')).forEach(function (option) {
        option.addEventListener('click', function () {
          scrollWheelTo(column, option.getAttribute('data-value'), true);
        });
      });
    });
    updateSummary();
    requestAnimationFrame(function () {
      scrollWheelTo(dayColumn, dayInput.value, false);
      scrollWheelTo(timeColumn, timeInput.value, false);
    });
  }

  /* Запись на урок идёт по одному вопросу, как анкета перед экзаменом:
     сразу четыре поля и барабан на одном экране в телефон не помещались
     и пугали объёмом. Последним шагом — выбор дня и времени. */
  function showLead(forceSignup) {
    if (!forceSignup && studentToken()) {
      state.phase = 'lessons';
      return showProfile();
    }
    state.phase = 'lead';
    setBar(null);
    document.title = 'Запись на уроки · таджвид.рф';
    var requestId = '';
    try {
      requestId = localStorage.getItem('tajweed_lead_request_id') || uuid();
      localStorage.setItem('tajweed_lead_request_id', requestId);
    } catch (e) { requestId = uuid(); }

    personWizard({
      title: 'Запись на урок',
      intro:
        '<div class="wizard-intro">' +
          '<h2 class="wizard-intro-h">Вы записываетесь на урок таджвида</h2>' +
          '<p>Занятия ведёт преподаватель <strong>Деаб Анас Т.</strong> 🇵🇸 ' +
          'Заявка ни к чему не обязывает: преподаватель свяжется с вами и вы ' +
          'договоритесь о времени и формате.</p>' +
          '<p>Четыре коротких вопроса — как к вам обращаться и как с вами ' +
          'связаться, — потом выберете удобное время. Данные получит только ' +
          'преподаватель.</p>' +
        '</div>',
      finishLabel: 'Дальше →',
      onDone: function () { /* последний шаг — выбор времени ниже */ },
      extraStep: function (data, scaleHtml, goBack) {
        render(
          '<section class="wizard">' +
            scaleHtml +
            '<p class="kicker">Последний шаг<span class="cur">_</span></p>' +
            '<h1 class="wizard-q">Когда удобно заниматься?</h1>' +
            '<form class="form wizard-schedule-form" id="leadForm" novalidate>' +
              '<input name="requestId" type="hidden" value="' + esc(requestId) + '">' +
              scheduleFields() +
              '<p class="notice">Данные получит преподаватель Деаб Анас Т. Больше никуда они не уходят.</p>' +
              '<p class="notice is-error" id="leadErr" role="status" aria-live="polite" hidden></p>' +
              /* Возврат стоит РЯДОМ с отправкой, а не строкой ниже: на
                 телефоне отдельный ряд уводил кнопку «Назад» под нижнее
                 меню, и с последнего шага нельзя было вернуться. */
              '<div class="btn-row wizard-send">' +
                '<button class="btn is-quiet" id="wBack">← Назад</button>' +
                '<button type="submit" class="btn">Отправить заявку</button>' +
              '</div>' +
            '</form>' +
          '</section>'
        );
        window.scrollTo(0, 0);
        var form = document.getElementById('leadForm');
        form.setAttribute('data-request-id', requestId);
        initSchedule(form);
        document.getElementById('wBack').onclick = goBack;

        form.onsubmit = function (event) {
          event.preventDefault();
          var err = document.getElementById('leadErr');
          err.hidden = true;
          err.textContent = '';

          var picker = form.querySelector('[data-schedule]');
          var selectedDay = form.scheduleDay.value;
          var timeMinute = Number(form.scheduleTimeMinutes.value);
          var scheduleBad = !selectedDay || !Number.isInteger(timeMinute) ||
            timeMinute < 300 || timeMinute > 1380 || timeMinute % 60 !== 0;
          markInvalid(picker, scheduleBad);
          if (scheduleBad) return;

          var payload = {
            firstName: data.firstName,
            lastName: data.lastName,
            city: data.city,
            phone: data.phone,
            requestId: form.requestId.value,
            availability: {
              version: 2,
              days: [selectedDay],
              timeMinute: timeMinute,
              timeZone: form.timeZone.value || 'Europe/Moscow'
            }
          };

          var btn = form.querySelector('button[type="submit"]');
          btn.disabled = true;
          btn.textContent = 'Отправляем…';
          api('/api/lead', payload).then(function () {
            try { localStorage.removeItem('tajweed_lead_request_id'); } catch (e) { /* ок */ }
            state.phase = 'leadDone';
            show();
          }).catch(function (error) {
            btn.disabled = false;
            err.hidden = false;
            err.classList.add('is-error');
            /* 409 — заявка с этим requestId уже сохранена, а данные с тех пор
               изменились: берём новый идентификатор, иначе повтор молча
               пропадёт. */
            if (error && error.status === 409) {
              requestId = uuid();
              form.requestId.value = requestId;
              form.setAttribute('data-request-id', requestId);
              try { localStorage.setItem('tajweed_lead_request_id', requestId); } catch (e) { /* ок */ }
              btn.textContent = 'Отправить обновлённую заявку';
              err.textContent = 'Первая версия заявки уже сохранена. Вы изменили данные после отправки; ' +
                'проверьте их и нажмите кнопку ещё раз, чтобы отправить обновлённую заявку отдельно.';
            } else {
              btn.textContent = 'Отправить заявку';
              err.textContent = 'Не получилось отправить заявку. Проверьте интернет и попробуйте ещё раз, ' +
                'либо напишите преподавателю напрямую.';
            }
          });
        };
      }
    });
  }

  /* Кнопки возврата нет: уйти отсюда можно нижним меню, а лишняя строка
     только сбивает — заявка уже отправлена, действий не осталось. */
  function showLeadDone() {
    setBar(null);
    document.title = 'Заявка отправлена · таджвид.рф';
    render(
      '<h1>Заявка отправлена</h1>' +
      '<p class="lede">Спасибо! Преподаватель свяжется с вами в ближайшее время.</p>' +
      '<p class="notice">Пока ждёте — можно посмотреть, как устроен экзамен первого уровня.</p>'
    );
  }

  function examFreeTime(value) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
      }).format(new Date(value));
    } catch (error) { return value; }
  }

  function showExamCatalog() {
    state.phase = 'exams';
    paintNav();
    setBar(null);
    document.title = 'Экзамены · таджвид.рф';
    var token = studentToken();
    var draft = state.resumable === true && !!state.student;

    function paint(data) {
      var progress = progressFromResults(data && data.results || []);
      var pendingHomework = (data && data.homework || []).filter(function (item) {
        return item.status !== 'accepted' && !item.done;
      });
      var previousReady = !!progress.canOpen2;
      var courseworkReady = pendingHomework.length === 0;
      var level2Ready = !!token && previousReady && courseworkReady;
      var firstResult = progress.level1;
      var firstStatus = firstResult
        ? 'Лучший результат · ' + Math.round(Number(firstResult.percent) || 0) + '%'
        : 'Доступен сразу';
      var level2Reason = !token
        ? 'Сначала сдайте первый уровень и сохраните результат в кабинете.'
        : !previousReady
          ? 'Нужен результат 100% за первый уровень.'
          : !courseworkReady
            ? 'Сначала завершите обязательные задания: осталось ' + pendingHomework.length + '.'
            : 'Доступен.';

      var html = '<section class="exam-catalog" aria-labelledby="examCatalogTitle">' +
        '<p class="kicker">Экзамены<span class="cur">_</span></p>' +
        '<h1 id="examCatalogTitle">Выберите уровень</h1>' +
        '<p class="lede">Экзамен не начнётся сам. Сначала проверьте уровень и нажмите «Начать».</p>' +
        '<div class="exam-catalog-list">' +
          '<article class="exam-level-choice is-open"><header><span>01</span><div><h2>Первый уровень</h2>' +
            '<p>' + esc(firstStatus) + '</p></div></header><p>' + esc(LEVELS[0].topic) + '</p>' +
            '<button class="btn" type="button" data-start-exam="1">' +
              (draft ? 'Продолжить текущую попытку' : 'Начать первый уровень') + '</button></article>' +
          '<article class="exam-level-choice' + (level2Ready ? ' is-open' : ' is-locked') + '"><header><span>02</span><div><h2>Второй уровень</h2>' +
            '<p>' + esc(level2Reason) + '</p></div></header><p>' + esc(LEVELS[1].topic) + '</p>' +
            (level2Ready
              ? '<button class="btn" type="button" data-start-exam="2">Открыть второй уровень</button>'
              : pendingHomework.length
                ? '<button class="btn is-ghost" type="button" data-open-assignments>Открыть задания</button>' : '') + '</article>' +
        '</div>' +
        '<div class="exam-future-levels"><p>Следующие уровни</p><div>' +
          [3, 4, 5, 6].map(function (level) { return '<span><b>0' + level + '</b><small>закрыт</small></span>'; }).join('') +
        '</div><p class="profile-standing-note">Они появятся после того, как преподаватель добавит программу и ключ проверки.</p></div>' +
      '</section>';
      render(html);
      var startFirst = app.querySelector('[data-start-exam="1"]');
      if (startFirst) startFirst.onclick = function () {
        state.phase = draft ? 'exam' : 'reg';
        save();
        show();
      };
      var startSecond = app.querySelector('[data-start-exam="2"]');
      if (startSecond) startSecond.onclick = function () { location.href = 'level2.html'; };
      var assignments = app.querySelector('[data-open-assignments]');
      if (assignments) assignments.onclick = function () {
        lessonView = 'homework';
        state.phase = 'lessons';
        show();
      };
    }

    if (!token) return paint(null);
    loadingScreen('Экзамены', 'Проверяем ваш прогресс…');
    var seq = screenToken();
    apiGet('/api/student/' + encodeURIComponent(token)).then(function (data) {
      if (isStale(seq)) return;
      paint(data);
    }).catch(function (error) {
      if (isStale(seq)) return;
      if (error && error.status === 404) {
        try { localStorage.removeItem(STUDENT_KEY); } catch (storageError) { /* приватный режим */ }
        return paint(null);
      }
      errorScreen('Не удалось загрузить уровни', 'Проверьте интернет и попробуйте ещё раз.', showExamCatalog);
    });
  }

  function prepareExamAttempt(token, requestId, onReady) {
    function restartAfterInvalidToken(error) {
      if (!error || error.status !== 401) return false;
      try {
        if (studentToken() === token) localStorage.removeItem(STUDENT_KEY);
        if (guestToken() === token) localStorage.removeItem(GUEST_KEY);
      } catch (err) { /* ок */ }
      showReg();
      return true;
    }

    function issuePass() {
      loadingScreen('Готовим попытку', 'Проверяем доступ и баланс…');
      return api('/api/exam/start', {
        studentToken: token,
        examLevel: 1,
        requestId: requestId
      }).then(function (result) {
        state.attemptPassId = result.attemptPassId;
        state.attemptRequestId = requestId;
        onReady(result);
      }).catch(function (error) {
        if (restartAfterInvalidToken(error)) return;
        if (error && error.status === 402) {
          profileTab = 'settings';
          state.phase = 'profile';
          return showProfile();
        }
        errorScreen('Не удалось открыть попытку',
          error.message || 'Проверьте интернет и попробуйте ещё раз.', function () {
            prepareExamAttempt(token, requestId, onReady);
          });
      });
    }

    loadingScreen('Доступ к экзамену', 'Проверяем предыдущую попытку…');
    apiGet('/api/exam/access?examLevel=1&studentToken=' + encodeURIComponent(token)).then(function (access) {
      if (access.free) return issuePass();
      var guestAttempt = !studentToken() && guestToken() === token;
      var enough = Number(access.balance) >= Number(access.cost);
      render('<section class="retake-gate">' +
        '<p class="kicker">Повторная попытка<span class="cur">_</span></p>' +
        '<h1>' + (guestAttempt ? 'Бесплатно через 48 часов' : 'Сейчас или бесплатно позже') + '</h1>' +
        '<p class="lede">Следующая бесплатная попытка откроется ' + esc(examFreeTime(access.freeAt)) +
          (guestAttempt
            ? '. Сохраните первый результат в кабинете, если хотите пополнить кошелёк и начать раньше.</p>'
            : '. Если хотите начать сейчас, с кошелька спишется ' + esc(access.cost) + ' нуров.</p>') +
        (guestAttempt ? ''
          : '<div class="retake-balance"><span>Мой кошелёк</span><b>' + esc(access.balance) + '</b><small>нуров</small></div>') +
        (!guestAttempt && enough
          ? '<button class="btn btn-block" id="buyRetake" type="button">Начать сейчас · ' + esc(access.cost) + ' нуров</button>'
          : guestAttempt ? '' : '<p class="notice is-error">На балансе не хватает нуров для мгновенной попытки.</p>') +
        '<div class="btn-row"><button class="btn is-ghost" id="openWallet" type="button">' +
          (guestAttempt ? 'Сохранить первый результат' : 'Открыть кошелёк') + '</button>' +
          '<button class="btn is-quiet" id="retakeHome" type="button">Подождать</button></div>' +
        (guestAttempt ? '' : '<p class="wallet-fineprint">Нуры — внутренние учебные единицы. Они не выводятся в деньги; каждое списание видно в истории.</p>') +
      '</section>');
      var buy = document.getElementById('buyRetake');
      if (buy) buy.onclick = function () {
        buy.disabled = true;
        buy.textContent = 'Списываем…';
        issuePass();
      };
      document.getElementById('openWallet').onclick = function () {
        if (guestAttempt && access.lastResultId) return showSavedResult(access.lastResultId);
        profileTab = 'settings'; state.phase = 'profile'; show();
      };
      document.getElementById('retakeHome').onclick = function () {
        state.phase = 'welcome'; show();
      };
    }).catch(function (error) {
      if (restartAfterInvalidToken(error)) return;
      errorScreen('Не удалось проверить доступ', error.message || 'Попробуйте ещё раз.', function () {
        prepareExamAttempt(token, requestId, onReady);
      });
    });
  }

  function showReg() {
    state.attemptPassId = null;
    state.attemptRequestId = uuid();
    var permanentToken = studentToken();
    var temporaryToken = guestToken();
    var ownerToken = permanentToken || temporaryToken;

    function startExam(result) {
      var token = result.studentToken || ownerToken;
      var isGuest = !!result.isGuest || (!permanentToken && token === temporaryToken);
      if (isGuest && token) {
        try { localStorage.setItem(GUEST_KEY, token); } catch (err) { /* ок */ }
      }
      state.student = isGuest ? { isGuest: true } : { registered: true };
      state.startedAt = new Date().toISOString();
      state.submissionId = uuid();
      state.answers = freshAnswers();
      state.phase = 'exam';
      state.resumable = true;
      state.stepIdx = 0;
      examFinished = false;
      /* новая попытка начинается с чистого листа: журнал уходов и запись
         голоса от прошлой попытки не должны уехать преподавателю */
      integrity = { away: 0, awayMs: 0, events: [] };
      audioBlob = null;
      audioMime = '';
      save();
      show();
    }

    if (ownerToken) {
      return prepareExamAttempt(ownerToken, state.attemptRequestId, startExam);
    }

    /* Первая попытка — один запрос и сразу задания. Сервер сам создаёт
       временный кабинет, чтобы результат и лимит пересдачи не зависели от
       анкеты и не обходились простым обновлением страницы. */
    loadingScreen('Готовим экзамен', 'Открываем первую попытку без анкеты…');
    api('/api/exam/start', {
      studentToken: '', examLevel: 1, requestId: state.attemptRequestId
    }).then(function (result) {
      state.attemptPassId = result.attemptPassId;
      startExam(result);
    }).catch(function (error) {
      errorScreen('Не удалось открыть экзамен',
        error.message || 'Проверьте интернет и попробуйте ещё раз.', showReg);
    });
  }

  /* ── Экраны: экзамен ───────────────────────────────────── */

  function taskIndex(task) {
    return EXAM.tasks.indexOf(task) + 1;
  }

  function showStep() {
    var step = steps[state.stepIdx];
    if (!step) return finishExam();
    if (step.t === 'intro') return showIntro(step);
    return showQuestion(step);
  }

  function showIntro(step) {
    var task = step.task;
    setBar('Задание ' + taskIndex(task) + ' из ' + EXAM.tasks.length);
    var minutes = task.kind === 'reading'
      ? Math.round((task.timeLimit || QUESTION_TIME) / 60)
      : 3;
    render(
      '<p class="kicker">Задание ' + taskIndex(task) + ' из ' + EXAM.tasks.length + '</p>' +
      '<h1>' + esc(task.title) + '</h1>' +
      (task.note ? '<p class="lede">' + esc(task.note) + '</p>' : '') +
      '<dl class="task-meta">' +
        '<div><dt>Баллы</dt><dd>' + task.points + '</dd></div>' +
        '<div><dt>Вопросов</dt><dd>' + task.questions + '</dd></div>' +
        '<div><dt>Время</dt><dd>' + minutes + ' мин' + (task.questions > 1 ? ' на вопрос' : '') + '</dd></div>' +
      '</dl>' +
      '<div class="btn-row"><button class="btn btn-block" id="startTask">Начать задание</button></div>'
    );
    document.getElementById('startTask').onclick = next;
  }

  function qLabel(step) {
    var task = step.task;
    var label = 'Задание ' + taskIndex(task) + ' из ' + EXAM.tasks.length;
    if (task.questions > 1) label += ' · Вопрос ' + questionNumber(step) + ' из ' + task.questions;
    return label;
  }

  /* Водяной знак с именем ученика: скриншот заблокировать нельзя,
     но подписанный кадр невыгодно пересылать. */
  function stampWatermark() {
    var s = state.student || {};
    var tail = String(s.phone || '').replace(/\D/g, '').slice(-4);
    var mark = [s.lastName, s.firstName].filter(Boolean).join(' ') + (tail ? ' ·' + tail : '');
    if (!mark.trim()) return;
    var wm = document.createElement('div');
    wm.className = 'watermark';
    wm.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < 12; i++) {
      var span = document.createElement('span');
      span.textContent = mark;
      wm.appendChild(span);
    }
    app.appendChild(wm);
  }

  function wireExamHint(step) {
    var token = studentToken();
    if (!token || !state.attemptPassId) return;
    var taskNumber = taskIndex(step.task);
    var stepKey = String(taskNumber) + ':' + String(step.sub == null ? 0 : Number(step.sub));
    var target = document.getElementById('answerBtn');
    var anchor = target ? target.closest('.btn-row') : null;
    var host = document.createElement('div');
    host.className = 'exam-hint';
    host.innerHTML = '<button class="exam-hint-button" type="button">Подсказка · 50 нуров</button>' +
      '<p class="exam-hint-text" role="status" aria-live="polite" hidden></p>';
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(host, anchor);
    else app.querySelector('.screen').appendChild(host);
    var button = host.querySelector('button');
    var text = host.querySelector('p');
    button.onclick = function () {
      systemDialog = true;
      var accepted = window.confirm('Открыть подсказку за 50 нуров? Она направит ход мысли, но не покажет правильный ответ.');
      systemDialog = false;
      if (!accepted) return;
      button.disabled = true;
      button.textContent = 'Открываем…';
      api('/api/exam/hint', {
        studentToken: token,
        attemptPassId: state.attemptPassId,
        stepKey: stepKey,
        requestId: uuid()
      }).then(function (result) {
        text.hidden = false;
        text.textContent = result.hint;
        button.textContent = 'Подсказка открыта · осталось ' + result.balance;
      }).catch(function (error) {
        button.disabled = false;
        button.textContent = 'Подсказка · 50 нуров';
        text.hidden = false;
        text.textContent = error && error.status === 402
          ? 'На балансе не хватает нуров. Пополнить кошелёк можно в настройках профиля.'
          : 'Не удалось открыть подсказку. Попробуйте ещё раз.';
      });
    };
  }

  function showQuestion(step) {
    var task = step.task;
    setBar(qLabel(step));
    if (task.kind === 'match') renderMatch(task);
    if (task.kind === 'syllables') renderSyllables(task, step.sub);
    if (task.kind === 'sifat') renderSifat(task, step.sub);
    if (task.kind === 'compose') renderCompose(task, step.sub);
    if (task.kind === 'yesno') renderYesno(task, step.sub);
    if (task.kind === 'reading') {
      // render() внутри renderReading перетирает содержимое, поэтому знак
      // ставим после отрисовки — иначе на этом экране его просто нет
      renderReading(task);
      wireExamHint(step);
      return stampWatermark();
    }
    wireExamHint(step);
    stampWatermark();
    startTimer(QUESTION_TIME, commitAndNext);
  }

  function commitAndNext() {
    if (cur && cur.collect) cur.collect();
    next();
  }

  function next() {
    state.stepIdx += 1;
    save();
    if (state.stepIdx >= steps.length) return finishExam();
    show();
  }

  function answerFooter() {
    return '<div class="btn-row"><button class="btn btn-block" id="answerBtn">Сохранить ответ и продолжить</button></div>';
  }

  /* Пустой ответ уходит только с подтверждения: вернуться назад нельзя,
     а случайный тап иначе стоил бы вопроса. */
  function bindAnswer(isAnswered) {
    var btn = document.getElementById('answerBtn');
    var base = btn.textContent;
    var armed = false;

    function ready() {
      return typeof isAnswered !== 'function' || isAnswered();
    }

    // состояние сверяем при каждом нажатии — устаревшее предупреждение снимаем
    btn.onclick = function () {
      if (ready()) {
        if (armed) { armed = false; btn.textContent = base; btn.classList.remove('is-warning'); }
        stopTimer();
        return commitAndNext();
      }
      if (!armed) {
        armed = true;
        btn.textContent = 'Ответ не выбран — пропустить вопрос?';
        btn.classList.add('is-warning');
        return;
      }
      stopTimer();
      commitAndNext();
    };
  }

  /* Задание 1: соединение */

  function renderMatch(task) {
    var pairs = {}; // form -> name (локально на экране)
    Object.keys(state.answers.match).forEach(function (f) { pairs[f] = state.answers.match[f]; });
    var selForm = null, selName = null;

    var LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'];
    var formsHtml = task.forms.map(function (f, i) {
      return '<button type="button" class="opt opt-form" data-v="' + esc(f) + '" aria-pressed="false">' +
        '<span class="opt-num" aria-hidden="true">' + (i + 1) + '</span>' +
        '<span class="ar" lang="ar" dir="rtl">' + esc(f) + '</span>' +
        '<span class="tag" lang="ar" dir="rtl"></span>' +
        '<span class="pair-status visually-hidden">Буква ' + (i + 1) + ', связь не выбрана</span></button>';
    }).join('');
    var namesHtml = task.names.map(function (n, i) {
      return '<button type="button" class="opt opt-name" data-v="' + esc(n) + '" aria-pressed="false">' +
        '<span class="opt-num" aria-hidden="true">' + LETTERS[i] + '</span>' +
        '<span class="ar" lang="ar" dir="rtl">' + esc(n) + '</span>' +
        '<span class="tag" lang="ar" dir="rtl"></span>' +
        '<span class="pair-status visually-hidden">Название ' + LETTERS[i] + ', связь не выбрана</span></button>';
    }).join('');

    render(
      '<div class="q-head"><h1 class="q-title">' + esc(task.title) + '</h1>' +
      '<p class="q-note">' + esc(task.note) + '</p></div>' +
      '<div class="match">' +
        '<div class="col" id="colForms">' + formsHtml + '</div>' +
        '<div class="col" id="colNames">' + namesHtml + '</div>' +
      '</div>' +
      '<p class="match-hint" aria-live="polite">Составлено пар: <span id="pairCount">0</span> из ' + task.names.length + '</p>' +
      answerFooter()
    );

    var formBtns = [].slice.call(app.querySelectorAll('.opt-form'));
    var nameBtns = [].slice.call(app.querySelectorAll('.opt-name'));

    function paint() {
      var used = {};
      var n = 0;
      Object.keys(pairs).forEach(function (f) { used[pairs[f]] = f; n++; });
      // сохраняем сразу: иначе закрытая посреди задания вкладка уносит все пары
      state.answers.match = pairs;
      save();
      formBtns.forEach(function (b) {
        var f = b.getAttribute('data-v');
        var paired = !!pairs[f];
        b.classList.toggle('is-paired', paired);
        b.classList.toggle('is-on', selForm === f);
        b.setAttribute('aria-pressed', selForm === f ? 'true' : 'false');
        b.querySelector('.pair-status').textContent = paired ? 'Связано с ' + pairs[f] : 'Связь не выбрана';
        b.querySelector('.tag').textContent = paired ? pairs[f] : '';
      });
      nameBtns.forEach(function (b) {
        var v = b.getAttribute('data-v');
        var paired = !!used[v];
        b.classList.toggle('is-paired', paired);
        b.classList.toggle('is-on', selName === v);
        b.setAttribute('aria-pressed', selName === v ? 'true' : 'false');
        b.querySelector('.pair-status').textContent = paired ? 'Связано' : 'Связь не выбрана';
        b.querySelector('.tag').textContent = paired ? used[v] : '';
      });
      document.getElementById('pairCount').textContent = n;
    }

    function tryPair() {
      if (selForm && selName) {
        Object.keys(pairs).forEach(function (f) { if (pairs[f] === selName) delete pairs[f]; });
        pairs[selForm] = selName;
        selForm = null; selName = null;
      }
      paint();
    }

    formBtns.forEach(function (b) {
      b.onclick = function () {
        var f = b.getAttribute('data-v');
        if (pairs[f]) { delete pairs[f]; selForm = null; paint(); return; }
        selForm = selForm === f ? null : f;
        tryPair();
      };
    });
    nameBtns.forEach(function (b) {
      b.onclick = function () {
        var v = b.getAttribute('data-v');
        var ownerForm = null;
        Object.keys(pairs).forEach(function (f) { if (pairs[f] === v) ownerForm = f; });
        if (ownerForm) { delete pairs[ownerForm]; selName = null; paint(); return; }
        selName = selName === v ? null : v;
        tryPair();
      };
    });

    paint();
    cur = { collect: function () { state.answers.match = pairs; } };
    bindAnswer(function () { return Object.keys(pairs).length > 0; });
  }

  /* Задание 2: слоги */

  function renderSyllables(task, i) {
    var val = state.answers.syllables[i];
    render(
      '<div class="q-head"><h1 class="q-title">Слово ' + (i + 1) + ' из ' + task.words.length + ': сколько слогов?</h1></div>' +
      '<p class="ar-hero" lang="ar" dir="rtl">' + esc(task.words[i]) + '</p>' +
      '<div class="stepper">' +
        '<button type="button" id="minus" aria-label="Уменьшить число слогов">−</button>' +
        '<output id="num" aria-label="Выбранное число слогов" aria-live="polite" class="' + (val == null ? 'is-empty' : '') + '">' + (val == null ? 'Выберите число' : val) + '</output>' +
        '<button type="button" id="plus" aria-label="Увеличить число слогов">+</button>' +
      '</div>' +
      answerFooter()
    );
    var out = document.getElementById('num');
    function set(v) {
      val = Math.max(1, Math.min(12, v));
      out.textContent = val;
      out.classList.remove('is-empty');
    }
    document.getElementById('plus').onclick = function () { set(val == null ? 1 : val + 1); };
    document.getElementById('minus').onclick = function () { set(val == null ? 1 : val - 1); };
    cur = { collect: function () { state.answers.syllables[i] = val; } };
    bindAnswer(function () { return val != null; });
  }

  /* Задание 3: сифаты */

  function renderSifat(task, i) {
    var letter = task.letters[i];
    var chosen = (state.answers.sifat[letter] || []).slice();
    var rows = task.sifat.map(function (s) {
      var on = chosen.indexOf(s.ar) !== -1;
      return '<label class="check' + (on ? ' is-on' : '') + '"><input type="checkbox" name="sifat" value="' + esc(s.ar) + '" data-v="' + esc(s.ar) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="box">✓</span><span class="ru">' + esc(s.ru) + '</span><span class="ar" lang="ar" dir="rtl">' + esc(s.ar) + '</span>' +
      '</label>';
    }).join('');
    render(
      '<div class="q-head"><h1 class="q-title">Буква ' + (i + 1) + ' из ' + task.letters.length + ': отметьте сифаты</h1>' +
      '<p class="q-note">' + esc(task.note) + '</p></div>' +
      '<p class="ar-hero" lang="ar" dir="rtl">' + esc(letter) + '</p>' +
      '<fieldset class="checks"><legend class="visually-hidden">Сифаты буквы</legend>' + rows + '</fieldset>' +
      answerFooter()
    );
    [].slice.call(app.querySelectorAll('.check input')).forEach(function (input) {
      input.onchange = function () {
        var v = input.getAttribute('data-v');
        var idx = chosen.indexOf(v);
        if (idx === -1) chosen.push(v); else chosen.splice(idx, 1);
        input.closest('.check').classList.toggle('is-on', input.checked);
      };
    });
    cur = { collect: function () { state.answers.sifat[letter] = chosen; } };
    bindAnswer(function () { return chosen.length > 0; });
  }

  /* Задание 4: сборка слова */

  function renderCompose(task, i) {
    var item = task.items[i];
    var tiles = item.tiles.map(function (t, k) { return { v: t, id: 'c' + k, dis: false }; })
      .concat((item.distractors || []).map(function (t, k) { return { v: t, id: 'd' + k, dis: true }; }));
    tiles = shuffled(tiles, i + 7);
    var picked = []; // массив id в порядке нажатия

    render(
      '<div class="q-head"><h1 class="q-title">Слово ' + (i + 1) + ' из ' + task.items.length + ': соберите</h1>' +
      (item.hint ? '<p class="q-note">' + esc(item.hint) + '</p>' : '') +
      '</div>' +
      '<p class="compose-given">Дано: <span class="ar" lang="ar" dir="rtl">' + esc(item.given) + '</span></p>' +
      '<div class="compose-out is-empty" id="composeOut" aria-live="polite">Нажимайте на плитки внизу</div>' +
      '<div class="compose-tiles" id="composeTiles">' +
        tiles.map(function (t) {
          return '<button type="button" class="opt" data-id="' + t.id + '" aria-pressed="false"><bdi lang="ar" dir="rtl">' + esc(t.v) + '</bdi></button>';
        }).join('') +
      '</div>' +
      '<div class="compose-ctrl">' +
        '<button type="button" class="btn is-ghost" id="composeUndo">⌫ Стереть</button>' +
        '<button type="button" class="btn is-ghost" id="composeClear">Очистить</button>' +
      '</div>' +
      answerFooter()
    );

    var out = document.getElementById('composeOut');
    var btns = {};
    [].slice.call(app.querySelectorAll('#composeTiles .opt')).forEach(function (b) {
      btns[b.getAttribute('data-id')] = b;
      b.onclick = function () {
        var id = b.getAttribute('data-id');
        if (picked.indexOf(id) !== -1) return;
        picked.push(id);
        paint();
      };
    });
    document.getElementById('composeUndo').onclick = function () { picked.pop(); paint(); };
    document.getElementById('composeClear').onclick = function () { picked = []; paint(); };

    function word() {
      return picked.map(function (id) {
        for (var k = 0; k < tiles.length; k++) if (tiles[k].id === id) return tiles[k].v;
        return '';
      }).join('');
    }

    function paint() {
      var w = word();
      if (w) {
        out.classList.remove('is-empty');
        out.setAttribute('lang', 'ar');
        out.setAttribute('dir', 'rtl');
        out.textContent = w;
      } else {
        out.classList.add('is-empty');
        out.removeAttribute('lang');
        out.removeAttribute('dir');
        out.textContent = 'Нажимайте на плитки внизу';
      }
      Object.keys(btns).forEach(function (id) {
        btns[id].classList.toggle('is-used', picked.indexOf(id) !== -1);
        btns[id].setAttribute('aria-pressed', picked.indexOf(id) !== -1 ? 'true' : 'false');
      });
    }

    cur = { collect: function () { state.answers.compose[i] = word(); } };
    bindAnswer(function () { return !!word(); });
  }

  /* Задание 5: да / нет */

  function renderYesno(task, i) {
    var st = task.statements[i];
    var val = state.answers.yesno[i];
    render(
      '<div class="q-head"><h1 class="q-title">Утверждение ' + (i + 1) + ' из ' + task.statements.length + ': верно?</h1></div>' +
      '<p class="lede statement">' + esc(st.text) + '</p>' +
      (st.ar ? '<p class="ar-hero is-compact" lang="ar" dir="rtl">' + esc(st.ar) + '</p>' : '') +
      '<fieldset class="yesno"><legend class="visually-hidden">Верно ли утверждение</legend>' +
        '<label class="opt' + (val === true ? ' is-on' : '') + '"><input type="radio" name="yesno" value="yes"' + (val === true ? ' checked' : '') + '><span>Да</span></label>' +
        '<label class="opt' + (val === false ? ' is-on' : '') + '"><input type="radio" name="yesno" value="no"' + (val === false ? ' checked' : '') + '><span>Нет</span></label>' +
      '</fieldset>' +
      answerFooter()
    );
    var yes = app.querySelector('input[name="yesno"][value="yes"]');
    var no = app.querySelector('input[name="yesno"][value="no"]');
    yes.onchange = function () {
      val = true; yes.closest('.opt').classList.add('is-on'); no.closest('.opt').classList.remove('is-on');
    };
    no.onchange = function () {
      val = false; no.closest('.opt').classList.add('is-on'); yes.closest('.opt').classList.remove('is-on');
    };
    cur = { collect: function () { state.answers.yesno[i] = val; } };
    bindAnswer(function () { return typeof val === 'boolean'; });
  }

  /* Задание 6: чтение с записью */

  function renderReading(task) {
    var rowsHtml = task.rows.map(function (r) {
      /* Номер строки берём из данных и печатаем сам: в бланке номера идут
         с пропусками (1, 2, 5, 7, 8, 9, 10), а маркеры <ol> отключены
         стилем — без этого преподаватель говорит «строка 5», а ученик
         видит третью по счёту. */
      return '<li class="read-row"' + (r.n ? ' value="' + (r.n | 0) + '"' : '') + '>' +
        (r.n ? '<span class="read-num" aria-hidden="true">' + (r.n | 0) + '</span>' : '') +
        '<p class="ar-line" lang="ar" dir="rtl">' + esc(r.text) + '</p>' +
        (r.n ? '<span class="visually-hidden">Строка ' + (r.n | 0) + '</span>' : '') +
        '</li>';
    }).join('');

    render(
      '<div class="q-head"><h1 class="q-title">' + esc(task.title) + '</h1>' +
      '<p class="q-note">' + esc(task.note) + '</p></div>' +
      '<ol class="read-rows">' + rowsHtml + '</ol>' +
      '<div class="recorder">' +
        '<p class="rec-status" id="recStatus" role="status" aria-live="polite">Микрофон ещё не включён</p>' +
        '<div class="btn-row reading-actions">' +
          '<button type="button" class="btn" id="recBtn">Начать запись</button>' +
        '</div>' +
        '<div id="recPlayback" class="recording-playback" hidden></div>' +
      '</div>' +
      '<div class="btn-row">' +
        '<button class="btn btn-block" id="answerBtn" disabled>Завершить экзамен</button>' +
        '<button class="btn is-ghost btn-block" id="skipBtn">Пропустить — прочитаю преподавателю лично</button>' +
      '</div>'
    );

    var recBtn = document.getElementById('recBtn');
    var status = document.getElementById('recStatus');
    var playback = document.getElementById('recPlayback');
    var answerBtn = document.getElementById('answerBtn');
    var recorder = null;
    var stream = null;
    var chunks = [];
    var advanceAfterStop = false;
    var skipped = false;
    var active = true;
    var permissionPending = false;
    var playbackUrl = '';

    function stopStream() {
      if (!stream) return;
      stream.getTracks().forEach(function (track) { track.stop(); });
      stream = null;
    }

    screenCleanup = function () {
      active = false;
      permissionPending = false;
      if (recorder) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        if (recorder.state === 'recording') {
          try { recorder.stop(); } catch (e) { /* поток остановим ниже */ }
        }
      }
      stopStream();
      if (playbackUrl) {
        URL.revokeObjectURL(playbackUrl);
        playbackUrl = '';
      }
    };

    function pickMime() {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
        if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
      }
      return '';
    }

    function setStatus(html, live) {
      if (!active) return;
      status.replaceChildren();
      if (live) {
        var dot = document.createElement('span');
        dot.className = 'rec-dot';
        dot.setAttribute('aria-hidden', 'true');
        status.appendChild(dot);
      }
      status.appendChild(document.createTextNode(html));
      recBtn.classList.toggle('is-recording', !!live);
    }

    // предупреждаем сразу, а не после нажатия на «Начать запись»
    if (!window.isSecureContext || !navigator.mediaDevices) {
      setStatus('Микрофон работает только по защищённому адресу (https).');
      var earlyLink = document.createElement('a');
      earlyLink.href = 'https://' + location.host + location.pathname;
      earlyLink.className = 'rec-secure-link';
      earlyLink.textContent = 'Открыть по https';
      status.appendChild(document.createTextNode(' '));
      status.appendChild(earlyLink);
    }

    recBtn.onclick = function () {
      if (!active || permissionPending) return;
      if (recorder && recorder.state === 'recording') {
        recBtn.disabled = true;
        recorder.stop();
        return;
      }
      // Браузеры дают микрофон только на https (и на localhost).
      // По http navigator.mediaDevices вообще не существует.
      if (!window.isSecureContext || !navigator.mediaDevices) {
        var httpsUrl = 'https://' + location.host + location.pathname;
        setStatus('Микрофон работает только по защищённому адресу. Откройте сайт по https и вернитесь к этому заданию.');
        status.appendChild(document.createTextNode(' '));
        var link = document.createElement('a');
        link.href = httpsUrl;
        link.className = 'rec-secure-link';
        link.textContent = 'Открыть по https';
        status.appendChild(link);
        recBtn.disabled = true;
        return;
      }
      if (!window.MediaRecorder) {
        setStatus('Этот браузер не умеет записывать звук. Нажмите «Пропустить» и прочитайте преподавателю лично.');
        return;
      }
      permissionPending = true;
      recBtn.disabled = true;
      setStatus('Запрашиваем доступ к микрофону…');
      // запрос доступа снимает фокус с окна — не считаем это уходом со вкладки
      systemDialog = true;
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (mediaStream) {
        systemDialog = false;
        permissionPending = false;
        stream = mediaStream;
        if (!active || skipped) {
          stopStream();
          return;
        }
        var mime = pickMime();
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        audioMime = recorder.mimeType || mime || 'audio/webm';
        chunks = [];
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = function () {
          stopStream();
          if (!active || skipped) return; // экран ушёл или ученик отказался от записи
          audioBlob = new Blob(chunks, { type: audioMime });
          state.answers.readingRecorded = true;
          save();
          setStatus('Запись готова. Можно прослушать или перезаписать.');
          recBtn.textContent = 'Перезаписать';
          recBtn.disabled = false;
          playback.hidden = false;
          playback.innerHTML = '';
          if (playbackUrl) URL.revokeObjectURL(playbackUrl);
          var audio = document.createElement('audio');
          audio.controls = true;
          playbackUrl = URL.createObjectURL(audioBlob);
          audio.src = playbackUrl;
          playback.appendChild(audio);
          answerBtn.disabled = false;
          if (advanceAfterStop) { advanceAfterStop = false; stopTimer(); commitAndNext(); }
        };
        recorder.start();
        setStatus('Идёт запись — читайте строки вслух', true);
        recBtn.textContent = 'Остановить запись';
        recBtn.disabled = false;
        playback.hidden = true;
        audioBlob = null;
        answerBtn.disabled = true;
      }).catch(function () {
        // симметрично успешной ветке: иначе флаг остаётся поднятым
        // и уходы со вкладки перестают фиксироваться до конца попытки
        systemDialog = false;
        permissionPending = false;
        stopStream();
        if (!active) return;
        recBtn.disabled = false;
        setStatus('Нет доступа к микрофону. Разрешите доступ или нажмите «Пропустить».');
      });
    };

    document.getElementById('skipBtn').onclick = function () {
      skipped = true;
      advanceAfterStop = false;
      if (recorder && recorder.state === 'recording') recorder.stop();
      audioBlob = null;
      state.answers.readingRecorded = false;
      stopTimer();
      next();
    };

    answerBtn.onclick = function () {
      stopTimer();
      next();
    };

    cur = {
      collect: function () { /* аудио уже в audioBlob */ }
    };

    startTimer(task.timeLimit || QUESTION_TIME, function () {
      if (recorder && recorder.state === 'recording') {
        advanceAfterStop = true;
        recorder.stop();
      } else {
        next();
      }
    });
  }

  /* ── Завершение и отправка ─────────────────────────────── */

  var examFinished = false;

  function finishExam() {
    if (examFinished) return; // защита от двойного завершения (гонка onstop/skip)
    examFinished = true;
    hideTimer();
    state.phase = 'done';
    save();
    setBar('Экзамен завершён');
    render(
      '<h1>Отправляем ответы…</h1>' +
      '<p class="lede">Не закрывайте вкладку, это займёт несколько секунд.</p>' +
      '<p class="notice" id="submitProgress" role="status" aria-live="polite">Соединяемся с сервером…</p>'
    );
    submitAll(function (n, total) {
      var el = document.getElementById('submitProgress');
      if (!el) return;
      el.textContent = n === 1
        ? 'Соединяемся с сервером…'
        : 'Сервер просыпается, пробуем ещё раз (попытка ' + n + ' из ' + total + ')…';
    }).then(function () { showDone(); });
  }

  /* Сервер на Railway может «просыпаться» после простоя или перезапуска —
     первая попытка тогда не укладывается в таймаут. Пробуем несколько раз. */
  function apiWithRetry(path, body, attempts, onAttempt) {
    var total = attempts || 4;
    function run(n) {
      if (onAttempt) onAttempt(n, total);
      return api(path, body, 30000).catch(function (err) {
        // 4xx — данные не примут и со второй попытки, повторять бессмысленно
        if (err && err.status && err.status >= 400 && err.status < 500) throw err;
        if (n >= total) throw err;
        return new Promise(function (resolve) {
          setTimeout(resolve, n * 2500);
        }).then(function () { return run(n + 1); });
      });
    }
    return run(1);
  }

  function submitAll(onAttempt) {
    var savedStudentToken = examOwnerToken();
    var payload = {
      examLevel: 1,
      submissionId: state.submissionId,
      studentToken: savedStudentToken,
      attemptPassId: state.attemptPassId,
      student: state.student,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      answers: state.answers,
      integrity: integrity,
      site: location.hostname
    };
    serverResult = null;
    submitError = null; // причину отказа показываем ученику
    return apiWithRetry('/api/submit', payload, 4, onAttempt).then(function (res) {
      serverResult = res;
      if (audioBlob && res && res.id) {
        var fd = new FormData();
        var ext = /mp4|aac/.test(audioMime) ? 'm4a' : 'webm';
        fd.append('audio', audioBlob, 'reading.' + ext);
        return fetchWithTimeout(API + '/api/audio/' + encodeURIComponent(res.id), {
          method: 'POST',
          headers: { 'X-Audio-Upload-Token': res.audioUploadToken || '' },
          body: fd
        }, 60000)
          .then(function (r) { serverResult.audioUploaded = r.ok; })
          .catch(function () { serverResult.audioUploaded = false; });
      }
    }).catch(function (e) {
      submitError = e;
    });
  }

  /* Отчёт по данным сервера — работает и без локальных ответов
     (например, когда результат открыт по ссылке на другом устройстве). */
  function reportFromResult(res) {
    var lines = [];
    var level = Number(res.examLevel) || 1;
    var pending = res.gradingStatus === 'pending';
    lines.push('ЭКЗАМЕН ПО ТАДЖВИДУ · ' + (level === 2 ? '2-Й' : '1-Й') + ' УРОВЕНЬ');
    lines.push(res.isGuest
      ? 'Ученик: данные ещё не сохранены'
      : 'Ученик: ' + res.lastName + ' ' + res.firstName + ' (' + res.city + ')');
    lines.push('Дата: ' + new Date(res.createdAt).toLocaleString('ru-RU'));
    lines.push('');
    if (pending) {
      lines.push('СТАТУС: ожидает проверки преподавателем');
      lines.push('Автоматически проверяемая часть: ' + res.points + ' из ' + res.max + ' баллов');
    } else {
      lines.push('РЕЗУЛЬТАТ: ' + Math.round(res.percent) + '% — ' + scoreVerdict(res.percent));
      lines.push('Письменная часть: ' + res.points + ' из ' + res.max + ' баллов');
    }
    lines.push('');
    lines.push('ПО ЗАДАНИЯМ:');
    (res.breakdown || []).forEach(function (b) {
      lines.push('  ' + b.label + ': ' + b.points + ' / ' + b.max);
    });
    lines.push('  ' + (level === 2 ? 'Мадд, слоги, диктант и устное чтение' : 'Устное чтение и диктант') +
      ': оценит преподаватель' +
      (res.hasAudio ? ' (аудиозапись отправлена)' : ''));
    return lines.join('\n');
  }

  function reportButtonsHtml(withAudio) {
    return '<div class="btn-row">' +
      '<button class="btn is-pill" id="copyBtn">Скопировать отчёт</button>' +
      '<button class="btn is-pill" id="dlBtn">Скачать отчёт</button>' +
      (withAudio ? '<button class="btn is-ghost" id="dlAudioBtn">Скачать аудио</button>' : '') +
      '<a class="btn is-pill" id="waBtn" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a class="btn is-pill" id="tgBtn" target="_blank" rel="noopener">Telegram</a>' +
    '</div>';
  }

  function wireReportButtons(text, lastName) {
    var copyBtn = document.getElementById('copyBtn');
    if (!copyBtn) return;
    copyBtn.onclick = function () {
      var btn = this;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(function () { btn.textContent = 'Скопировано'; })
        .catch(function () { window.prompt('Скопируйте отчёт:', text); });
    };
    document.getElementById('dlBtn').onclick = function () {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var aEl = document.createElement('a');
      aEl.href = url;
      aEl.download = 'Экзамен_' + (lastName || 'ученик') + '.txt';
      aEl.click();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    };
    var dlAudio = document.getElementById('dlAudioBtn');
    if (dlAudio && audioBlob) {
      dlAudio.onclick = function () {
        var url = URL.createObjectURL(audioBlob);
        var aEl = document.createElement('a');
        aEl.href = url;
        aEl.download = 'Чтение_' + (lastName || 'ученик') + (/mp4|aac/.test(audioMime) ? '.m4a' : '.webm');
        aEl.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      };
    }
    document.getElementById('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(text);
    document.getElementById('tgBtn').href = 'https://t.me/share/url?url=' +
      encodeURIComponent(CFG.SITE_URL || location.href) + '&text=' + encodeURIComponent(text);
  }

  function reportText() {
    var a = state.answers;
    var s = state.student || {};
    var lines = [];
    lines.push('ЭКЗАМЕН ПО ТАДЖВИДУ · 1-Й УРОВЕНЬ');
    lines.push(s.isGuest
      ? 'Ученик: данные ещё не сохранены'
      : 'Ученик: ' + (s.lastName || '') + ' ' + (s.firstName || '') + ' (' + (s.city || '') + ')');
    if (s.phone) lines.push('Телефон: ' + s.phone);
    lines.push('Дата: ' + new Date().toLocaleString('ru-RU'));
    lines.push('');
    lines.push('ЗАДАНИЕ 1 — соединение букв с названиями:');
    var t1 = EXAM.tasks[0];
    t1.forms.forEach(function (f) {
      lines.push('  ' + f + ' → ' + (a.match[f] || '—'));
    });
    lines.push('');
    lines.push('ЗАДАНИЕ 2 — количество слогов:');
    EXAM.tasks[1].words.forEach(function (w, i) {
      lines.push('  ' + w + ' = ' + (a.syllables[i] == null ? '—' : a.syllables[i]));
    });
    lines.push('');
    lines.push('ЗАДАНИЕ 3 — сифаты:');
    EXAM.tasks[2].letters.forEach(function (l) {
      lines.push('  ' + l + ': ' + ((a.sifat[l] || []).join('، ') || '—'));
    });
    lines.push('');
    lines.push('ЗАДАНИЕ 4 — составление слов:');
    EXAM.tasks[3].items.forEach(function (it, i) {
      lines.push('  ' + (i + 1) + ') ' + (a.compose[i] || '—'));
    });
    lines.push('');
    lines.push('ЗАДАНИЕ 5 — да/нет:');
    EXAM.tasks[4].statements.forEach(function (st, i) {
      var v = a.yesno[i];
      lines.push('  ' + (i + 1) + '. ' + (v === true ? 'Да' : v === false ? 'Нет' : '—'));
    });
    lines.push('');
    lines.push('ЗАДАНИЕ 6 — чтение: ' + (a.readingRecorded ? 'записано на диктофон' : 'будет прочитано преподавателю лично'));
    return lines.join('\n');
  }

  function showDone() {
    setBar('Экзамен завершён');
    var html = '<h1>Экзамен завершён</h1>';
    var s = state.student || {};
    html += '<p class="lede">' + (s.firstName ? esc(s.firstName) + ', спасибо! ' : 'Готово. ');

    if (serverResult && serverResult.id) {
      try { localStorage.setItem('tajweed_last_result', serverResult.id); } catch (e) { /* ок */ }
      if (serverResult.studentToken && !serverResult.isGuest) {
        try { localStorage.setItem(STUDENT_KEY, serverResult.studentToken); } catch (e) { /* ок */ }
      }
      if (history.replaceState) history.replaceState(null, '', '#r=' + serverResult.id);
    }

    if (serverResult && typeof serverResult.percent === 'number') {
      var pct = Math.round(serverResult.percent);
      html += 'Ответы отправлены преподавателю. Вот ваш уровень:</p>';
      html += '<div class="score-hero is-scored frame" style="--score-color: ' + scoreColor(pct) + '">' +
        '<div class="score-percent">' + pct + '<i>%</i></div>' +
        '<p class="score-caption">Первый уровень · ' + scoreVerdict(pct) + '</p>' +
        '<div class="level-bar"><span style="width: ' + pct + '%"></span></div>' +
        '<p class="score-points">Письменная часть: ' + esc(serverResult.points) + ' из ' + esc(serverResult.max) + ' баллов</p>' +
      '</div>';
      html += '<p class="lede">' + (pct === 100
        ? 'Идеальный результат: второй экзамен открыт.'
        : 'Второй уровень откроется, когда результат первого будет ровно 100%.') + '</p>';
      html += levelLadder({
        level1: { percent: pct, points: serverResult.points, max: serverResult.max, id: serverResult.id },
        level2: null,
        canOpen2: pct === 100
      });
      if (serverResult.breakdown && serverResult.breakdown.length) {
        html += '<div class="breakdown">';
        serverResult.breakdown.forEach(function (b) {
          html += '<div class="breakdown-row"><span>' + esc(b.label) + '</span>' +
            '<span class="pts">' + esc(b.points) + ' / ' + esc(b.max) + '</span></div>';
        });
        html += '<div class="breakdown-row is-muted"><span>Устное чтение и диктант</span><span class="pts">оценит преподаватель</span></div>';
        html += '</div>';
      }
      if (state.answers.readingRecorded) {
        html += '<p class="notice">' + (serverResult.audioUploaded
          ? 'Аудиозапись чтения тоже отправлена.'
          : 'Аудиозапись не загрузилась — скачайте её кнопкой ниже и отправьте преподавателю вручную.') + '</p>';
      }
    } else {
      html += 'Ответы сохранены на этом устройстве.</p>';
      var code = submitError && submitError.status;
      html += '<p class="notice is-error">' + (
        code === 402
          ? 'Эта повторная попытка не была оплачена. Ответы сохранены: откройте кошелёк или дождитесь бесплатного доступа через 48 часов.'
        : code === 429
          ? 'Сегодня с вашего номера уже отправлено пять работ. Ответы сохранены — отправьте их завтра или передайте отчёт преподавателю вручную.'
        : code === 409
          ? 'Эта работа уже отправлена раньше. Откройте свой результат в профиле — повторная отправка не нужна.'
        : code >= 400 && code < 500
          ? 'Сервер не принял работу: возможно, анкета заполнена не полностью. Ответы сохранены — передайте отчёт преподавателю вручную.'
        : storageWorks
          ? 'Сервер сейчас недоступен — мы пробовали несколько раз. Ответы не потеряны: они останутся здесь, даже если закрыть вкладку. Попробуйте отправку через минуту или передайте отчёт преподавателю вручную.'
          : 'Сервер сейчас недоступен — мы пробовали несколько раз. Браузер запретил сохранение, поэтому НЕ закрывайте вкладку: скачайте отчёт кнопкой ниже или передайте его преподавателю сейчас.'
      ) + '</p>';
      html += '<div class="btn-row"><button class="btn" id="retrySubmitBtn">Повторить отправку</button></div>';
    }

    if (serverResult && serverResult.id && serverResult.isGuest) html += resultClaimHtml();
    html += '<hr class="rule">';
    html += '<p class="kicker">Отчёт<span class="cur">_</span></p>';
    html += '<p class="lede">' + (serverResult && serverResult.id
      ? 'Отчёт уже ушёл преподавателю. Кнопки ниже — если хотите сохранить копию себе или переслать её сами.'
      : 'Пока отчёт до преподавателя не дошёл. Сохраните его или перешлите сами — так результат точно не потеряется.') + '</p>';
    html += reportButtonsHtml(audioBlob && (!serverResult || !serverResult.audioUploaded));

    if (serverResult && serverResult.studentToken && !serverResult.isGuest) {
      html += '<div class="btn-row"><button class="btn" id="cabinetBtn">Открыть личный кабинет</button>' +
        '<button class="btn is-ghost" id="homeBtn">На главную</button></div>';
    } else {
      html += '<div class="btn-row"><button class="btn is-ghost" id="homeBtn">На главную</button></div>';
    }

    render(html);
    wireLevelActions();
    if (serverResult && serverResult.isGuest) wireResultClaim(serverResult.id);
    wireReportButtons(reportText(), s.lastName);

    var retrySubmit = document.getElementById('retrySubmitBtn');
    if (retrySubmit) {
      retrySubmit.onclick = function () {
        retrySubmit.disabled = true;
        submitAll(function (n, total) {
          retrySubmit.textContent = n === 1 ? 'Отправляем…' : 'Попытка ' + n + ' из ' + total + '…';
        }).then(function () { showDone(); });
      };
    }
    var cabinetBtn = document.getElementById('cabinetBtn');
    if (cabinetBtn) cabinetBtn.onclick = function () { showStudentCabinet(serverResult.studentToken); };
    document.getElementById('homeBtn').onclick = function () {
      if (history.replaceState) history.replaceState(null, '', location.pathname);
      state.phase = 'welcome';
      show();
    };

    // черновик стираем только когда сервер принял ответы
    if (serverResult && serverResult.id) {
      try { localStorage.removeItem(LS_KEY); } catch (e) { /* не критично */ }
    }
  }

  /* ── Запуск ────────────────────────────────────────────── */

  window.addEventListener('beforeunload', function (e) {
    if (state.phase === 'exam') {
      e.preventDefault();
      e.returnValue = '';
    }
  });
  window.addEventListener('pagehide', function () {
    if (screenCleanup) screenCleanup();
  });
  window.addEventListener('pageshow', function (event) {
    if (event.persisted) show();
  });

  /* ── Переключатель темы ────────────────────────────────── */

  function currentTheme() {
    var set = document.documentElement.getAttribute('data-theme');
    return set === 'dark' ? 'dark' : 'light'; // по умолчанию белый бланк
  }

  function applyTheme(next) {
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('tajweed_theme', next); } catch (e) { /* приватный режим */ }
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', next === 'light' ? '#FFFFFF' : '#0A0A0B');
    syncThemeToggle();
  }

  function syncThemeToggle() {
    var toggle = document.getElementById('themeToggle');
    var label = document.getElementById('themeLabel');
    if (!toggle || !label) return;
    var isLight = currentTheme() === 'light';
    label.textContent = isLight ? 'Светлая' : 'Тёмная';
    toggle.setAttribute('aria-pressed', isLight ? 'true' : 'false');
    toggle.setAttribute('aria-label', 'Тема оформления: ' + (isLight ? 'светлая' : 'тёмная') +
      '. Переключить на ' + (isLight ? 'тёмную' : 'светлую'));
  }

  (function initTheme() {
    var toggle = document.getElementById('themeToggle');
    if (!toggle) return;
    document.documentElement.setAttribute('data-theme', currentTheme());
    syncThemeToggle();
    toggle.onclick = function () { applyTheme(currentTheme() === 'light' ? 'dark' : 'light'); };
  })();

  (function initLanguages() {
    var button = document.getElementById('languageButton');
    var menu = document.getElementById('languageMenu');
    if (!button || !menu) return;
    var languages = window.TAJWEED_LANGUAGES || [];
    var i18n = window.TAJWEED_I18N;
    var current = i18n ? i18n.current() : 'ru';
    var selected = languages.filter(function (item) { return item[0] === current; })[0] || languages[0];
    function languageFlag(svg, small) {
      return '<span class="language-flag' + (small ? ' is-small' : '') +
        '" aria-hidden="true">' + svg + '</span>';
    }
    /* Рядом с флагом — код языка, как на вики: по одному флагу не всегда
       понятно, какой язык включён. */
    button.innerHTML = languageFlag(selected[1], false) +
      '<span class="language-code">' + selected[0].toUpperCase() + '</span>' +
      '<svg class="language-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"></path></svg>' +
      '<span class="visually-hidden">' + selected[2] + '</span>';
    button.setAttribute('aria-label', 'Язык: ' + selected[2] + '. Выбрать другой');
    menu.innerHTML = languages.map(function (item) {
      return '<button class="language-option" type="button" role="menuitem" data-language="' + item[0] +
        '" aria-current="' + (item[0] === current ? 'true' : 'false') + '">' +
        languageFlag(item[1], true) + '<span>' + item[2] + '</span></button>';
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

  var navHome = document.getElementById('navHome');
  if (navHome) navHome.onclick = function () {
    if (state.phase === 'exam') return;
    state.phase = 'welcome';
    show();
  };

  /* Нижнее мобильное меню всегда остаётся доступным. При прокрутке меняется
     только состояние закреплённой верхней веб-навигации. */
  (function watchScroll() {
    var ticking = false;
    document.documentElement.classList.remove('nav-hidden');
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY;
        document.documentElement.classList.toggle('nav-scrolled', y > 16);
        document.documentElement.classList.remove('nav-hidden');
        ticking = false;
      });
    }, { passive: true });
  })();

  /* Как в эталонной plaque: ни одна ячейка не закрашена постоянно.
     Кроме hover, видимые клетки по очереди появляются и снова исчезают. */
  (function animateBlueprintCells() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    window.setInterval(function () {
      var cells = [].slice.call(document.querySelectorAll(
        '.blueprint-layer .blueprint-cell'
      )).filter(function (cell) {
        return cell.offsetParent !== null && !cell.matches(':hover') &&
          !cell.classList.contains('is-lit');
      });
      var cell = cells[Math.floor(Math.random() * cells.length)];
      if (!cell) return;
      cell.classList.add('is-lit');
      window.setTimeout(function () { cell.classList.remove('is-lit'); }, 1000);
    }, 760);
  })();

  /* Аят в шапке: начинаем с «аята дня» (по номеру дня в году), дальше
     меняем по кругу. Высота блока задана в CSS, поэтому смена текста
     не двигает шапку. */
  function startAyahs() {
    var host = document.getElementById('ayah');
    var textNode = document.getElementById('ayahText');
    var refNode = document.getElementById('ayahRef');
    if (!host || !textNode || !refNode) return;

    var start = new Date(new Date().getFullYear(), 0, 0);
    var dayOfYear = Math.floor((Date.now() - start.getTime()) / 86400000);
    var idx = ((dayOfYear % AYAHS.length) + AYAHS.length) % AYAHS.length;
    var calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function paint() {
      var ayah = AYAHS[idx];
      textNode.textContent = ayah.text;
      refNode.textContent = ayah.ref;
    }

    paint();
    host.hidden = false;

    if (AYAHS.length < 2) return;
    setInterval(function () {
      /* Во время экзамена шапка скрыта — не тратим кадры на невидимое. */
      if (state.phase === 'exam' || document.hidden) return;
      idx = (idx + 1) % AYAHS.length;
      if (calm) return paint();
      host.classList.remove('is-swap-in');
      host.classList.add('is-swap-out');
      setTimeout(function () {
        paint();
        host.classList.remove('is-swap-out');
        /* Принудительный пересчёт: без него браузер склеивает снятие и
           навешивание класса в один кадр, и вход не проигрывается. */
        void host.offsetWidth;
        host.classList.add('is-swap-in');
      }, 950);
    }, 25000);
  }

  watchIntegrity();
  startAyahs();
  restore();
  hit();
  var hashResult = location.hash.match(/^#r=([0-9a-f-]{36})$/i);
  var hashStudent = location.hash.match(/^#student=([0-9a-f-]{36})$/i);
  var hashYandex = location.hash.match(/^#yandex=([0-9a-f-]{36})(?:&saved=([0-9a-f-]{36}))?$/i);
  var hashYandexError = location.hash.match(/^#yandex-error=/i);
  var hashSection = location.hash.match(/^#(lessons|profile|exam)(?:\/(me|lessons|settings|results|classes))?$/i);
  var hashJoin = location.hash.match(/^#join=([A-Za-z0-9]{4,16})$/);
  if (hashYandex && state.phase !== 'exam') {
    /* Вернулись с oauth.yandex.ru: токен кабинета уже выдан сервером */
    try {
      localStorage.setItem(STUDENT_KEY, hashYandex[1]);
      localStorage.removeItem(GUEST_KEY);
    } catch (e) { /* ок */ }
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    showStudentCabinet(hashYandex[1]);
  } else if (hashYandexError && state.phase !== 'exam') {
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    var failedResult = '';
    try { failedResult = localStorage.getItem('tajweed_last_result') || ''; } catch (e) { /* ок */ }
    if (failedResult && guestToken()) showSavedResult(failedResult);
    else showLogin('Не получилось войти через Яндекс. Попробуйте ещё раз или войдите по номеру и паролю.');
  } else if (hashJoin && state.phase !== 'exam') {
    joinClass(hashJoin[1].toUpperCase());
  } else if (hashStudent && state.phase !== 'exam') {
    showStudentCabinet(hashStudent[1]);
  } else if (hashResult && state.phase !== 'exam') {
    showSavedResult(hashResult[1]);
  } else if (hashSection && state.phase !== 'exam' && state.phase !== 'done') {
    if (hashSection[1].toLowerCase() === 'lessons') state.phase = studentToken() ? 'lessons' : 'lead';
    if (hashSection[1].toLowerCase() === 'profile') {
      state.phase = 'profile';
      if (hashSection[2]) {
        profileTab = hashSection[2].toLowerCase();
        if (profileTab === 'lessons') {
          state.phase = studentToken() ? 'lessons' : 'lead';
          profileTab = 'me';
        }
      }
    }
    if (hashSection[1].toLowerCase() === 'exam') {
      state.phase = 'exams';
    }
    show();
  } else {
    show();
  }
})();
