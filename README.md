# studylog — フロントエンド (PWA)

**公開URL: https://nodamachi.github.io/studylog-app/**

学習時間を記録・可視化する PWA の「殻」。
GitHub Pages で配信し、データは Google Apps Script の Web アプリを JSON API として叩いて出し入れする。

**このリポジトリにデータは一切入らない。** 学習記録も認証トークンも Google 側にあり、
ここにあるのは画面を描くための HTML / CSS / JS だけ。記録を読むにはトークンが要る。

## なぜ殻を分けているか

GAS の Web アプリは `script.google.com` のサンドボックス iframe の中で動く。その結果、

- `manifest.json` が効かず、ホーム画面に追加してもブラウザ UI が消えない
- iOS Safari が iframe の `localStorage` を第三者ストレージとして遮断するため、
  再起動のたびにトークンの再入力を求められる
- ステータスバー（ノッチ周り）の色を指定できない
- Service Worker を登録できない

自前のオリジンに殻を置くと、この4つがまとめて解決する。

## 構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の骨格 |
| `app.css` | デザイントークンと全スタイル |
| `config.js` | GAS のエンドポイント URL |
| `js/core.js` | 通信・状態・画面切替・トースト |
| `js/offline.js` | 端末内タイマー・未送信の箱・集計の保存(電波なし対応) |
| `js/record.js` | 記録画面とタイマー |
| `js/dashboard.js` | ダッシュボードの描画 |
| `js/history.js` | 履歴と編集ダイアログ |
| `js/boot.js` | 起動とイベント配線 |
| `sw.js` | Service Worker（殻だけキャッシュ） |
| `manifest.webmanifest` | PWA マニフェスト |

サーバー側（GAS）のソースは別リポジトリ。ローカルの `C:\Users\white\studylog-server`。

## 通信

`config.js` の `endpoint` に対して POST 1本。

```js
fetch(CONFIG.endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },
  body: JSON.stringify({ action: 'bootstrap', token: '...', args: [] })
})
```

**`Content-Type` は必ず `text/plain` にすること。** `application/json` にすると
CORS のプリフライト（OPTIONS）が飛ぶが、GAS は OPTIONS に応答できないので必ず失敗する。
`text/plain` なら単純リクエストとして扱われ、プリフライトが発生しない。

action は `verifyToken` / `bootstrap` / `stats` / `sessionsForDay` / `recordedDays` /
`start` / `pause` / `resume` / `stop` / `discard` / `addManual` / `editSession` /
`deleteSession` / `sync`。

## 電波が無いとき

タイマーは端末の `localStorage` で動き、開始・一時停止・終了で通信しない。
終えた記録は「未送信の箱」に入り、`addMany` でまとめて送る。記録ごとに端末で
id を付けるので、返事が届かずに送り直してもサーバー側で二重にならない。
送るのは「開いたとき」「画面に戻ったとき」「電波が戻ったとき」「記録を終えたとき」。
iPhone は閉じている間に送れない(バックグラウンド同期が無い)。
編集・削除は電波があるときだけ。

科目横断の「Anki」はサーバーの `CROSS_SUBJECTS`。今日の合計・目標・連続日数には入り、
科目の配分と「〇日ぶり」の警告には入らない。

## トークン

初回に入力すると `localStorage` に入る。自前オリジンなので iOS でも消えない。
`#t=<トークン>` を付けた URL で開くと入力を省略でき、その場合は履歴に残らないよう
`history.replaceState` で URL から消す。

トークンを消したいときはダッシュボード右上の「ログアウト」。

## 更新のしかた

```bash
cd C:/Users/white/studylog-app
git add -A
git commit -m "..."
git push
```

push すると GitHub Pages が数十秒で反映する。

**`sw.js` の `CACHE` の版を上げること。** 上げないと古い殻がキャッシュに残り、
更新が反映されない。

## ローカルで確認

```bash
cd C:/Users/white/studylog-app
npx --yes http-server -p 4173 -c-1
```

`http://localhost:4173` を開く。Service Worker は localhost でも登録される。
