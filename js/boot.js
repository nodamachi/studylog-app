/* ===========================================================
   起動とイベント配線

   このシェルは自前のオリジンで動くので localStorage が普通に永続する。
   GAS の iframe の中とは違い、iOS Safari に消されない。
   =========================================================== */

function boot() {
  bindEvents();
  registerServiceWorker();

  // 初回だけ #t=<トークン> で渡せるようにしておく(URL 断片はサーバーに送られない)。
  var hashToken = '';
  try {
    var m = location.hash.match(/(?:^#|&)t=([^&]+)/);
    if (m) hashToken = decodeURIComponent(m[1]);
  } catch (e) {}

  var saved = '';
  try { saved = localStorage.getItem(TOKEN_KEY) || ''; } catch (e) {}

  var token = hashToken || saved;
  if (!token) {
    document.getElementById('gate').hidden = false;
    return;
  }

  App.token = token;
  if (hashToken) {
    try { localStorage.setItem(TOKEN_KEY, hashToken); } catch (e) {}
    // 履歴やブックマークにトークンを残さない
    history.replaceState(null, '', location.pathname + location.search);
  }

  // トークンが違うときだけ api() の中でログアウトされる。
  // 電波が無いだけならログアウトせず、保存しておいた画面で開く。
  loadApp().catch(function () {});
}

/**
 * まず手元に保存してある集計で画面を出し(電波が無くても開ける)、
 * それからサーバーに問い合わせて差し替える。
 */
function loadApp() {
  App.running = loadRunning();
  var savedFormat = '';
  try { savedFormat = localStorage.getItem('studylog_last_format') || ''; } catch (e) {}
  App.lastFormat = savedFormat;

  showApp(loadCachedStats() || fallbackStats());
  flushOutbox();

  return api('bootstrap').then(function (d) {
    setOffline(false);
    if (!App.lastFormat) App.lastFormat = d.lastFormat;
    adoptServerRunning(d.running);
    App.prevStreak = d.stats && d.stats.streak ? d.stats.streak.days : null;
    App.currentDay = d.stats.today.dayKey;
    applyStats(d.stats);
    if (App.running && document.getElementById('timer').hidden) openTimer();
  }).catch(function (e) {
    if (e && e.offline) setOffline(true);
    throw e;
  });
}

function showApp(stats) {
  App.stats = stats;
  if (!App.currentDay) App.currentDay = stats.today.dayKey;
  if (!App.lastFormat) App.lastFormat = (stats.formats || [''])[0];

  document.getElementById('gate').hidden = true;
  document.getElementById('app').hidden = false;

  renderRecord();
  showView('record');

  if (App.running) {
    openTimer();
    var sec = Math.floor(runningElapsedMs(App.running) / 1000);
    if (sec >= 3 * 3600) {
      RUNAWAY_ASKED = true;
      openRunaway(sec);
    }
  }
}

function submitToken() {
  var input = document.getElementById('gate-input');
  var value = input.value.trim();
  var err = document.getElementById('gate-error');
  if (!value) return;

  err.hidden = true;
  App.token = value;

  api('verifyToken')
    .then(function () {
      try { localStorage.setItem(TOKEN_KEY, value); } catch (e) {}
      input.value = '';
      return loadApp();
    })
    .catch(function (e) {
      App.token = '';
      if (e && e.offline) {
        err.textContent = '電波がありません。つながる場所でもう一度。';
      } else {
        err.textContent = 'トークンが違います。';
      }
      err.hidden = false;
    });
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') return;
  navigator.serviceWorker.register('sw.js').catch(function () {
    // 失敗してもアプリ自体は動く
  });
}

function bindEvents() {
  document.getElementById('gate-submit').addEventListener('click', submitToken);
  document.getElementById('gate-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') submitToken();
  });

  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () { showView(b.dataset.target); });
  });

  document.getElementById('btn-pause').addEventListener('click', doPauseResume);
  document.getElementById('btn-stop').addEventListener('click', function () { doStop(null); });
  document.getElementById('btn-discard').addEventListener('click', doDiscard);

  document.getElementById('day-prev').addEventListener('click', function () { shiftDay(-1); });
  document.getElementById('day-next').addEventListener('click', function () { shiftDay(1); });
  document.getElementById('btn-add').addEventListener('click', function () { openSheet(null); });

  document.getElementById('sheet-cancel').addEventListener('click', closeSheet);
  document.getElementById('sheet-save').addEventListener('click', saveSheet);
  document.getElementById('sheet-delete').addEventListener('click', deleteSheet);
  document.getElementById('sheet').addEventListener('click', function (e) {
    if (e.target.id === 'sheet') closeSheet();
  });

  document.getElementById('runaway-keep').addEventListener('click', closeRunaway);
  document.getElementById('runaway-fix').addEventListener('click', function () {
    var v = document.getElementById('runaway-end').value;
    if (!v) return;
    closeRunaway();
    doStop(isoToMs(localInputToIso(v)));
  });

  document.getElementById('btn-sync').addEventListener('click', function () {
    toast('同期しています…');
    flushOutbox()
      .then(function () { return api('sync'); })
      .then(function (d) {
        setOffline(false);
        applyStats(d.stats);
        var r = d.result || {};
        var left = loadOutbox().length;
        toast('同期しました（追加 ' + (r.added || 0) + ' / 更新 ' + (r.updated || 0) + '）' +
          (left ? '\n未送信が ' + left + ' 件残っています' : ''));
      })
      .catch(function (e) {
        if (e && e.offline) setOffline(true);
        toast(e.message);
      });
  });

  document.getElementById('btn-logout').addEventListener('click', function () {
    forgetToken();
    toast('トークンを消しました');
  });

  // 画面に戻ったとき: 溜まっている記録を送り、集計を取り直す。
  // iPhone は閉じている間に送れないので、ここが主な送信の機会になる。
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !App.token) return;
    if (App.running) tickTimer();
    refreshFromServer();
  });

  // 電波が戻ったとき
  window.addEventListener('online', function () {
    if (App.token) refreshFromServer();
  });
  window.addEventListener('offline', function () { setOffline(true); });
}

function refreshFromServer() {
  flushOutbox()
    .then(function () { return api('stats'); })
    .then(function (d) {
      setOffline(false);
      applyStats(d.stats);
    })
    .catch(function (e) {
      if (e && e.offline) setOffline(true);
    });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
