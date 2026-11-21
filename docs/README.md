# 開発する人へ

## ドキュメント

| ドキュメント | 内容 |
|---|---|
| [企画書](product.md) | コンセプト・ターゲットと利用シーン・コア体験・ゲームルール・テーマ「ito」との関連・スコープ・デモ |
| [設計](design.md) | システム構成・技術スタックと選定理由・ディレクトリ構成・完成の定義・決定の記録 |
| [API](api.md) | エンドポイント・メッセージのフィールドと例・設計方針 |
| [ゲームの進行](game.md) | 状態の遷移・画面・操作・プレイの終了・モード・距離・ランキング |
| [開発の進め方](development.md) | タスク（Issue の作り方・ラベル）・ブランチ・コミット・プルリクエスト・レビュー |
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
| `/screen` | スクリーンのページ。サーバーを呼んだ回数を表示する |
| `/play` | スマホのページ |

| エンドポイント | 内容 |
|---|---|
| `GET /api/ping` | Durable Objects が数えた、呼ばれた回数を返す |
| `POST /api/rooms` | ルームを作り、ルームコードを返す |
| `GET /api/rooms/<ルームコード>/ws?role=screen` または `role=phone` | WebSocket で接続する（[API](api.md)） |

ローカルの Durable Objects のデータは、Local Explorer（`http://localhost:5173/cdn-cgi/local/explorer`）で見られる。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを動かす |
| `npm run build` | 本番用にビルドする（`.cloudflare/output/` に出力する） |
| `npm run preview` | ビルドした結果をローカルで開く。先に `npm run build` を実行する。`npm run check` はビルドの出力を消すので、そのあとはビルドし直す |
| `npm run check` | フォーマット・lint・型の検査とテストを順に実行する。PR の CI も同じコマンドを実行する |
| `npm test` | テストだけを1回実行する |
| `npx vp check --fix` | フォーマットと lint の指摘のうち、直せるものを直す |

テストのファイルは `*.test.ts`。サーバーのテスト（`src/server/index.test.ts`）は、テストの前に開発サーバーを空いているポートで立て、HTTP と WebSocket でつないで確かめる。開発サーバーは `src/server/test-setup.ts` が立て、テストが終わると止める。Durable Objects のデータはファイルに残さない。`npm run dev` の開発サーバーとは別に動くので、止めなくてよい。

ツールは [Vite+](https://viteplus.dev/guide/)（`vp`）を使う。`vp` はプロジェクトに入っているので、別にインストールしなくてよい。

Worker の名前・Durable Objects・バインディングは `cloudflare.config.ts` に書く。CLI の `cf` もプロジェクトに入っている（`npx cf`）。
