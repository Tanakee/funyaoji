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

ローカルの Durable Objects のデータは、Local Explorer（`http://localhost:5173/cdn-cgi/local/explorer`）で見られる。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバーを動かす |
| `npm run build` | 本番用にビルドする（`.cloudflare/output/` に出力する） |
| `npm run preview` | ビルドした結果をローカルで開く。先に `npm run build` を実行する |
| `npx vp check` | フォーマット・lint・型の検査をする。`--fix` を付けると、直せるものを直す |

ツールは [Vite+](https://viteplus.dev/guide/)（`vp`）を使う。`vp` はプロジェクトに入っているので、別にインストールしなくてよい。

Worker の名前・Durable Objects・バインディングは `cloudflare.config.ts` に書く。CLI の `cf` もプロジェクトに入っている（`npx cf`）。
