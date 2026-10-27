/* ===========================================================
   共有状態・通信・小物

   サーバー(GAS)は Asia/Tokyo 固定。ISO 文字列は必ず +09:00 付きで来るので、
   時刻の取り出しは Date に変換せず文字列のまま切り出す。
   端末のタイムゾーン設定に結果が左右されない。
   =========================================================== */
var App = {
  token: '',
  stats: null,
  running: null,
  lastFormat: '',
  currentDay: '',
  view: 'record',
  tickHandle: null,
  prevStreak: null,
  offline: false,
};

var TOKEN_KEY = 'yobi_studylog_token';

/* ---------- 通信 ---------- */

/**
 * GAS を叩く。Content-Type を text/plain にしているのは、CORS の単純リクエストに
 * 収めてプリフライト(OPTIONS)を発生させないため。GAS は OPTIONS に応答できない。
 */
var API_TIMEOUT_MS = 20000;

/** 電波が無い・届かないときの失敗。これだけは「あとで送り直す」扱いにする。 */
function offlineError_() {
  var e = new Error('電波がありません。記録はこの端末に残し、あとで送ります。');
  e.offline = true;
  return e;
}

function api(action, args) {
  // 地下鉄では fetch が失敗せずに止まり続けることがあるので、時間で切る
  var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, API_TIMEOUT_MS) : null;

  return fetch(CONFIG.endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: action, token: App.token, args: args || [] }),
    signal: ctrl ? ctrl.signal : undefined,
  })
    .then(function (r) {
      if (timer) clearTimeout(timer);
      if (!r.ok) throw new Error('サーバーが応答しません (' + r.status + ')');
      return r.json();
    }, function () {
      if (timer) clearTimeout(timer);
      throw offlineError_();
    })
    .then(function (res) {
      if (!res || res.ok === false) {
        if (res && res.unauthorized) forgetToken();
        throw new Error((res && res.error) || '処理に失敗しました');
      }
      return res.data;
    });
}

function forgetToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
  App.token = '';
  App.running = null;
  stopTick();
  document.getElementById('app').hidden = true;
  document.getElementById('timer').hidden = true;
  document.getElementById('sheet').hidden = true;
  document.getElementById('runaway').hidden = true;
  document.getElementById('gate').hidden = false;
}

/* ---------- 文字列・時刻 ---------- */

function fmtHM(minutes) {
  var m = Math.max(0, Math.floor(Number(minutes) || 0));
  var h = Math.floor(m / 60);
  var mm = m % 60;
  return h + ':' + (mm < 10 ? '0' + mm : mm);
}

function fmtJp(minutes) {
  var m = Math.max(0, Math.floor(Number(minutes) || 0));
  var h = Math.floor(m / 60);
  var mm = m % 60;
  return h === 0 ? mm + '分' : h + '時間' + mm + '分';
}

/** 経過秒 -> '1:23:45' / '12:34' */
function fmtClock(seconds) {
  var s = Math.max(0, Math.floor(Number(seconds) || 0));
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  var ss = s % 60;
  var mm = m < 10 && h > 0 ? '0' + m : String(m);
  var s2 = ss < 10 ? '0' + ss : String(ss);
  return h > 0 ? h + ':' + mm + ':' + s2 : mm + ':' + s2;
}

function isoTime(iso) { return String(iso || '').substr(11, 5); }
function isoDay(iso) { return String(iso || '').substr(0, 10); }
function isoToLocalInput(iso) { return String(iso || '').substr(0, 16); }

/** datetime-local の値を JST の ISO にする */
function localInputToIso(value) {
  var v = String(value || '').trim();
  if (!v) return '';
  if (v.length === 16) v += ':00';
  return v + '+09:00';
}

var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

/** 'YYYY-MM-DD' -> '8月2日 (土)' */
function dayLabel(dayKey) {
  var p = String(dayKey || '').split('-');
  if (p.length !== 3) return '';
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  return (+p[1]) + '月' + (+p[2]) + '日 (' + WEEKDAYS[d.getUTCDay()] + ')';
}

function todayKeyLocal() {
  if (App.stats && App.stats.today && App.stats.today.dayKey) return App.stats.today.dayKey;
  var d = new Date();
  var p = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60000);
  return p.getFullYear() + '-' + pad2(p.getMonth() + 1) + '-' + pad2(p.getDate());
}

function pad2(n) { return n < 10 ? '0' + n : String(n); }

/** 日本時間の「今」を datetime-local の値にする */
function nowLocalInput() {
  var now = new Date();
  var jst = new Date(now.getTime() + (9 * 60 + now.getTimezoneOffset()) * 60000);
  return jst.getFullYear() + '-' + pad2(jst.getMonth() + 1) + '-' + pad2(jst.getDate()) +
    'T' + pad2(jst.getHours()) + ':' + pad2(jst.getMinutes());
}

/** ミリ秒 -> 日本時間の ISO 文字列 '2026-10-27T08:15:00+09:00' */
function msToIso(ms) {
  var d = new Date(ms + 9 * 3600000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) +
    'T' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds()) +
    '+09:00';
}

function isoToMs(iso) {
  var t = Date.parse(String(iso || ''));
  return isNaN(t) ? 0 : t;
}

function newId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** 記録画面に出す全科目(9科目 + 横断) */
function allSubjects() {
  var s = App.stats || {};
  return (s.subjectOrder || []).concat(s.crossSubjects || []);
}

function subjectColor(subject) {
  var colors = (App.stats && App.stats.colors) || {};
  return colors[subject] || '#9ba6b1';
}

/* ---------- トースト ---------- */

var toastTimer = null;
function toast(message, ms) {
  if (!message) return;
  var el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('is-on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('is-on'); }, ms || 3200);
}

/* ---------- 画面切り替え ---------- */

function showView(name) {
  App.view = name;
  ['record', 'dashboard', 'history'].forEach(function (v) {
    document.getElementById('view-' + v).hidden = v !== name;
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.classList.toggle('is-on', b.dataset.target === name);
  });
  window.scrollTo(0, 0);
  if (name === 'dashboard') renderDashboard();
  if (name === 'history') renderHistory();
}

function applyStats(stats) {
  if (!stats) return;
  App.stats = stats;
  saveCachedStats(stats);
  renderRecord();
  if (App.view === 'dashboard') renderDashboard();
}

function el(tag, className, text) {
  var e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
