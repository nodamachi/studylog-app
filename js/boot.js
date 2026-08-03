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

  loadApp().catch(function () { forgetToken(); });
}

function loadApp() {
  return api('bootstrap').then(function (d) {
    App.stats = d.stats;
    App.running = d.running;
    App.lastFormat = d.lastFormat;
    App.prevStreak = d.stats && d.stats.streak ? d.stats.streak.days : null;
    App.currentDay = d.stats.today.dayKey;

    document.getElementById('gate').hidden = true;
    document.getElementById('app').hidden = false;

    renderRecord();
    showView('record');

    if (App.running) {
      openTimer();
      if (App.running.elapsedSeconds >= (d.runawayHours || 3) * 3600) {
        RUNAWAY_ASKED = true;
        openRunaway(App.running.elapsedSeconds);
      }
    }
  });
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
    .catch(function () {
      App.token = '';
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
    doStop(localInputToIso(v));
  });

  document.getElementById('btn-sync').addEventListener('click', function () {
    toast('同期しています…');
    api('sync')
      .then(function (d) {
        applyStats(d.stats);
        var r = d.result || {};
        toast('同期しました（追加 ' + (r.added || 0) + ' / 更新 ' + (r.updated || 0) + '）');
      })
      .catch(function (e) { toast(e.message); });
  });

  document.getElementById('btn-logout').addEventListener('click', function () {
    forgetToken();
    toast('トークンを消しました');
  });

  // 別の端末で開始・停止された場合に追随する
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !App.token) return;
    api('stats')
      .then(function (d) {
        App.running = d.running;
        applyStats(d.stats);
        if (App.running) {
          if (document.getElementById('timer').hidden) openTimer();
        } else {
          closeTimer();
        }
      })
      .catch(function () {});
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
