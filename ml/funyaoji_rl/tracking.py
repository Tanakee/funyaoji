"""MLflow の置き場所と、実験に付ける情報（コミット・体の設定の指紋）。

MLflow はオープンソースのものを手元で動かす。記録は ml/mlflow.db（SQLite）と ml/mlartifacts/ に残る。
ほかの場所（別のマシンの MLflow サーバーなど）に記録するときは、環境変数 MLFLOW_TRACKING_URI を入れる。
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from typing import Any

os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")

import mlflow  # noqa: E402

from .vec_env import ROOT, load_body  # noqa: E402

ML_DIR = ROOT / "ml"
EXPERIMENT = "funyaoji-walk"
MODEL_NAME = "funyaoji-walker"
CHAMPION = "champion"
PROTOTYPE = ROOT / "src/screen/game/prototype"
# 体の動きと評価の結果を決めるファイル。どれかが変わると、前に学習した重みとはタイムを比べられない
# （lab/run.ts は打ち切りと sanity()、lab/rl/play.ts は評価のずらし方、bot.ts は土台の歩き方の入力を持つ）
PHYSICS_FILES = [
    PROTOTYPE / "sim.ts",
    PROTOTYPE / "policy.ts",
    PROTOTYPE / "bot.ts",
    PROTOTYPE / "lab/run.ts",
    PROTOTYPE / "lab/rl/play.ts",
]


def setup() -> None:
    """記録先を決め、実験が無ければ作る"""
    if not os.environ.get("MLFLOW_TRACKING_URI"):
        mlflow.set_tracking_uri("sqlite:///" + (ML_DIR / "mlflow.db").as_posix())
        if mlflow.get_experiment_by_name(EXPERIMENT) is None:
            mlflow.create_experiment(
                EXPERIMENT, artifact_location=(ML_DIR / "mlartifacts").as_uri()
            )
    mlflow.set_experiment(EXPERIMENT)


def git_info() -> dict[str, str]:
    def git(*args: str) -> str:
        return subprocess.run(
            ["git", *args], cwd=ROOT, capture_output=True, text=True, encoding="utf-8"
        ).stdout.strip()

    return {"git_commit": git("rev-parse", "HEAD"), "git_dirty": str(bool(git("status", "--porcelain")))}


def body_fingerprint(params: dict[str, Any] | None = None) -> str:
    """体の設定と物理のコードから作る指紋。同じ指紋の重みどうしだけ、タイムを比べられる

    params は学習に使った体の設定（EnvConfig の params）。省くと今の body-b.json の値
    """
    h = hashlib.sha256()
    if params is None:
        params = load_body()
    h.update(json.dumps(params, sort_keys=True).encode())
    for f in PHYSICS_FILES:
        # 改行コードの違い（Windows と Linux）で指紋が変わらないようにする
        h.update(f.read_bytes().replace(b"\r\n", b"\n"))
    return h.hexdigest()[:12]


def flatten(prefix: str, d: dict[str, Any]) -> dict[str, Any]:
    """MLflow のパラメータにする。入れ子の値（体の設定 params など）は JSON の文字列にする"""
    return {
        f"{prefix}.{k}": json.dumps(v, sort_keys=True) if isinstance(v, (dict, list)) else v
        for k, v in d.items()
    }
