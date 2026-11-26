"""PPO でおじさんを歩かせる。

使い方（ml/ で）：uv run python -m funyaoji_rl.train --steps 2000000 --name try1
学習の経過と重みは、MLflow にも残る（tracking.py）。評価と登録まで通すときは pipeline.py を使う
"""

from __future__ import annotations

import argparse
import json
import time
from collections import Counter, deque
from pathlib import Path

import numpy as np
import torch
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import BaseCallback
from stable_baselines3.common.vec_env import VecNormalize

from . import tracking
from .tracking import mlflow
from .vec_env import BODY_B, FunyaojiVecEnv


class Stats(BaseCallback):
    """終わったエピソードを集め、更新のたびに1行で出す"""

    def __init__(self):
        super().__init__()
        self.recent: deque[dict] = deque(maxlen=400)
        self.best_time = float("inf")
        self.best_clean = float("inf")
        self.t0 = time.time()
        self.history: list[dict] = []

    def _on_step(self) -> bool:
        for info in self.locals["infos"]:
            if "ended" not in info:
                continue
            self.recent.append(info)
            if info["ended"] == "goal":
                self.best_time = min(self.best_time, info["time"])
                if info["problems"] == 0:
                    self.best_clean = min(self.best_clean, info["time"])
        return True

    def _on_rollout_end(self) -> None:
        if not self.recent:
            return
        ends = Counter(i["ended"] for i in self.recent)
        n = len(self.recent)
        goals = [i for i in self.recent if i["ended"] == "goal"]
        row = {
            "steps": self.num_timesteps,
            "sec": round(time.time() - self.t0),
            "goal_rate": round(ends["goal"] / n, 3),
            "fell_rate": round((ends["fell"] + ends["jump"]) / n, 3),
            "distance": round(float(np.mean([i["distance"] for i in self.recent])), 2),
            "goal_time": round(float(np.mean([i["time"] for i in goals])), 2) if goals else None,
            "clean_rate": round(sum(i["problems"] == 0 for i in goals) / len(goals), 3)
            if goals
            else None,
            "best_time": round(self.best_time, 3) if self.best_time < 1e9 else None,
            "best_clean": round(self.best_clean, 3) if self.best_clean < 1e9 else None,
        }
        self.history.append(row)
        mlflow.log_metrics(
            {k: v for k, v in row.items() if v is not None and k not in ("steps", "sec")},
            step=self.num_timesteps,
        )
        print(json.dumps(row), flush=True)


def _r(x) -> list:
    """小数6桁に丸める（ファイルを小さくする。再生は丸めた値で行うので、Node とブラウザは一致する）"""
    return np.round(np.asarray(x, dtype=np.float64), 6).tolist()


def export_policy(model: PPO, norm: VecNormalize, path: Path) -> None:
    """ブラウザで順伝播を計算できるように、重みと観測の正規化を JSON に書く"""
    sd = model.policy.state_dict()
    layers = []
    i = 0
    while f"mlp_extractor.policy_net.{i}.weight" in sd:
        layers.append(
            {
                "w": _r(sd[f"mlp_extractor.policy_net.{i}.weight"]),
                "b": _r(sd[f"mlp_extractor.policy_net.{i}.bias"]),
            }
        )
        i += 2
    layers.append({"w": _r(sd["action_net.weight"]), "b": _r(sd["action_net.bias"])})
    out = {
        "obsMean": _r(norm.obs_rms.mean),
        "obsStd": _r(np.sqrt(norm.obs_rms.var + norm.epsilon)),
        "clipObs": float(norm.clip_obs),
        "activation": "tanh",
        "layers": layers,
    }
    path.write_text(json.dumps(out), encoding="utf-8")


def add_train_args(ap: argparse.ArgumentParser) -> None:
    ap.add_argument("--steps", type=int, default=2_000_000)
    ap.add_argument("--workers", type=int, default=16)
    ap.add_argument("--envs-per-worker", type=int, default=8)
    ap.add_argument("--n-steps", type=int, default=256)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--gamma", type=float, default=0.99)
    ap.add_argument("--ent", type=float, default=0.0)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--name", type=str, default=None, help="MLflow に出す実験の名前")
    ap.add_argument("--out", type=Path, default=None, help="結果を置く場所。省くと runs/<名前>")
    ap.add_argument(
        "--config", type=str, default="{}", help="環境の設定（JSON）。server.ts の EnvConfig"
    )


def train(args: argparse.Namespace) -> tuple[str, Path]:
    """学習して、MLflow の run の ID と、重み（policy.json）の場所を返す"""
    tracking.setup()
    torch.set_num_threads(4)
    name = args.name or time.strftime("ppo-%m%d-%H%M%S")
    out: Path = args.out or Path("runs") / name
    out.mkdir(parents=True, exist_ok=True)
    config = json.loads(args.config)
    venv = FunyaojiVecEnv(args.workers, args.envs_per_worker, config)
    env = VecNormalize(venv, norm_obs=True, norm_reward=True, gamma=args.gamma)
    model = PPO(
        "MlpPolicy",
        env,
        n_steps=args.n_steps,
        batch_size=4096,
        n_epochs=10,
        learning_rate=args.lr,
        gamma=args.gamma,
        gae_lambda=0.95,
        ent_coef=args.ent,
        policy_kwargs={"net_arch": [64, 64], "log_std_init": -0.5},
        seed=args.seed,
        device="cpu",
    )
    stats = Stats()
    with mlflow.start_run(run_name=name) as run:
        mlflow.set_tags({**tracking.git_info(), "body": tracking.body_fingerprint()})
        mlflow.log_params(
            {
                "algo": "PPO",
                "net_arch": "64x64",
                **{k: v for k, v in vars(args).items() if k not in ("out", "name", "config")},
                # 環境の設定は、既定の値から変えたものだけが入る
                **tracking.flatten("env", config),
            }
        )
        try:
            model.learn(args.steps, callback=stats)
        finally:
            model.save(out / "model")
            env.save(str(out / "vecnormalize.pkl"))
            export_policy(model, env, out / "policy.json")
            (out / "history.json").write_text(json.dumps(stats.history), encoding="utf-8")
            venv.close()
            mlflow.log_artifact(str(out / "policy.json"))
            mlflow.log_artifact(str(out / "history.json"))
            mlflow.log_artifact(str(BODY_B))
    return run.info.run_id, out / "policy.json"


def main() -> None:
    ap = argparse.ArgumentParser()
    add_train_args(ap)
    run_id, policy = train(ap.parse_args())
    print(f"run {run_id} / {policy}")


if __name__ == "__main__":
    main()
