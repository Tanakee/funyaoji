"""決まった歩き方の5つの値を CMA-ES で探す（docs/ml.md の「決まった歩き方を土台にするか」の ①）。

体の状態を見ない、時間だけで決まる入力で出せる最速を出す。機械学習を使わない基準であり、③ の土台にもなる。
歩き方を走らせるのは Node（server.ts の gait）で、学習と同じ毎秒30回・1/1000 の目盛りを通す。

使い方（ml/ で）：uv run python -m funyaoji_rl.openloop [--mode normal] --seed 0
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import cma
import numpy as np

from . import registry, tracking
from .render import render
from .tracking import mlflow
from .vec_env import DEFAULT_MODE, NodeProcess, mode_prefix

KEYS = ["T", "h0", "A", "K", "kp"]
# 探す範囲。CMA-ES は 0〜1 に直した値で探す
LOW = np.array([0.5, -0.5, 0.05, 0.0, 0.0])
HIGH = np.array([3.0, 0.8, 1.6, 1.6, 2 * np.pi])
DEMO = {"T": 2.16, "h0": 0.34, "A": 0.38, "K": 0.76, "kp": 0.21}
# 記録の候補として残す、違う歩き方の数
TOP_K = 5


def to_gait(z: np.ndarray) -> dict[str, float]:
    v = LOW + np.clip(z, 0, 1) * (HIGH - LOW)
    return {k: float(x) for k, x in zip(KEYS, v)}


def fitness(result: dict) -> float:
    """小さいほど良い。ゴールしたらタイム（秒）、しなければ 100 − 進んだ距離（どのゴールよりも悪い）"""
    if result["outcome"] == "goal":
        return result["timeMs"] / 1000
    return 100.0 - result["distanceM"]


class Pool:
    """Node のプロセスを並べて、歩き方をまとめて走らせる。mode のモードの物理で動く"""

    def __init__(self, n: int, mode: str = DEFAULT_MODE):
        self.mode = mode
        self.procs: list[NodeProcess] = []
        try:
            for _ in range(n):
                self.procs.append(NodeProcess(mode))
            replies = [p.call({"cmd": "init", "n": 1, "config": {}}) for p in self.procs]
        except BaseException:
            # 途中で失敗したら、起動済みのプロセスを残さない
            self.close()
            raise
        self.fingerprint = replies[0]["fingerprint"]
        self.rapier = replies[0]["rapier"]
        self.shapes = replies[0]["shapes"]

    def run(self, gaits: list[dict], with_inputs: bool = False) -> list[dict]:
        chunks = np.array_split(np.arange(len(gaits)), len(self.procs))
        for p, idx in zip(self.procs, chunks):
            p.send({"cmd": "gait", "gaits": [gaits[i] for i in idx], "withInputs": with_inputs})
        out: list[dict] = []
        for p in self.procs:
            out.extend(p.recv()["results"])
        return out

    def close(self) -> None:
        for p in self.procs:
            p.close()


class Top:
    """探索の全体で、fitness の良い、違う歩き方を k 個まで持つ"""

    def __init__(self, k: int):
        self.k = k
        self.items: list[tuple[float, dict[str, float]]] = []

    def add(self, f: float, gait: dict[str, float]) -> None:
        if any(g == gait for _, g in self.items):
            return
        self.items.append((f, gait))
        self.items.sort(key=lambda x: x[0])
        del self.items[self.k :]


def main() -> None:
    # Windows でも、日本語の表示が文字化けや例外にならないようにする
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default=DEFAULT_MODE, help="モード（src/screen/game/modes.ts の一覧）。そのモードの物理で探す")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--popsize", type=int, default=24)
    ap.add_argument("--iters", type=int, default=120)
    ap.add_argument("--sigma", type=float, default=0.2)
    ap.add_argument("--name", type=str, default=None)
    args = ap.parse_args()

    tracking.setup()
    name = args.name or f"{mode_prefix(args.mode)}openloop-s{args.seed}"
    out = Path("runs") / name
    out.mkdir(parents=True, exist_ok=True)
    x0 = (np.array([DEMO[k] for k in KEYS]) - LOW) / (HIGH - LOW)
    es = cma.CMAEvolutionStrategy(
        x0, args.sigma, {"bounds": [0, 1], "popsize": args.popsize, "seed": args.seed + 1, "verbose": -9}
    )
    # 最速の1本だけを残すと、それが (E2) で落ちたとき、2番目に速い記録が評価されない。上位 TOP_K 個を残す
    top = Top(TOP_K)
    t0 = time.time()
    pool = Pool(args.workers, args.mode)
    try:
        with mlflow.start_run(run_name=name) as run:
            mlflow.set_tags(
                {
                    **tracking.git_info(),
                    "mode": args.mode,
                    "method": "openloop-cmaes",
                    "physics_fingerprint": pool.fingerprint,
                    "rapier": pool.rapier,
                }
            )
            mlflow.log_params({k: v for k, v in vars(args).items() if k != "name"})
            snapshots: list[tuple[str, dict]] = []
            for it in range(args.iters):
                zs = es.ask()
                gaits = [to_gait(np.asarray(z)) for z in zs]
                results = pool.run(gaits)
                fs = [fitness(r) for r in results]
                es.tell(zs, fs)
                for f, g in zip(fs, gaits):
                    top.add(f, g)
                i = int(np.argmin(fs))
                best_f = top.items[0][0]
                goals = sum(r["outcome"] == "goal" for r in results)
                mlflow.log_metrics(
                    {"best_fitness": best_f, "gen_best": fs[i], "gen_goal_rate": goals / len(results), "sigma": es.sigma},
                    step=it,
                )
                if it in (0, args.iters // 8, args.iters // 3) or it == args.iters - 1:
                    snapshots.append((f"{it + 1} 世代目の最良", gaits[i]))
                print(json.dumps({"it": it, "sec": round(time.time() - t0), "best": round(best_f, 3), "gen": round(fs[i], 3), "goals": goals}), flush=True)

            if not top.items:
                raise RuntimeError("歩き方を1つも走らせていない")
            finals = pool.run([g for _, g in top.items], with_inputs=True)
            for k, ((_, gait), final) in enumerate(zip(top.items, finals), start=1):
                record = {"label": f"探索の {k} 番目", "gait": gait, **final}
                path = out / f"record_top{k}.json"
                path.write_text(json.dumps(record), encoding="utf-8")
                mlflow.log_artifact(str(path), "records")
                if k == 1:
                    # ③ の土台（--base-gait）に使うファイル
                    (out / "record_best.json").write_text(
                        json.dumps({**record, "label": "探索の最良"}), encoding="utf-8"
                    )
                    if final["outcome"] == "goal":
                        mlflow.log_metric("eval_exact_time", final["timeMs"] / 1000)
                    mlflow.log_dict(gait, "gait.json")
            if snapshots:
                snap_runs = pool.run([g for _, g in snapshots], with_inputs=True)
                runs = [(label, r["inputs"]) for (label, _), r in zip(snapshots, snap_runs)]
                gif, mp4 = render(pool.shapes, runs, out / "progress", cols=2, mode=args.mode)
                mlflow.log_artifact(str(gif), "video")
                mlflow.log_artifact(str(mp4), "video")
    finally:
        pool.close()
    registry.submit([run.info.run_id], args.mode)
    print(json.dumps({"best": top.items[0]}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
