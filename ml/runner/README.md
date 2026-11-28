# 学習のジョブの self-hosted runner

理論値の記録の作り直し（`.github/workflows/ml-retrain.yml`）の、学習のジョブ（`retrain`）だけを、チームのマシンで流すためのランナー。Docker の Linux コンテナで動かし、ジョブを1つ流すたびに使い捨てる。決まり（公開リポジトリで使うときの注意・リポジトリの設定）は [docs/ml.md の「どこで学習を流すか」](../../docs/ml.md#どこで学習を流すか) にある。

| ファイル | 中身 |
|---|---|
| `compose.yaml` | ランナーのコンテナ。ラベル・使い捨て・CPU とメモリの上限 |
| `Dockerfile` | 元のイメージ（[myoung34/github-runner](https://github.com/myoung34/docker-github-actions-runner)。版を固定）に、動画のフォントを足し、ジョブから root の権限を外したもの |
| `reset.sh` | コンテナの起動のたびに、前のジョブが残したものを消し、ランナーの本体を元に戻してから登録する |
| `.env.example` | `.env` の例。`.env` に登録の秘密を書く（コミットしない） |

## しくみ

1. コンテナが起きると、`reset.sh` が作業フォルダ・ツールのキャッシュ・一時ファイル・ホームを消し、ランナーの本体をイメージの写しに戻す
2. 登録の秘密（PAT）で登録のトークンを取り、ラベル `funyaoji-ml`（と既定の `self-hosted`・`Linux`・`X64`）でリポジトリに登録して、ジョブを待つ
3. ジョブを1つ流すと、ランナーは登録を消して終わる（`EPHEMERAL`）。コンテナが終わり、`restart: unless-stopped` で起き直して 1 に戻る

- ジョブは root でなく `runner` のユーザーで動き、`sudo` を使えない。書けるのは 1 で消す場所だけなので、ジョブが何かを書き換えても次のジョブに残らない
- ホストの Docker のソケットやフォルダはマウントしない
- ランナーが1つなので、学習し直すモードが2つ以上あるときは、1つずつ順に流れる

## マシンの持ち主がやること

### 立て方

前もって、Docker Desktop を入れ、下の「Windows で Docker Desktop を使うとき」を済ませる。管理者から、登録の秘密（PAT）を受け取る。

```sh
cd ml/runner
cp .env.example .env
# .env の ACCESS_TOKEN に PAT を書く。RUNNER_CPUS・RUNNER_MEMORY をマシンに合わせる
docker compose up -d --build
```

- GitHub の Settings → Actions → Runners に `funyaoji-ml-...` が「Idle」で出れば、ジョブを待っている
- PAT はチャットやコミットに貼らない。`.env` だけに書く。`docker compose config` は `.env` の値を表示するので、画面を人に見せない
- 学習の並べ方は、管理者がリポジトリの変数 `ML_TRAIN_WORKERS` で決める。`RUNNER_CPUS` が 20 前後なら 16 にする（Node のプロセス 16 個 × 8 体）

### 止め方

```sh
cd ml/runner
docker compose down
```

- 止めるとランナーは登録を消す。学習のジョブは、ランナーが戻るまで待つ（24 時間で落ちる）。長く止めるときは、管理者に変数 `ML_TRAIN_RUNNER` を消してもらい、GitHub のマシンに戻す
- ジョブを流している途中で止めると、そのジョブは落ちる。Actions の画面で、ジョブが流れていないことを確かめてから止める

### ログの見方

```sh
docker compose logs -f          # 登録・ジョブを待つ・ジョブの名前
docker compose ps               # 動いているか（Restarting が続くときは「困ったとき」）
```

- ジョブの中身のログは、GitHub の Actions の画面で見る（GitHub のマシンで流したときと同じ）
- ログは 10MB × 5 本まで残す（`compose.yaml` の `logging`）

### 更新のしかた

ランナーの本体は自分では上がらない（`DISABLE_AUTO_UPDATE`。使い捨てで毎回イメージに戻すため）。GitHub は古いランナーにジョブを渡さなくなるので、新しい版が出たら、月に一度くらい上げる。

1. [Docker Hub のタグ](https://hub.docker.com/r/myoung34/github-runner/tags) で、新しい `<版>-ubuntu-noble` を探す
2. その digest を調べる：`docker pull myoung34/github-runner:<版>-ubuntu-noble` のあと `docker image inspect --format '{{index .RepoDigests 0}}' myoung34/github-runner:<版>-ubuntu-noble`
3. `Dockerfile` の `FROM` の版と digest を書き換え、PR で入れる
4. マシンで、そのブランチ（マージしたあとは main）を取ってから `docker compose up -d --build`

- `.env` とコンテナの外のものは、更新で変わらない

### 困ったとき

| 起きたこと | 見るところと直し方 |
|---|---|
| `docker compose ps` が `Restarting` のまま | `docker compose logs` を見る。`401` や `Invalid configuration provided for token` なら、PAT が違うか期限切れ。管理者に作り直してもらい、`.env` を書き換えて `docker compose up -d` |
| ランナーが GitHub の画面に出ない | 上と同じくログを見る。マシンがネットにつながっているか、Docker Desktop が動いているか |
| 学習のジョブが「Waiting for a runner」のまま | ランナーが止まっているか、ラベルが合っていない。変数 `ML_TRAIN_RUNNER` のラベルが、`self-hosted`・`linux`・`x64`・`funyaoji-ml` の中だけか |
| ジョブが「作業フォルダが空でない」で落ちる | 使い捨てになっていない。`reset.sh` が動いていない（`Dockerfile` の `ENTRYPOINT` を変えた、など）。`docker compose down` のあと `docker compose up -d --build` |
| ジョブがメモリ不足（`Killed`）で落ちる | `RUNNER_MEMORY` を上げるか、変数 `ML_TRAIN_WORKERS` を下げる。WSL2 のメモリの上限（下）より上げても効かない |
| `reset.sh` が「runner のユーザーのファイルが、消す場所の外にある」で止まる | 元のイメージを上げて、ジョブが書ける場所が増えた。`Dockerfile` の chown と `reset.sh` の消す場所を見直す |
| すぐにランナーを外したい | `docker compose down`。急ぐときは、管理者が Settings → Actions → Runners からランナーを消し、変数 `ML_TRAIN_RUNNER` を消す |

## Windows で Docker Desktop を使うとき

- **PC の再起動のあと**：Docker Desktop の Settings → General の「Start Docker Desktop when you sign in to your computer」を入れる。Windows にサインインすると Docker が起き、コンテナも起きる（`restart: unless-stopped`）。サインインするまでは起きないので、再起動したらサインインしておく。`docker compose down` で止めたときは、再起動しても起きない
- **スリープ**：スリープ・休止のあいだはジョブが止まり、落ちる。ランナーを立てているあいだは、電源の設定でスリープしないようにする。Windows Update の再起動の時間も、学習を流しそうな時間から外す
- **WSL2 のメモリと CPU の上限**：Docker Desktop（WSL2 のバックエンド）のコンテナは、WSL2 の VM の中で動く。VM の上限は `%UserProfile%\.wslconfig` で決まる（既定はメモリがマシンの半分、CPU は全部）。`RUNNER_CPUS`・`RUNNER_MEMORY` は、VM の上限より小さくする。変えたら `wsl --shutdown` のあと Docker Desktop を起動し直す

  ```ini
  [wsl2]
  memory=24GB
  processors=24
  ```

- **ディスク**：イメージは約 4.5GB。ジョブのたびに、Node・uv・Python の依存（PyTorch の CPU 版など）を落とし直すので、コンテナの中で数 GB 使い、起き直すたびに消える。WSL2 の仮想ディスクは自動では縮まないので、空きが減ったら Docker Desktop の Troubleshoot → Clean / Purge data か、`docker system prune` を使う
- **マシンを使いながら**：学習のあいだは `RUNNER_CPUS` のコアを使い切る。マシンで作業するなら、`RUNNER_CPUS` を下げる
- **ネットワーク**：コンテナからは、マシンと同じ LAN に届く。ジョブは同じリポジトリの PR のコードを動かすので、LAN に守るべきものがあるマシンでは立てない（docs/ml.md の「どこで学習を流すか」）
