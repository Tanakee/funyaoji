"""Node で動く物理演算（lab/rl/server.ts）を、Stable-Baselines3 の VecEnv として使う。

Node のプロセスを workers 個立て、それぞれがおじさんを envs_per_worker 体持つ。
1ステップごとに、全プロセスへ行動を送ってから、順番に結果を受け取る（プロセスは並列に計算する）。
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import numpy as np
from gymnasium import spaces
from stable_baselines3.common.vec_env import VecEnv

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / "src/screen/game/prototype/lab/rl/server.ts"
BODY_B = ROOT / "src/screen/game/prototype/lab/rl/body-b.json"
OBS_DIM = 20
ACT_DIM = 4


def load_body(path: Path = BODY_B) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))["params"]


class FunyaojiVecEnv(VecEnv):
    def __init__(
        self,
        workers: int = 8,
        envs_per_worker: int = 8,
        config: dict[str, Any] | None = None,
    ):
        self.workers = workers
        self.per = envs_per_worker
        self.config = {"params": load_body(), **(config or {})}
        obs_space = spaces.Box(-np.inf, np.inf, (OBS_DIM,), np.float32)
        # 行動は -1〜1。関節の入力（0〜1）には (a + 1) / 2 で直す
        act_space = spaces.Box(-1.0, 1.0, (ACT_DIM,), np.float32)
        super().__init__(workers * envs_per_worker, obs_space, act_space)
        self.procs = [
            subprocess.Popen(
                ["node", str(SERVER)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                cwd=ROOT,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
            for _ in range(workers)
        ]
        self._obs = self._all({"cmd": "init", "n": self.per, "config": self.config})

    def _send(self, p: subprocess.Popen, msg: dict[str, Any]) -> None:
        assert p.stdin is not None
        p.stdin.write(json.dumps(msg) + "\n")
        p.stdin.flush()

    def _recv(self, p: subprocess.Popen) -> dict[str, Any]:
        assert p.stdout is not None
        line = p.stdout.readline()
        if not line:
            raise RuntimeError("Node のプロセスが終了した")
        return json.loads(line)

    def _all(self, msg: dict[str, Any]) -> np.ndarray:
        for p in self.procs:
            self._send(p, msg)
        return np.concatenate([np.asarray(self._recv(p)["obs"], np.float32) for p in self.procs])

    def reset(self) -> np.ndarray:
        self._obs = self._all({"cmd": "reset"})
        return self._obs

    def step_async(self, actions: np.ndarray) -> None:
        u = (np.clip(actions, -1.0, 1.0) + 1.0) / 2.0
        for i, p in enumerate(self.procs):
            self._send(p, {"cmd": "step", "a": u[i * self.per : (i + 1) * self.per].tolist()})

    def step_wait(self):
        obs, rew, done, infos = [], [], [], []
        for p in self.procs:
            r = self._recv(p)
            obs.append(np.asarray(r["obs"], np.float32))
            rew.append(np.asarray(r["rew"], np.float32))
            done.append(np.asarray(r["done"], bool))
            for info in r["info"]:
                if info is None:
                    infos.append({})
                    continue
                info["terminal_observation"] = np.asarray(info.pop("final"), np.float32)
                # 時間切れと「止まった」は打ち切り。価値の見積もりを続きから足す
                info["TimeLimit.truncated"] = info["ended"] in ("timeout", "stuck")
                infos.append(info)
        self._obs = np.concatenate(obs)
        return self._obs, np.concatenate(rew), np.concatenate(done), infos

    def close(self) -> None:
        for p in self.procs:
            try:
                if p.stdin:
                    p.stdin.close()
                p.terminate()
            except OSError:
                pass

    # VecEnv が求めるが、ここでは使わないもの
    def get_attr(self, attr_name, indices=None):
        return [None] * self.num_envs

    def set_attr(self, attr_name, value, indices=None):
        pass

    def env_method(self, method_name, *method_args, indices=None, **method_kwargs):
        return [None] * self.num_envs

    def env_is_wrapped(self, wrapper_class, indices=None):
        return [False] * self.num_envs
