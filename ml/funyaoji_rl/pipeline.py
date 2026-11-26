"""学習・評価・登録・書き出しを、1つのコマンドで通す。体の設定を変えたら、これを流し直す。

使い方（ml/ で）：uv run python -m funyaoji_rl.pipeline --steps 20000000 --name free
  1. PPO で学習する（train.py）。経過と重みが MLflow に残る
  2. 重みを乱数なしで1回走らせて評価する（registry.py）
  3. 10m に着き、不自然な動きが無ければ、レジストリに登録する。今の champion より速ければ入れ替える
  4. champion が入れ替わったら、/prototype が読む場所（policy-b.json）に書き出す
"""

from __future__ import annotations

import argparse
import json
import sys

from . import registry
from .train import add_train_args, train


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows でも日本語をそのまま出す
    ap = argparse.ArgumentParser()
    add_train_args(ap)
    ap.add_argument(
        "--no-export", action="store_true", help="champion が入れ替わっても、書き出さない"
    )
    args = ap.parse_args()

    run_id, policy = train(args)
    summary = registry.submit(run_id, policy)
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
