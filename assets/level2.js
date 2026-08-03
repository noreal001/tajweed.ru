(function () {
  'use strict';

  var DATA = window.TAJWEED_LEVEL_2;
  var CFG = window.TAJWEED_CONFIG || {};
  var API = String(CFG.API_BASE || '').replace(/\/+$/, '');
  var STUDENT_KEY = 'tajweed_student_token';
  var DRAFT_KEY = 'tajweed_exam_v2';
  var app = document.getElementById('level2App');
  var audioBlob = null;
  var audioMime = '';
  var recorder = null;
  var recordingParts = [];
  var studentToken = '';
  var student = null;
  var startedAt = new Date().toISOString();
  var submissionId = uuid();

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (char) {
      var random = Math.random() * 16 | 0;
      return (char === 'x' ? random : (random & 3 | 8)).toString(16);
    });
  }

  function request(path, options, timeout) {
    var controller = typeof AbortController === 'undefined' ? null : new AbortController();
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeout || 25000) : null;
    var opts = Object.assign({}, options || {});
    if (controller) opts.signal = controller.signal;
    return fetch(API + path, opts).then(function (response) {
      if (timer) clearTimeout(timer);
      return response.json().catch(function () { return {}; }).then(function (body) {
        if (!response.ok) {
          var error = new Error(body.error || 'Ошибка ' + response.status);
          error.status = response.status;
          throw error;
        }
        return body;
      });
    }, function (error) {
      if (timer) clearTimeout(timer);
      throw error;
    });
  }

  function renderLocked(reason) {
    var needsLogin = reason === 'login';
    app.innerHTML =
      '<section class="access-state">' +
        '<p class="eyebrow">Экзамен №2 · закрыт</p>' +
        '<h1>Сначала — 100% за первый уровень</h1>' +
        '<p>' + (needsLogin
          ? 'Войдите в личный кабинет. Доступ проверяется по сохранённому результату, а не только на этом устройстве.'
          : 'Сейчас второй экзамен закрыт. Получите ровно 100% за письменную часть первого уровня — и замок снимется автоматически.') + '</p>' +
        '<div class="btn-row"><a class="btn" href="./">Перейти к первому экзамену</a>' +
          (studentToken ? '<a class="btn is-ghost" href="./#student=' + esc(studentToken) + '">Открыть кабинет</a>' : '') +
        '</div>' +
      '</section>';
    app.focus();
  }

  function renderUnavailable() {
    app.innerHTML =
      '<section class="access-state">' +
        '<p class="eyebrow">Второй уровень</p>' +
        '<h1>Не удалось проверить доступ</h1>' +
        '<p>Проверьте интернет и попробуйте ещё раз. Экзамен не откроется без подтверждения результата первого уровня.</p>' +
        '<div class="btn-row"><button class="btn" id="retryAccess" type="button">Повторить</button>' +
          '<a class="btn is-ghost" href="./">На главную</a></div>' +
      '</section>';
    document.getElementById('retryAccess').onclick = loadAccess;
  }

  function optionList() {
    return '<option value="">Выберите определение</option>' + DATA.definitions.map(function (item) {
      return '<option value="' + item.id + '">' + esc(item.text) + '</option>';
    }).join('');
  }

  function renderExam() {
    var profileName = esc(student.lastName + ' ' + student.firstName);
    app.innerHTML =
      '<header class="level2-hero">' +
        '<div class="level2-hero-copy">' +
          '<p class="eyebrow">Доступ открыт · Экзамен №2</p>' +
          '<h1 class="notranslate" translate="no">' +
            (window.TAJWEED_I18N ? window.TAJWEED_I18N.text('examTitle')
                                : 'Экзамен по <em>таджвиду</em>') + '</h1>' +
          '<p>Второй уровень открыт после идеального результата за первый. Ответы сохраняются на этом устройстве, а окончательную оценку поставит преподаватель.</p>' +
        '</div>' +
        '<dl class="level2-meta">' +
          '<div><dt>Ученик</dt><dd>' + profileName + '</dd></div>' +
          '<div><dt>Уровень</dt><dd>Второй</dd></div>' +
          '<div><dt>Преподаватель</dt><dd>' + esc(DATA.teacher) + '</dd></div>' +
          '<div><dt>Формат</dt><dd>7 заданий</dd></div>' +
        '</dl>' +
      '</header>' +
      '<form class="level2-form" id="level2Form" novalidate>' +
        taskOne() + taskTwo() + taskThree() + taskFour() + taskFive() + taskSix() + taskSeven() +
        '<div class="exam-submit">' +
          '<p>После отправки преподаватель получит письменные ответы и, если вы запишете её, аудиозапись чтения.</p>' +
          '<div class="btn-row"><button class="btn" id="submitExam" type="submit">Отправить экзамен</button>' +
            '<a class="btn is-ghost" href="./#student=' + esc(studentToken) + '">Сохранить и выйти</a></div>' +
          '<p class="recording-status" id="submitStatus" role="status" aria-live="polite"></p>' +
        '</div>' +
      '</form>';

    restoreDraft();
    var form = document.getElementById('level2Form');
    form.addEventListener('input', saveDraft);
    form.addEventListener('change', saveDraft);
    form.addEventListener('submit', submitExam);
    wireRecording();
    app.focus();
  }

  function sectionHead(number, title, points) {
    return '<div class="exam-section-head">' +
      '<span class="exam-section-number">0' + number + '</span>' +
      '<h2>' + esc(title) + '</h2>' +
      '<span class="exam-section-points">' + esc(points) + ' баллов</span>' +
    '</div>';
  }

  function taskOne() {
    return '<section class="exam-section" aria-labelledby="task1Title">' +
      sectionHead(1, 'Соедините термин с определением', 5).replace('<h2>', '<h2 id="task1Title">') +
      '<div class="term-grid">' +
        DATA.terms.map(function (term) {
          return '<div class="term-row"><label for="match-' + term.id + '">' + esc(term.label) + '</label>' +
            '<select id="match-' + term.id + '" name="match-' + term.id + '" autocomplete="off" required>' + optionList() + '</select></div>';
        }).join('') +
      '</div></section>';
  }

  function taskTwo() {
    var columns = ['Танвин фатха', 'Танвин касра', 'Танвин дамма'];
    return '<section class="exam-section" aria-labelledby="task2Title">' +
      sectionHead(2, 'Напишите слова с танвином', 6).replace('<h2>', '<h2 id="task2Title">') +
      '<p class="exam-section-note">Для каждого слова запишите три формы: с танвином фатха, касра и дамма.</p>' +
      '<div class="answer-table-wrap"><table class="answer-table"><thead><tr><th>Слово</th>' +
        columns.map(function (label) { return '<th>' + label + '</th>'; }).join('') +
        '</tr></thead><tbody>' +
        DATA.tanwinWords.map(function (word, row) {
          return '<tr><td class="ar" lang="ar" dir="rtl">' + esc(word) + '</td>' +
            columns.map(function (label, column) {
              return '<td><label class="visually-hidden" for="tanwin-' + row + '-' + column + '">' +
                esc(word + ', ' + label) + '</label><input class="answer-input ar-input" id="tanwin-' + row + '-' + column +
                '" name="tanwin-' + row + '-' + column + '" lang="ar" dir="rtl" autocomplete="off" spellcheck="false" required></td>';
            }).join('') + '</tr>';
        }).join('') +
      '</tbody></table></div></section>';
  }

  function countTask(number, title, points, words, prefix, note) {
    return '<section class="exam-section" aria-labelledby="task' + number + 'Title">' +
      sectionHead(number, title, points).replace('<h2>', '<h2 id="task' + number + 'Title">') +
      '<p class="exam-section-note">' + esc(note) + '</p>' +
      '<div class="count-grid">' +
        words.map(function (word, index) {
          return '<label class="count-card" for="' + prefix + '-' + index + '">' +
            '<span class="ar" lang="ar" dir="rtl">' + esc(word) + '</span>' +
            '<input class="count-input" id="' + prefix + '-' + index + '" name="' + prefix + '-' + index +
              '" type="number" min="1" max="24" inputmode="numeric" autocomplete="off" aria-label="' + esc(title + ': ' + word) + '" required>' +
          '</label>';
        }).join('') +
      '</div></section>';
  }

  function taskThree() {
    return countTask(3, 'Количество харакятов мадда', 12, DATA.maddWords, 'madd',
      'Укажите длительность буквы мадд в харакятах.');
  }

  function taskFour() {
    return countTask(4, 'Количество звуковых отрезков', 12, DATA.syllableWords, 'syllable',
      'Посчитайте слоги (звуковые отрезки) и впишите число.');
  }

  function taskFive() {
    return '<section class="exam-section" aria-labelledby="task5Title">' +
      sectionHead(5, 'Определите сифаты каждой буквы', 10).replace('<h2>', '<h2 id="task5Title">') +
      '<p class="exam-section-note">Отметьте все качества, которые относятся к каждой букве.</p>' +
      '<div class="sifat-grid">' +
        DATA.sifatLetters.map(function (letter) {
          return '<fieldset class="sifat-card" data-sifat-letter="' + esc(letter) + '"><legend lang="ar" dir="rtl">' + esc(letter) + '</legend>' +
            '<div class="sifat-options">' + DATA.sifat.map(function (quality, index) {
              return '<label class="sifat-choice"><input type="checkbox" name="sifat-' + esc(letter) +
                '" value="' + esc(quality.ar) + '"><span>' + esc(quality.ru) + ' <span lang="ar" dir="rtl">' +
                esc(quality.ar) + '</span></span></label>';
            }).join('') + '</div><p class="recording-status" data-sifat-error hidden>Отметьте хотя бы один сифат.</p></fieldset>';
        }).join('') +
      '</div></section>';
  }

  function taskSix() {
    return '<section class="exam-section" aria-labelledby="task6Title">' +
      sectionHead(6, 'Составьте правильное слово', 10).replace('<h2>', '<h2 id="task6Title">') +
      '<p class="exam-section-note">Запишите слово полностью. Последние три слова преподаватель продиктует отдельно.</p>' +
      '<div class="compose-list">' +
        DATA.compose.map(function (given, index) {
          var arabic = index < 7;
          return '<div class="compose-row"><label class="compose-given-l2' + (arabic ? ' is-arabic' : '') +
            '" for="compose-' + index + '"' + (arabic ? ' lang="ar" dir="rtl"' : '') + '>' +
            '<span class="visually-hidden">Пункт ' + (index + 1) + ': </span>' + esc(given) + '</label>' +
            '<input class="answer-input ar-input" id="compose-' + index + '" name="compose-' + index +
              '" lang="ar" dir="rtl" autocomplete="off" spellcheck="false" required></div>';
        }).join('') +
      '</div></section>';
  }

  function taskSeven() {
    return '<section class="exam-section" aria-labelledby="task7Title">' +
      sectionHead(7, 'Устное чтение', 25).replace('<h2>', '<h2 id="task7Title">') +
      '<p class="exam-section-note">Прочитайте все семь строк. Можно записать чтение сейчас или прочитать преподавателю лично.</p>' +
      '<div class="reading-list">' +
        DATA.readingRows.map(function (row, index) {
          return '<div class="reading-row-l2"><span>' + (index + 1) + '</span><p class="ar" lang="ar" dir="rtl">' +
            esc(row) + '</p></div>';
        }).join('') +
      '</div>' +
      '<div class="recording-panel"><button class="btn is-ghost" id="recordButton" type="button">Записать чтение</button>' +
        '<p class="recording-status" id="recordingStatus">Запись необязательна.</p></div>' +
    '</section>';
  }

  function collectAnswers() {
    var form = document.getElementById('level2Form');
    var answers = {
      match: {},
      tanwin: [],
      madd: [],
      syllables: [],
      sifat: {},
      compose: [],
      readingRecorded: !!audioBlob
    };
    DATA.terms.forEach(function (term) {
      answers.match[term.id] = form.elements['match-' + term.id].value;
    });
    DATA.tanwinWords.forEach(function (_, row) {
      answers.tanwin[row] = [0, 1, 2].map(function (column) {
        return form.elements['tanwin-' + row + '-' + column].value.trim();
      });
    });
    DATA.maddWords.forEach(function (_, index) {
      answers.madd[index] = Number(form.elements['madd-' + index].value) || null;
    });
    DATA.syllableWords.forEach(function (_, index) {
      answers.syllables[index] = Number(form.elements['syllable-' + index].value) || null;
    });
    DATA.sifatLetters.forEach(function (letter) {
      answers.sifat[letter] = [].slice.call(form.querySelectorAll('[name="sifat-' + letter + '"]:checked'))
        .map(function (input) { return input.value; });
    });
    DATA.compose.forEach(function (_, index) {
      answers.compose[index] = form.elements['compose-' + index].value.trim();
    });
    return answers;
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        startedAt: startedAt,
        submissionId: submissionId,
        answers: collectAnswers()
      }));
    } catch (error) {}
  }

  function restoreDraft() {
    var draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (error) {}
    if (!draft || !draft.answers) return;
    if (draft.startedAt) startedAt = draft.startedAt;
    if (/^[0-9a-f-]{36}$/i.test(String(draft.submissionId || ''))) submissionId = draft.submissionId;
    var form = document.getElementById('level2Form');
    var answers = draft.answers;
    DATA.terms.forEach(function (term) {
      form.elements['match-' + term.id].value = (answers.match || {})[term.id] || '';
    });
    DATA.tanwinWords.forEach(function (_, row) {
      [0, 1, 2].forEach(function (column) {
        form.elements['tanwin-' + row + '-' + column].value =
          ((answers.tanwin || [])[row] || [])[column] || '';
      });
    });
    DATA.maddWords.forEach(function (_, index) {
      form.elements['madd-' + index].value = (answers.madd || [])[index] || '';
    });
    DATA.syllableWords.forEach(function (_, index) {
      form.elements['syllable-' + index].value = (answers.syllables || [])[index] || '';
    });
    DATA.sifatLetters.forEach(function (letter) {
      var selected = new Set((answers.sifat || {})[letter] || []);
      [].slice.call(form.querySelectorAll('[name="sifat-' + letter + '"]')).forEach(function (input) {
        input.checked = selected.has(input.value);
      });
    });
    DATA.compose.forEach(function (_, index) {
      form.elements['compose-' + index].value = (answers.compose || [])[index] || '';
    });
  }

  function validateSifat() {
    var valid = true;
    DATA.sifatLetters.forEach(function (letter) {
      var fieldset = document.querySelector('[data-sifat-letter="' + letter + '"]');
      var selected = fieldset.querySelector('input:checked');
      var error = fieldset.querySelector('[data-sifat-error]');
      error.hidden = !!selected;
      if (!selected) valid = false;
    });
    return valid;
  }

  function submitExam(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var status = document.getElementById('submitStatus');
    var firstInvalid = form.querySelector(':invalid');
    if (firstInvalid || !validateSifat()) {
      status.textContent = 'Заполните все задания. Первое незаполненное поле выделено.';
      if (firstInvalid) firstInvalid.focus();
      else document.querySelector('[data-sifat-error]:not([hidden])').parentElement.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    var button = document.getElementById('submitExam');
    button.disabled = true;
    button.textContent = 'Отправляем…';
    status.textContent = 'Сохраняем письменные ответы на сервере.';
    var answers = collectAnswers();
    saveDraft();
    request('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        examLevel: 2,
        submissionId: submissionId,
        studentToken: studentToken,
        student: {
          firstName: student.firstName,
          lastName: student.lastName,
          city: student.city,
          phone: student.phone
        },
        startedAt: startedAt,
        finishedAt: new Date().toISOString(),
        answers: answers,
        site: location.hostname
      })
    }, 35000).then(function (result) {
      if (!audioBlob || !result.audioUploadToken) return result;
      status.textContent = 'Ответы сохранены. Загружаем запись чтения…';
      var data = new FormData();
      var extension = /mp4|aac/.test(audioMime) ? 'm4a' : 'webm';
      data.append('audio', audioBlob, 'reading-level-2.' + extension);
      return fetch(API + '/api/audio/' + encodeURIComponent(result.id), {
        method: 'POST',
        headers: { 'X-Audio-Upload-Token': result.audioUploadToken },
        body: data
      }).then(function (response) {
        result.audioUploaded = response.ok;
        return result;
      }).catch(function () {
        result.audioUploaded = false;
        return result;
      });
    }).then(showDone).catch(function (error) {
      button.disabled = false;
      button.textContent = 'Отправить экзамен';
      status.textContent = error.status === 403
        ? error.message
        : 'Не удалось отправить работу. Черновик сохранён — проверьте интернет и повторите.';
    });
  }

  function showDone(result) {
    try { localStorage.removeItem(DRAFT_KEY); } catch (error) {}
    app.innerHTML =
      '<section class="level2-done">' +
        '<p class="eyebrow">Экзамен №2 · отправлен</p>' +
        '<h1>Работа у преподавателя</h1>' +
        '<p class="lede">Письменные ответы сохранены. Задания на мадд, слоги, диктант и устное чтение преподаватель проверит вручную.</p>' +
        '<div class="auto-score"><strong>' + esc(result.points) + ' / ' + esc(result.max) + '</strong>' +
          '<span>Автоматически проверяемая часть. Это не итоговая оценка за экзамен.</span></div>' +
        (audioBlob ? '<p class="lede">' + (result.audioUploaded
          ? 'Запись чтения тоже отправлена.'
          : 'Запись чтения не загрузилась. Прочитайте строки преподавателю лично.') + '</p>' : '') +
        '<div class="btn-row"><a class="btn" href="./#student=' + esc(studentToken) + '">Открыть кабинет</a>' +
          '<a class="btn is-ghost" href="./">На главную</a></div>' +
      '</section>';
    app.focus();
  }

  function wireRecording() {
    var button = document.getElementById('recordButton');
    var status = document.getElementById('recordingStatus');
    if (!navigator.mediaDevices || !window.MediaRecorder) {
      button.disabled = true;
      status.textContent = 'Запись недоступна в этом браузере — прочитайте преподавателю лично.';
      return;
    }
    button.onclick = function () {
      if (recorder && recorder.state === 'recording') {
        recorder.stop();
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        recordingParts = [];
        var preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].filter(function (type) {
          return !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type);
        })[0];
        recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
        audioMime = recorder.mimeType || preferred || 'audio/webm';
        recorder.ondataavailable = function (event) {
          if (event.data && event.data.size) recordingParts.push(event.data);
        };
        recorder.onstop = function () {
          stream.getTracks().forEach(function (track) { track.stop(); });
          audioBlob = new Blob(recordingParts, { type: audioMime });
          button.textContent = 'Перезаписать чтение';
          button.classList.remove('is-recording');
          status.textContent = 'Запись готова и будет отправлена вместе с экзаменом.';
          saveDraft();
        };
        recorder.start();
        button.textContent = 'Остановить запись';
        button.classList.add('is-recording');
        status.textContent = 'Идёт запись. Прочитайте все семь строк.';
      }).catch(function () {
        status.textContent = 'Не удалось включить микрофон. Разрешите доступ или прочитайте преподавателю лично.';
      });
    };
  }

  function loadAccess() {
    if (!API) return renderUnavailable();
    try { studentToken = localStorage.getItem(STUDENT_KEY) || ''; } catch (error) {}
    if (!studentToken) return renderLocked('login');
    app.innerHTML = '<section class="access-state"><p class="eyebrow">Второй уровень</p>' +
      '<h1>Проверяем результат первого экзамена…</h1></section>';
    request('/api/exams/2/access?studentToken=' + encodeURIComponent(studentToken))
      .then(function (access) {
        if (!access.allowed) return renderLocked(access.reason);
        return request('/api/student/' + encodeURIComponent(studentToken)).then(function (profile) {
          student = profile.student;
          renderExam();
        });
      })
      .catch(function (error) {
        if (error.status === 401 || error.status === 403) renderLocked('login');
        else renderUnavailable();
      });
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function syncTheme() {
    var light = currentTheme() === 'light';
    var label = document.getElementById('themeLabel');
    var button = document.getElementById('themeToggle');
    label.textContent = light ? 'Светлая' : 'Тёмная';
    button.setAttribute('aria-pressed', light ? 'true' : 'false');
    button.setAttribute('aria-label', 'Тема оформления: ' + (light ? 'светлая' : 'тёмная') +
      '. Переключить на ' + (light ? 'тёмную' : 'светлую'));
  }

  document.getElementById('themeToggle').onclick = function () {
    var next = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('tajweed_theme', next); } catch (error) {}
    document.querySelector('meta[name="theme-color"]').setAttribute('content', next === 'light' ? '#ffffff' : '#0a0a0b');
    syncTheme();
  };
  syncTheme();

  (function wireLanguages() {
    var languages = window.TAJWEED_LANGUAGES || [];
    var i18n = window.TAJWEED_I18N;
    var current = i18n ? i18n.current() : 'ru';
    var button = document.getElementById('languageButton');
    var menu = document.getElementById('languageMenu');
    var currentLanguage = languages.filter(function (item) { return item[0] === current; })[0] || languages[0];
    function languageFlag(svg, small) {
      return '<span class="language-flag' + (small ? ' is-small' : '') +
        '" aria-hidden="true">' + svg + '</span>';
    }
    button.innerHTML = languageFlag(currentLanguage[1], false) +
      '<span class="visually-hidden">' + currentLanguage[2] + '</span>';
    button.setAttribute('aria-label', 'Язык: ' + currentLanguage[2] + '. Выбрать другой');
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
      var target = document.createElement('div');
      target.id = 'google_translate_element';
      target.hidden = true;
      document.body.appendChild(target);
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

  window.addEventListener('beforeunload', function (event) {
    if (!document.getElementById('level2Form')) return;
    event.preventDefault();
    event.returnValue = '';
  });

  loadAccess();
})();
