"""学習を何本も、決まった本数まで同時に流す。

1本の学習は、Node のプロセスを並べても、毎ステップ全部の返事を待つので、CPU を使い切れない。
本数を増やして、空いている CPU を埋める。レジストリへの登録まで終わった run（runs/<名前>/registered がある）は飛ばす。
失敗した run があれば、0 以外で終わる。

使い方（ml/ で）：
  uv run python -m funyaoji_rl.sweep --parallel 8 --plan first   # 最初の実験（③ の 12 run と ② の (R1)）
  uv run python -m funyaoji_rl.sweep --parallel 8 --plan bench   # 同時に流したときの速さを測る（短い run を 8 本）
"""

from __future__ import annotations

import argparse
import os
import subprocess
import tempfile
import sys
import time
from pathlib import Path
from typing import IO

from .vec_env import DEFAULT_MODE, mode_prefix

RUNS = Path("runs")
# 学習・評価・レジストリへの登録まで終わった run に付ける印
DONE = "registered"


def plan_first(base: str) -> list[tuple[str, list[str]]]:
    plan = [("free-r1-g0.99-s0", ["--reward", "r1", "--gamma", "0.99", "--seed", "0"])]
    for seed in (0, 1, 2):
        for reward in ("r2", "r1"):
            for gamma in ("0.99", "0.995"):
                plan.append(
                    (
                        f"res-{reward}-g{gamma}-s{seed}",
                        ["--reward", reward, "--gamma", gamma, "--seed", str(seed),
                         "--base-gait", base, "--log-std", "-1.5"],
                    )
                )
    return plan


def plan_bench(base: str, n: int) -> list[tuple[str, list[str]]]:
    return [
        (f"bench-p{n}-{i}", ["--steps", "300000", "--seed", str(i), "--base-gait", base,
                             "--log-std", "-1.5", "--snapshot-every", "100000000", "--trials", "1"])
        for i in range(n)
    ]


def main() -> None:
    # Windows でも、日本語の表示が文字化けや例外にならないようにする
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default=DEFAULT_MODE, help="モード（src/screen/game/modes.ts の一覧）。どの run もこのモードで学習する")
    ap.add_argument("--parallel", type=int, default=8)
    ap.add_argument("--plan", choices=["first", "bench"], default="first")
    ap.add_argument(
        "--base-gait",
        default=None,
        help="土台の歩き方。省くと runs/base-gait.json（ノーマル）、runs/<モード>-base-gait.json（ほかのモード）",
    )
    ap.add_argument("--steps", type=int, default=20_000_000)
    # 1本あたり 4 プロセス × 32 体 ＝ 128 体（16 × 8 と同じ数なので、PPO の設定はそのまま比べられる）
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--envs-per-worker", type=int, default=32)
    ap.add_argument("--torch-threads", type=int, default=2)
    ap.add_argument("--separate-db", action="store_true", help="速さを測るとき：MLflow の記録先を run ごとに別の一時ファイルにする")
    args = ap.parse_args()

    # 土台の歩き方はモードの物理で探したものを使う。ほかのモードの歩き方を黙って使わないよう、既定もモードで分ける
    base = args.base_gait or f"runs/{mode_prefix(args.mode)}base-gait.json"
    plan = plan_first(base) if args.plan == "first" else plan_bench(base, args.parallel)
    # ノーマル以外は、run の名前にモードを付ける（終わった印 runs/<名前>/registered が、モードをまたいで重ならないように）
    plan = [(f"{mode_prefix(args.mode)}{name}", extra) for name, extra in plan]
    common = ["--mode", args.mode, "--workers", str(args.workers), "--envs-per-worker", str(args.envs_per_worker),
              "--torch-threads", str(args.torch_threads)]
    queue = [(name, extra) for name, extra in plan if not (RUNS / name / DONE).exists()]
    running: dict[str, tuple[subprocess.Popen, IO[str], float]] = {}
    failed: list[str] = []
    RUNS.mkdir(exist_ok=True)
    t0 = time.time()
    try:
        while queue or running:
            while queue and len(running) < args.parallel:
                name, extra = queue.pop(0)
                steps = [] if "--steps" in extra else ["--steps", str(args.steps)]
                cmd = [sys.executable, "-m", "funyaoji_rl.train", "--name", name, *steps, *common, *extra]
                env = dict(os.environ)
                env["PYTHONIOENCODING"] = "utf-8"
                if args.separate_db:
                    db = Path(tempfile.gettempdir()) / f"funyaoji-{name}.db"
                    env["MLFLOW_TRACKING_URI"] = "sqlite:///" + db.as_posix()
                log = open(RUNS / f"{name}.log", "w", encoding="utf-8")
                try:
                    p = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=env)
                except BaseException:
                    log.close()
                    raise
                running[name] = (p, log, time.time())
                print(f"start {name} {time.strftime('%H:%M')}", flush=True)
            for name, (p, log, started) in list(running.items()):
                if p.poll() is None:
                    continue
                log.close()
                del running[name]
                print(f"end {name} exit {p.returncode} {round(time.time() - started)}s {time.strftime('%H:%M')}", flush=True)
                # train.py は、評価してレジストリに載せるところまで終わってから 0 で終わる
                if p.returncode == 0:
                    (RUNS / name / DONE).write_text(time.strftime("%Y-%m-%d %H:%M:%S") + "\n", encoding="utf-8")
                else:
                    failed.append(name)
            time.sleep(5)
    finally:
        for p, log, _ in running.values():
            p.terminate()
            p.wait()
            log.close()
    print(f"all done {round(time.time() - t0)}s", flush=True)
    if failed:
        print(f"失敗した run：{', '.join(failed)}", flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
