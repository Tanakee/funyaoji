# Cloudflare の注意点

## 参照先

| 項目 | 参照先 |
|---|---|
| Worker の設定 | `cloudflare.config.ts` |
| デプロイの手順 | `.github/workflows/deploy.yml` |
| アカウント・メンバー・使用量 | Cloudflare のダッシュボード（アカウントは `team-sweater`） |
| `cf` のコマンド | [Develop, build, and deploy](https://developers.cloudflare.com/cf/projects/) |
| バージョンを戻す手順 | [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) |
| 上限 | [Workers](https://developers.cloudflare.com/workers/platform/limits/)、[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)、[ログ](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)、[Previews](https://developers.cloudflare.com/workers/previews/) |

## デプロイ

- デプロイは GitHub Actions が行う（`.github/workflows/deploy.yml`）。PR ごとにプレビューを作り、`main` にマージされ、`main` の CI が通ると本番にデプロイする（`workflow_run`）
- ローカルからのデプロイ（`npx cf deploy`）は、GitHub Actions が使えないときだけ行う。レビューと CI を通らず、コミットしていない変更も本番に出る
- ローカルからデプロイすると、本番の内容が `main` とずれる。同じ変更を、あとで `main` に入れる
- 本番で問題が起きたときは、前のバージョンに戻す（[Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)）

## アカウントのロール

- メンバーは、読み取り専用のロール（Workers Platform (Read-only)）で招待する。ログと使用量を見られる
- ローカルからのデプロイと、バージョンを戻す操作ができるのは、Super Administrator と Workers Platform Admin のロール。この2つのロールを持つ人を、2人以上にしておく
- 誰がどのロールかは、ダッシュボードの Members のページで確かめる

## 上限

無料プランを使っている。上限は1日ごとで、本番とプレビューの合計で数える。超えると、その種類の操作がエラーになる。

- Durable Objects のリクエストは、WebSocket で受信したメッセージを 20 通で1回と数える。スマホ4台が `tilt` を毎秒30回送り続けると、約4.6時間で1日の上限に届く（2026年11月時点の上限での計算）
- ログは、受信したメッセージ1通ごとに1件記録される。同じ条件で、約30分で1日の上限に届く。届くと、その日のログが記録されなくなる

## データや URL に影響する変更

| 変更 | 影響 |
|---|---|
| Worker の名前（`cloudflare.config.ts` の `name`） | 別の Worker としてデプロイされる。Durable Objects のデータは引き継がれない |
| `workers.dev` のサブドメイン（ダッシュボード） | 本番とプレビューの URL が全部変わる。データは残る |
| Durable Objects のクラスを消す | そのクラスのデータが消える。クラスを足した・消したバージョンをまたいでは、前のバージョンに戻せない |
| Durable Objects を `env` のバインディングで呼ぶ | プレビューが本番のストレージを使う。`ctx.exports` で呼ぶ（[Previews: Resources and isolation](https://developers.cloudflare.com/workers/previews/resources/)） |
| プレビューを消す | そのプレビューの Durable Objects のデータも消える |
