# ジョブのコンテナを1つずつ起こす manager（ml/runner/manager.sh）。登録の秘密（PAT）を持つのは、このコンテナだけ。
# ジョブのコードはここでは動かない。小さく保つ（docker の CLI・curl・jq・bash だけ）。
# 元のイメージは、版（タグ）と中身（digest）の両方で固定する
FROM docker:29.9.3-cli@sha256:5a7af0dcb0e46c803efe9b45371dd21cb500e5b4453250394ac6f06d49b6e6f1

RUN apk add --no-cache bash curl jq

COPY manager.sh /usr/local/bin/funyaoji-manager
# Windows で取り出して改行が CRLF になっていても動くようにする
RUN sed -i 's/\r$//' /usr/local/bin/funyaoji-manager && chmod 755 /usr/local/bin/funyaoji-manager

ENTRYPOINT ["/usr/local/bin/funyaoji-manager"]
