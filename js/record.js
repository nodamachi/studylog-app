/* ===========================================================
   記録画面とタイマー

   タイマーはこの端末の中だけで動く(offline.js)。開始・一時停止・
   終了のどれも通信しないので、電波が無くても押せる。終えた記録は
   未送信の箱に入り、送れるときに送られる。
   =========================================================== */

var TIMER_CIRC = 2 * Math.PI * 94;   // タイマーリング(r=94)。1周=1時間。
var RUNAWAY_ASKED = false;

function renderRecord() {
  var s = App.stats;
  if (!s) return;

  var today = s.today.dayKey;
  document.getElementById('record-date').textContent = dayLabel(today);
  document.getElementById('record-today').textContent =
    fmtHM(s.today.minutes + outboxMinutesForDay(today));

  renderFormatRow();
  renderTiles();
  renderNetStatus();
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
      try { localStorage.setItem('studylog_last_format', f); } catch (e) {}
      renderFormatRow();
    });
    row.appendChild(b);
  });
}

/** 今週の分(サーバーの集計 + 未送信のうち今週の分) */
function weekMinutesFor(subject) {
  var week = (App.stats && App.stats.thisWeekBySubject) || {};
  var base = week[subject] || 0;
  var monday = mondayOf(todayKeyLocal());
  loadOutbox().forEach(function (x) {
    if (x.subject === subject && isoDay(x.start) >= monday) base += x.minutes || 0;
  });
  return base;
}

function mondayOf(dayKey) {
  var p = dayKey.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  var dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function renderTiles() {
  var wrap = document.getElementById('subject-tiles');
  wrap.textContent = '';

  (App.stats.subjectOrder || []).forEach(function (subject) {
    wrap.appendChild(makeTile(subject, false));
  });
  (App.stats.crossSubjects || []).forEach(function (subject) {
    wrap.appendChild(makeTile(subject, true));
  });
}

function makeTile(subject, cross) {
  var b = el('button', 'tile' + (cross ? ' tile-cross' : ''));
  b.type = 'button';
  b.style.setProperty('--c', subjectColor(subject));
  b.setAttribute('aria-label', subject + 'を開始');

  b.appendChild(el('span', 'tile-dot'));
  var body = el('div', 'tile-body');
  body.appendChild(el('div', 'tile-name', subject));
  body.appendChild(el('div', 'tile-sub',
    (cross ? '科目横断 · ' : '') + fmtHM(weekMinutesFor(subject)) + ' / 週'));
  b.appendChild(body);

  b.addEventListener('click', function () { startSubject(subject, cross); });
  return b;
}

/* ---------- 開始・停止 ---------- */

/**
 * 開始。走っているものがあれば締めてから切り替える(aTimeLogger と同じ)。
 * 科目横断(Anki)は形式を持たない。
 */
function startSubject(subject, cross) {
  var now = Date.now();
  var prev = App.running;
  var closed = prev ? closeRunningToOutbox(prev, now) : null;

  App.running = {
    id: newId(),
    subject: subject,
    format: cross ? '' : (App.lastFormat || ''),
    startMs: now,
    pausedAtMs: 0,
    pausedTotalMs: 0,
  };
  saveRunning(App.running);

  if (closed && closed.discarded) toast('1分未満のため記録しませんでした');
  else if (closed && closed.item) toast(prev.subject + 'を' + fmtJp(closed.item.minutes) + '記録しました');

  renderRecord();
  openTimer();
  if (closed && closed.item) flushOutbox();
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
  document.getElementById('timer-since').textContent =
    isoTime(msToIso(App.running.startMs)) + ' 開始';
  document.getElementById('btn-pause').textContent = App.running.pausedAtMs ? '再開' : '一時停止';

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
 * 経過は毎回「開始時刻との差」で出す。画面を消したり別アプリに
 * 切り替えて JS が止まっても、戻ったときに正しい時間になる。
 */
function tickTimer() {
  if (!App.running) return;
  var sec = Math.floor(runningElapsedMs(App.running) / 1000);
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
  var r = App.running;
  if (!r) return;
  var now = Date.now();
  if (r.pausedAtMs) {
    r.pausedTotalMs = (r.pausedTotalMs || 0) + (now - r.pausedAtMs);
    r.pausedAtMs = 0;
  } else {
    r.pausedAtMs = now;
  }
  saveRunning(r);
  document.getElementById('btn-pause').textContent = r.pausedAtMs ? '再開' : '一時停止';
  tickTimer();
}

/** 終了。endMs を渡すと終了時刻を指定できる(止め忘れの修正) */
function doStop(endMs) {
  var r = App.running;
  if (!r) return;
  if (endMs && endMs <= r.startMs) {
    toast('終了時刻が開始より前です');
    return;
  }

  var closed = closeRunningToOutbox(r, endMs || Date.now());
  App.running = null;
  saveRunning(null);
  closeTimer();
  renderRecord();

  if (closed.discarded) {
    toast('1分未満のため記録しませんでした');
    return;
  }

  var prevStreak = App.prevStreak;
  toast(fmtJp(closed.item.minutes) + '記録しました');
  flushOutbox().then(function (res) {
    if (res.offline) {
      toast(fmtJp(closed.item.minutes) + '記録しました\n電波が戻ったら送ります', 4200);
      return;
    }
    if (App.stats && App.stats.streak && prevStreak !== null &&
        App.stats.streak.days > prevStreak) {
      bumpStreak();
    }
    App.prevStreak = App.stats && App.stats.streak ? App.stats.streak.days : null;
  });
}

function doDiscard() {
  App.running = null;
  saveRunning(null);
  closeTimer();
  toast('破棄しました');
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

/* ---------- 前の版(サーバーで計っていたタイマー)からの引き継ぎ ---------- */

/**
 * 更新前に開始したタイマーがサーバーに残っていたら、この端末に移して
 * サーバー側は消す。経過時間はそのまま引き継ぐ。
 */
function adoptServerRunning(serverRunning) {
  if (!serverRunning || App.running) return;
  var startMs = isoToMs(serverRunning.startIso);
  if (!startMs) return;
  App.running = {
    id: newId(),
    subject: serverRunning.subject,
    format: serverRunning.format || '',
    startMs: startMs,
    pausedAtMs: serverRunning.paused ? startMs + serverRunning.elapsedSeconds * 1000 : 0,
    pausedTotalMs: 0,
  };
  saveRunning(App.running);
  api('discard').catch(function () {});
}
