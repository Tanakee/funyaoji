# 学習のジョブの self-hosted runner

理論値の記録の作り直し（`.github/workflows/ml-retrain.yml`）の、学習のジョブ（`retrain`）だけを、チームのマシンで流すためのランナー。Docker の Linux コンテナで動かし、ジョブを1つ流すたびにコンテナを作って捨てる。決まり（公開リポジトリで使うときの注意・残る危うさ・リポジトリの設定）は [docs/ml.md の「どこで学習を流すか」](../../docs/ml.md#どこで学習を流すか) にある。

| ファイル | 中身 |
|---|---|
| `compose.yaml` | manager のコンテナと、ジョブのコンテナのイメージ |
| `manager.sh`・`manager.Dockerfile` | manager。PAT で1回きりの JIT の設定を取り、ジョブのコンテナを1つずつ起こす |
| `job.Dockerfile`・`run-job.sh` | ジョブのコンテナのイメージ。公式のランナーのイメージ（`ghcr.io/actions/actions-runner`。ARC が使うもの。版と digest で固定）に、動画のフォントを足し、`sudo` を消し、ランナーの本体を root の持ち物にしたもの。`run-job.sh` が、JIT の設定でランナーを1回だけ動かす |
| `.env.example` | `.env` の例。`.env` に登録の秘密を書く（コミットしない。`.dockerignore` でイメージにも入れない） |

## しくみ

```
manager（PAT・Docker のソケットを持つ。ジョブのコードは動かさない）
  └ ループ：JIT の設定を取る → ジョブのコンテナを docker run --rm で起こす → 終わるのを待つ
      └ ジョブのコンテナ（JIT の設定だけを持つ。runner のユーザーで、ジョブを1つ流して消える）
```

1. manager が、前のジョブのコンテナが消えたこと、ジョブのイメージが手元にあることを確かめる
2. GitHub の API（`generate-jitconfig`）から、1回きりの JIT の設定を取る。ラベルは `self-hosted`・`Linux`・`X64`・`funyaoji-ml`、名前は `funyaoji-ml-<置き場所の名前>-<日時>-<乱数>`。取った runner ID を記録する（manager の volume）。応答に正の整数の runner ID と JIT の設定がそろっていなければ、起こさない
3. その設定だけを渡して、ジョブのコンテナを `docker run --rm --pull=never` で起こす。コンテナは最初から `runner` のユーザーで、ランナーの本体だけを動かし、ジョブを待つ
4. ジョブを1つ流すと、ランナーが終わり、コンテナが消える。GitHub がランナーの登録を消す。manager は記録した ID の登録を消し（もう無ければ記録から除く）、1 に戻る

- PAT を持つのは manager だけ。ジョブのコンテナには、PAT も Docker のソケットもホストのフォルダも渡さない
- manager の片づけは、この置き場所のものだけにする。Docker のコンテナは、置き場所の名前（`.env` の `RUNNER_INSTANCE`）のラベルが付いたものだけを消す。GitHub の登録は、自分が取って記録した runner ID だけを消す。消せなかった（通信が止まったなど）ときは記録に残し、あとで消し直す。記録の無い登録は、GitHub が自動で消すのに任せる
- GitHub の API には、1回 30 秒（止めるときは 10 秒）の期限を、Docker の操作にも期限を付ける。止める処理は、compose の猶予（90 秒）の中に終わる
- ランナーは自分では更新しない（`run-job.sh` が、JIT の設定の `.runner` に `DisableUpdate` を足す）。更新は、イメージの版を上げて行う（下の「更新のしかた」）
- ジョブのコンテナの中では root が何も動かさない。`sudo` は無い。ランナーの本体（`/actions-runner`）は root の持ち物で、ジョブからは書き換えられない（登録の情報・ログ・作業フォルダを作れるだけ）。だれでも書けるファイルが無いことを、イメージを作るときに確かめる
- ジョブのコンテナは、権限を全部外し（`--cap-drop ALL`）、権限を上げさせず（`no-new-privileges`）、CPU・メモリ・プロセスの数に上限を付ける
- ジョブのコンテナは毎回新しく作るので、前のジョブが書いたものは次のジョブに残らない
- ランナーが1つなので、学習し直すモードが2つ以上あるときは、1つずつ順に流れる

### JIT の設定が残る場所

JIT の設定は、そのランナーの登録の情報（認証の鍵を含む）そのもの。1回きりで、ジョブを流し終えると使えなくなるが、そのジョブのあいだは、次の場所に残る。どれも、ジョブと同じ `runner` のユーザーから読める（ランナーが読むので、隠せない）。

- ジョブのコンテナの設定（環境の変数 `RUNNER_JITCONFIG`）。ホストで `docker inspect` すると見える。コンテナの中では、最初のプロセス（`--init` の docker-init）の環境（`/proc/1/environ`）にも残る
- ランナー（`Runner.Listener`）の引数（`--jitconfig`。`/proc/<番号>/cmdline`）
- 展開された認証のファイル（`/actions-runner/.runner`・`.credentials`・`.credentials_rsaparams`）

ジョブのステップの環境の変数からは消してある（`run-job.sh`）。コンテナを捨てると、全部消える。

## マシンの持ち主がやること

### 立て方

前もって、Docker Desktop を入れ、下の「Windows で Docker Desktop を使うとき」を済ませる。管理者から、登録の秘密（PAT）を受け取る。

```sh
cd ml/runner
cp .env.example .env
# .env の ACCESS_TOKEN に PAT を、RUNNER_INSTANCE に置き場所の名前（ml-1 など。人やマシンの本当の名前にしない）を書く。
# 2台目を立てるときは、別の RUNNER_INSTANCE にする。RUNNER_CPUS・RUNNER_MEMORY をマシンに合わせる
docker compose --profile job build   # manager とジョブのコンテナのイメージを作る
docker compose up -d                 # manager を起こす
```

- GitHub の Settings → Actions → Runners に `funyaoji-ml-...` が「Idle」で出れば、ジョブを待っている（管理者に見てもらう）
- PAT はチャットやコミットに貼らない。`.env` だけに書く。`docker compose config` は `.env` の値を表示するので、画面を人に見せない
- 学習の並べ方は、管理者がリポジトリの変数 `ML_TRAIN_WORKERS` で決める。`RUNNER_CPUS` が 20 前後なら 16 にする（Node のプロセス 16 個 × 8 体）

### 止め方

```sh
cd ml/runner
docker compose down
```

- manager は止まるときに、ジョブのコンテナを止め、ジョブを受け取っていないランナーの登録を消す
- ジョブを流している途中で止めると、そのジョブは落ちる。Actions の画面で、ジョブが流れていないことを確かめてから止める
- 止めているあいだ、学習のジョブはランナーを待つ（24 時間で落ちる）。長く止めるときは、管理者に変数 `ML_TRAIN_RUNNER` を消してもらう（docs/ml.md の「ランナーが止まっていて、学習が始まらないとき」）
- 登録が残ったとき：manager が落ちた・PC の電源が切れた・通信が止まったなどで、登録を消せないことがある。manager は取った runner ID を volume に記録しているので、次に manager が起きるときに消し直す。manager を起こさないなら、管理者が Settings → Actions → Runners から `funyaoji-ml-<置き場所の名前>-...` を消す（消さなくても、GitHub がしばらくして消す）
- `docker compose down -v` は記録の volume も消すので、消し残した登録は消し直されない（GitHub の自動削除に任せる）。ふつうは `-v` を付けない

### ログの見方

```sh
docker compose logs -f manager   # JIT の設定を取った・ジョブのコンテナを起こした・終わった。ランナーのログも混ざる
docker compose ps                # manager が動いているか
docker ps --filter label=funyaoji-ml-instance=<置き場所の名前>   # いま動いているジョブのコンテナ
```

- ジョブの中身のログは、GitHub の Actions の画面で見る（GitHub のマシンで流したときと同じ）
- ログは 10MB × 5 本まで残す（`compose.yaml` の `logging`）

### 更新のしかた

ランナーは自分では更新しない。ランナーの本体を root の持ち物にしたので、自分で置き換えられないため、`run-job.sh` が JIT の設定の `.runner` に `DisableUpdate` を足して起こす。ランナーは GitHub に「自分では更新しない」と伝え、GitHub は更新の知らせを送らない（actions/runner v2.338.2 の `MessageListener`）。古くなると、ジョブのログに「古い」という警告が出て、そのうち GitHub がジョブを渡さなくなるので、新しい版が出たら、月に一度くらい上げる。

1. [actions/runner のリリース](https://github.com/actions/runner/releases) で新しい版を見る
2. その digest を調べる：`docker pull ghcr.io/actions/actions-runner:<版>` のあと `docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/actions/actions-runner:<版>`
3. `job.Dockerfile` の `FROM` の版と digest を書き換え、PR で入れる。manager の元のイメージ（`manager.Dockerfile` の `docker:<版>-cli`）も、同じように上げてよい
4. マシンで、そのブランチ（マージしたあとは main）を取ってから、イメージを作り直す：`docker compose --profile job build`
5. **待っている古いジョブのコンテナを入れ替える。** `docker compose up -d` だけでは、古いイメージで起こしたジョブのコンテナが、ジョブを待ったまま残る。Actions の画面で、学習のジョブが流れていないことを確かめてから、`docker compose up -d --force-recreate manager` で manager を作り直す。manager は止まるときに古いジョブのコンテナを止めて登録を消し、起き直すと新しいイメージでジョブのコンテナを起こす
6. `docker ps --filter label=funyaoji-ml-instance=<置き場所の名前> --format '{{.Image}} {{.CreatedAt}}'` で、ジョブのコンテナが作り直した時刻のものになったかを見る

- イメージを作るときに、だれでも書けるファイルが見つかると、ビルドが止まる（`job.Dockerfile` の最後）。元のイメージが変わったら、そのファイルを直してから使う

### 困ったとき

| 起きたこと | 見るところと直し方 |
|---|---|
| ログに「JIT の設定を取れなかった（HTTP 401）」 | PAT が違うか、期限が切れている。管理者に作り直してもらい、`.env` を書き換えて `docker compose up -d` |
| ログに「HTTP 403」「HTTP 404」 | PAT に、このリポジトリの Administration（Read and write）が無い。管理者に確かめてもらう |
| ランナーが GitHub の画面に出ない | `docker compose logs manager` を見る。マシンがネットにつながっているか、Docker Desktop が動いているか |
| ログに「ジョブのイメージ … が無い」 | `docker compose --profile job build` でジョブのイメージを作る。manager は、イメージが無いあいだは登録しない |
| ジョブのコンテナがすぐ終わり続ける | `docker compose logs manager` のランナーのログを見る。ランナーの版が古すぎる（ジョブのログに古いという警告が出ていた・ジョブを受け取らない）ときは、「更新のしかた」でイメージの版を上げて作り直す |
| ログに「前のジョブのコンテナが残っている」が続く | Docker Desktop の調子が悪い。`docker ps -a --filter label=funyaoji-ml-instance=<置き場所の名前>` のコンテナを `docker rm -f` で消すか、Docker Desktop を起動し直す。manager は、前のジョブのコンテナが消えるまで、次のランナーを作らない |
| ログに「登録を消せなかった（HTTP …）」 | 通信が止まったなど。記録に残っているので、通信が戻れば manager が消し直す |
| 学習のジョブが「Waiting for a runner」のまま | manager が止まっているか、ラベルが合っていない。変数 `ML_TRAIN_RUNNER` のラベルが、`self-hosted`・`linux`・`x64`・`funyaoji-ml` の中だけか。すぐに直せなければ、docs/ml.md の「ランナーが止まっていて、学習が始まらないとき」で GitHub のマシンに切り替える |
| ジョブが「作業フォルダが空でない」で落ちる | ジョブのコンテナが使い捨てになっていない。manager を通さずにコンテナを起こした、など。`docker compose down` のあと `docker compose up -d` |
| ジョブがメモリ不足（`Killed`）で落ちる | `RUNNER_MEMORY` を上げるか、変数 `ML_TRAIN_WORKERS` を下げる。WSL2 のメモリの上限（下）より上げても効かない |
| すぐにランナーを外したい | `docker compose down`。急ぐときは、管理者が Settings → Actions → Runners からランナーを消し、変数 `ML_TRAIN_RUNNER` を消し、PAT を取り消す |

## Windows で Docker Desktop を使うとき

- **daemon を TCP に出さない**：Settings → General の「Expose daemon on tcp://localhost:2375 without TLS」を切る。入っていると、ジョブのコンテナから `host.docker.internal:2375` で Docker を操作でき、ホストを乗っ取れる
- **ホストのサービス**：ジョブのコンテナから、ホストのサービス（`host.docker.internal`）と LAN に届く。`0.0.0.0` に開いている開発用のサービス（データベース・開発サーバー・管理画面など）は、ランナーを立てているあいだは止めるか、守るべきものをこのマシンに置かない。**`127.0.0.1` だけに開いたサービスにも、Docker Desktop では `host.docker.internal` から届くことがある**ので、`127.0.0.1` にしたから安全、とは考えない。LAN に守るべきものがあるマシンでは立てない
- **PC の再起動のあと**：Settings → General の「Start Docker Desktop when you sign in to your computer」を入れる。Windows にサインインすると Docker が起き、manager も起きる（`restart: unless-stopped`）。サインインするまでは起きないので、再起動したらサインインしておく。`docker compose down` で止めたときは、再起動しても起きない
- **スリープ**：スリープ・休止のあいだはジョブが止まり、落ちる。ランナーを立てているあいだは、電源の設定でスリープしないようにする。Windows Update の再起動の時間も、学習を流しそうな時間から外す
- **WSL2 のメモリと CPU の上限**：Docker Desktop（WSL2 のバックエンド）のコンテナは、WSL2 の VM の中で動く。VM の上限は `%UserProfile%\.wslconfig` で決まる（既定はメモリがマシンの半分、CPU は全部）。`RUNNER_CPUS`・`RUNNER_MEMORY` は、VM の上限より小さくする。変えたら `wsl --shutdown` のあと Docker Desktop を起動し直す

  ```ini
  [wsl2]
  memory=24GB
  processors=24
  ```

- **ディスク**：ジョブのコンテナのイメージは約 3.3GB。ジョブのたびに、Node・uv・Python の依存（PyTorch の CPU 版など）を落とし直すので、コンテナの中で数 GB 使い、コンテナを捨てるときに消える。WSL2 の仮想ディスクは自動では縮まないので、空きが減ったら Docker Desktop の Troubleshoot → Clean / Purge data か、`docker system prune` を使う
- **マシンを使いながら**：学習のあいだは `RUNNER_CPUS` のコアを使い切る。マシンで作業するなら、`RUNNER_CPUS` を下げる
