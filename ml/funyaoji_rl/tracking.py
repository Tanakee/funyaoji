"""MLflow の置き場所と、run に付ける情報（コミット）。

MLflow は手元で動かす。記録は ml/mlflow.db（SQLite）と ml/mlartifacts/ に残る。
ほかの場所に記録するときは、環境変数 MLFLOW_TRACKING_URI を入れる。
"""

from __future__ import annotations

import contextlib
import os
import subprocess
import time
from collections.abc import Iterator

os.environ.setdefault("MLFLOW_DISABLE_AGENT_HINT", "1")

import mlflow  # noqa: E402

from .vec_env import ROOT  # noqa: E402

ML_DIR = ROOT / "ml"
EXPERIMENT = "funyaoji-10m"
LOCK = ML_DIR / ".registry.lock"
# 鍵のファイルがこれより古ければ、持ち主が落ちたとみなして消す。持ち主は touch() で新しくする
LOCK_STALE_S = 600.0
_held = 0


@contextlib.contextmanager
def lock(timeout_s: float = 3600.0) -> Iterator[None]:
    """実験・モデルを作るところと、レジストリへの登録を、1つずつにする鍵（ml/.registry.lock）。
    何本も同時に流すと、読み直してから書くまでのあいだに、ほかの run が割り込むため。同じプロセスの中では重ねて取れる
    """
    global _held
    if _held:
        _held += 1
        try:
            yield
        finally:
            _held -= 1
        return
    start = time.monotonic()
    wait = 0.05
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, str(os.getpid()).encode())
            os.close(fd)
            break
        except FileExistsError:
            try:
                if time.time() - LOCK.stat().st_mtime > LOCK_STALE_S:
                    LOCK.unlink()
                    continue
            except FileNotFoundError:
                continue
            if time.monotonic() - start > timeout_s:
                raise TimeoutError(f"{LOCK} が {timeout_s:.0f} 秒たっても空かない")
            time.sleep(wait)
            wait = min(wait * 2, 2.0)
    _held = 1
    try:
        yield
    finally:
        _held = 0
        with contextlib.suppress(FileNotFoundError):
            LOCK.unlink()


def touch() -> None:
    """鍵を持ったまま長い処理をするとき、古い鍵として消されないようにする"""
    if _held:
        with contextlib.suppress(FileNotFoundError):
            os.utime(LOCK)


def setup() -> None:
    """記録先を決め、実験が無ければ作る"""
    with lock():
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
