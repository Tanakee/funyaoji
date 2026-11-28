#!/usr/bin/env bash
# 最初の実験（docs/ml.md の「比べ方」）を、1つずつ順に流す。すでに動画まで終わった run は飛ばす
# 使い方（ml/ で）：bash sweep.sh <土台の歩き方の JSON> [ステップ数]
#   ③（土台＋補正）：報酬 2 × γ 2 × 種 3 ＝ 12 run
#   ②（PPO だけ）：(R1)・γ 0.99・種 0 の1本（(R2) の ② と比べる）
set -u
BASE=$1
STEPS=${2:-20000000}
mkdir -p runs

run() {
  local name=$1
  shift
  if [ -f "runs/${name}/progress.mp4" ]; then
    echo "skip ${name}"
    return
  fi
  echo "start ${name} $(date +%H:%M)"
  uv run python -m funyaoji_rl.train --steps "$STEPS" --name "$name" "$@" > "runs/${name}.log" 2>&1
  echo "end ${name} exit $? $(date +%H:%M)"
}

run "free-r1-g0.99-s0" --reward r1 --gamma 0.99 --seed 0
for seed in 0 1 2; do
  for reward in r2 r1; do
    for gamma in 0.99 0.995; do
      run "res-${reward}-g${gamma}-s${seed}" --reward "$reward" --gamma "$gamma" --seed "$seed" \
        --base-gait "$BASE" --log-std -1.5
    done
  done
done
