"""MLflow の置き場所と、run に付ける情報（コミット）。

MLflow は手元で動かす。記録は ml/mlflow.db（SQLite）と ml/mlartifacts/ に残る。
ほかの場所に記録するときは、環境変数 MLFLOW_TRACKING_URI を入れる。
"""

from __future__ import annotations

import os
import subprocess

os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")

import mlflow  # noqa: E402

from .vec_env import ROOT  # noqa: E402

ML_DIR = ROOT / "ml"
EXPERIMENT = "funyaoji-10m"


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

    return {
        "git_commit": git("rev-parse", "HEAD"),
        "git_dirty": str(bool(git("status", "--porcelain"))),
    }
