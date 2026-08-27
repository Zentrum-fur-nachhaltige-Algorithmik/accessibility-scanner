/**
 * Blind Mode client: speaker and keyboard only. Every key becomes a
 * ScreenReaderEnv command; the server returns what the screen reader said.
 * Everything spoken also goes into an aria-live region for real screen readers.
 */
(function () {
  'use strict';

  // Key map: which key means which env command, used by the play screen,
  // the key help and the optimal-path rendering.
  var KEY_LABEL = {
    next: 'Arrow down',
    prev: 'Arrow up',
    tab: 'Tab',
    shiftTab: 'Shift+Tab',
    headings: 'List headings',
    landmarks: 'List landmarks',
    links: 'List links',
    formFields: 'List fields',
    jumpTo: 'Pick from the list',
    nextHeading: 'H',
    prevHeading: 'Shift+H',
    nextLink: 'L',
    prevLink: 'Shift+L',
    nextFormField: 'F',
    prevFormField: 'Shift+F',
    nextLandmark: 'D',
    prevLandmark: 'Shift+D',
    activate: 'Enter',
    type: 'Type',
    escape: 'Esc',
    repeat: 'R',
    done: 'Done',
  };

  var KEY_HELP = [
    'Arrow down and arrow up: one element forward or back.',
    'Tab and Shift Tab: next interactive element.',
    'H: next heading, Shift H back.',
    'L: next link, Shift L back.',
    'F: next form field, Shift F back.',
    'D: next landmark, Shift D back.',
    'Enter: activate. In a text field: input mode.',
    'Esc: cancel. R: repeat the last announcement.',
    'Question mark: this list. Esc Esc: leave the game.',
  ].join(' ');

  /** Roles whose phrase means "the cursor sits in a text field". */
  var TEXT_FIELD_RE = /^(textbox|searchbox|combobox|spinbutton)\b/i;

  // Elements
  var $ = function (id) {
    return document.getElementById(id);
  };
  var screens = {
    setup: $('screen-setup'),
    briefing: $('screen-briefing'),
    play: $('screen-play'),
    result: $('screen-result'),
  };
  var headings = {
    setup: $('setup-heading'),
    briefing: $('briefing-heading'),
    play: $('play-heading'),
    result: $('result-heading'),
  };
  var live = $('live');
  var capture = $('capture');

  // State
  var state = {
    tasks: [],
    task: null,
    mode: 'experience',
    rate: 1.2,
    lang: 'en',
    budget: 0,
    step: 0,
    lastPhrase: '',
    warned: false,
    inputMode: false,
    inputBuffer: '',
    inputField: '',
    escTimer: null,
    playing: false,
    ws: null,
    queue: [],
    inFlight: false,
    result: null,
  };

  // Live region + speech. Both are always used together: the live region
  // is the accessible fallback, speech is the experience.
  function announce(text) {
    if (!live) return;
    // Re-setting identical text does not re-trigger a live region; toggle it.
    live.textContent = '';
    window.setTimeout(function () {
      live.textContent = text;
    }, 20);
  }

  var speech = {
    supported:
      typeof window.speechSynthesis !== 'undefined' &&
      typeof window.SpeechSynthesisUtterance !== 'undefined',
    cancel: function () {
      if (!this.supported) return;
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        /* speech not available */
      }
    },
    /**
     * @param {string} text
     * @param {{lang?: string, pitch?: number, quiet?: boolean}} [opts]
     *        quiet: do not push into the live region (used for key echo)
     * @returns {Promise<void>} resolves when the utterance ended (or at once)
     */
    speak: function (text, opts) {
      opts = opts || {};
      if (!text) return Promise.resolve();
      if (!opts.quiet) announce(text);
      if (!this.supported) return Promise.resolve();
      var self = this;
      return new Promise(function (resolve) {
        var utter;
        try {
          self.cancel();
          utter = new window.SpeechSynthesisUtterance(text);
          utter.lang = opts.lang || state.lang || 'en';
          utter.rate = state.rate;
          utter.pitch = opts.pitch === undefined ? 1 : opts.pitch;
          utter.onend = function () {
            resolve();
          };
          utter.onerror = function () {
            resolve();
          };
          window.speechSynthesis.speak(utter);
        } catch (e) {
          resolve();
        }
        // Safety net: some engines never fire onend.
        window.setTimeout(resolve, 12000);
      });
    },
  };

  // Earcons (WebAudio, no assets)
  var audio = {
    ctx: null,
    ensure: function () {
      if (this.ctx) return this.ctx;
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try {
        this.ctx = new Ctx();
      } catch (e) {
        this.ctx = null;
      }
      return this.ctx;
    },
    tone: function (freq, ms, delayMs, gainValue) {
      var ctx = this.ensure();
      if (!ctx) return;
      try {
        var t0 = ctx.currentTime + (delayMs || 0) / 1000;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(gainValue || 0.08, t0 + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + ms / 1000 + 0.02);
      } catch (e) {
        /* audio is a nice-to-have */
      }
    },
  };
  var earcon = {
    announcement: function () {
      audio.tone(1320, 90, 0, 0.06);
    },
    noop: function () {
      audio.tone(180, 140, 0, 0.09);
    },
    inputMode: function () {
      audio.tone(990, 70, 0, 0.06);
      audio.tone(1240, 70, 80, 0.06);
    },
    success: function () {
      audio.tone(523, 260, 0, 0.07);
      audio.tone(659, 260, 90, 0.07);
      audio.tone(784, 420, 180, 0.07);
    },
  };

  // Screens
  function show(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].hidden = key !== name;
    });
    var target = name === 'play' ? capture : headings[name];
    if (target) {
      try {
        target.focus();
      } catch (e) {
        /* ignore */
      }
    }
  }

  // Setup screen
  function renderTasks(tasks) {
    var box = $('task-choices');
    box.innerHTML = '';
    if (!tasks.length) {
      box.textContent = 'No tasks found.';
      return;
    }
    tasks.forEach(function (task, i) {
      var p = document.createElement('p');
      p.className = 'choice';
      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'task';
      input.id = 'task-' + task.id;
      input.value = task.id;
      if (i === 0) input.checked = true;
      var label = document.createElement('label');
      label.htmlFor = input.id;
      label.textContent = task.description;
      p.appendChild(input);
      p.appendChild(label);
      box.appendChild(p);
    });
  }

  function selectedValue(name, fallback) {
    var el = document.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : fallback;
  }

  $('setup-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var taskId = selectedValue('task', null);
    state.task = null;
    state.tasks.forEach(function (t) {
      if (t.id === taskId) state.task = t;
    });
    if (!state.task) return;
    state.mode = selectedValue('mode', 'experience');
    state.rate = parseFloat(selectedValue('rate', '1.2'));
    audio.ensure(); // a user gesture is the only chance to unlock audio
    $('briefing-task').textContent = state.task.description;
    show('briefing');
  });

  // Briefing screen
  function beginGame() {
    $('play-task').textContent = state.task.description;
    $('play-counter').textContent = 'Step 0';
    $('phrase-display').hidden = state.mode !== 'training';
    $('phrase-display').textContent = '';
    $('pause-panel').hidden = true;
    capture.hidden = false;
    state.step = 0;
    state.warned = false;
    state.playing = true;
    state.queue = [];
    state.inFlight = false;
    connect();
    show('play');
  }

  $('begin-button').addEventListener('click', beginGame);
  screens.briefing.addEventListener('keydown', function (event) {
    if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') {
      event.preventDefault();
      beginGame();
    }
  });

  // WebSocket
  function connect() {
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    var ws = new WebSocket(proto + '//' + window.location.host + '/ws');
    state.ws = ws;
    ws.addEventListener('open', function () {
      ws.send(
        JSON.stringify({
          type: 'start',
          taskId: state.task.id,
          mode: state.mode,
          rate: state.rate,
        })
      );
    });
    ws.addEventListener('message', function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      handle(msg);
    });
    ws.addEventListener('close', function () {
      state.inFlight = false;
    });
  }

  function send(msg) {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
  }

  /** Queue a command. Keys are never dropped, only serialised. */
  function sendCmd(cmd) {
    if (!state.playing) return;
    state.queue.push(cmd);
    pump();
  }

  function pump() {
    if (state.inFlight || state.queue.length === 0) return;
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    state.inFlight = true;
    send({ type: 'cmd', cmd: state.queue.shift() });
  }

  function handle(msg) {
    if (msg.type === 'started') {
      state.lang = msg.lang || 'en';
      state.budget = msg.budget;
      speech.speak('Go.', { lang: 'en' });
    } else if (msg.type === 'obs') {
      onObservation(msg);
    } else if (msg.type === 'result') {
      onResult(msg);
    } else if (msg.type === 'error') {
      state.inFlight = false;
      earcon.noop();
      speech.speak('Error: ' + msg.message, { lang: 'en' });
    }
  }

  function onObservation(msg) {
    state.inFlight = false;
    if (!msg.free) state.step = msg.step;
    state.lastPhrase = msg.phrase || '';
    $('play-counter').textContent = 'Step ' + state.step;
    if (state.mode === 'training') $('phrase-display').textContent = state.lastPhrase;

    var spoken;
    if (msg.kind === 'noop') {
      earcon.noop();
      spoken = speech.speak(state.lastPhrase || 'Nothing happened.');
    } else if (msg.kind === 'announcement') {
      earcon.announcement();
      spoken = speech
        .speak('Announcement: ' + (msg.announcements || []).join('. '), { pitch: 1.4 })
        .then(function () {
          return speech.speak(state.lastPhrase);
        });
    } else {
      spoken = speech.speak(state.lastPhrase);
    }

    if (!msg.free && !state.warned && msg.budgetLeft === 5) {
      state.warned = true;
      spoken.then(function () {
        return speech.speak('5 steps left', { lang: 'en' });
      });
    }
    pump();
  }

  // Play screen: keyboard
  var PLAIN_KEYS = {
    ArrowDown: 'next',
    ArrowUp: 'prev',
  };
  var LETTER_KEYS = {
    h: ['nextHeading', 'prevHeading'],
    l: ['nextLink', 'prevLink'],
    f: ['nextFormField', 'prevFormField'],
    d: ['nextLandmark', 'prevLandmark'],
  };

  capture.addEventListener('keydown', function (event) {
    if (!state.playing) return;

    if (state.inputMode) {
      handleInputModeKey(event);
      return;
    }

    var key = event.key;

    if (key === 'Escape') {
      event.preventDefault();
      onEscape();
      return;
    }
    if (key === 'Tab') {
      event.preventDefault();
      sendCmd({ type: event.shiftKey ? 'shiftTab' : 'tab' });
      return;
    }
    if (PLAIN_KEYS[key]) {
      event.preventDefault();
      sendCmd({ type: PLAIN_KEYS[key] });
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      if (TEXT_FIELD_RE.test(state.lastPhrase)) enterInputMode();
      else sendCmd({ type: 'activate' });
      return;
    }
    if (key === '?') {
      event.preventDefault();
      speech.speak(KEY_HELP, { lang: 'en' });
      return;
    }
    var lower = typeof key === 'string' ? key.toLowerCase() : '';
    if (lower === 'r') {
      event.preventDefault();
      sendCmd({ type: 'repeat' });
      return;
    }
    if (LETTER_KEYS[lower]) {
      event.preventDefault();
      sendCmd({ type: LETTER_KEYS[lower][event.shiftKey ? 1 : 0] });
    }
  });

  /**
   * Esc is both "press Escape on the page" and, pressed twice, "leave the
   * game". A single Esc is held back for a moment: a second Esc within the
   * window leaves instead of spending a step on the page.
   */
  var ESC_DOUBLE_MS = 500;
  function onEscape() {
    if (state.escTimer) {
      window.clearTimeout(state.escTimer);
      state.escTimer = null;
      leaveCapture();
      return;
    }
    state.escTimer = window.setTimeout(function () {
      state.escTimer = null;
      sendCmd({ type: 'escape' });
    }, ESC_DOUBLE_MS);
  }

  function leaveCapture() {
    $('pause-panel').hidden = false;
    speech.speak('Game paused, Tab to give up', { lang: 'en' });
    var heading = $('pause-heading');
    if (heading) heading.focus();
  }

  $('resume-button').addEventListener('click', function () {
    $('pause-panel').hidden = true;
    capture.focus();
    speech.speak('Resumed.', { lang: 'en' });
  });

  $('giveup-button').addEventListener('click', function () {
    state.playing = false;
    send({ type: 'abort' });
  });

  // Input mode
  function fieldNameOf(phrase) {
    var parts = String(phrase || '').split(',');
    return (parts[1] || parts[0] || 'field').trim();
  }

  function enterInputMode() {
    state.inputMode = true;
    state.inputBuffer = '';
    state.inputField = fieldNameOf(state.lastPhrase);
    earcon.inputMode();
    speech.speak('Input mode, ' + state.inputField, { lang: 'en' });
  }

  function leaveInputMode() {
    state.inputMode = false;
    state.inputBuffer = '';
  }

  function handleInputModeKey(event) {
    var key = event.key;
    if (key === 'Escape') {
      event.preventDefault();
      leaveInputMode();
      earcon.noop();
      speech.speak('Input cancelled.', { lang: 'en' });
      return;
    }
    if (key === 'Enter') {
      event.preventDefault();
      var text = state.inputBuffer;
      var field = state.inputField;
      leaveInputMode();
      sendCmd({ type: 'type', arg: text });
      speech.speak(field + ', ' + text);
      return;
    }
    if (key === 'Backspace') {
      event.preventDefault();
      state.inputBuffer = state.inputBuffer.slice(0, -1);
      speech.speak('deleted', { lang: 'en', quiet: true });
      return;
    }
    if (typeof key === 'string' && key.length === 1) {
      event.preventDefault();
      state.inputBuffer += key;
      speech.speak(key === ' ' ? 'space' : key, { lang: 'en', quiet: true });
    }
  }

  // Result screen
  function keyFor(cmd) {
    if (!cmd) return '?';
    var label = KEY_LABEL[cmd.type] || cmd.type;
    if (cmd.type === 'type') return 'Type "' + cmd.arg + '"';
    if (cmd.type === 'jumpTo') return label;
    return label;
  }

  function onResult(msg) {
    state.playing = false;
    state.result = msg;
    speech.cancel();
    if (msg.success) earcon.success();
    else earcon.noop();

    $('result-verdict').textContent = msg.verdict;

    var dl = $('result-numbers');
    dl.innerHTML = '';
    var rows = [
      ['Your steps', String(msg.nHuman)],
      ['Shortest path', String(msg.nOpt)],
      ['Score R', String(Math.round(msg.R * 100) / 100)],
    ];
    if (msg.nAgent != null) rows.splice(2, 0, ['AI agent', String(msg.nAgent)]);
    rows.forEach(function (row) {
      var dt = document.createElement('dt');
      dt.textContent = row[0];
      var dd = document.createElement('dd');
      dd.textContent = row[1];
      dl.appendChild(dt);
      dl.appendChild(dd);
    });

    $('optimal-intro').textContent = 'It could have been done in ' + msg.nOpt + ' steps:';
    var ol = $('result-optimal');
    ol.innerHTML = '';
    (msg.optimalPath || []).forEach(function (entry) {
      var li = document.createElement('li');
      var key = document.createElement('span');
      key.className = 'key';
      key.textContent = keyFor(entry.cmd);
      li.appendChild(key);
      li.appendChild(document.createTextNode(' ' + (entry.phrase || '')));
      ol.appendChild(li);
    });
    $('playback-button').disabled = !(msg.optimalPath && msg.optimalPath.length);

    var stuckSection = $('stuck-section');
    if (msg.stuck) {
      stuckSection.hidden = false;
      $('stuck-intro').textContent =
        'Step ' + msg.stuck.fromStep + ' to ' + msg.stuck.toStep + '. This is what you heard:';
      var sol = $('result-stuck');
      sol.innerHTML = '';
      msg.stuck.phrases.forEach(function (phrase) {
        var li = document.createElement('li');
        li.textContent = phrase;
        sol.appendChild(li);
      });
    } else {
      stuckSection.hidden = true;
    }

    show('result');
    speech.speak(msg.verdict, { lang: 'en' });
  }

  $('playback-button').addEventListener('click', function () {
    var path = (state.result && state.result.optimalPath) || [];
    var i = 0;
    (function step() {
      if (i >= path.length) return;
      var entry = path[i];
      i += 1;
      speech
        .speak(keyFor(entry.cmd), { lang: 'en' })
        .then(function () {
          return speech.speak(entry.phrase || '');
        })
        .then(step);
    })();
  });

  $('again-button').addEventListener('click', function () {
    speech.cancel();
    if (state.ws) {
      try {
        state.ws.close();
      } catch (e) {
        /* ignore */
      }
      state.ws = null;
    }
    show('setup');
  });

  // Boot
  fetch('/api/tasks')
    .then(function (res) {
      return res.json();
    })
    .then(function (tasks) {
      state.tasks = tasks;
      renderTasks(tasks);
    })
    .catch(function () {
      $('task-choices').textContent = 'Tasks could not be loaded.';
    });

  // Exposed for the smoke test and for debugging in the browser console.
  window.__BLIND_MODE__ = { state: state, KEY_LABEL: KEY_LABEL };
})();
