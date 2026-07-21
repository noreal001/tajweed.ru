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
  var QUESTION_TIME = 180; // секунд на вопрос
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

  /* Лестница уровней. Открыт только первый. Темы закрытых уровней НЕ
     показываем: программу составляет преподаватель, обещать нечего. */
  var LEVELS = [
    { n: 1, title: 'Первый уровень', topic: 'Буквы и их названия, огласовки, сифаты, чтение вслух', open: true },
    { n: 2, open: false },
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

  /* best: { percent, points, max, id } либо null, если экзамен ещё не сдан. */
  function levelLadder(best) {
    var locked = LEVELS.filter(function (lv) { return !lv.open; });
    var html = '<ol class="levels">';
    LEVELS.forEach(function (lv) {
      if (!lv.open) return; // закрытые собираем отдельной полосой ниже
      if (!best) {
        html += '<li class="level is-open is-empty">' +
          '<div class="level-head"><span class="level-n">Уровень ' + lv.n + '</span>' +
          '<span class="level-lock is-ready">доступен</span></div>' +
          '<p class="level-topic">' + esc(lv.topic) + '</p>' +
          '<p class="level-hint">Экзамен ещё не сдан</p>' +
        '</li>';
        return;
      }
      var pct = Math.round(best.percent);
      html += '<li class="level is-open is-scored" style="--score-color: ' + scoreColor(pct) + '">' +
        '<div class="level-head"><span class="level-n">Уровень ' + lv.n + '</span>' +
        '<span class="level-verdict">' + scoreVerdict(pct) + '</span></div>' +
        '<p class="level-topic">' + esc(lv.topic) + '</p>' +
        '<div class="level-score"><span class="level-percent">' + pct + '<i>%</i></span>' +
          '<span class="level-points">' + esc(best.points) + ' из ' + esc(best.max) + ' баллов письменной части</span></div>' +
        '<div class="level-bar"><span style="width: ' + pct + '%"></span></div>' +

      '</li>';
    });
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

  /* ── Состояние ─────────────────────────────────────────── */

  var steps = buildSteps();
  var state = {
    phase: 'welcome', // welcome | lead | leadDone | reg | exam | done
    stepIdx: 0,
    student: null,
    startedAt: null,
    submissionId: null,
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
          state.phase = state.resumable && state.student ? 'exam' : 'reg';
          save();
          show();
        },
        on: function () { return state.phase === 'reg' || state.phase === 'exam'; } },
      { id: 'lead', label: 'Уроки', act: function () { state.phase = 'lead'; show(); },
        on: function () { return state.phase === 'lead' || state.phase === 'leadDone'; } },
      { id: 'profile', label: 'Профиль',
        act: function () { state.phase = 'profile'; show(); },
        on: function () { return state.phase === 'profile'; } }
    ];
  }

  /* ── Профиль ───────────────────────────────────────────── */

  function studentToken() {
    try { return localStorage.getItem(STUDENT_KEY) || ''; } catch (e) { return ''; }
  }

  function themeRow() {
    var isLight = document.documentElement.getAttribute('data-theme') === 'light';
    return '<button class="setting-row" id="profileTheme" type="button" aria-pressed="' + (isLight ? 'true' : 'false') + '">' +
      '<span><b>Оформление</b><small>Тёмное или светлое</small></span>' +
      '<span class="setting-value"><span class="theme-dial" aria-hidden="true"></span>' +
        (isLight ? 'Светлое' : 'Тёмное') + '</span></button>';
  }

  function wireThemeRow() {
    var row = document.getElementById('profileTheme');
    if (!row) return;
    row.onclick = function () {
      applyTheme(currentTheme() === 'light' ? 'dark' : 'light');
      showProfile();
    };
  }

  function showProfile() {
    if (state.phase === 'exam') return;
    state.phase = 'profile';
    paintNav();
    var token = studentToken();
    setBar('Профиль');
    if (!token) return showLogin();

    loadingScreen('Профиль', 'Загружаем ваши данные…');
    var seq = screenToken();
    apiGet('/api/student/' + encodeURIComponent(token)).then(function (d) {
      if (isStale(seq)) return;
      if (!d.ok) throw new Error('нет данных');
      var s = d.student;
      var results = d.results || [];
      var best = null;
      results.forEach(function (r) { if (!best || r.percent > best.percent) best = r; });

      var html = '<h1>Профиль</h1>' +
        '<section class="frame profile-card">' +
          '<p class="kicker">Ученик<span class="cur">_</span></p>' +
          '<p class="profile-name">' + esc(s.lastName) + ' ' + esc(s.firstName) + '</p>' +
          '<dl class="profile-meta">' +
            '<div><dt>Город</dt><dd>' + esc(s.city) + '</dd></div>' +
            '<div><dt>Телефон</dt><dd>' + esc(formatPhone(s.phone)) + '</dd></div>' +
            '<div><dt>Экзаменов сдано</dt><dd>' + results.length + '</dd></div>' +
          '</dl>' +
        '</section>';

      html += '<h2 class="kicker">Уровень<span class="cur">_</span></h2>' + levelLadder(best);

      html += '<h2 class="kicker">Настройки<span class="cur">_</span></h2><div class="settings">' + themeRow() +
        (s.hasPassword
          ? '<button class="setting-row" id="changePass" type="button">' +
              '<span><b>Пароль</b><small>Вход с другого телефона</small></span>' +
              '<span class="setting-value">Изменить</span></button>'
          : '<button class="setting-row" id="setPass" type="button">' +
              '<span><b>Пароль не задан</b><small>Задайте, чтобы войти с другого устройства</small></span>' +
              '<span class="setting-value">Задать</span></button>') +
        '<button class="setting-row" id="logout" type="button">' +
          '<span><b>Выйти</b><small>Данные останутся у преподавателя</small></span>' +
          '<span class="setting-value">Выйти</span></button>' +
      '</div>';

      html += '<div class="btn-row">' +
        (best ? '<button class="btn" data-open-result="' + esc(best.id) + '">Разбор и отчёт</button>' : '') +
        '<button class="btn' + (best ? ' is-ghost' : '') + '" id="againBtn">' +
          (best ? 'Пройти ещё раз' : 'Сдать экзамен') + '</button></div>';

      render(html);
      wireThemeRow();
      [].slice.call(app.querySelectorAll('[data-open-result]')).forEach(function (b) {
        b.onclick = function () { showSavedResult(b.getAttribute('data-open-result'), token); };
      });
      document.getElementById('againBtn').onclick = function () { state.phase = 'reg'; show(); };
      var pass = document.getElementById('setPass') || document.getElementById('changePass');
      if (pass) pass.onclick = function () { showSetPassword(token, s.hasPassword); };
      document.getElementById('logout').onclick = function () {
        if (!window.confirm('Выйти из профиля на этом устройстве?')) return;
        try { localStorage.removeItem(STUDENT_KEY); localStorage.removeItem('tajweed_last_result'); } catch (e) { /* ок */ }
        state.phase = 'welcome';
        show();
      };
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
    setBar('Вход в профиль');
    render(
      '<h1>Вход в профиль</h1>' +
      '<p class="lede">Профиль появляется после первого экзамена. Если вы уже сдавали с другого телефона — войдите по номеру и паролю.</p>' +
      '<form class="form" id="loginForm" novalidate>' +
        '<div class="field" data-f="phone"><label for="lPhone">Телефон</label>' +
          '<input id="lPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00" maxlength="20">' +
          '<span class="err" data-msg="Введите номер целиком" role="alert"></span></div>' +
        '<div class="field" data-f="password"><label for="lPass">Пароль</label>' +
          '<input id="lPass" name="password" type="password" autocomplete="current-password" maxlength="200">' +
          '<span class="err" data-msg="Введите пароль" role="alert"></span></div>' +
        '<p class="notice" id="loginErr" role="status" aria-live="polite" hidden></p>' +
        '<div class="btn-row"><button class="btn btn-block" type="submit">Войти</button></div>' +
      '</form>' +
      '<div class="btn-row" id="yandexRow" hidden>' +
        '<button class="btn is-ghost btn-block" id="yandexBtn" type="button">Войти через Яндекс</button></div>' +
      '<div class="btn-row"><button class="btn is-ghost btn-block" id="toExam">Сдать экзамен и завести профиль</button></div>' +
      '<h2 class="kicker">Настройки<span class="cur">_</span></h2><div class="settings">' + themeRow() + '</div>'
    );
    wireThemeRow();
    document.getElementById('toExam').onclick = function () { state.phase = 'reg'; show(); };

    if (startupError) {
      var startErr = document.getElementById('loginErr');
      startErr.hidden = false;
      startErr.classList.add('is-error');
      startErr.textContent = startupError;
    }

    /* Кнопка Яндекса появляется, только если вход настроен на сервере */
    apiGet('/api/auth/yandex/enabled').then(function (d) {
      if (!d || !d.enabled) return;
      var row = document.getElementById('yandexRow');
      var btn = document.getElementById('yandexBtn');
      if (!row || !btn) return;
      row.hidden = false;
      btn.onclick = function () { location.href = API + '/api/auth/yandex/start'; };
    }).catch(function () { /* нет сети — вход по паролю остаётся */ });

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
            ? 'Неверный номер или пароль. Кабинет появляется после первого экзамена — если вы ещё не сдавали, нажмите «Сдать экзамен и завести профиль» ниже.'
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
    document.documentElement.classList.toggle('has-tabbar', !isExam);

    var items = navItems();
    [document.getElementById('tabbar'), document.getElementById('sitenavTabs')].forEach(function (host) {
      if (!host) return;
      host.replaceChildren();
      items.forEach(function (item) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'tab' + (item.on() ? ' is-on' : '');
        b.textContent = item.label;
        if (item.on()) b.setAttribute('aria-current', 'page');
        b.onclick = function () {
          if (state.phase === 'exam') return;
          item.act();
        };
        host.appendChild(b);
      });
    });
  }

  function show() {
    hideTimer();
    screenToken();
    paintNav();
    if (state.phase === 'welcome') return showWelcome();
    if (state.phase === 'lead') return showLead();
    if (state.phase === 'leadDone') return showLeadDone();
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

    /* Главная — как баннер прайса: сетка одинаковых квадратов,
       штриховка сверху, заголовок, кикер, одна вдавленная кнопка.
       Ничего лишнего: уроки и кабинет живут в меню. */
    render(
      '<section class="welcome-hero" aria-labelledby="welcomeTitle">' +
        '<span class="hero-hatch" aria-hidden="true"></span>' +
        marks('is-out') +
        '<h1 id="welcomeTitle">Экзамен по <em>таджвиду</em></h1>' +
        '<p class="kicker is-under">' +
          (draft ? 'Экзамен начат · шаг ' + doneCount + ' из ' + steps.length
                 : 'Наука чтения Корана · Первый уровень') +
          '<span class="cur">_</span></p>' +
        '<div class="hero-actions"><button class="btn" id="heroExam">' +
          (draft ? 'Продолжить экзамен →' : 'Сдать экзамен →') + '</button></div>' +
        '<div class="hero-meta">' +
          '<span class="crosshair" aria-hidden="true"></span>' +
          '<span>ТАДЖВИД.РФ // 2026<br>ПРЕПОДАВАТЕЛЬ ДЕАБ АНАС Т. ' +
            '<span class="flag" role="img" aria-label="Палестина">🇵🇸</span></span>' +
        '</div>' +
      '</section>' +
      '<section class="levels-teaser" aria-labelledby="levelsTitle">' +
        '<p class="kicker" id="levelsTitle">Уровни программы<span class="cur">_</span></p>' +
        levelLadder(null) +
        (studentTok || lastId
          ? '<div class="btn-row"><button class="btn is-pill" id="goSaved">' +
            (studentTok ? 'Мой кабинет →' : 'Мой результат →') + '</button></div>'
          : '') +
      '</section>' +
      '<section class="cta-banner" aria-labelledby="ctaTitle">' +
        '<span class="hero-hatch" aria-hidden="true"></span>' +
        marks('is-out') +
        '<h2 id="ctaTitle">' + (draft ? 'Вернуться к экзамену' : 'Проверьте себя') + '</h2>' +
        '<p class="kicker is-under">' +
          (draft ? 'Ответы сохранены на этом устройстве'
                 : '51 вопрос и чтение вслух · до 3 минут на вопрос') +
          '<span class="cur">_</span></p>' +
        '<div class="hero-actions"><button class="btn" id="ctaExam">' +
          (draft ? 'Продолжить →' : 'Сдать экзамен →') + '</button>' +
          (draft ? '<button class="btn is-pill" id="startOver">Начать заново</button>' : '') +
        '</div>' +
      '</section>'
    );
    var startExam = function () { state.phase = 'reg'; show(); };
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
  }

  function showStudentCabinet(token) {
    setBar('Личный кабинет');
    loadingScreen('Личный кабинет', 'Загружаем историю экзаменов…');
    var seq = screenToken();
    apiGet('/api/student/' + encodeURIComponent(token)).then(function (d) {
      if (isStale(seq)) return; // пользователь уже ушёл на другой экран
      if (!d.ok) throw new Error('нет данных');
      try { localStorage.setItem(STUDENT_KEY, token); } catch (e) { /* ок */ }
      if (history.replaceState) history.replaceState(null, '', '#student=' + token);
      var s = d.student;
      var results = d.results || [];
      // лучший результат определяет свечение уровня
      var best = null;
      results.forEach(function (r) {
        if (!best || r.percent > best.percent) best = r;
      });

      var html = '<h1>Личный кабинет</h1>' +
        '<p class="lede">' + esc(s.lastName) + ' ' + esc(s.firstName) + ' · ' + esc(s.city) + '</p>';

      html += levelLadder(best);

      if (results.length > 1) {
        html += '<hr class="rule"><h2 class="kicker">Все попытки</h2><div class="result-list">';
        results.forEach(function (r) {
          html += '<button class="result-item" data-result-id="' + esc(r.id) + '">' +
            '<span><b>Экзамен первого уровня</b><br><span class="meta">' +
            esc(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(r.createdAt))) +
            ' · ' + (r.hasAudio ? 'чтение записано' : 'без аудиозаписи') + '</span></span>' +
            '<span class="score" style="color: ' + scoreColor(r.percent, 62) + '">' + Math.round(r.percent) + '%</span></button>';
        });
        html += '</div>';
      }

      html += '<div class="btn-row">' +
        (best ? '<button class="btn" data-open-result="' + esc(best.id) + '">Разбор и отчёт</button>' : '') +
        '<button class="btn' + (best ? ' is-ghost' : '') + '" id="newExamBtn">' +
          (best ? 'Пройти ещё раз' : 'Сдать экзамен первого уровня') + '</button>' +
        '<button class="btn is-ghost" id="homeBtn">На главную</button></div>';
      render(html);
      [].slice.call(app.querySelectorAll('[data-result-id], [data-open-result]')).forEach(function (b) {
        b.onclick = function () {
          showSavedResult(b.getAttribute('data-result-id') || b.getAttribute('data-open-result'), token);
        };
      });
      document.getElementById('newExamBtn').onclick = function () { state.phase = 'reg'; show(); };
      document.getElementById('homeBtn').onclick = function () {
        if (history.replaceState) history.replaceState(null, '', location.pathname);
        state.phase = 'welcome';
        show();
      };
    }).catch(function () {
      if (isStale(seq)) return;
      errorScreen('Кабинет недоступен',
        'Не удалось загрузить историю. Проверьте интернет и попробуйте ещё раз.',
        function () { showStudentCabinet(token); });
    });
  }

  function showSavedResult(id, cabinetToken) {
    setBar('Мой результат');
    loadingScreen('Результат экзамена', 'Загружаем результат…');
    var seq = screenToken();
    apiGet('/api/result/' + encodeURIComponent(id))
      .then(function (d) {
        if (isStale(seq)) return;
        if (!d.ok) throw new Error('нет данных');
        var res = d.result;
        var pct = Math.round(res.percent);
        var html = '<h1>Результат экзамена</h1>' +
          '<p class="lede">' + esc(res.lastName) + ' ' + esc(res.firstName) + ' (' + esc(res.city) + ') · ' +
            new Date(res.createdAt).toLocaleString('ru-RU') + '</p>' +
          '<div class="score-hero is-scored frame" style="--score-color: ' + scoreColor(pct) + '">' +
            '<div class="score-percent">' + pct + '<i>%</i></div>' +
            '<p class="score-caption">Первый уровень · ' + scoreVerdict(pct) + '</p>' +
            '<div class="level-bar"><span style="width: ' + pct + '%"></span></div>' +
            '<p class="score-points">Письменная часть: ' + esc(res.points) + ' из ' + esc(res.max) + ' баллов</p>' +
          '</div>';
        if (res.breakdown && res.breakdown.length) {
          html += '<div class="breakdown">';
          res.breakdown.forEach(function (b) {
            html += '<div class="breakdown-row"><span>' + esc(b.label) + '</span>' +
              '<span class="pts">' + esc(b.points) + ' / ' + esc(b.max) + '</span></div>';
          });
          html += '<div class="breakdown-row is-muted"><span>Устное чтение и диктант</span><span class="pts">оценит преподаватель</span></div>';
          html += '</div>';
        }
        html += '<hr class="rule"><h2 class="kicker">Отчёт для преподавателя</h2>' +
          '<p class="lede">Отчёт уже у преподавателя. Эти кнопки нужны, если хотите сохранить копию себе или переслать её сами.</p>' +
          reportButtonsHtml();
        html += (cabinetToken ? '' : '<p class="notice">Сохраните адрес этой страницы — по нему результат откроется снова.</p>') +
          '<div class="btn-row"><button class="btn is-ghost" id="homeBtn">' +
          (cabinetToken ? '← В кабинет' : '← На главную') + '</button></div>';
        render(html);
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
      var id = 'day' + index;
      return '<label class="day-option" for="' + id + '">' +
        '<input id="' + id + '" name="scheduleDays" type="checkbox" value="' + day.value + '">' +
        '<span class="day-face"><span class="day-short" aria-hidden="true">' + day.short + '</span>' +
        '<span class="day-full">' + day.full + '</span></span></label>';
    }).join('');
    return '<fieldset class="schedule-picker" data-schedule aria-describedby="daysHint errScheduleDays">' +
      '<legend>Когда удобно заниматься?</legend>' +
      '<p class="field-hint" id="daysHint">Выберите один или несколько дней.</p>' +
      '<div class="day-strip">' + days + '</div>' +
      '<span class="err" id="errScheduleDays" data-msg="Выберите хотя бы один день" role="alert"></span>' +
      '<div class="time-window">' +
        '<div class="time-heading"><span>Диапазон времени</span>' +
          '<strong id="scheduleSummary">10:00—20:00</strong></div>' +
        '<div class="time-slider"><label for="timeFrom">Не раньше</label>' +
          '<output id="timeFromOutput" for="timeFrom">10:00</output>' +
          '<input id="timeFrom" name="timeFromMinutes" type="range" min="360" max="1380" step="30" value="600" autocomplete="off"></div>' +
        '<div class="time-slider"><label for="timeTo">Не позже</label>' +
          '<output id="timeToOutput" for="timeTo">20:00</output>' +
          '<input id="timeTo" name="timeToMinutes" type="range" min="360" max="1380" step="30" value="1200" autocomplete="off"></div>' +
        '<div class="time-scale" aria-hidden="true"><span>06:00</span><span>день</span><span>23:00</span></div>' +
        '<input id="timeZone" name="timeZone" type="hidden" value="Europe/Moscow">' +
        '<button class="sound-toggle" id="scheduleSound" type="button" aria-pressed="false">' +
          '<span><b>Звук ползунка</b><small>Тихий отклик при смене времени</small></span>' +
          '<span class="sound-switch" aria-hidden="true"><span></span></span>' +
        '</button>' +
      '</div>' +
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
      render(
        '<section class="wizard">' +
          scale() +
          '<p class="kicker">Шаг ' + (idx + 1) + ' из ' + total + '<span class="cur">_</span></p>' +
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
          '<div class="btn-row wizard-back">' +
            '<button class="btn is-quiet" id="wBack">' + (idx === 0 ? '← Назад на главную' : '← Предыдущий шаг') + '</button>' +
          '</div>' +
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
      document.getElementById('wBack').onclick = function () {
        if (idx === 0) { state.phase = 'welcome'; return show(); }
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

  function personForm(submitLabel, includeSchedule) {
    return '<form class="form" id="personForm" method="post" action="' + (includeSchedule ? esc(API + '/apply') : '') + '" novalidate>' +
      '<div class="field" data-f="firstName"><label for="fFirst">Имя</label>' +
        '<input id="fFirst" name="firstName" autocomplete="given-name" maxlength="60" aria-describedby="errFirst" required>' +
        '<span class="err" id="errFirst" data-msg="Укажите имя" role="alert"></span></div>' +
      '<div class="field" data-f="lastName"><label for="fLast">Фамилия</label>' +
        '<input id="fLast" name="lastName" autocomplete="family-name" maxlength="60" aria-describedby="errLast" required>' +
        '<span class="err" id="errLast" data-msg="Укажите фамилию" role="alert"></span></div>' +
      '<div class="field" data-f="city"><label for="fCity">Город</label>' +
        '<input id="fCity" name="city" autocomplete="address-level2" maxlength="60" aria-describedby="errCity" required>' +
        '<span class="err" id="errCity" data-msg="Укажите город" role="alert"></span></div>' +
      '<div class="field" data-f="phone"><label for="fPhone">Телефон</label>' +
        '<input id="fPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00…" maxlength="20" aria-describedby="errPhone" required>' +
        '<span class="err" id="errPhone" data-msg="Укажите телефон полностью" role="alert"></span></div>' +
      (includeSchedule ? '<input name="requestId" type="hidden" value="">' + scheduleFields() : '') +
      '<div class="btn-row"><button type="submit" class="btn btn-block">' + submitLabel + '</button></div>' +
    '</form>';
  }

  function readPersonForm(form) {
    var data = {
      firstName: form.firstName.value.trim(),
      lastName: form.lastName.value.trim(),
      city: form.city.value.trim(),
      phone: form.phone.value.trim()
    };
    var ok = true;
    var firstInvalid = null;
    ['firstName', 'lastName', 'city', 'phone'].forEach(function (f) {
      var field = form.querySelector('[data-f="' + f + '"]');
      var bad = !data[f] || (f === 'phone' && data[f].replace(/\D/g, '').length < 10);
      markInvalid(field, bad);
      field.querySelector('input').setAttribute('aria-invalid', bad ? 'true' : 'false');
      if (bad) { ok = false; if (!firstInvalid) firstInvalid = field.querySelector('input'); }
    });
    var schedule = form.querySelector('[data-schedule]');
    if (schedule) {
      var selectedDays = [].slice.call(form.querySelectorAll('[name="scheduleDays"]:checked')).map(function (input) {
        return input.value;
      });
      var daysBad = selectedDays.length === 0;
      markInvalid(schedule, daysBad);
      if (daysBad) {
        ok = false;
        if (!firstInvalid) firstInvalid = form.querySelector('[name="scheduleDays"]');
      }
      var startMinute = Number(form.timeFromMinutes.value);
      var endMinute = Number(form.timeToMinutes.value);
      if (startMinute >= endMinute) {
        ok = false;
        markInvalid(schedule, true);
        var slot = schedule.querySelector('.err');
        if (slot) slot.textContent = 'Время «не раньше» должно быть меньше, чем «не позже»';
        if (!firstInvalid) firstInvalid = form.timeFromMinutes;
      }
      data.requestId = form.requestId.value || form.getAttribute('data-request-id') || uuid();
      data.availability = {
        version: 1,
        days: selectedDays,
        startMinute: startMinute,
        endMinute: endMinute,
        timeZone: form.timeZone.value || 'Europe/Moscow'
      };
    }
    if (firstInvalid) firstInvalid.focus();
    return ok ? data : null;
  }

  function playScheduleTick(enabled, value) {
    if (!enabled) return;
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    try {
      if (!scheduleAudioContext) scheduleAudioContext = new AudioCtor();
      if (scheduleAudioContext.state === 'suspended') scheduleAudioContext.resume();
      var now = scheduleAudioContext.currentTime;
      var oscillator = scheduleAudioContext.createOscillator();
      var gain = scheduleAudioContext.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = 520 + ((Math.round(Number(value) / 30) % 8) * 12);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      oscillator.connect(gain);
      gain.connect(scheduleAudioContext.destination);
      oscillator.start(now);
      oscillator.stop(now + 0.04);
    } catch (e) { /* звук — необязательное улучшение */ }
  }

  function initSchedule(form) {
    var picker = form.querySelector('[data-schedule]');
    if (!picker) return;
    var from = form.timeFromMinutes;
    var to = form.timeToMinutes;
    var fromOutput = document.getElementById('timeFromOutput');
    var toOutput = document.getElementById('timeToOutput');
    var summary = document.getElementById('scheduleSummary');
    var soundButton = document.getElementById('scheduleSound');
    var soundEnabled = false;
    var lastTickAt = 0;
    try { soundEnabled = localStorage.getItem('tajweed_schedule_sound') === 'on'; } catch (e) { /* ок */ }
    try { form.timeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow'; } catch (e) { /* ок */ }

    function updateSoundButton() {
      soundButton.setAttribute('aria-pressed', soundEnabled ? 'true' : 'false');
    }

    function updateSummary() {
      var labels = [].slice.call(form.querySelectorAll('[name="scheduleDays"]:checked')).map(function (input) {
        var day = WEEK_DAYS.filter(function (item) { return item.value === input.value; })[0];
        return day ? day.short : input.value;
      });
      var range = fmtMinutes(from.value) + '—' + fmtMinutes(to.value);
      fromOutput.textContent = fmtMinutes(from.value);
      toOutput.textContent = fmtMinutes(to.value);
      from.setAttribute('aria-valuetext', 'Не раньше ' + fmtMinutes(from.value));
      to.setAttribute('aria-valuetext', 'Не позже ' + fmtMinutes(to.value));
      summary.textContent = (labels.length ? labels.join(', ') + ' · ' : '') + range;
      if (labels.length) markInvalid(picker, false);
    }

    function onRangeInput(changed) {
      if (changed === from && Number(from.value) > Number(to.value) - 60) {
        from.value = Math.max(Number(from.min), Number(to.value) - 60);
      }
      if (changed === to && Number(to.value) < Number(from.value) + 60) {
        to.value = Math.min(Number(to.max), Number(from.value) + 60);
      }
      updateSummary();
      var now = Date.now();
      if (now - lastTickAt >= 45) {
        lastTickAt = now;
        playScheduleTick(soundEnabled, changed.value);
      }
    }

    [].slice.call(form.querySelectorAll('[name="scheduleDays"]')).forEach(function (input) {
      input.addEventListener('change', updateSummary);
    });
    from.addEventListener('input', function () { onRangeInput(from); });
    to.addEventListener('input', function () { onRangeInput(to); });
    soundButton.addEventListener('click', function () {
      soundEnabled = !soundEnabled;
      try { localStorage.setItem('tajweed_schedule_sound', soundEnabled ? 'on' : 'off'); } catch (e) { /* ок */ }
      updateSoundButton();
      if (soundEnabled) playScheduleTick(true, from.value);
    });
    updateSoundButton();
    updateSummary();
  }

  function showLead() {
    setBar('Запись на уроки');
    render(
      '<h1>Запись на уроки</h1>' +
      '<p class="lede">Оставьте контакты и отметьте удобное время — преподаватель свяжется с вами и подберёт группу.</p>' +
      '<p class="notice">Имя, город, телефон и выбранное время получит преподаватель Деаб Анас Т. Больше никуда данные не уходят.</p>' +
      personForm('Отправить заявку', true) +
      '<p class="notice" id="leadErr" role="status" aria-live="polite" hidden></p>' +
      '<div class="btn-row"><button class="btn is-ghost" id="backBtn">← Назад</button></div>'
    );
    document.getElementById('backBtn').onclick = function () { state.phase = 'welcome'; show(); };
    var form = document.getElementById('personForm');
    var requestId = '';
    try {
      requestId = localStorage.getItem('tajweed_lead_request_id') || uuid();
      localStorage.setItem('tajweed_lead_request_id', requestId);
    } catch (e) { requestId = uuid(); }
    form.setAttribute('data-request-id', requestId);
    form.requestId.value = requestId;
    initSchedule(form);
    form.onsubmit = function (e) {
      e.preventDefault();
      var previousError = document.getElementById('leadErr');
      previousError.hidden = true;
      previousError.textContent = '';
      var data = readPersonForm(form);
      if (!data) return;
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Отправляем…';
      api('/api/lead', data).then(function () {
        try { localStorage.removeItem('tajweed_lead_request_id'); } catch (e) { /* ок */ }
        state.phase = 'leadDone';
        show();
      }).catch(function (error) {
        btn.disabled = false;
        var err = document.getElementById('leadErr');
        err.hidden = false;
        err.classList.add('is-error');
        if (error && error.status === 409) {
          var nextRequestId = uuid();
          form.requestId.value = nextRequestId;
          form.setAttribute('data-request-id', nextRequestId);
          try { localStorage.setItem('tajweed_lead_request_id', nextRequestId); } catch (e) { /* ок */ }
          btn.textContent = 'Отправить обновлённую заявку';
          err.textContent = 'Первая версия заявки уже сохранена. Вы изменили данные после отправки; проверьте их и нажмите кнопку ещё раз, чтобы отправить обновлённую заявку отдельно.';
        } else {
          btn.textContent = 'Отправить заявку';
          err.textContent = 'Не получилось отправить заявку. Проверьте интернет и попробуйте ещё раз, либо напишите преподавателю напрямую.';
        }
      });
    };
  }

  function showLeadDone() {
    setBar(null);
    render(
      '<h1>Заявка отправлена</h1>' +
      '<p class="lede">Спасибо! Преподаватель свяжется с вами в ближайшее время.</p>' +
      '<div class="btn-row"><button class="btn is-ghost" id="homeBtn">← На главную</button></div>'
    );
    document.getElementById('homeBtn').onclick = function () { state.phase = 'welcome'; show(); };
  }

  function showReg() {
    setBar('Анкета перед экзаменом');
    personWizard({
      finishLabel: 'Начать экзамен',
      isExam: true,
      onDone: function (data) {
        render('<h1>Открываем кабинет…</h1><p class="lede">Секунду, готовим экзамен.</p>');

      function startExam() {
        state.student = data;
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

      // кабинет заводим до экзамена: ученик сразу закреплён за своим номером
      var savedToken = '';
      try { savedToken = localStorage.getItem(STUDENT_KEY) || ''; } catch (err) { /* ок */ }
      api('/api/student/register', {
        firstName: data.firstName, lastName: data.lastName,
        city: data.city, phone: data.phone, studentToken: savedToken
      }).then(function (res) {
        if (res && res.studentToken) {
          try { localStorage.setItem(STUDENT_KEY, res.studentToken); } catch (err) { /* ок */ }
        }
      }).catch(function () {
        // без сети кабинет создастся позже, при отправке результата
      }).then(startExam);
      }
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
      return stampWatermark();
    }
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
      // номер строки берём из данных: в бланке они идут с пропусками (1,2,5,7…),
      // а сквозная нумерация <ol> показывала бы ученику и преподавателю разное
      return '<li class="read-row"' + (r.n ? ' value="' + (r.n | 0) + '"' : '') +
        '><p class="ar-line" lang="ar" dir="rtl">' + esc(r.text) + '</p></li>';
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
    var savedStudentToken = '';
    try { savedStudentToken = localStorage.getItem(STUDENT_KEY) || ''; } catch (e) { /* ок */ }
    var payload = {
      submissionId: state.submissionId,
      studentToken: savedStudentToken,
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
    lines.push('ЭКЗАМЕН ПО ТАДЖВИДУ · 1-Й УРОВЕНЬ');
    lines.push('Ученик: ' + res.lastName + ' ' + res.firstName + ' (' + res.city + ')');
    lines.push('Дата: ' + new Date(res.createdAt).toLocaleString('ru-RU'));
    lines.push('');
    lines.push('РЕЗУЛЬТАТ: ' + Math.round(res.percent) + '% — ' + scoreVerdict(res.percent));
    lines.push('Письменная часть: ' + res.points + ' из ' + res.max + ' баллов');
    lines.push('');
    lines.push('ПО ЗАДАНИЯМ:');
    (res.breakdown || []).forEach(function (b) {
      lines.push('  ' + b.label + ': ' + b.points + ' / ' + b.max);
    });
    lines.push('  Устное чтение и диктант: оценит преподаватель' +
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
    lines.push('Ученик: ' + s.lastName + ' ' + s.firstName + ' (' + s.city + ')');
    lines.push('Телефон: ' + s.phone);
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
    html += '<p class="lede">' + esc(s.firstName) + ', спасибо! ';

    if (serverResult && serverResult.id) {
      try { localStorage.setItem('tajweed_last_result', serverResult.id); } catch (e) { /* ок */ }
      if (serverResult.studentToken) {
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
      html += '<p class="lede">Остальные уровни откроются позже — их готовит преподаватель.</p>';
      html += levelLadder({ percent: pct, points: serverResult.points, max: serverResult.max });
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
        code === 429
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

    html += '<hr class="rule">';
    html += '<p class="kicker">Отчёт<span class="cur">_</span></p>';
    html += '<p class="lede">' + (serverResult && serverResult.id
      ? 'Отчёт уже ушёл преподавателю. Кнопки ниже — если хотите сохранить копию себе или переслать её сами.'
      : 'Пока отчёт до преподавателя не дошёл. Сохраните его или перешлите сами — так результат точно не потеряется.') + '</p>';
    html += reportButtonsHtml(audioBlob && (!serverResult || !serverResult.audioUploaded));

    if (serverResult && serverResult.studentToken) {
      html += '<div class="btn-row"><button class="btn" id="cabinetBtn">Открыть личный кабинет</button>' +
        '<button class="btn is-ghost" id="homeBtn">На главную</button></div>';
    } else {
      html += '<div class="btn-row"><button class="btn is-ghost" id="homeBtn">На главную</button></div>';
    }

    render(html);
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

  var navHome = document.getElementById('navHome');
  if (navHome) navHome.onclick = function () {
    if (state.phase === 'exam') return;
    state.phase = 'welcome';
    show();
  };

  /* Плавающее меню прячется при прокрутке вниз и возвращается при прокрутке
     вверх — иначе непрозрачная пилюля закрывает контент на каждом экране. */
  (function watchScroll() {
    var last = 0;
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        var y = window.scrollY;
        var hide = y > last && y > 120;
        document.documentElement.classList.toggle('nav-hidden', hide);
        last = y;
        ticking = false;
      });
    }, { passive: true });
  })();

  watchIntegrity();
  restore();
  hit();
  var hashResult = location.hash.match(/^#r=([0-9a-f-]{36})$/i);
  var hashStudent = location.hash.match(/^#student=([0-9a-f-]{36})$/i);
  var hashYandex = location.hash.match(/^#yandex=([0-9a-f-]{36})$/i);
  var hashYandexError = location.hash.match(/^#yandex-error=/i);
  if (hashYandex && state.phase !== 'exam') {
    /* Вернулись с oauth.yandex.ru: токен кабинета уже выдан сервером */
    try { localStorage.setItem(STUDENT_KEY, hashYandex[1]); } catch (e) { /* ок */ }
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    showStudentCabinet(hashYandex[1]);
  } else if (hashYandexError && state.phase !== 'exam') {
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    showLogin('Не получилось войти через Яндекс. Попробуйте ещё раз или войдите по номеру и паролю.');
  } else if (hashStudent && state.phase !== 'exam') {
    showStudentCabinet(hashStudent[1]);
  } else if (hashResult && state.phase !== 'exam') {
    showSavedResult(hashResult[1]);
  } else {
    show();
  }
})();
