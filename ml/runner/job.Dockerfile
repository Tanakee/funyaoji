# 学習のジョブを1つだけ流して捨てる、ジョブのコンテナ（ml/runner/README.md）。
# manager が、1回きりの JIT の設定だけを渡して `docker run --rm` で起こす。登録の秘密（PAT）はこのコンテナに入れない。
# コンテナの中では root が何も動かさない。最初から runner のユーザーで、ランナーの本体だけを動かす。
# 元のイメージは、GitHub の公式のランナーのイメージ（ARC が使うもの）を、版（タグ）と中身（digest）の両方で固定する。
# 上げるときは README.md の「更新のしかた」
FROM ghcr.io/actions/actions-runner:2.338.2@sha256:6d0b2d80d80f143f77dcb676e50920100bbb547e39e883454d57f45ab8c31300

USER root

# 学習のジョブに要るもの：動画の日本語のフォント（ml/funyaoji_rl/render.py が読む）と、setup-node などが使う展開の道具。
# ジョブの中では sudo を使えないので、ここで入れておく。そのあと sudo を消す
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk xz-utils \
  && SUDO_FORCE_REMOVE=yes apt-get purge -y sudo \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/* /etc/sudoers.d \
  && gpasswd -d runner sudo \
  && gpasswd -d runner docker

# ランナーの本体を /actions-runner に移し、root の持ち物にする（runner からは書けない）。
# 本体のフォルダには、ランナーが起動のときに登録の情報（.runner・.credentials）とログ（_diag）、作業フォルダ（_work）を作るので、
# runner のグループに書かせる。sticky bit で、root のファイルを消したり置き換えたりはさせない
RUN mkdir /actions-runner \
  && cd /home/runner \
  && mv bin externals config.sh env.sh run.sh run-helper.sh.template run-helper.cmd.template safe_sleep.sh /actions-runner/ \
  && rm -rf /home/runner/k8s /home/runner/k8s-novolume \
  && chown -R root:root /actions-runner \
  && chmod -R go-w /actions-runner \
  && chown root:runner /actions-runner \
  && chmod 1775 /actions-runner \
  && chown runner:runner /home/runner \
  && chmod 750 /home/runner

# JIT の設定を受け取って、ランナーを1回だけ動かす（run-job.sh）。ランナーが自分で更新しないようにする（DisableUpdate）
COPY run-job.sh /usr/local/bin/funyaoji-run-job
# Windows で取り出して改行が CRLF になっていても動くようにする
RUN sed -i 's/\r$//' /usr/local/bin/funyaoji-run-job \
  && chown root:root /usr/local/bin/funyaoji-run-job \
  && chmod 755 /usr/local/bin/funyaoji-run-job

# だれでも書けるファイル・フォルダが無いことを確かめる（一時ファイルの場所を除く）。あればビルドを止める
RUN found=$(find / -xdev \( -path /proc -o -path /sys -o -path /dev -o -path /tmp -o -path /var/tmp -o -path /run/lock \) -prune \
      -o -perm -0002 ! -type l -print) \
  && if [ -n "$found" ]; then echo "だれでも書けるものがある：$found" >&2; exit 1; fi

USER runner
WORKDIR /home/runner
ENV HOME=/home/runner
ENTRYPOINT ["/usr/local/bin/funyaoji-run-job"]
