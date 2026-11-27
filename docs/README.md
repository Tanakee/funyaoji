# 開発する人へ

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [企画書](product.md) | コンセプト・ターゲットと利用シーン・コア体験・ゲームルール・テーマ「ito」との関連・スコープ・デモ |
| [設計](design.md) | システム構成・技術スタックと選定理由・ディレクトリ構成・完成の定義・決定の記録 |
| [API](api.md) | エンドポイント・メッセージのフィールドと例・設計方針 |
| [ゲームの進行](game.md) | 状態の遷移・画面・操作・プレイの終了・モード・距離・ランキング |
| [開発の進め方](development.md) | タスク（Issue の作り方・ラベル）・ブランチ・コミット・プルリクエスト・レビュー |
| [Cloudflare の注意点](cloudflare.md) | 参照先・デプロイ・アカウントのロール・上限・データや URL に影響する変更 |
| [AGENTS.md](../AGENTS.md) | AI に開発させるときの決まり |

## 動かし方

Node.js 24（24.22 以上）と npm を使う。

```sh
npm install
npm run dev
```

開発サーバーが動き、ターミナルに URL（`http://localhost:5173/`）が表示される。サーバー（Hono と Durable Objects）も同じコマンドでローカルで動く。

| URL | ページ |
|---|---|
| `/screen` | スクリーンのページ。開くとルームを作って WebSocket で接続し、スマホ用の URL と、関節ごとに最後に受信した `tilt` を表示する。切れたら、つなぎ直さずに close コードを表示する |
| `/screen?outcome=goal` | 結果画面のモック。トップページの「結果画面のモック」からも開ける。画面下のボタンでゴール・転倒・タイムアウト・切断を切り替える。ルームは作らない |
| `/play` | スマホのページ |

| エンドポイント | 内容 |
|---|---|
| `GET /api/ping` | Durable Objects が数えた、呼ばれた回数を返す |
| `POST /api/rooms` | ルームを作り、ルームコードを返す |
| `GET /api/rooms/<ルームコード>/ws?role=screen` または `role=phone` | WebSocket で接続する（[API](api.md)） |

ローカルの Durable Objects のデータは、Local Explorer（`http://localhost:5173/cdn-cgi/local/explorer`）で見られる。

スマホのページが無くても、スクリプトをスマホの代わりにつなげる。`/screen` に表示されたルームコードを渡すと、`role=phone` で接続し、`tilt` を毎秒30回送り続ける。`ping` には `pong` を返す。受信したメッセージを表示し、Ctrl+C ですべての台を閉じてから止まる。どれかの台が断られた（`rejected`）か、一度もつながらなかったときは、終了コード 1 で終わる。

```sh
node scripts/fake-phone.ts <ルームコード>
node scripts/fake-phone.ts <ルームコード> --phones 4 --url http://localhost:5173
```

`--phones` はつなぐ台数（省くと1台）、`--url` は開発サーバーの URL（省くと `http://localhost:5173`）。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを動かす |
| `npm run build` | 本番用にビルドする（`.cloudflare/output/` に出力する） |
| `npm run preview` | ビルドした結果をローカルで開く。先に `npm run build` を実行する。`npm run check` はビルドの出力を消すので、そのあとはビルドし直す |
| `npm run check` | フォーマット・lint・型の検査とテストを順に実行する。PR の CI も同じコマンドを実行する |
| `npm test` | テストだけを1回実行する |
| `npx vp check --fix` | フォーマットと lint の指摘のうち、直せるものを直す |

テストのファイルは `*.test.ts`。サーバーのテスト（`src/server/` の `*.test.ts`）と、サーバーにつなぐほかのテスト（`*.server.test.ts`）は、テストの前に開発サーバーを空いているポートで立て、HTTP と WebSocket でつないで確かめる。開発サーバーは `src/server/test-setup.ts` が立て、テストが終わると止める。Durable Objects のデータはファイルに残さない。`npm run dev` の開発サーバーとは別に動くので、止めなくてよい。

型の検査は2つに分ける。ブラウザと Worker で動くファイルは `tsconfig.app.json` で、Node.js で動くファイル（`vite.config.ts` と、テストの準備の `src/server/test-setup.ts`・`src/server/test-server.ts` と、`scripts/`）は `tsconfig.node.json` で検査する。ブラウザと Worker のコードでは、Node.js の型（`process` など）を使えない。`npm run check` は両方を検査する。`tsconfig.json` は、エディタのために2つを参照するだけ。

ツールは [Vite+](https://viteplus.dev/guide/)（`vp`）を使う。`vp` はプロジェクトに入っているので、別にインストールしなくてよい。

Worker の名前と Durable Objects は `cloudflare.config.ts` に書く。CLI の `cf` もプロジェクトに入っている（`npx cf`）。

## 環境とデプロイ

| 環境 | URL | 更新のきっかけ |
|---|---|---|
| ローカル | `http://localhost:5173/` | `npm run dev` |
| プレビュー | `https://<ブランチ名>-funyaoji.team-sweater.workers.dev/` | PR を出す・更新する |
| 本番 | `https://funyaoji.team-sweater.workers.dev/` | `main` にマージする |

プレビューの URL は、PR のコメントに表示される。ブランチ名の `/` は `-` に置き換わる。デプロイの決まりと上限は [Cloudflare の注意点](cloudflare.md) にある。
