#!/bin/bash
# 学習のジョブのランナーを、1つのジョブごとに作って捨てる（ml/runner/README.md）。
# 1. GitHub から、1回きりの JIT の設定を取る（登録の秘密の PAT を持つのは、この manager のコンテナだけ）
# 2. その設定だけを渡して、ジョブのコンテナ（funyaoji-ml-job:local）を `docker run --rm` で1つ起こし、終わるのを待つ
# 3. 1 に戻る
# ジョブのコンテナには、Docker のソケットもホストのフォルダもマウントしない。止めるときは、待っているランナーの登録を消す
set -uo pipefail

: "${ACCESS_TOKEN:?.env に ACCESS_TOKEN を書く（ml/runner/README.md）}"
: "${REPO:?REPO（owner/repo）が要る}"
JOB_IMAGE=${JOB_IMAGE:-funyaoji-ml-job:local}
RUNNER_CPUS=${RUNNER_CPUS:-20}
RUNNER_MEMORY=${RUNNER_MEMORY:-16g}
RUNNER_PIDS=${RUNNER_PIDS:-4096}
NAME_PREFIX=funyaoji-ml
# ジョブのコンテナに付ける印。manager が起き直したときに、前の manager が残したものを見つける
MARK=funyaoji-ml-job=1
API=${GITHUB_API_URL:-https://api.github.com}/repos/$REPO/actions/runners

log() { echo "[$(date -u +%FT%TZ)] $*"; }

# GitHub の API を呼ぶ。本文を $BODY に、HTTP の状態を $STATUS に入れる（サブシェルで呼ばない）
STATUS=""
BODY=""
api() {
  local method=$1 path=$2
  local args=(-sS -o /tmp/api-body -w '%{http_code}' -X "$method"
    -H "Authorization: Bearer $ACCESS_TOKEN"
    -H "Accept: application/vnd.github+json"
    -H "X-GitHub-Api-Version: 2022-11-28")
  if [ $# -ge 3 ]; then args+=(-d "$3"); fi
  STATUS=$(curl "${args[@]}" "$API$path") || STATUS=000
  BODY=$(cat /tmp/api-body 2> /dev/null)
  rm -f /tmp/api-body
}

runner_id=""
child=""
container=""

# 待っている（ジョブを受け取っていない）ランナーの登録を消す。ジョブを流し終えた JIT のランナーは、GitHub が消す
remove_runner() {
  [ -n "$runner_id" ] || return 0
  api DELETE "/$runner_id"
  case $STATUS in
    204 | 404) log "ランナー $runner_id の登録を消した（または、もう無い）" ;;
    *) log "ランナー $runner_id の登録を消せなかった（HTTP $STATUS）。Settings → Actions → Runners から消す" ;;
  esac
  runner_id=""
}

stop() {
  log "止める"
  if [ -n "$container" ]; then
    docker stop -t 30 "$container" > /dev/null 2>&1 || true
  fi
  if [ -n "$child" ]; then
    kill "$child" 2> /dev/null
    wait "$child" 2> /dev/null
  fi
  remove_runner
  exit 0
}
trap stop TERM INT

# 前の manager が残したジョブのコンテナと、つながっていない（offline の）ランナーの登録を片づける
cleanup_leftovers() {
  local ids id
  ids=$(docker ps -aq --filter "label=$MARK")
  if [ -n "$ids" ]; then
    log "前の manager が残したジョブのコンテナを止める：$(tr '\n' ' ' <<< "$ids")"
    # shellcheck disable=SC2086
    docker rm -f $ids > /dev/null || true
  fi
  api GET "?per_page=100"
  if [ "$STATUS" != 200 ]; then
    log "ランナーの一覧を読めなかった（HTTP $STATUS）"
    return
  fi
  while read -r id; do
    [ -n "$id" ] || continue
    api DELETE "/$id"
    log "つながっていないランナー $id の登録を消した（HTTP $STATUS）"
  done < <(jq -r --arg p "$NAME_PREFIX-" '.runners[] | select((.name | startswith($p)) and .status == "offline") | .id' <<< "$BODY")
}

cleanup_leftovers

while true; do
  name="$NAME_PREFIX-$(date -u +%Y%m%d%H%M%S)-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  body=$(jq -nc --arg n "$name" '{name: $n, runner_group_id: 1, labels: ["self-hosted", "Linux", "X64", "funyaoji-ml"], work_folder: "_work"}')
  api POST /generate-jitconfig "$body"
  if [ "$STATUS" != 201 ]; then
    log "JIT の設定を取れなかった（HTTP $STATUS）：$(jq -r '.message? // empty' <<< "$BODY" 2> /dev/null)。60 秒後にやり直す"
    case $STATUS in
      401) log "PAT が違うか、期限が切れている（ml/runner/README.md の「困ったとき」）" ;;
      403 | 404) log "PAT に、このリポジトリの Administration（Read and write）が無い" ;;
    esac
    sleep 60 &
    child=$!
    wait "$child"
    child=""
    continue
  fi
  runner_id=$(jq -r '.runner.id' <<< "$BODY")
  jit=$(jq -r '.encoded_jit_config' <<< "$BODY")
  BODY=""
  log "ランナー $name（$runner_id）を登録した。ジョブを待つ"
  container=$name
  # JIT の設定は環境の変数で渡す（コマンドの引数に出さない）。ジョブのコンテナに渡すのは、これと上限だけ
  RUNNER_JITCONFIG=$jit docker run --rm --name "$container" --label "$MARK" \
    --env RUNNER_JITCONFIG \
    --cpus "$RUNNER_CPUS" --memory "$RUNNER_MEMORY" --memory-swap "$RUNNER_MEMORY" --pids-limit "$RUNNER_PIDS" \
    --security-opt no-new-privileges:true --cap-drop ALL --init --stop-signal SIGINT \
    --log-driver json-file --log-opt max-size=10m --log-opt max-file=3 \
    "$JOB_IMAGE" &
  child=$!
  jit=""
  wait "$child"
  rc=$?
  child=""
  container=""
  log "ジョブのコンテナが終わった（終了コード $rc）"
  # ジョブを受け取らずに終わったとき（起動に失敗したなど）は登録が残るので、消す
  remove_runner
  if [ "$rc" != 0 ]; then
    sleep 10
  fi
done
