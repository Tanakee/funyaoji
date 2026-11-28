#!/bin/bash
# 学習のジョブのランナーを、1つのジョブごとに作って捨てる（ml/runner/README.md）。
# 1. GitHub から、1回きりの JIT の設定を取る（登録の秘密の PAT を持つのは、この manager のコンテナだけ）
# 2. その設定だけを渡して、ジョブのコンテナ（funyaoji-ml-job:local）を `docker run --rm` で1つ起こし、終わるのを待つ
# 3. 前のジョブのコンテナが消えたことを確かめてから、1 に戻る
# ジョブのコンテナには、Docker のソケットもホストのフォルダもマウントしない。
# 片づけ（Docker のコンテナ・GitHub の登録）は、この置き場所（RUNNER_INSTANCE）のものだけにする
set -uo pipefail

: "${ACCESS_TOKEN:?.env に ACCESS_TOKEN を書く（ml/runner/README.md）}"
: "${REPO:?REPO（owner/repo）が要る}"
: "${RUNNER_INSTANCE:?.env に RUNNER_INSTANCE（この置き場所の名前。英小文字・数字・-）を書く（ml/runner/README.md）}"
if ! [[ "$RUNNER_INSTANCE" =~ ^[a-z0-9][a-z0-9-]{0,19}$ ]]; then
  echo "RUNNER_INSTANCE（$RUNNER_INSTANCE）は、英小文字・数字・- の20文字まで（先頭は英小文字か数字）にする" >&2
  exit 1
fi
JOB_IMAGE=${JOB_IMAGE:-funyaoji-ml-job:local}
RUNNER_CPUS=${RUNNER_CPUS:-20}
RUNNER_MEMORY=${RUNNER_MEMORY:-16g}
RUNNER_PIDS=${RUNNER_PIDS:-4096}
# この manager が取った runner ID の記録。消せたら除く。消せなかったものは、あとで消し直す（compose の volume に置く）
STATE_DIR=${STATE_DIR:-/var/lib/funyaoji-ml}
IDS_FILE=$STATE_DIR/runner-ids
NAME_PREFIX=funyaoji-ml-$RUNNER_INSTANCE
# ジョブのコンテナに付ける印。片づけは、この置き場所の印のものだけにする
MARK=funyaoji-ml-instance=$RUNNER_INSTANCE
API=${GITHUB_API_URL:-https://api.github.com}/repos/$REPO/actions/runners

log() { echo "[$(date -u +%FT%TZ)] $*"; }

mkdir -p "$STATE_DIR"
touch "$IDS_FILE"

# GitHub の API を呼ぶ。本文を $BODY に、HTTP の状態を $STATUS に入れる（サブシェルで呼ばない）。
# 通信が止まっても戻るように、期限を付ける（MAX_TIME 秒。既定 30）
STATUS=""
BODY=""
api() {
  local method=$1 path=$2
  local args=(-sS --connect-timeout 10 --max-time "${MAX_TIME:-30}" -o /tmp/api-body -w '%{http_code}' -X "$method"
    -H "Authorization: Bearer $ACCESS_TOKEN"
    -H "Accept: application/vnd.github+json"
    -H "X-GitHub-Api-Version: 2022-11-28")
  if [ $# -ge 3 ]; then args+=(-d "$3"); fi
  STATUS=$(curl "${args[@]}" "$API$path" 2> /dev/null) || STATUS=000
  BODY=$(cat /tmp/api-body 2> /dev/null)
  rm -f /tmp/api-body
}

# Docker の操作。止まっても戻るように、期限（秒）を付ける
dk() {
  local limit=$1
  shift
  timeout "$limit" docker "$@"
}

record_id() { echo "$1" >> "$IDS_FILE"; }
forget_id() {
  grep -vxF "$1" "$IDS_FILE" > "$IDS_FILE.new" || true
  mv "$IDS_FILE.new" "$IDS_FILE"
}

# 記録した runner ID の登録を消す。消せた（204）か、もう無い（404）ものは記録から除く。
# 消せなかったもの（通信の失敗など）は記録に残し、次に呼ばれたときに消し直す。
# ジョブを流し終えた JIT のランナーは GitHub が消すので、ふつうは 404 になる
remove_recorded() {
  local id
  while read -r id; do
    [ -n "$id" ] || continue
    api DELETE "/$id"
    case $STATUS in
      204 | 404)
        forget_id "$id"
        log "ランナー $id の登録を消した（または、もう無い。HTTP $STATUS）"
        ;;
      *) log "ランナー $id の登録を消せなかった（HTTP $STATUS）。あとで消し直す" ;;
    esac
  done < <(cat "$IDS_FILE")
}

# この置き場所のジョブのコンテナを止めて消す。消えたら 0
remove_job_containers() {
  local ids
  ids=$(dk 20 ps -aq --filter "label=$MARK") || return 1
  [ -n "$ids" ] || return 0
  log "ジョブのコンテナを止めて消す：$(tr '\n' ' ' <<< "$ids")"
  # shellcheck disable=SC2086
  dk 40 rm -f $ids > /dev/null 2>&1
  ids=$(dk 20 ps -aq --filter "label=$MARK") || return 1
  [ -z "$ids" ]
}

child=""
cid_file=/tmp/job.cid

stop() {
  log "止める"
  # 止める処理は、compose の stop_grace_period（90 秒）の中に収める。
  # ジョブのコンテナ（30 秒待ってから止める。期限 40 秒）→ 登録を消す（1件 10 秒）
  if [ -s "$cid_file" ]; then
    dk 40 stop -t 30 "$(cat "$cid_file")" > /dev/null 2>&1 || true
  fi
  if [ -n "$child" ]; then
    kill "$child" 2> /dev/null
    wait "$child" 2> /dev/null
  fi
  remove_job_containers || log "ジョブのコンテナを消せなかった。次に manager が起きるときに消す"
  MAX_TIME=10 remove_recorded
  exit 0
}
trap stop TERM INT

# 少し待つ。止める合図を受けたら、すぐに stop に入る
pause() {
  sleep "$1" &
  child=$!
  wait "$child"
  child=""
}

# 前の manager が残したもの（この置き場所のジョブのコンテナと、記録した登録）を片づける
remove_job_containers || log "前のジョブのコンテナを消せなかった"
remove_recorded

while true; do
  # 前のジョブのコンテナが残っていれば、次のランナーを作らない（2つのジョブを同時に流さない）
  if ! remove_job_containers; then
    log "前のジョブのコンテナが残っている。30 秒後に確かめ直す"
    pause 30
    continue
  fi
  # 消せなかった登録を、消し直す
  remove_recorded
  # ジョブのイメージが手元に無ければ、登録しない（docker run は --pull=never で、取りに行かない）
  if ! dk 20 image inspect "$JOB_IMAGE" > /dev/null 2>&1; then
    log "ジョブのイメージ $JOB_IMAGE が無い。docker compose --profile job build で作る。60 秒後に確かめ直す"
    pause 60
    continue
  fi
  name="$NAME_PREFIX-$(date -u +%Y%m%d%H%M%S)-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  body=$(jq -nc --arg n "$name" '{name: $n, runner_group_id: 1, labels: ["self-hosted", "Linux", "X64", "funyaoji-ml"], work_folder: "_work"}')
  api POST /generate-jitconfig "$body"
  if [ "$STATUS" != 201 ]; then
    log "JIT の設定を取れなかった（HTTP $STATUS）：$(jq -r '.message? // empty' <<< "$BODY" 2> /dev/null)。60 秒後にやり直す"
    case $STATUS in
      401) log "PAT が違うか、期限が切れている（ml/runner/README.md の「困ったとき」）" ;;
      403 | 404) log "PAT に、このリポジトリの Administration（Read and write）が無い" ;;
    esac
    pause 60
    continue
  fi
  runner_id=$(jq -r '.runner.id // empty' <<< "$BODY" 2> /dev/null)
  jit=$(jq -r '.encoded_jit_config // empty' <<< "$BODY" 2> /dev/null)
  BODY=""
  if ! [[ "$runner_id" =~ ^[1-9][0-9]*$ ]]; then
    log "JIT の応答に、正しい runner ID が無い（$runner_id）。60 秒後にやり直す"
    jit=""
    pause 60
    continue
  fi
  record_id "$runner_id"
  if [ -z "$jit" ] || [ "$jit" = null ]; then
    log "JIT の応答に、JIT の設定が無い。登録を消して、60 秒後にやり直す"
    remove_recorded
    pause 60
    continue
  fi
  log "ランナー $name（$runner_id）を登録した。ジョブを待つ"
  rm -f "$cid_file"
  # JIT の設定は環境の変数で渡す（コマンドの引数に出さない）。ジョブのコンテナに渡すのは、これと上限だけ
  RUNNER_JITCONFIG=$jit docker run --rm --pull=never --name "$name" --label "$MARK" --cidfile "$cid_file" \
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
  log "ジョブのコンテナが終わった（終了コード $rc）"
  # ジョブを受け取らずに終わったとき（起動に失敗したなど）は登録が残るので、消す。ジョブを流し終えたものは GitHub が消している（404）
  remove_recorded
  if [ "$rc" != 0 ]; then
    pause 10
  fi
done
