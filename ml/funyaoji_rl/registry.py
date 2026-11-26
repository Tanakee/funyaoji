"""学習した重みを評価し、通ったものだけを MLflow のモデルのレジストリに登録する。

使い方（ml/ で）：
  uv run python -m funyaoji_rl.registry list              登録した重みの一覧
  uv run python -m funyaoji_rl.registry export            いちばん良い重み（champion）を、/prototype が読む場所に書き出す
  uv run python -m funyaoji_rl.registry submit <run の ID>   学習の済んだ run を、評価して登録する

評価：乱数なしで1回走らせる（物理も AI も乱数を使わないので、何回走らせても同じ結果になる）。
登録の条件：10m に着き、不自然な動き（lab/run.ts の sanity()）が無い。
champion（/prototype で使う重み）にする条件：今の champion より速い。体の設定が変わっていたら、速さにかかわらず入れ替える。
"""

from __future__ import annotations

import argparse
import json
import sys
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from . import tracking
from .tracking import CHAMPION, MODEL_NAME, PROTOTYPE, ROOT, mlflow

from mlflow import MlflowClient  # noqa: E402  tracking のあとで読む（MLflow の案内を消す設定が先）
from mlflow.exceptions import MlflowException  # noqa: E402
from .vec_env import BODY_B

PLAY = PROTOTYPE / "lab/rl/play.ts"
EXPORT_TO = PROTOTYPE / "policy-b.json"


def evaluate(policy: Path, body: Path = BODY_B) -> dict[str, Any]:
    """重みを Node で1回走らせる。ゲームと同じコード（policy.ts と sim.ts）で測る"""
    out = subprocess.run(
        ["node", str(PLAY), str(policy.resolve()), "--body", str(body), "--json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    ).stdout
    return json.loads(out.strip().splitlines()[-1])


def passed(result: dict[str, Any]) -> bool:
    return result["ended"] == "goal" and not result["problems"]


def champion(client: MlflowClient):
    try:
        return client.get_model_version_by_alias(MODEL_NAME, CHAMPION)
    except MlflowException:
        return None


def submit(run_id: str, policy: Path | None = None) -> dict[str, Any]:
    """run の重みを評価し、結果を run に書く。通れば登録し、今の champion より良ければ入れ替える"""
    tracking.setup()
    client = MlflowClient()
    with tempfile.TemporaryDirectory() as tmp:
        if policy is None:
            policy = Path(
                mlflow.artifacts.download_artifacts(
                    run_id=run_id, artifact_path="policy.json", dst_path=tmp
                )
            )
        result = evaluate(policy)
    ok = passed(result)
    body = tracking.body_fingerprint()
    with mlflow.start_run(run_id=run_id):
        mlflow.log_metrics(
            {
                "eval_goal": float(result["ended"] == "goal"),
                "eval_time": result["time"],
                "eval_distance": result["distance"],
                "eval_problems": len(result["problems"]),
                "eval_peak_speed": result["peakSpeed"],
                "eval_air_frac": result["airFrac"],
            }
        )
        mlflow.set_tags({"eval_ended": result["ended"], "eval_passed": str(ok)})
    summary: dict[str, Any] = {"run_id": run_id, "passed": ok, "body": body, **result}
    if not ok:
        return summary

    try:
        client.create_registered_model(
            MODEL_NAME, description="ふにゃおじを歩かせる AI の重み（policy.json）"
        )
    except MlflowException:
        pass  # もうある
    version = client.create_model_version(
        MODEL_NAME,
        source=f"runs:/{run_id}/policy.json",
        run_id=run_id,
        tags={"body": body, "time": f"{result['time']:.3f}"},
    )
    summary["version"] = version.version
    now = champion(client)
    better = now is None or now.tags.get("body") != body or result["time"] < float(now.tags["time"])
    if better:
        client.set_registered_model_alias(MODEL_NAME, CHAMPION, version.version)
    summary["champion"] = better
    return summary


def export(dst: Path = EXPORT_TO) -> dict[str, Any]:
    """champion の重みを、/prototype が読む場所に書き出す。リポジトリの書式にそろえる"""
    tracking.setup()
    client = MlflowClient()
    now = champion(client)
    if now is None:
        raise SystemExit("champion がまだ無い。先に学習して登録する")
    body = tracking.body_fingerprint()
    if now.tags.get("body") != body:
        raise SystemExit(
            f"champion は別の体の設定（{now.tags.get('body')}）で学習したもの。今の体（{body}）で学習し直す"
        )
    with tempfile.TemporaryDirectory() as tmp:
        src = mlflow.artifacts.download_artifacts(
            run_id=now.run_id, artifact_path="policy.json", dst_path=tmp
        )
        shutil.copyfile(src, dst)
    subprocess.run(f'npx vp fmt "{dst}"', cwd=ROOT, shell=True, check=True, capture_output=True)
    return {"version": now.version, "time": now.tags["time"], "run_id": now.run_id, "to": str(dst)}


def versions() -> list[dict[str, Any]]:
    tracking.setup()
    client = MlflowClient()
    now = champion(client)
    rows = []
    for v in client.search_model_versions(f"name='{MODEL_NAME}'"):
        rows.append(
            {
                "version": v.version,
                "time": v.tags.get("time"),
                "body": v.tags.get("body"),
                "run_id": v.run_id,
                "champion": now is not None and v.version == now.version,
            }
        )
    return sorted(rows, key=lambda r: int(r["version"]))


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows でも日本語をそのまま出す
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    sub.add_parser("export")
    s = sub.add_parser("submit")
    s.add_argument("run_id")
    args = ap.parse_args()
    if args.cmd == "list":
        for row in versions():
            print(json.dumps(row, ensure_ascii=False))
    elif args.cmd == "export":
        print(json.dumps(export(), ensure_ascii=False))
    else:
        print(json.dumps(submit(args.run_id), ensure_ascii=False))


if __name__ == "__main__":
    main()
