/* ===========================================================
   Service Worker

   殻(HTML/CSS/JS/アイコン)だけをキャッシュする。
   記録そのものは GAS にあるので、オフラインでは画面が開くだけで
   データは出ない。中途半端なオフライン書き込みは同期の衝突を生むので作らない。

   ファイルを更新したら CACHE の版を上げること。上げないと古い殻が残る。
   =========================================================== */
var CACHE = 'yobi-studylog-v1';

var ASSETS = [
  './',
  './index.html',
  './app.css',
  './config.js',
  './js/core.js',
  './js/record.js',
  './js/dashboard.js',
  './js/history.js',
  './js/boot.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.map(function (k) {
          return k === CACHE ? null : caches.delete(k);
        }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;

  // GAS への POST や外部フォントには触らない
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  // 殻はキャッシュ優先。裏で取り直して次回に備える。
  e.respondWith(
    caches.match(req).then(function (hit) {
      var fresh = fetch(req)
        .then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        })
        .catch(function () { return hit; });
      return hit || fresh;
    })
  );
});
