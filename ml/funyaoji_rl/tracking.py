"""MLflow の置き場所と、実験に付ける情報（コミット・体の設定の指紋）。

MLflow はオープンソースのものを手元で動かす。記録は ml/mlflow.db（SQLite）と ml/mlartifacts/ に残る。
ほかの場所（別のマシンの MLflow サーバーなど）に記録するときは、環境変数 MLFLOW_TRACKING_URI を入れる。
"""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
from pathlib import Path
from typing import Any

os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")

import mlflow  # noqa: E402

from .vec_env import BODY_B, ROOT  # noqa: E402

ML_DIR = ROOT / "ml"
EXPERIMENT = "funyaoji-walk"
MODEL_NAME = "funyaoji-walker"
CHAMPION = "champion"
PROTOTYPE = ROOT / "src/screen/game/prototype"
# 体の動きを決めるファイル。どれかが変わると、前に学習した重みは使えない
PHYSICS_FILES = [PROTOTYPE / "sim.ts", PROTOTYPE / "policy.ts"]


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


def body_fingerprint(body_path: Path = BODY_B) -> str:
    """体の設定と物理のコードから作る指紋。同じ指紋の重みどうしだけ、タイムを比べられる"""
    h = hashlib.sha256()
    params = json.loads(body_path.read_text(encoding="utf-8"))["params"]
    h.update(json.dumps(params, sort_keys=True).encode())
    for f in PHYSICS_FILES:
        # 改行コードの違い（Windows と Linux）で指紋が変わらないようにする
        h.update(f.read_bytes().replace(b"\r\n", b"\n"))
    return h.hexdigest()[:12]


def flatten(prefix: str, d: dict[str, Any]) -> dict[str, Any]:
    return {f"{prefix}.{k}": v for k, v in d.items() if not isinstance(v, dict)}
