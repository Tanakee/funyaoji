#!/bin/bash
# ジョブのコンテナの中で、runner のユーザーで動く（job.Dockerfile）。manager から受け取った JIT の設定で、ランナーを1回だけ動かす。
# JIT の設定の中の .runner に DisableUpdate を足し、ランナーが自分で更新しないようにする。
# ランナーの本体は root の持ち物で書き換えられないので、更新はイメージの版を上げて行う（README.md の「更新のしかた」）。
# DisableUpdate のランナーは、GitHub に「自分では更新しない」と伝え、更新の知らせを受けない（actions/runner の MessageListener）
set -euo pipefail

jit="${RUNNER_JITCONFIG:?manager が JIT の設定を渡す}"
# JIT の設定は、ジョブのステップの環境に残さない
unset RUNNER_JITCONFIG
# run.sh を通さないので、止める合図（SIGINT）はランナーが自分で受ける
unset RUNNER_MANUALLY_TRAP_SIG

# JIT の設定は {"<ファイルの名前>": "<中身の base64>"} の JSON を base64 にしたもの
if ! jit=$(base64 -d <<< "$jit" \
  | jq -ce 'if (type == "object") and (.[".runner"] | type == "string")
            then .[".runner"] |= (@base64d | fromjson | .DisableUpdate = true | tojson | @base64)
            else error("JIT の設定に .runner が無い") end' \
  | base64 -w0); then
  echo "JIT の設定を読めなかった" >&2
  exit 1
fi

cd /actions-runner
exec ./bin/Runner.Listener run --jitconfig "$jit"
