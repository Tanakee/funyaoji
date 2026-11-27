"""学習・評価・登録・書き出しを、1つのコマンドで通す。体の設定を変えたら、これを流し直す。

使い方（ml/ で）：uv run python -m funyaoji_rl.pipeline --steps 20000000 --name free
  1. PPO で学習する（train.py）。経過と重みが MLflow に残る
  2. run に上げた重みを評価する（registry.py）。そのままの重みで1回と、重みを少しずらして16回走らせ、中央値を出す
  3. そのままの重みで 10m に着いて不自然な動きが無く、ずらした16回も9割以上（15回以上）がそうなら、
     レジストリに登録する。中央値が今の champion より速ければ入れ替える
  4. champion が入れ替わったら、/prototype が読む場所（policy-b.json）に書き出す
"""

from __future__ import annotations

import argparse
import json
import sys

from . import registry, tracking
from .train import add_train_args, train


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows でも日本語をそのまま出す
    ap = argparse.ArgumentParser()
    add_train_args(ap)
    ap.add_argument(
        "--no-export", action="store_true", help="champion が入れ替わっても、書き出さない"
    )
    args = ap.parse_args()

    # 登録（registry.submit）は、今の体（body-b.json）の指紋の run しか通さない。
    # --config の params で体を変えると、学習が済んでから必ず止まるので、学習の前に止める
    params = json.loads(args.config).get("params")
    if params is not None and tracking.body_fingerprint(params) != tracking.body_fingerprint():
        raise SystemExit(
            "--config の params が今の体（body-b.json）と違うので、登録できない。"
            "体を変えるなら body-b.json を書き換えてから流す。学習だけなら funyaoji_rl.train を使う"
        )

    run_id, _ = train(args)
    summary = registry.submit(run_id)
    print(json.dumps(summary, ensure_ascii=False))
    if not summary["passed"]:
        print("評価を通らなかったので、登録しない")
    elif not summary["champion"]:
        print(f"登録した（version {summary['version']}）。今の champion のほうが速いので、入れ替えない")
    elif args.no_export:
        print(f"champion を version {summary['version']} に入れ替えた")
    else:
        print(json.dumps(registry.export(), ensure_ascii=False))
        print(f"champion を version {summary['version']} に入れ替え、書き出した")


if __name__ == "__main__":
    main()
