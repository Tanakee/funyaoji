"""PPO でおじさんを歩かせる（docs/ml.md の「学習の方法」）。

使い方（ml/ で）：
  uv run python -m funyaoji_rl.train --steps 20000000 --reward r2 --gamma 0.99 --seed 0

学習の経過・途中の記録・最後の評価・動画が MLflow の run に残る。同じものが runs/<名前>/ にもできる。
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter, deque
from pathlib import Path
from typing import Any

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.logger import KVWriter, Logger
from stable_baselines3.common.vec_env import VecNormalize

from . import registry, tracking
from .policy import AsymmetricPolicy
from .render import render
from .tracking import mlflow
from .vec_env import FunyaojiVecEnv


class MlflowWriter(KVWriter):
    """Stable-Baselines3 の記録（損失・explained_variance など）を MLflow に送る"""

    def write(self, key_values: dict[str, Any], key_excluded: dict[str, Any], step: int = 0) -> None:
        metrics = {
            k.replace("/", "."): float(v)
            for k, v in key_values.items()
            if isinstance(v, (int, float, np.floating)) and not k.startswith("time/")
        }
        if metrics:
            mlflow.log_metrics(metrics, step=step)

    def close(self) -> None:
        pass


def rollout(env: VecNormalize, model: PPO, perturb: float = 0.0, seed: int = 0) -> dict[str, Any]:
    """1体の環境で、行動の乱数を使わずに1回走らせる。perturb > 0 なら、出力の層の bias を少しずらす"""
    net = model.policy.action_net
    saved = net.bias.detach().clone()
    if perturb > 0:
        g = torch.Generator().manual_seed(seed)
        with torch.no_grad():
            net.bias.add_(torch.randn(saved.shape, generator=g) * perturb)
    try:
        obs = env.venv.reset()
        while True:
            action, _ = model.predict(env.normalize_obs(obs), deterministic=True)
            obs, _, done, infos = env.venv.step(action)
            if done[0]:
                return infos[0]
    finally:
        with torch.no_grad():
            net.bias.copy_(saved)


def summarize(infos: list[dict[str, Any]]) -> dict[str, float | None]:
    goals = [i["timeMs"] / 1000 for i in infos if i["outcome"] == "goal"]
    return {
        "goal_rate": len(goals) / len(infos),
        "time_median": float(np.median(goals)) if goals else None,
        "time_best": min(goals) if goals else None,
    }


class Progress(BaseCallback):
    """終わったエピソードを集めて記録し、snapshot_every ステップごとに、途中の記録を残す"""

    def __init__(self, eval_env: VecNormalize, out: Path, snapshot_every: int):
        super().__init__()
        self.recent: deque[dict] = deque(maxlen=400)
        self.eval_env = eval_env
        self.out = out
        self.snapshot_every = snapshot_every
        self.next_snapshot = 0
        self.snapshots: list[tuple[int, dict]] = []
        self.best_time = float("inf")
        self.t0 = time.time()

    def _on_step(self) -> bool:
        for info in self.locals["infos"]:
            if "outcome" in info:
                self.recent.append(info)
                if info["outcome"] == "goal":
                    self.best_time = min(self.best_time, info["timeMs"] / 1000)
        if self.num_timesteps >= self.next_snapshot:
            self.snapshot()
            self.next_snapshot += self.snapshot_every
        return True

    def snapshot(self) -> None:
        self.eval_env.obs_rms = self.training_env.obs_rms  # type: ignore[attr-defined]
        info = rollout(self.eval_env, self.model)
        step = self.num_timesteps
        rec = {
            "label": f"{step / 1e6:.1f}M ステップ",
            "step": step,
            "outcome": info["outcome"],
            "timeMs": info["timeMs"],
            "distanceM": info["distanceM"],
            "inputs": info["inputs"],
        }
        path = self.out / "snapshots" / f"step_{step:09d}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rec), encoding="utf-8")
        mlflow.log_artifact(str(path), "snapshots")
        mlflow.log_metrics(
            {"snapshot_distance": info["distanceM"], "snapshot_goal": float(info["outcome"] == "goal")},
            step=step,
        )
        self.snapshots.append((step, rec))
        print(f"[snapshot] {step} {info['outcome']} {info['distanceM']:.2f}m {info['timeMs']}", flush=True)

    def _on_rollout_end(self) -> None:
        if not self.recent:
            return
        n = len(self.recent)
        ends = Counter(i["outcome"] for i in self.recent)
        goals = [i["timeMs"] / 1000 for i in self.recent if i["outcome"] == "goal"]
        row = {
            "goal_rate": ends["goal"] / n,
            "fell_rate": ends["fell"] / n,
            "timeout_rate": ends["timeout"] / n,
            "distance": float(np.mean([i["distanceM"] for i in self.recent])),
        }
        if goals:
            row["goal_time"] = float(np.mean(goals))
            row["best_time"] = self.best_time
        mlflow.log_metrics(row, step=self.num_timesteps)
        print(
            json.dumps({"steps": self.num_timesteps, "sec": round(time.time() - self.t0), **{k: round(v, 3) for k, v in row.items()}}),
            flush=True,
        )


def pick_snapshots(snaps: list[tuple[int, dict]], count: int = 6) -> list[tuple[int, dict]]:
    """動画に並べる途中の記録を、学習の初めから終わりまで均等に選ぶ"""
    if len(snaps) <= count:
        return snaps
    idx = np.linspace(0, len(snaps) - 1, count).round().astype(int)
    return [snaps[i] for i in sorted(set(idx.tolist()))]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=20_000_000)
    ap.add_argument("--reward", choices=["r1", "r2"], default="r2")
    ap.add_argument("--goal", type=float, default=30.0, help="r2 のゴールの報酬 G")
    ap.add_argument("--k", type=float, default=1.0, help="r2 の整形 Φ = k・x の k")
    ap.add_argument("--gamma", type=float, default=0.99)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--envs-per-worker", type=int, default=8)
    ap.add_argument("--n-steps", type=int, default=256)
    ap.add_argument("--torch-threads", type=int, default=4, help="PyTorch のスレッドの数。何本も同時に流すときは減らす")
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--ent", type=float, default=0.0)
    ap.add_argument("--log-std", type=float, default=-0.5)
    ap.add_argument("--snapshot-every", type=int, default=500_000)
    ap.add_argument("--trials", type=int, default=16, help="最後の評価で、ずらして走らせる回数")
    ap.add_argument("--perturb", type=float, default=0.01, help="ずらす大きさ（出力の層の bias）")
    ap.add_argument(
        "--base-gait",
        type=Path,
        default=None,
        help="土台の歩き方（openloop.py の record_best.json）。入れると、AI はこの歩き方に補正を足す（③）",
    )
    ap.add_argument("--residual-scale", type=float, default=0.3, help="補正の大きさの上限（入力の目盛り）")
    ap.add_argument("--name", type=str, default=None)
    args = ap.parse_args()

    tracking.setup()
    torch.set_num_threads(args.torch_threads)
    name = args.name or f"ppo-{args.reward}-g{args.gamma}-s{args.seed}-{time.strftime('%m%d%H%M')}"
    out = Path("runs") / name
    out.mkdir(parents=True, exist_ok=True)
    env_config: dict[str, Any] = {"reward": args.reward, "goal": args.goal, "k": args.k, "gamma": args.gamma}
    if args.base_gait:
        gait = json.loads(args.base_gait.read_text(encoding="utf-8"))["gait"]
        env_config["base"] = {"gait": gait, "scale": args.residual_scale}

    venv = FunyaojiVecEnv(args.workers, args.envs_per_worker, env_config)
    env = VecNormalize(venv, norm_obs=True, norm_reward=True, gamma=args.gamma)
    eval_venv = FunyaojiVecEnv(1, 1, {**env_config, "record": True})
    eval_env = VecNormalize(eval_venv, training=False, norm_obs=True, norm_reward=False)

    model = PPO(
        AsymmetricPolicy,
        env,
        n_steps=args.n_steps,
        batch_size=4096,
        n_epochs=10,
        learning_rate=args.lr,
        gamma=args.gamma,
        gae_lambda=0.95,
        ent_coef=args.ent,
        policy_kwargs={"net_arch": [64, 64], "log_std_init": args.log_std, "actor_obs": venv.actor_obs},
        seed=args.seed,
        device="cpu",
    )
    model.set_logger(Logger(folder=None, output_formats=[MlflowWriter()]))
    progress = Progress(eval_env, out, args.snapshot_every)

    with mlflow.start_run(run_name=name) as run:
        mlflow.set_tags(
            {
                **tracking.git_info(),
                "method": "ppo-residual" if args.base_gait else "ppo",
                "physics_fingerprint": venv.fingerprint,
                "rapier": venv.rapier,
            }
        )
        mlflow.log_params(
            {
                **{k: str(v) if isinstance(v, Path) else v for k, v in vars(args).items() if k != "name"},
                "base_gait_values": json.dumps(env_config.get("base", {}).get("gait")),
                "net_arch": "64x64",
                "asymmetric_critic": True,
                "actor_obs": venv.actor_obs,
                "obs_dim": venv.observation_space.shape[0],
                "norm_reward": True,
            }
        )
        try:
            model.learn(args.steps, callback=progress)
        finally:
            model.save(out / "model")
            env.save(str(out / "vecnormalize.pkl"))
            venv.close()

        # 最後の評価（docs/ml.md の「理論値として出す数字」）
        eval_env.obs_rms = env.obs_rms
        exact = rollout(eval_env, model)
        trials = [rollout(eval_env, model, args.perturb, seed=i + 1) for i in range(args.trials)]
        summary = summarize(trials)
        metrics = {
            "eval_exact_goal": float(exact["outcome"] == "goal"),
            "eval_exact_distance": exact["distanceM"],
            "eval_goal_rate": summary["goal_rate"],
        }
        if exact["outcome"] == "goal":
            metrics["eval_exact_time"] = exact["timeMs"] / 1000
        if summary["time_median"] is not None:
            metrics["eval_time_median"] = summary["time_median"]
            metrics["eval_time_best"] = summary["time_best"]
        mlflow.log_metrics(metrics)
        print(json.dumps(metrics), flush=True)

        # 記録の候補：そのままの1回と、ずらした中の最速
        candidates = {"exact": exact}
        goals = [t for t in trials if t["outcome"] == "goal"]
        if goals:
            candidates["best_perturbed"] = min(goals, key=lambda t: t["timeMs"])
        for key, info in candidates.items():
            path = out / f"record_{key}.json"
            path.write_text(
                json.dumps({k: info[k] for k in ("outcome", "timeMs", "distanceM", "inputs")}),
                encoding="utf-8",
            )
            mlflow.log_artifact(str(path), "records")

        # 動画：途中の記録を並べ、最後に「そのままの1回」を足す
        picked = pick_snapshots(progress.snapshots)
        runs = [(rec["label"], rec["inputs"]) for _, rec in picked]
        runs.append(("最後（評価）", exact["inputs"]))
        gif, mp4 = render(venv.shapes, runs, out / "progress", cols=2 if len(runs) <= 4 else 3)
        mlflow.log_artifact(str(gif), "video")
        mlflow.log_artifact(str(mp4), "video")
        eval_venv.close()
    # 評価して登録し、速ければ別名を移す（registry.py）
    registry.submit([run.info.run_id])
    print(f"done: {out}")


if __name__ == "__main__":
    main()
