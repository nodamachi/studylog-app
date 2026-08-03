/* ===========================================================
   記録画面とタイマー
   =========================================================== */

var TIMER_CIRC = 2 * Math.PI * 94;   // タイマーリング(r=94)。1周=1時間。
var RUNAWAY_ASKED = false;

function renderRecord() {
  var s = App.stats;
  if (!s) return;

  document.getElementById('record-date').textContent = dayLabel(s.today.dayKey);
  document.getElementById('record-today').textContent = fmtHM(s.today.minutes);

  renderFormatRow();
  renderTiles();
}

function renderFormatRow() {
  var row = document.getElementById('format-row');
  if (row.childElementCount) {
    Array.prototype.forEach.call(row.children, function (b) {
      b.classList.toggle('is-on', b.dataset.format === App.lastFormat);
    });
    return;
  }
  (App.stats.formats || []).forEach(function (f) {
    var b = el('button', 'format-btn', f);
    b.type = 'button';
    b.dataset.format = f;
    b.classList.toggle('is-on', f === App.lastFormat);
    b.addEventListener('click', function () {
      App.lastFormat = f;
      renderFormatRow();
    });
    row.appendChild(b);
  });
}

function renderTiles() {
  var wrap = document.getElementById('subject-tiles');
  var week = App.stats.thisWeekBySubject || {};
  wrap.textContent = '';

  (App.stats.subjectOrder || []).forEach(function (subject) {
    var b = el('button', 'tile');
    b.type = 'button';
    b.style.setProperty('--c', subjectColor(subject));
    b.setAttribute('aria-label', subject + 'を開始');

    b.appendChild(el('span', 'tile-dot'));
    var body = el('div', 'tile-body');
    body.appendChild(el('div', 'tile-name', subject));
    body.appendChild(el('div', 'tile-sub', fmtHM(week[subject] || 0) + ' / 週'));
    b.appendChild(body);

    b.addEventListener('click', function () { startSubject(subject); });
    wrap.appendChild(b);
  });
}

/* ---------- 開始・停止 ---------- */

function startSubject(subject) {
  api('start', [subject, App.lastFormat])
    .then(function (d) {
      App.running = d.running;
      applyStats(d.stats);
      if (d.closed && d.closed.discarded) {
        toast('1分未満のため記録しませんでした');
      } else if (d.closed && d.closed.saved) {
        var m = d.closed.saved.minutes;
        toast(fmtJp(m) + '記録しました' + (d.message ? '\n' + d.message : ''));
      }
      openTimer();
    })
    .catch(function (e) { toast(e.message); });
}

function openTimer() {
  if (!App.running) return;
  RUNAWAY_ASKED = false;

  var color = subjectColor(App.running.subject);
  var t = document.getElementById('timer');
  t.style.setProperty('--c', color);
  t.hidden = false;

  document.getElementById('timer-subject').textContent = App.running.subject;
  document.getElementById('timer-subject').style.color = color;
  document.getElementById('timer-format').textContent = App.running.format || '';
  document.getElementById('timer-since').textContent = isoTime(App.running.startIso) + ' 開始';
  document.getElementById('btn-pause').textContent = App.running.paused ? '再開' : '一時停止';

  var arc = document.getElementById('timer-arc');
  arc.setAttribute('stroke-dasharray', TIMER_CIRC);
  arc.setAttribute('stroke-dashoffset', TIMER_CIRC);

  tickTimer();
  startTick();
}

function closeTimer() {
  stopTick();
  document.getElementById('timer').hidden = true;
}

function startTick() {
  stopTick();
  App.tickHandle = setInterval(tickTimer, 1000);
}
function stopTick() {
  if (App.tickHandle) clearInterval(App.tickHandle);
  App.tickHandle = null;
}

/**
 * 経過時間はサーバーが返した elapsedSeconds を基準に、
 * クライアント側の経過分を足して表示する。端末時計のズレを持ち込まない。
 */
function tickTimer() {
  if (!App.running) return;
  if (!App.running.paused) App.running.elapsedSeconds += 1;

  var sec = App.running.elapsedSeconds;
  document.getElementById('timer-digits').textContent = fmtClock(sec);

  var progress = (sec % 3600) / 3600;
  document.getElementById('timer-arc')
    .setAttribute('stroke-dashoffset', TIMER_CIRC * (1 - progress));

  var limit = (App.stats && App.stats.runawayHours ? App.stats.runawayHours : 3) * 3600;
  if (!RUNAWAY_ASKED && sec >= limit) {
    RUNAWAY_ASKED = true;
    openRunaway(sec);
  }
}

function doPauseResume() {
  if (!App.running) return;
  api(App.running.paused ? 'resume' : 'pause')
    .then(function (d) {
      App.running = d.running;
      document.getElementById('btn-pause').textContent = App.running.paused ? '再開' : '一時停止';
    })
    .catch(function (e) { toast(e.message); });
}

function doStop(endIsoOverride) {
  stopTick();
  api('stop', [endIsoOverride || null])
    .then(function (d) {
      App.running = null;
      closeTimer();
      var prevStreak = App.prevStreak;
      applyStats(d.stats);

      if (d.discarded) {
        toast('1分未満のため記録しませんでした');
      } else {
        var line = fmtJp(d.saved.minutes) + '記録しました';
        toast(d.message ? line + '\n' + d.message : line, 4200);
      }
      if (App.stats && App.stats.streak && prevStreak !== null &&
          App.stats.streak.days > prevStreak) {
        bumpStreak();
      }
      App.prevStreak = App.stats && App.stats.streak ? App.stats.streak.days : null;
    })
    .catch(function (e) {
      toast(e.message);
      startTick();
    });
}

function doDiscard() {
  stopTick();
  api('discard')
    .then(function (d) {
      App.running = null;
      closeTimer();
      applyStats(d.stats);
      toast('破棄しました');
    })
    .catch(function (e) {
      toast(e.message);
      startTick();
    });
}

/* ---------- 止め忘れ ---------- */

function openRunaway(seconds) {
  var hours = Math.floor(seconds / 3600);
  document.getElementById('runaway-msg').textContent =
    App.running.subject + 'を ' + hours + ' 時間走らせたままです。終了時刻を修正しますか？';
  document.getElementById('runaway-end').value = nowLocalInput();
  document.getElementById('runaway').hidden = false;
}

function closeRunaway() {
  document.getElementById('runaway').hidden = true;
}

function bumpStreak() {
  var e = document.getElementById('streak-days');
  if (!e) return;
  e.classList.remove('bump');
  void e.offsetWidth;
  e.classList.add('bump');
}
