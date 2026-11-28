#!/bin/bash
# コンテナの起動のたびに（root で）流す。前のジョブが残したものを消し、ランナーの本体を元に戻してから、
# 元のイメージの entrypoint（/entrypoint.sh。登録して、ジョブを1つ待つ）に渡す。
# compose の restart で同じコンテナが起き直すので、ジョブのたびにコンテナを作り直すのと同じ状態にするため。
# ジョブ（runner のユーザー）は root になれないので、書けるのはここで消す場所だけ
set -euo pipefail

if [ "$(id -u)" != 0 ]; then
  echo "reset.sh は root で動かす" >&2
  exit 1
fi

echo "前のジョブが残したものを消す"
# 作業フォルダ（RUNNER_WORKDIR）・ツールのキャッシュ（setup-node・setup-uv が入れる）・一時ファイル・ホーム
rm -rf /_work
find /opt/hostedtoolcache /tmp /var/tmp /run/lock -mindepth 1 -delete
rm -rf /home/runner
mkdir -p /home/runner
cp -a /etc/skel/. /home/runner/
chown -R runner:runner /home/runner
chmod 750 /home/runner

# ランナーの本体を、触られていない写しから戻す（登録の情報 .runner・.credentials も消える）
find /actions-runner -mindepth 1 -delete
cp -a /opt/actions-runner-pristine/. /actions-runner/
chown -R runner:runner /actions-runner

# 念のため、ジョブが書ける場所がほかに無いかを確かめる（あれば止める）
left=$(find / -xdev \( -path /proc -o -path /sys -o -path /dev \) -prune -o \
  \( -user runner ! -path '/actions-runner*' ! -path '/home/runner*' ! -path /opt/hostedtoolcache \) -print -quit)
if [ -n "$left" ]; then
  echo "runner のユーザーのファイルが、消す場所の外にある：$left" >&2
  exit 1
fi

exec /entrypoint.sh "$@"
