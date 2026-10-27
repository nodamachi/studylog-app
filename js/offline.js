/* ===========================================================
   電波が無くても記録できるようにする部分

   - 走っているタイマーはこの端末の localStorage に持つ。
     開始・一時停止・終了で通信しないので、地下鉄でも押せる。
   - 終わった記録は「未送信の箱」(outbox) に入れ、電波があるときに
     まとめて送る(addMany)。記録ごとに端末で id を付けて送るので、
     返事が届かずに送り直しても、サーバー側で二重にならない。
   - 最後に受け取った集計も保存しておき、電波が無くても画面を出す。

   iPhone ではアプリを閉じている間は送れない(バックグラウンド同期が無い)。
   送るのは「開いたとき」「電波が戻ったとき」「記録を終えたとき」。
   =========================================================== */

var LS_RUNNING = 'studylog_running';
var LS_OUTBOX = 'studylog_outbox';
var LS_STATS = 'studylog_stats';

function lsGet(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function lsSet(key, value) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // 保存できなくても画面は動かす
  }
}

/* ---------- 集計の保存(電波が無いときの表示用) ---------- */

function saveCachedStats(stats) { lsSet(LS_STATS, stats); }
function loadCachedStats() { return lsGet(LS_STATS, null); }

/**
 * 一度も集計を受け取っていない端末で、電波が無いまま開いたときの最低限。
 * 科目と形式はサーバー(Constants.gs)と同じ並び。
 */
function fallbackStats() {
  var today = todayKeyLocal();
  return {
    today: { dayKey: today, minutes: 0, target: 120, stretch: 180 },
    streak: { days: 0, restsLast7: 0, studiedToday: false },
    week: { bars: [], dailyTarget: 120, weeklyTarget: 840, total: 0 },
    subjects: { items: [], total: 0, days: 28 },
    stale: { items: [] },
    heatmap: { weeks: [], maxMinutes: 0 },
    totals: { minutes: 0, days: 0 },
    thisWeekBySubject: {},
    exam: null,
    colors: {},
    subjectOrder: ['憲法', '行政法', '民法', '商法', '民事訴訟法', '刑法', '刑事訴訟法', '法律実務基礎', '一般教養'],
    crossSubjects: ['Anki'],
    formats: ['論文', '短答', 'インプット', '復習'],
  };
}

/* ---------- 走っているタイマー ---------- */

/**
 * { id, subject, format, startMs, pausedAtMs, pausedTotalMs }
 *  - pausedAtMs が 0 でなければ一時停止中
 *  - 計った時間 = (止めた時刻 or 今) - startMs - pausedTotalMs
 */
function loadRunning() { return lsGet(LS_RUNNING, null); }
function saveRunning(r) { lsSet(LS_RUNNING, r || null); }

function runningElapsedMs(r, atMs) {
  if (!r) return 0;
  var end = r.pausedAtMs || atMs || Date.now();
  return Math.max(0, end - r.startMs - (r.pausedTotalMs || 0));
}

/**
 * 走っているタイマーを締めて、未送信の箱に入れる。
 * 1分未満なら箱に入れずに捨てる(サーバーと同じ誤タップ対策)。
 * 戻り値: { item } か { discarded: true }
 */
function closeRunningToOutbox(r, endMs) {
  var end = endMs || Date.now();
  if (r.pausedAtMs) {
    // 一時停止中に終えたなら、止めた時点で終わったものとする
    end = Math.min(end, r.pausedAtMs);
  }
  var measuredMs = Math.max(0, end - r.startMs - (r.pausedTotalMs || 0));
  if (measuredMs < 60000) return { discarded: true };

  // サーバーと同じ考え方: 一時停止した分だけ開始を後ろへずらし、
  // 終了 - 開始 = 実際に計った時間 にする
  var item = {
    id: r.id,
    subject: r.subject,
    format: r.format || '',
    start: msToIso(end - measuredMs),
    end: msToIso(end),
    memo: '',
    minutes: Math.floor(measuredMs / 60000),
  };
  pushOutbox(item);
  return { item: item };
}

/* ---------- 未送信の箱 ---------- */

function loadOutbox() { return lsGet(LS_OUTBOX, []); }
function saveOutbox(list) { lsSet(LS_OUTBOX, list && list.length ? list : null); }

function pushOutbox(item) {
  var list = loadOutbox();
  list.push(item);
  saveOutbox(list);
  renderNetStatus();
}

/** 指定日の未送信分(履歴と今日の合計に足す) */
function outboxForDay(dayKey) {
  return loadOutbox().filter(function (x) { return isoDay(x.start) === dayKey; });
}

function outboxMinutesForDay(dayKey) {
  return outboxForDay(dayKey).reduce(function (t, x) { return t + (x.minutes || 0); }, 0);
}

var flushing = null;

/**
 * 箱の中身をまとめて送る。送れた分だけ箱から消す。
 * 何度呼んでも同時には1回しか走らない。
 * 戻り値の Promise は { sent, failed, offline } で解決する(失敗しても reject しない)。
 */
function flushOutbox() {
  if (flushing) return flushing;
  var items = loadOutbox();
  if (!items.length || !App.token) {
    return Promise.resolve({ sent: 0, failed: 0, offline: false });
  }

  var payload = items.map(function (x) {
    return { id: x.id, subject: x.subject, format: x.format, start: x.start, end: x.end, memo: x.memo };
  });

  flushing = api('addMany', [payload])
    .then(function (d) {
      setOffline(false);
      var done = {};
      var failed = [];
      (d.results || []).forEach(function (r) {
        if (r.ok) done[r.id] = true;
        else failed.push(r);
      });
      // 送っている間に箱へ増えた分は残す
      saveOutbox(loadOutbox().filter(function (x) { return !done[x.id]; }));
      applyStats(d.stats);
      if (failed.length) toast('送れなかった記録が ' + failed.length + ' 件あります: ' + failed[0].error, 5000);
      return { sent: Object.keys(done).length, failed: failed.length, offline: false };
    })
    .catch(function (e) {
      if (e && e.offline) setOffline(true);
      else toast(e.message);
      return { sent: 0, failed: 0, offline: !!(e && e.offline) };
    })
    .then(function (r) {
      flushing = null;
      renderNetStatus();
      if (App.view === 'history') renderHistory();
      return r;
    });
  return flushing;
}

/* ---------- 電波の状態の表示 ---------- */

function setOffline(flag) {
  App.offline = !!flag;
  renderNetStatus();
}

function renderNetStatus() {
  var n = loadOutbox().length;
  var text = '';
  if (App.offline && n) text = '電波なし · 未送信 ' + n + ' 件';
  else if (App.offline) text = '電波なし';
  else if (n) text = '未送信 ' + n + ' 件';

  Array.prototype.forEach.call(document.querySelectorAll('.net-status'), function (e) {
    e.textContent = text;
    e.hidden = !text;
  });
}
