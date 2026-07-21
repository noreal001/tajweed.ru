/* Экзамен по таджвиду · логика одностраничника.
   Экраны рендерятся в #app; ответы копятся локально и уходят на сервер,
   где хранится ключ и считается процент. */

(function () {
  'use strict';

  var CFG = window.TAJWEED_CONFIG || { API_BASE: '', SITE_URL: '' };
  var API = (CFG.API_BASE || '').replace(/\/+$/, '');
  var LS_KEY = 'tajweed_exam_v1';
  var STUDENT_KEY = 'tajweed_student_token';
  var QUESTION_TIME = 180; // секунд на вопрос
  var app = document.getElementById('app');
  var topbar = document.getElementById('topbar');
  var topbarLabel = document.getElementById('topbarLabel');
  var topbarTimer = document.getElementById('topbarTimer');
  var timebar = document.getElementById('timebar');
  var timebarFill = document.getElementById('timebarFill');

  /* ── Состояние ─────────────────────────────────────────── */

  var steps = buildSteps();
  var state = {
    phase: 'welcome', // welcome | lead | leadDone | reg | exam | done
    stepIdx: 0,
    student: null,
    startedAt: null,
    submissionId: null,
    answers: {
      match: {},
      syllables: EXAM.tasks[1].words.map(function () { return null; }),
      sifat: {},
      compose: EXAM.tasks[3].items.map(function () { return ''; }),
      yesno: EXAM.tasks[4].statements.map(function () { return null; }),
      readingRecorded: false
    }
  };

  var audioBlob = null;
  var audioMime = '';
  var timerId = null;
  var deadline = 0;
  var cur = null; // { collect: fn } — сборщик ответа текущего экрана
  var serverResult = null;
  var submitError = null;

  /* ── Утилиты ───────────────────────────────────────────── */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
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

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({
        phase: state.phase,
        stepIdx: state.stepIdx,
        student: state.student,
        startedAt: state.startedAt,
        submissionId: state.submissionId,
        answers: state.answers
      }));
    } catch (e) { /* приватный режим — работаем без сохранения */ }
  }

  function restore() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && (saved.phase === 'exam' || saved.phase === 'done') && saved.student) {
        state.phase = saved.phase;
        state.stepIdx = Math.min(saved.stepIdx || 0, steps.length - 1);
        state.student = saved.student;
        state.startedAt = saved.startedAt;
        state.submissionId = saved.submissionId || uuid();
        if (saved.answers) {
          for (var k in state.answers) {
            if (saved.answers[k] !== undefined) state.answers[k] = saved.answers[k];
          }
        }
        // аудио живёт только в памяти — после перезагрузки записи нет
        state.answers.readingRecorded = false;
      }
    } catch (e) { /* повреждённое сохранение игнорируем */ }
  }

  function api(path, body) {
    if (!API) return Promise.reject(new Error('API не настроен'));
    return fetch(API + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function apiGet(path) {
    if (!API) return Promise.reject(new Error('API не настроен'));
    return fetch(API + path).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
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

  function startTimer(seconds, onExpire) {
    stopTimer();
    deadline = Date.now() + seconds * 1000;
    topbarTimer.hidden = false;
    timebar.hidden = false;
    var total = seconds * 1000;
    timerId = setInterval(function () {
      var left = deadline - Date.now();
      if (left <= 0) {
        stopTimer();
        topbarTimer.textContent = '0:00';
        timebarFill.style.transform = 'scaleX(0)';
        onExpire();
        return;
      }
      var sec = Math.ceil(left / 1000);
      topbarTimer.textContent = fmtTime(sec);
      topbarTimer.classList.toggle('is-low', sec <= 30);
      timebarFill.style.transform = 'scaleX(' + (left / total) + ')';
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
    cur = null;
    app.innerHTML = '<div class="screen">' + html + '</div>';
    window.scrollTo(0, 0);
    var heading = app.querySelector('h1, h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      try { heading.focus({ preventScroll: true }); } catch (e) { heading.focus(); }
    }
  }

  function setBar(label) {
    if (!label) { topbar.hidden = true; return; }
    topbar.hidden = false;
    topbarLabel.textContent = label;
  }

  function show() {
    hideTimer();
    if (state.phase === 'welcome') return showWelcome();
    if (state.phase === 'lead') return showLead();
    if (state.phase === 'leadDone') return showLeadDone();
    if (state.phase === 'reg') return showReg();
    if (state.phase === 'exam') return showStep();
    if (state.phase === 'done') return showDone();
  }

  /* ── Экраны: вход ──────────────────────────────────────── */

  function showWelcome() {
    setBar(null);
    var lastId = '';
    var studentToken = '';
    try {
      lastId = localStorage.getItem('tajweed_last_result') || '';
      studentToken = localStorage.getItem(STUDENT_KEY) || '';
    } catch (e) { /* ок */ }
    render(
      '<h1>Экзамен по таджвиду</h1>' +
      '<p class="lede">Таджвид — наука правильного чтения Корана. Здесь можно сдать экзамен первого уровня или записаться на занятия к преподавателю Деабу Анасу Т.</p>' +
      '<div class="paths">' +
        '<button class="path" id="goExam">' +
          '<span class="path-title">Проверить свой уровень</span>' +
          '<span class="path-desc">Экзамен первого уровня: 51 письменный вопрос и чтение вслух. Около 40 минут.</span>' +
        '</button>' +
        '<button class="path" id="goLead">' +
          '<span class="path-title">Записаться на уроки</span>' +
          '<span class="path-desc">Для новичков. Оставьте контакты, и преподаватель свяжется с вами.</span>' +
        '</button>' +
        (studentToken ? '<button class="path" id="goCabinet">' +
          '<span class="path-title">Личный кабинет</span>' +
          '<span class="path-desc">История экзаменов, баллы и разбор по заданиям.</span>' +
        '</button>' : (lastId ? '<button class="path" id="goResult">' +
          '<span class="path-title">Мой результат</span>' +
          '<span class="path-desc">Посмотреть итог последнего сданного экзамена.</span>' +
        '</button>' : '')) +
      '</div>'
    );
    document.getElementById('goExam').onclick = function () { state.phase = 'reg'; show(); };
    document.getElementById('goLead').onclick = function () { state.phase = 'lead'; show(); };
    var goCabinet = document.getElementById('goCabinet');
    if (goCabinet) goCabinet.onclick = function () { showStudentCabinet(studentToken); };
    var goResult = document.getElementById('goResult');
    if (goResult) goResult.onclick = function () { showSavedResult(lastId); };
  }

  function showStudentCabinet(token) {
    setBar('Личный кабинет');
    render('<h1>Личный кабинет</h1><p class="lede">Загружаем историю экзаменов…</p>');
    apiGet('/api/student/' + encodeURIComponent(token)).then(function (d) {
      if (!d.ok) throw new Error('нет данных');
      try { localStorage.setItem(STUDENT_KEY, token); } catch (e) { /* ок */ }
      if (history.replaceState) history.replaceState(null, '', '#student=' + token);
      var s = d.student;
      var html = '<h1>Личный кабинет</h1>' +
        '<p class="lede">' + esc(s.lastName) + ' ' + esc(s.firstName) + ' · ' + esc(s.city) + '</p>';
      if (!d.results || !d.results.length) {
        html += '<p class="notice">В кабинете пока нет завершённых экзаменов.</p>';
      } else {
        html += '<div class="result-list">';
        d.results.forEach(function (r) {
          html += '<button class="path result-item" data-result-id="' + esc(r.id) + '">' +
            '<span><b>Экзамен первого уровня</b><br><span class="meta">' +
            esc(new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(r.createdAt))) +
            ' · ' + (r.hasAudio ? 'чтение записано' : 'без аудиозаписи') + '</span></span>' +
            '<span class="score">' + Math.round(r.percent) + '%</span></button>';
        });
        html += '</div>';
      }
      html += '<div class="btn-row"><button class="btn" id="newExamBtn">Пройти ещё раз</button>' +
        '<button class="btn is-ghost" id="homeBtn">На главную</button></div>';
      render(html);
      [].slice.call(app.querySelectorAll('[data-result-id]')).forEach(function (b) {
        b.onclick = function () { showSavedResult(b.getAttribute('data-result-id'), token); };
      });
      document.getElementById('newExamBtn').onclick = function () { state.phase = 'reg'; show(); };
      document.getElementById('homeBtn').onclick = function () {
        if (history.replaceState) history.replaceState(null, '', location.pathname);
        state.phase = 'welcome';
        show();
      };
    }).catch(function () {
      render('<h1>Кабинет недоступен</h1>' +
        '<p class="lede">Не удалось загрузить историю. Проверьте интернет и попробуйте ещё раз.</p>' +
        '<div class="btn-row"><button class="btn" id="retryCabinet">Повторить</button>' +
        '<button class="btn is-ghost" id="homeBtn">На главную</button></div>');
      document.getElementById('retryCabinet').onclick = function () { showStudentCabinet(token); };
      document.getElementById('homeBtn').onclick = function () { state.phase = 'welcome'; show(); };
    });
  }

  function showSavedResult(id, cabinetToken) {
    setBar('Мой результат');
    render('<h1>Загружаем результат…</h1>');
    fetch(API + '/api/result/' + encodeURIComponent(id))
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (d) {
        if (!d.ok) throw new Error('нет данных');
        var res = d.result;
        var html = '<h1>Результат экзамена</h1>' +
          '<p class="lede">' + esc(res.lastName) + ' ' + esc(res.firstName) + ' (' + esc(res.city) + ') · ' +
            new Date(res.createdAt).toLocaleString('ru-RU') + '</p>' +
          '<div class="score-hero">' +
            '<div class="score-percent">' + Math.round(res.percent) + '%</div>' +
            '<p class="score-caption">первого уровня по письменной части (' + res.points + ' из ' + res.max + ' баллов)</p>' +
          '</div>';
        if (res.breakdown && res.breakdown.length) {
          html += '<div class="breakdown">';
          res.breakdown.forEach(function (b) {
            html += '<div class="breakdown-row"><span>' + esc(b.label) + '</span>' +
              '<span class="pts">' + b.points + ' / ' + b.max + '</span></div>';
          });
          html += '<div class="breakdown-row is-muted"><span>Устное чтение и диктант</span><span class="pts">оценит преподаватель</span></div>';
          html += '</div>';
        }
        html += '<p class="notice">Сохраните адрес этой страницы — по нему результат откроется снова.</p>' +
          '<div class="btn-row"><button class="btn is-ghost" id="homeBtn">' +
          (cabinetToken ? '← В кабинет' : '← На главную') + '</button></div>';
        render(html);
        document.getElementById('homeBtn').onclick = function () {
          if (history.replaceState) history.replaceState(null, '', location.pathname);
          if (cabinetToken) return showStudentCabinet(cabinetToken);
          state.phase = 'welcome'; show();
        };
      })
      .catch(function () {
        render('<h1>Результат не найден</h1>' +
          '<p class="lede">Ссылка устарела или сервер недоступен. Попробуйте позже.</p>' +
          '<div class="btn-row"><button class="btn is-ghost" id="homeBtn">← На главную</button></div>');
        document.getElementById('homeBtn').onclick = function () {
          if (history.replaceState) history.replaceState(null, '', location.pathname);
          state.phase = 'welcome';
          show();
        };
      });
  }

  function personForm(submitLabel) {
    return '<form class="form" id="personForm" novalidate>' +
      '<div class="field" data-f="firstName"><label for="fFirst">Имя</label>' +
        '<input id="fFirst" name="firstName" autocomplete="given-name" maxlength="60" aria-describedby="errFirst">' +
        '<span class="err" id="errFirst">Укажите имя</span></div>' +
      '<div class="field" data-f="lastName"><label for="fLast">Фамилия</label>' +
        '<input id="fLast" name="lastName" autocomplete="family-name" maxlength="60" aria-describedby="errLast">' +
        '<span class="err" id="errLast">Укажите фамилию</span></div>' +
      '<div class="field" data-f="city"><label for="fCity">Город</label>' +
        '<input id="fCity" name="city" autocomplete="address-level2" maxlength="60" aria-describedby="errCity">' +
        '<span class="err" id="errCity">Укажите город</span></div>' +
      '<div class="field" data-f="phone"><label for="fPhone">Телефон</label>' +
        '<input id="fPhone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="+7 900 000-00-00…" maxlength="20" aria-describedby="errPhone">' +
        '<span class="err" id="errPhone">Укажите телефон полностью</span></div>' +
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
      field.classList.toggle('is-invalid', bad);
      field.querySelector('input').setAttribute('aria-invalid', bad ? 'true' : 'false');
      if (bad) { ok = false; if (!firstInvalid) firstInvalid = field.querySelector('input'); }
    });
    if (firstInvalid) firstInvalid.focus();
    return ok ? data : null;
  }

  function showLead() {
    setBar('Запись на уроки');
    render(
      '<h1>Запись на уроки</h1>' +
      '<p class="lede">Оставьте контакты — преподаватель свяжется с вами и подберёт группу.</p>' +
      personForm('Отправить заявку') +
      '<p class="notice" id="leadErr" hidden></p>' +
      '<div class="btn-row"><button class="btn is-ghost" id="backBtn">← Назад</button></div>'
    );
    document.getElementById('backBtn').onclick = function () { state.phase = 'welcome'; show(); };
    var form = document.getElementById('personForm');
    form.onsubmit = function (e) {
      e.preventDefault();
      var data = readPersonForm(form);
      if (!data) return;
      var btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = 'Отправляем…';
      api('/api/lead', data).then(function () {
        state.phase = 'leadDone';
        show();
      }).catch(function () {
        btn.disabled = false;
        btn.textContent = 'Отправить заявку';
        var err = document.getElementById('leadErr');
        err.hidden = false;
        err.classList.add('is-error');
        err.textContent = 'Не получилось отправить заявку. Проверьте интернет и попробуйте ещё раз, либо напишите преподавателю напрямую.';
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
    render(
      '<h1>Анкета перед экзаменом</h1>' +
      '<p class="lede">Экзамен состоит из шести заданий. Вопросы идут по одному, на каждый даётся 3 минуты, вернуться назад нельзя. Не закрывайте вкладку: ответы сохраняются на этом устройстве.</p>' +
      personForm('Начать экзамен')
    );
    var form = document.getElementById('personForm');
    form.onsubmit = function (e) {
      e.preventDefault();
      var data = readPersonForm(form);
      if (!data) return;
      state.student = data;
      state.startedAt = new Date().toISOString();
      state.submissionId = uuid();
      state.answers = freshAnswers();
      state.phase = 'exam';
      state.stepIdx = 0;
      examFinished = false;
      save();
      show();
    };
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

  function showQuestion(step) {
    var task = step.task;
    setBar(qLabel(step));
    if (task.kind === 'match') renderMatch(task);
    if (task.kind === 'syllables') renderSyllables(task, step.sub);
    if (task.kind === 'sifat') renderSifat(task, step.sub);
    if (task.kind === 'compose') renderCompose(task, step.sub);
    if (task.kind === 'yesno') renderYesno(task, step.sub);
    if (task.kind === 'reading') return renderReading(task);
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
    return '<div class="btn-row"><button class="btn btn-block" id="answerBtn">Ответить</button></div>';
  }

  function bindAnswer() {
    document.getElementById('answerBtn').onclick = function () {
      stopTimer();
      commitAndNext();
    };
  }

  /* Задание 1: соединение */

  function renderMatch(task) {
    var pairs = {}; // form -> name (локально на экране)
    Object.keys(state.answers.match).forEach(function (f) { pairs[f] = state.answers.match[f]; });
    var selForm = null, selName = null;

    var formsHtml = task.forms.map(function (f, i) {
      return '<button type="button" class="opt opt-form" data-v="' + esc(f) + '" aria-pressed="false"><span class="ar">' + esc(f) + '</span><span class="tag"></span></button>';
    }).join('');
    var namesHtml = task.names.map(function (n, i) {
      return '<button type="button" class="opt opt-name" data-v="' + esc(n) + '" aria-pressed="false"><span class="ar">' + esc(n) + '</span><span class="tag"></span></button>';
    }).join('');

    render(
      '<div class="q-head"><p class="q-title">' + esc(task.title) + '</p>' +
      '<p class="q-note">' + esc(task.note) + '</p></div>' +
      '<div class="match">' +
        '<div class="col" id="colForms">' + formsHtml + '</div>' +
        '<div class="col" id="colNames">' + namesHtml + '</div>' +
      '</div>' +
      '<p class="match-hint">Составлено пар: <span id="pairCount">0</span> из ' + task.names.length + '</p>' +
      answerFooter()
    );

    var formBtns = [].slice.call(app.querySelectorAll('.opt-form'));
    var nameBtns = [].slice.call(app.querySelectorAll('.opt-name'));

    function paint() {
      var used = {};
      var n = 0;
      Object.keys(pairs).forEach(function (f) { used[pairs[f]] = f; n++; });
      formBtns.forEach(function (b) {
        var f = b.getAttribute('data-v');
        var paired = !!pairs[f];
        b.classList.toggle('is-paired', paired);
        b.classList.toggle('is-on', selForm === f);
        b.setAttribute('aria-pressed', selForm === f ? 'true' : 'false');
        b.querySelector('.tag').textContent = paired ? pairs[f] : '';
      });
      nameBtns.forEach(function (b) {
        var v = b.getAttribute('data-v');
        var paired = !!used[v];
        b.classList.toggle('is-paired', paired);
        b.classList.toggle('is-on', selName === v);
        b.setAttribute('aria-pressed', selName === v ? 'true' : 'false');
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
    bindAnswer();
  }

  /* Задание 2: слоги */

  function renderSyllables(task, i) {
    var val = state.answers.syllables[i];
    render(
      '<div class="q-head"><p class="q-title">Сколько слогов в этом слове?</p></div>' +
      '<p class="ar-hero">' + esc(task.words[i]) + '</p>' +
      '<div class="stepper">' +
        '<button type="button" id="minus" aria-label="Меньше">−</button>' +
        '<output id="num" aria-live="polite" class="' + (val == null ? 'is-empty' : '') + '">' + (val == null ? 'выберите число' : val) + '</output>' +
        '<button type="button" id="plus" aria-label="Больше">+</button>' +
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
    bindAnswer();
  }

  /* Задание 3: сифаты */

  function renderSifat(task, i) {
    var letter = task.letters[i];
    var chosen = (state.answers.sifat[letter] || []).slice();
    var rows = task.sifat.map(function (s) {
      var on = chosen.indexOf(s.ar) !== -1;
      return '<button type="button" class="check' + (on ? ' is-on' : '') + '" data-v="' + esc(s.ar) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' +
        '<span class="box">✓</span><span class="ru">' + esc(s.ru) + '</span><span class="ar">' + esc(s.ar) + '</span>' +
      '</button>';
    }).join('');
    render(
      '<div class="q-head"><p class="q-title">Отметьте сифаты буквы</p>' +
      '<p class="q-note">' + esc(task.note) + '</p></div>' +
      '<p class="ar-hero">' + esc(letter) + '</p>' +
      '<div class="checks">' + rows + '</div>' +
      answerFooter()
    );
    [].slice.call(app.querySelectorAll('.check')).forEach(function (b) {
      b.onclick = function () {
        var v = b.getAttribute('data-v');
        var idx = chosen.indexOf(v);
        if (idx === -1) chosen.push(v); else chosen.splice(idx, 1);
        b.classList.toggle('is-on', idx === -1);
        b.setAttribute('aria-pressed', idx === -1 ? 'true' : 'false');
      };
    });
    cur = { collect: function () { state.answers.sifat[letter] = chosen; } };
    bindAnswer();
  }

  /* Задание 4: сборка слова */

  function renderCompose(task, i) {
    var item = task.items[i];
    var tiles = item.tiles.map(function (t, k) { return { v: t, id: 'c' + k, dis: false }; })
      .concat((item.distractors || []).map(function (t, k) { return { v: t, id: 'd' + k, dis: true }; }));
    tiles = shuffled(tiles, i + 7);
    var picked = []; // массив id в порядке нажатия

    render(
      '<div class="q-head"><p class="q-title">Соберите слово</p>' +
      (item.hint ? '<p class="q-note">' + esc(item.hint) + '</p>' : '') +
      '</div>' +
      '<p class="compose-given">Дано: <span class="ar">' + esc(item.given) + '</span></p>' +
      '<div class="compose-out is-empty" id="composeOut">нажимайте на плитки внизу</div>' +
      '<div class="compose-tiles" id="composeTiles">' +
        tiles.map(function (t) {
          return '<button type="button" class="opt" data-id="' + t.id + '" aria-pressed="false"><bdi>' + esc(t.v) + '</bdi></button>';
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
        out.textContent = w;
      } else {
        out.classList.add('is-empty');
        out.textContent = 'нажимайте на плитки внизу';
      }
      Object.keys(btns).forEach(function (id) {
        btns[id].classList.toggle('is-used', picked.indexOf(id) !== -1);
        btns[id].setAttribute('aria-pressed', picked.indexOf(id) !== -1 ? 'true' : 'false');
      });
    }

    cur = { collect: function () { state.answers.compose[i] = word(); } };
    bindAnswer();
  }

  /* Задание 5: да / нет */

  function renderYesno(task, i) {
    var st = task.statements[i];
    var val = state.answers.yesno[i];
    render(
      '<div class="q-head"><p class="q-title">Верно ли утверждение?</p></div>' +
      '<p class="lede statement">' + esc(st.text) + '</p>' +
      (st.ar ? '<p class="ar-hero is-compact">' + esc(st.ar) + '</p>' : '') +
      '<div class="yesno">' +
        '<button type="button" class="opt' + (val === true ? ' is-on' : '') + '" id="optYes" aria-pressed="' + (val === true ? 'true' : 'false') + '">Да</button>' +
        '<button type="button" class="opt' + (val === false ? ' is-on' : '') + '" id="optNo" aria-pressed="' + (val === false ? 'true' : 'false') + '">Нет</button>' +
      '</div>' +
      answerFooter()
    );
    var yes = document.getElementById('optYes');
    var no = document.getElementById('optNo');
    yes.onclick = function () {
      val = true; yes.classList.add('is-on'); no.classList.remove('is-on');
      yes.setAttribute('aria-pressed', 'true'); no.setAttribute('aria-pressed', 'false');
    };
    no.onclick = function () {
      val = false; no.classList.add('is-on'); yes.classList.remove('is-on');
      no.setAttribute('aria-pressed', 'true'); yes.setAttribute('aria-pressed', 'false');
    };
    cur = { collect: function () { state.answers.yesno[i] = val; } };
    bindAnswer();
  }

  /* Задание 6: чтение с записью */

  function renderReading(task) {
    var rowsHtml = task.rows.map(function (r) {
      return '<div class="read-row"><p class="ar-line">' + esc(r.text) + '</p></div>';
    }).join('');

    render(
      '<div class="q-head"><p class="q-title">' + esc(task.title) + '</p>' +
      '<p class="q-note">' + esc(task.note) + '</p></div>' +
      '<div class="read-rows">' + rowsHtml + '</div>' +
      '<div class="recorder">' +
        '<p class="rec-status" id="recStatus">Микрофон ещё не включён</p>' +
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
    var chunks = [];
    var advanceAfterStop = false;
    var skipped = false;

    function pickMime() {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported) {
        if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
        if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
        if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4';
      }
      return '';
    }

    function setStatus(html, live) {
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

    recBtn.onclick = function () {
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
        return;
      }
      if (!navigator.mediaDevices || !window.MediaRecorder) {
        setStatus('Запись не поддерживается этим браузером. Нажмите «Пропустить» и прочитайте преподавателю лично.');
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        var mime = pickMime();
        recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        audioMime = recorder.mimeType || mime || 'audio/webm';
        chunks = [];
        recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        recorder.onstop = function () {
          stream.getTracks().forEach(function (t) { t.stop(); });
          if (skipped) return; // ученик отказался от записи — ничего не сохраняем
          audioBlob = new Blob(chunks, { type: audioMime });
          state.answers.readingRecorded = true;
          save();
          setStatus('Запись готова. Можно прослушать или перезаписать.');
          recBtn.textContent = 'Перезаписать';
          playback.hidden = false;
          playback.innerHTML = '';
          var audio = document.createElement('audio');
          audio.controls = true;
          audio.src = URL.createObjectURL(audioBlob);
          playback.appendChild(audio);
          answerBtn.disabled = false;
          if (advanceAfterStop) { advanceAfterStop = false; stopTimer(); commitAndNext(); }
        };
        recorder.start();
        setStatus('Идёт запись — читайте строки вслух', true);
        recBtn.textContent = 'Остановить запись';
        playback.hidden = true;
        audioBlob = null;
        answerBtn.disabled = true;
      }).catch(function () {
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
      '<p class="lede">Не закрывайте вкладку, это займёт несколько секунд.</p>'
    );
    submitAll().then(function () { showDone(); });
  }

  function submitAll() {
    var savedStudentToken = '';
    try { savedStudentToken = localStorage.getItem(STUDENT_KEY) || ''; } catch (e) { /* ок */ }
    var payload = {
      submissionId: state.submissionId,
      studentToken: savedStudentToken,
      student: state.student,
      startedAt: state.startedAt,
      finishedAt: new Date().toISOString(),
      answers: state.answers,
      site: location.hostname
    };
    serverResult = null;
    submitError = null;
    return api('/api/submit', payload).then(function (res) {
      serverResult = res;
      if (audioBlob && res && res.id) {
        var fd = new FormData();
        var ext = /mp4|aac/.test(audioMime) ? 'm4a' : 'webm';
        fd.append('audio', audioBlob, 'reading.' + ext);
        return fetch(API + '/api/audio/' + encodeURIComponent(res.id), { method: 'POST', body: fd })
          .then(function (r) { serverResult.audioUploaded = r.ok; })
          .catch(function () { serverResult.audioUploaded = false; });
      }
    }).catch(function (e) {
      submitError = e;
    });
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
      html += 'Ответы отправлены преподавателю. Адрес этой страницы — постоянная ссылка на ваш результат, сохраните её.</p>';
      html += '<div class="score-hero">' +
        '<div class="score-percent">' + Math.round(serverResult.percent) + '%</div>' +
        '<p class="score-caption">первого уровня по письменной части (' +
          serverResult.points + ' из ' + serverResult.max + ' баллов)</p>' +
      '</div>';
      if (serverResult.breakdown && serverResult.breakdown.length) {
        html += '<div class="breakdown">';
        serverResult.breakdown.forEach(function (b) {
          html += '<div class="breakdown-row"><span>' + esc(b.label) + '</span>' +
            '<span class="pts">' + b.points + ' / ' + b.max + '</span></div>';
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
      html += '<p class="notice is-error">Не получилось связаться с сервером. Ответы не потеряны: повторите отправку или передайте отчёт преподавателю вручную.</p>';
      html += '<div class="btn-row"><button class="btn" id="retrySubmitBtn">Повторить отправку</button></div>';
    }

    html += '<hr class="rule">';
    html += '<p class="kicker">Отчёт</p>';
    html += '<div class="btn-row">' +
      '<button class="btn is-ghost" id="copyBtn">Скопировать отчёт</button>' +
      '<button class="btn is-ghost" id="dlBtn">Скачать отчёт</button>' +
      (audioBlob && (!serverResult || !serverResult.audioUploaded)
        ? '<button class="btn is-ghost" id="dlAudioBtn">Скачать аудио</button>' : '') +
      '<a class="btn is-ghost" id="waBtn" target="_blank" rel="noopener">WhatsApp</a>' +
      '<a class="btn is-ghost" id="tgBtn" target="_blank" rel="noopener">Telegram</a>' +
    '</div>';

    if (serverResult && serverResult.studentToken) {
      html += '<div class="btn-row"><button class="btn" id="cabinetBtn">Открыть личный кабинет</button>' +
        '<button class="btn is-ghost" id="homeBtn">На главную</button></div>';
    } else {
      html += '<div class="btn-row"><button class="btn is-ghost" id="homeBtn">На главную</button></div>';
    }

    render(html);

    var text = reportText();
    document.getElementById('copyBtn').onclick = function () {
      var btn = this;
      (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
        .then(function () { btn.textContent = 'Скопировано'; })
        .catch(function () { window.prompt('Скопируйте отчёт:', text); });
    };
    document.getElementById('dlBtn').onclick = function () {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(blob);
      aEl.download = 'Экзамен_' + (s.lastName || 'ученик') + '.txt';
      aEl.click();
    };
    var dlAudio = document.getElementById('dlAudioBtn');
    if (dlAudio) {
      dlAudio.onclick = function () {
        var aEl = document.createElement('a');
        aEl.href = URL.createObjectURL(audioBlob);
        aEl.download = 'Чтение_' + (s.lastName || 'ученик') + (/mp4|aac/.test(audioMime) ? '.m4a' : '.webm');
        aEl.click();
      };
    }
    document.getElementById('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(text);
    document.getElementById('tgBtn').href = 'https://t.me/share/url?url=' +
      encodeURIComponent(CFG.SITE_URL || location.href) + '&text=' + encodeURIComponent(text);

    var retrySubmit = document.getElementById('retrySubmitBtn');
    if (retrySubmit) {
      retrySubmit.onclick = function () {
        retrySubmit.disabled = true;
        retrySubmit.textContent = 'Отправляем…';
        submitAll().then(function () { showDone(); });
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

  restore();
  hit();
  var hashResult = location.hash.match(/^#r=([0-9a-f-]{36})$/i);
  var hashStudent = location.hash.match(/^#student=([0-9a-f-]{36})$/i);
  if (hashStudent && state.phase !== 'exam') {
    showStudentCabinet(hashStudent[1]);
  } else if (hashResult && state.phase !== 'exam') {
    showSavedResult(hashResult[1]);
  } else {
    show();
  }
})();
