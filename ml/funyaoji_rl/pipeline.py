"""理論値の記録を作り直す流れを、1つのコマンドで通す（docs/ml.md の「物理の変更から記録の差し替えまでを自動にする」）。

1. ① 決まった歩き方を CMA-ES で探す
2. ③ その歩き方を土台に、PPO で補正を学ぶ。(R2)・γ 0.99 で1本だけ流す
3. 評価してレジストリに載せ、別名を移す（train.py・openloop.py の終わりに自動で行う）
4. theory の記録を src/screen/game/ai/theory.json に書き出す
5. 書き出した記録だけを再生した動画を runs/theory-export/theory.{gif,mp4} に作る（マージする前に人が見る）

(R2)・γ 0.99 にしたのは、最初の実験で、種 3 つの中央値がいちばん速かった設定だから（ml/README.md の「③ の報酬と γ」）。
いちばん速い1本の記録（6.804 秒、今の theory）は (R1)・γ 0.99 の run から出ているが、差は種のぶれと同じくらいなので、
1本だけ流すなら、中央値で選んだ設定にした。

物理が変わった（物理の指紋が違う）ときに流す。新しい指紋で最初に評価を通った記録が、前より遅くても別名を取る。
設定の比べ合い（何本も流す実験）はここではせず、手元で sweep.py を使う。

使い方（ml/ で）：uv run python -m funyaoji_rl.pipeline [--steps 20000000]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from . import registry
from .render import render
from .vec_env import ROOT, NodeProcess

VIDEO = ROOT / "ml/runs/theory-export/theory"


def run(*args: str) -> None:
    cmd = [sys.executable, "-m", *args]
    print("$", " ".join(cmd), flush=True)
    subprocess.run(cmd, check=True)


def render_export(path: Path) -> None:
    """書き出した記録だけを再生した動画を作る。ラベルにタイムを書く"""
    rec = json.loads(path.read_text(encoding="utf-8"))
    proc = NodeProcess()
    try:
        shapes = proc.call({"cmd": "init", "n": 1, "config": {}})["shapes"]
    finally:
        proc.close()
    label = f"理論値 {rec['timeMs'] / 1000} 秒（{rec['source']}）"
    gif, mp4 = render(shapes, [(label, rec["inputs"])], VIDEO, cols=1)
    print(gif, mp4, flush=True)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=20_000_000)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--envs-per-worker", type=int, default=32)
    ap.add_argument("--torch-threads", type=int, default=2)
    ap.add_argument("--render-only", action="store_true", help="学習せず、今の theory.json の動画だけを作る")
    args = ap.parse_args()

    if args.render_only:
        render_export(registry.EXPORT)
        return
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
    render_export(registry.export())


if __name__ == "__main__":
    main()
