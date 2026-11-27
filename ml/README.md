# 強化学習（試作）

おじさんを強化学習（PPO）で歩かせ、10m モードの理論値を調べる。#68 の作業。

物理演算は、ゲームと同じコード（`src/screen/game/prototype/sim.ts`）を Node で動かす。Python は、その Node のプロセスに行動を送り、観測と報酬を受け取る。物理演算は CPU で動くので、GPU は要らない。

## 準備

- Node（リポジトリのルートで `npm install` を済ませる）
- [uv](https://docs.astral.sh/uv/)

```sh
cd ml
uv sync
```

## 学習

```sh
# ml/ で。runs/<名前>/ に、重み（policy.json）と学習の経過（history.json）ができる
uv run python -m funyaoji_rl.train --steps 20000000 --out runs/free

# 報酬や打ち切りの設定を変える（src/screen/game/prototype/lab/rl/server.ts の EnvConfig）
uv run python -m funyaoji_rl.train --config '{"wTime": -2, "maxJump": 0.25}' --out runs/clean
```

学習の間、更新のたびに1行ずつ出る。`goal_rate` は 10m に着いた割合、`best_time` は着いた中の最速、`best_clean` は不自然な動き（`lab/run.ts` の `sanity()`）に引っかからなかった中の最速。学習の間は行動に乱数を足しているので、乱数なしの結果は下の「再生」で測る。

## 再生

```sh
# リポジトリのルートで。Node で1回走らせ、タイムを出す
node src/screen/game/prototype/lab/rl/play.ts ml/runs/free/policy.json

# ブラウザで見る：policy.json を src/screen/game/prototype/policy-b.json に置き、/prototype の「AI」を押す
```

重みは体の設定ごとに作る。体（`lab/rl/body-b.json` と `main.ts` の `BODIES`）を変えたら、学習し直す。

## 比べる基準（フィードバックなしの最速）

強化学習を使わずに、歩き方の機械（`bot.ts` の5つの値）だけで出せる最速のタイムを探す。AI がこれより速くなければ、深層を使う意味は薄い。

```sh
# リポジトリのルートで。乱数の種を変えて探し、最速の歩き方を候補の JSON に書く（種1つで30〜40秒）
node src/screen/game/prototype/lab/rl/openloop.ts --seeds 6 --out src/screen/game/prototype/lab/rl/body-b-fastest.json
```

`/prototype` の「設定」で「お手本を、探索で出した最速の歩き方にする」を入れると、この歩き方をお手本として再生できる。

`body-b-fastest.json` は体 B の値の写しを持つ。体（`body-b.json` と `main.ts` の `BODIES`）を変えたら、上のコマンドで作り直す。

## 仕組み

| ファイル | 役割 |
|---|---|
| `src/screen/game/prototype/policy.ts` | 観測を作り、ニューラルネットを計算する。学習とブラウザで同じものを使う |
| `src/screen/game/prototype/lab/rl/server.ts` | 環境。おじさんを何体も持ち、標準入力の1行ごとに全員を1ステップ進める |
| `src/screen/game/prototype/lab/rl/bench.ts` | 環境が `lab/run.ts` と同じ結果になるかを確かめ、速さを測る |
| `src/screen/game/prototype/lab/rl/play.ts` | 重みを読み、1回走らせる |
| `src/screen/game/prototype/lab/rl/openloop.ts` | フィードバックなしの最速の歩き方を探す |
| `ml/funyaoji_rl/vec_env.py` | Node のプロセスを並べて、Stable-Baselines3 の環境にする |
| `ml/funyaoji_rl/train.py` | PPO で学習し、重みを JSON に書き出す |

- 行動は4つの関節の入力（0〜1）。毎秒30回（スマホの `tilt` と同じ）変える。`--config` の `actionHz` で変えたときは、その値を重みの JSON（`actionHz`）に書き、再生も同じ頻度にする。行動を変える間隔は、学習も再生も `round(240 / actionHz)` ステップ。`play.ts` は 1/60 秒（4ステップ）ごとにしか AI を呼ばないので、間隔が 4 の倍数になる値（60・30・20・15・12・10 など）だけを使える。ほかの値は学習の始めに止まる
- 観測は20個の数（胴の高さ・傾き・速度、関節の角度と回る速さ、足の接地、前の行動）。前後の位置は入れない
- ニューラルネットは 64 個のユニットが2層。ブラウザでは `policy.ts` が計算するので、推論のサーバーは要らない
