"""理論値の記録を作り直す流れを、1つのコマンドで通す（docs/ml.md の「物理の変更から記録の差し替えまでを自動にする」）。

1. ① 決まった歩き方を CMA-ES で探す
2. ③ その歩き方を土台に、PPO で補正を学ぶ。今の champion の設定（(R2)・γ 0.99）で1本だけ流す
3. 評価してレジストリに載せ、別名を移す（train.py・openloop.py の終わりに自動で行う）
4. theory の記録を src/screen/game/ai/theory.json に書き出す

物理が変わった（物理の指紋が違う）ときに流す。新しい指紋で最初に評価を通った記録が、前より遅くても別名を取る。
設定の比べ合い（何本も流す実験）はここではせず、手元で sweep.py を使う。

使い方（ml/ で）：uv run python -m funyaoji_rl.pipeline [--steps 20000000]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time

from . import registry


def run(*args: str) -> None:
    cmd = [sys.executable, "-m", *args]
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=20_000_000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--envs-per-worker", type=int, default=32)
    ap.add_argument("--torch-threads", type=int, default=2)
    args = ap.parse_args()

    stamp = time.strftime("%m%d%H%M")
    openloop = f"pipeline-openloop-{stamp}"
    run("funyaoji_rl.openloop", "--seed", str(args.seed), "--workers", str(args.workers), "--name", openloop)
    run(
        "funyaoji_rl.train",
        "--name", f"pipeline-res-r2-g0.99-{stamp}",
        "--steps", str(args.steps),
        "--reward", "r2",
        "--gamma", "0.99",
        "--seed", str(args.seed),
        "--base-gait", f"runs/{openloop}/record_best.json",
        "--log-std", "-1.5",
        "--workers", str(args.workers),
        "--envs-per-worker", str(args.envs_per_worker),
        "--torch-threads", str(args.torch_threads),
    )
    registry.export()


if __name__ == "__main__":
    main()
