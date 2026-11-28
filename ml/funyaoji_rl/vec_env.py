"""Node で動く学習の環境（scripts/rl/server.ts）を、Stable-Baselines3 の VecEnv として使う。

Node のプロセスを workers 個立て、それぞれがおじさんを envs_per_worker 体持つ。
1ステップごとに、全プロセスへ行動を送ってから、順番に結果を受け取る（プロセスは並列に計算する）。
Node のプロセスは、1つのモード（src/screen/game/modes.ts の一覧）だけを扱う。モードは立てるときに渡す（--mode）。
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
SERVER = ROOT / "scripts/rl/server.ts"
ACT_DIM = 4
# 省いたときのモード（src/screen/game/modes.ts の DEFAULT_SIM_MODE と同じ）
DEFAULT_MODE = "normal"


class NodeProcess:
    """server.ts を1つ立て、JSON を1行ずつやり取りする。mode のモードの物理で動く"""

    def __init__(self, mode: str = DEFAULT_MODE) -> None:
        self.mode = mode
        self.p = subprocess.Popen(
            ["node", str(SERVER), "--mode", mode],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            cwd=ROOT,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )

    def send(self, msg: dict[str, Any]) -> None:
        assert self.p.stdin is not None
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()

    def recv(self) -> dict[str, Any]:
        assert self.p.stdout is not None
        line = self.p.stdout.readline()
        if not line:
            raise RuntimeError("Node のプロセスが終了した")
        return json.loads(line)

    def call(self, msg: dict[str, Any]) -> dict[str, Any]:
        self.send(msg)
        return self.recv()

    def close(self) -> None:
        """入力を閉じて終わりを待つ。待っても終わらなければ止める（ゾンビのプロセスを残さない）"""
        for f in (self.p.stdin, self.p.stdout):
            try:
                if f:
                    f.close()
            except OSError:
                pass
        try:
            self.p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.p.kill()
            self.p.wait()


class FunyaojiVecEnv(VecEnv):
    def __init__(
        self,
        workers: int = 16,
        envs_per_worker: int = 8,
        config: dict[str, Any] | None = None,
        mode: str = DEFAULT_MODE,
    ):
        self.workers = workers
        self.per = envs_per_worker
        self.config = config or {}
        self.mode = mode
        self.procs: list[NodeProcess] = []
        try:
            for _ in range(workers):
                self.procs.append(NodeProcess(mode))
            init = {"cmd": "init", "n": self.per, "config": self.config}
            for p in self.procs:
                p.send(init)
            replies = [p.recv() for p in self.procs]
        except BaseException:
            # 途中で失敗したら、起動済みのプロセスを残さない
            self.close()
            raise
        first = replies[0]
        self.actor_obs: int = first["actorObs"]
        self.fingerprint: str = first["fingerprint"]
        self.rapier: str = first["rapier"]
        self.shapes: dict[str, Any] = first["shapes"]
        self._obs = np.concatenate([np.asarray(r["obs"], np.float32) for r in replies])
        obs_space = spaces.Box(-np.inf, np.inf, (first["obsDim"],), np.float32)
        # 行動は -1〜1。関節の入力（0〜1）には、Node の側で直して 1/1000 にそろえる
        act_space = spaces.Box(-1.0, 1.0, (ACT_DIM,), np.float32)
        self._actions: np.ndarray | None = None
        super().__init__(workers * envs_per_worker, obs_space, act_space)

    def reset(self) -> np.ndarray:
        # 環境は終わるたびに自分でやり直すので、最初の観測をそのまま返す
        return self._obs

    def step_async(self, actions: np.ndarray) -> None:
        u = np.clip(actions, -1.0, 1.0).astype(np.float64)
        for i, p in enumerate(self.procs):
            p.send({"cmd": "step", "a": u[i * self.per : (i + 1) * self.per].tolist()})

    def step_wait(self):
        obs, rew, done, infos = [], [], [], []
        for p in self.procs:
            r = p.recv()
            obs.append(np.asarray(r["obs"], np.float32))
            rew.append(np.asarray(r["rew"], np.float32))
            done.append(np.asarray(r["done"], bool))
            for info in r["info"]:
                if info is None:
                    infos.append({})
                    continue
                info["terminal_observation"] = np.asarray(info.pop("final"), np.float32)
                # 学習の上限時間は打ち切り。ゲームの終わり（ゴール・転倒）は Node の側で優先している
                info["TimeLimit.truncated"] = info["outcome"] == "timeout"
                infos.append(info)
        self._obs = np.concatenate(obs)
        return self._obs, np.concatenate(rew), np.concatenate(done), infos

    def close(self) -> None:
        for p in self.procs:
            p.close()

    # VecEnv が求めるが、ここでは使わないもの
    def get_attr(self, attr_name, indices=None):
        return [None] * self.num_envs

    def set_attr(self, attr_name, value, indices=None):
        pass

    def env_method(self, method_name, *method_args, indices=None, **method_kwargs):
        return [None] * self.num_envs

    def env_is_wrapped(self, wrapper_class, indices=None):
        return [False] * self.num_envs
