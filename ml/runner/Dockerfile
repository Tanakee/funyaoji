# 理論値の記録の作り直しの、学習のジョブ（.github/workflows/ml-retrain.yml の retrain）だけを流す self-hosted runner。
# 立て方は ml/runner/README.md、決まりは docs/ml.md の「どこで学習を流すか」。
# 元のイメージは、版（タグ）と中身（digest）の両方で固定する。上げるときは README.md の「更新のしかた」
FROM myoung34/github-runner:2.338.2-ubuntu-noble@sha256:23e3a4a1da30de5b462ad0ae13d901288e803a688075c3b9b5bb79b7148c07fa

# 動画の日本語のフォント（ml/funyaoji_rl/render.py が読む）。ジョブの中では sudo を使えないので、ここで入れておく
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-cjk \
  && rm -rf /var/lib/apt/lists/*

# ジョブ（runner のユーザー）に root の権限を渡さない。sudo・docker のグループから外す。
# root になれないので、ジョブが書けるのは、下の reset.sh が毎回消す場所だけになる
RUN gpasswd -d runner sudo && gpasswd -d runner docker
# 元のイメージには runner のユーザーが持つファイル（/usr/local/bin/yq など）があり、ジョブが書き換えると次のジョブに残る。
# reset.sh が消す場所（本体・ホーム・ツールのキャッシュ・作業フォルダ）の外は、root のものにする
RUN find / -xdev \( -path /proc -o -path /sys -o -path /dev \) -prune -o -user runner \
    ! -path '/actions-runner*' ! -path '/home/runner*' ! -path /opt/hostedtoolcache ! -path '/_work*' \
    -exec chown root:root {} +

# ランナーの本体の、触られていない写し。reset.sh が、起動のたびにここから戻す（ジョブが本体を書き換えても、次のジョブに残さない）
RUN cp -a /actions-runner /opt/actions-runner-pristine \
  && chown -R root:root /opt/actions-runner-pristine \
  && chmod -R go-w /opt/actions-runner-pristine

COPY reset.sh /usr/local/bin/funyaoji-reset.sh
# Windows で取り出して改行が CRLF になっていても動くようにする
RUN sed -i 's/\r$//' /usr/local/bin/funyaoji-reset.sh && chmod 755 /usr/local/bin/funyaoji-reset.sh

# 起動のたびに、前のジョブが残したものを消してから、元のイメージの entrypoint（登録・ジョブを1つ待つ）に渡す
ENTRYPOINT ["/usr/local/bin/funyaoji-reset.sh"]
CMD ["./bin/Runner.Listener", "run", "--startuptype", "service"]
