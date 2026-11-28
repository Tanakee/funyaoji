"""入力の記録を評価し、MLflow のレジストリに載せ、別名を移し、ゲームに書き出す（docs/ml.md の「実験の管理」）。

どの操作も、1つのモード（src/screen/game/modes.ts の一覧。省くとノーマル）について行う。

- 評価：記録を Node で、そのモードの物理の1ステップずつ再生し、タイムと物理の不具合の量を測る（scripts/rl/anomaly.ts）
  - (E1)：10m に着いた
  - (E2)：(E1) で、物理の不具合のしきい値（THRESHOLDS）を越えていない
- 登録：モードのモデル（ノーマルは funyaoji-10m-record、ほかは funyaoji-10m-record-<モード>）の version として載せる。
  候補は、run のタグ mode がそのモードの run だけ（タグの無い run はノーマル）。
  同じ物理の指紋で同じ記録（入力の列のハッシュ）は二度載せない。
  記録は今の物理で再生して評価するので、学習したときの指紋が今と違う run の記録も、今の指紋で載せる
- 別名：同じ物理の指紋の中で、(E2) の最速に theory、(E1) の最速に theory-any を付ける。
  別名の記録が別の指紋のものなら、新しい指紋の記録が速さにかかわらず別名を取る
- 登録と、実験・モデルを作るところは、ml/.registry.lock の鍵で1つずつにする（何本も同時に流すため）
- 書き出し：theory の記録を src/screen/game/ai/theory/<モード>.json に書く。再生の一致のテスト（theory.test.ts）と fingerprint.ts が読む。
  theory が今の物理の指紋の記録でなければ、書き出さずに止める

使い方（ml/ で）：
  uv run python -m funyaoji_rl.registry submit         # 実験の全部の run の記録を評価して登録し、別名を移す
  uv run python -m funyaoji_rl.registry submit <run_id> ...
  uv run python -m funyaoji_rl.registry list
  uv run python -m funyaoji_rl.registry export
  uv run python -m funyaoji_rl.registry --mode normal export   # モードを選ぶ（省くとノーマル）
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path
from typing import Any

from . import tracking
from .tracking import mlflow
from .vec_env import DEFAULT_MODE, ROOT, NodeProcess

# ノーマルのモデル。ほかのモードは model_name() の名前
MODEL = "funyaoji-10m-record"
THEORY = "theory"
THEORY_ANY = "theory-any"
EXPORT_DIR = ROOT / "src/screen/game/ai/theory"


def model_name(mode: str = DEFAULT_MODE) -> str:
    """モードのモデルの名前。ノーマルは前からの名前のまま（モードを分ける前の version と別名をそのまま使う）"""
    return MODEL if mode == DEFAULT_MODE else f"{MODEL}-{mode}"


def export_path(mode: str = DEFAULT_MODE) -> Path:
    """モードの理論値の記録の場所。再生の一致のテスト（theory.test.ts）と fingerprint.ts が読む"""
    return EXPORT_DIR / f"{mode}.json"


def run_mode(run: Any) -> str:
    """run のモード。モードを分ける前の run には mode のタグが無く、ノーマルで学習している"""
    return run.data.tags.get("mode", DEFAULT_MODE)

# 物理の不具合のしきい値。普通の走り（お手本の歩き方）と、最初の実験の走りで出た値の、およそ 10 倍にした（ml/README.md）
THRESHOLDS = {
    "jointOvershoot": 0.05,  # rad。ただし jointOvershootS（0.05 rad を越えて続いた秒数）も 0.05 秒を越えたときだけ
    "penetration": 0.02,  # m。penetrationS も 0.05 秒を越えたときだけ
    "jump": 0.25,  # m
    "peakSpeed": 5.0,  # m/s
}
DURATION_S = 0.05


def e2_problems(a: dict[str, Any]) -> list[str]:
    out = []
    if a["jointOvershoot"] > THRESHOLDS["jointOvershoot"] and a["jointOvershootS"] > DURATION_S:
        out.append(f"関節が範囲を {a['jointOvershoot']:.3f} rad 越えた（{a['jointOvershootS']:.2f} 秒）")
    if a["penetration"] > THRESHOLDS["penetration"] and a["penetrationS"] > DURATION_S:
        out.append(f"地面に {a['penetration']:.3f} m めり込んだ（{a['penetrationS']:.2f} 秒）")
    if a["jump"] > THRESHOLDS["jump"]:
        out.append(f"胴が {a['jump']:.2f} m 跳ね上がった")
    if a["peakSpeed"] > THRESHOLDS["peakSpeed"]:
        out.append(f"胴の速さが {a['peakSpeed']:.1f} m/s になった")
    return out


def evaluate(proc: NodeProcess, inputs: list[list[float]]) -> dict[str, Any]:
    """記録を物理の1ステップずつ再生して、不具合の量と (E1)・(E2) を返す"""
    a = proc.call({"cmd": "check", "inputs": inputs})
    e1 = a["outcome"] == "goal"
    problems = e2_problems(a) if e1 else ["ゴールしていない"]
    return {"anomaly": a, "e1": e1, "e2": e1 and not problems, "problems": problems}


def record_hash(inputs: list[list[float]]) -> str:
    return hashlib.sha256(json.dumps(inputs).encode()).hexdigest()[:16]


def _client(mode: str) -> mlflow.MlflowClient:
    model = model_name(mode)
    with tracking.lock():
        tracking.setup()
        client = mlflow.MlflowClient()
        try:
            client.get_registered_model(model)
        except mlflow.exceptions.MlflowException:
            client.create_registered_model(
                model, description=f"モード {mode} の入力の記録（毎秒30回の4つの値）。docs/ml.md"
            )
    return client


def _all_runs(client: mlflow.MlflowClient, experiment_id: str) -> list[Any]:
    """件数の上限で切れないよう、ページをたどって全部の run を読む"""
    out: list[Any] = []
    token = None
    while True:
        page = client.search_runs(
            [experiment_id], "attributes.status = 'FINISHED'", max_results=1000, page_token=token
        )
        out.extend(page)
        token = page.token
        if not token:
            return out


def _candidates(
    client: mlflow.MlflowClient, run_ids: list[str] | None, mode: str
) -> list[dict[str, Any]]:
    exp = mlflow.get_experiment_by_name(tracking.EXPERIMENT)
    runs = [client.get_run(r) for r in run_ids] if run_ids else _all_runs(client, exp.experiment_id)
    out = []
    with tempfile.TemporaryDirectory() as tmp:
        for run in runs:
            if "physics_fingerprint" not in run.data.tags:
                continue
            # ほかのモードで学習した記録は載せない
            if run_mode(run) != mode:
                if run_ids:
                    print(f"{run.info.run_name} はモード {run_mode(run)} の run なので、{mode} には載せない")
                continue
            # 動作確認と速さの計測の run は載せない
            if any(w in (run.info.run_name or "") for w in ("smoke", "bench")):
                continue
            for art in client.list_artifacts(run.info.run_id, "records"):
                if art.is_dir:
                    continue
                local = Path(client.download_artifacts(run.info.run_id, art.path, tmp))
                rec = json.loads(local.read_text(encoding="utf-8"))
                if not rec.get("inputs"):
                    continue
                out.append(
                    {
                        "run": run,
                        "artifact": art.path,
                        "inputs": rec["inputs"],
                        "hash": record_hash(rec["inputs"]),
                    }
                )
    return out


def _versions(client: mlflow.MlflowClient, model: str) -> list[Any]:
    """件数の上限で切れないよう、ページをたどって全部の version を読む"""
    out: list[Any] = []
    token = None
    while True:
        page = client.search_model_versions(f"name='{model}'", max_results=1000, page_token=token)
        out.extend(page)
        token = page.token
        if not token:
            return out


def current_physics(mode: str = DEFAULT_MODE) -> dict[str, Any]:
    """モードの今の物理の指紋と Rapier の版を、Node に聞く"""
    proc = NodeProcess(mode)
    try:
        return proc.call({"cmd": "init", "n": 1, "config": {}})
    finally:
        proc.close()


def submit(run_ids: list[str] | None = None, mode: str = DEFAULT_MODE) -> None:
    # 読み直してから別名を移すまでに、ほかの run が割り込まないよう、全体を鍵の中で行う
    with tracking.lock():
        _submit(run_ids, mode)


def _submit(run_ids: list[str] | None, mode: str) -> None:
    client = _client(mode)
    model = model_name(mode)
    proc = NodeProcess(mode)
    try:
        current = proc.call({"cmd": "init", "n": 1, "config": {}})
        fingerprint = current["fingerprint"]
        # 重複は（物理の指紋、記録のハッシュ）で見る。物理が変われば、同じ記録も評価し直して載せる
        known = {
            (v.tags.get("physics_fingerprint"), v.tags.get("record_hash")) for v in _versions(client, model)
        }
        for c in _candidates(client, run_ids, mode):
            run = c["run"]
            if (fingerprint, c["hash"]) in known:
                continue
            tracking.touch()
            ev = evaluate(proc, c["inputs"])
            a, e1, e2, problems = ev["anomaly"], ev["e1"], ev["e2"], ev["problems"]
            v =client.create_model_version(
                model,
                source=f"{run.info.artifact_uri}/{c['artifact']}",
                run_id=run.info.run_id,
                tags={
                    "mode": mode,
                    "record_hash": c["hash"],
                    "physics_fingerprint": fingerprint,
                    # 学習・探索したときの指紋。今の指紋と違っても、記録は今の物理で再生して評価している
                    "run_physics_fingerprint": run.data.tags["physics_fingerprint"],
                    "rapier": current["rapier"],
                    "method": run.data.tags.get("method", ""),
                    "run_name": run.info.run_name,
                    "artifact": c["artifact"],
                    "time_ms": str(a["timeMs"]) if e1 else "",
                    "e1": str(e1),
                    "e2": str(e2),
                    "problems": "、".join(problems),
                    **{f"anomaly.{k}": f"{a[k]:.4f}" for k in THRESHOLDS},
                },
            )
            known.add((fingerprint, c["hash"]))
            print(f"v{v.version} {run.info.run_name} {c['artifact']} {a['timeMs']} E1={e1} E2={e2}")
        _move_alias(client, model, THEORY, "e2", fingerprint)
        _move_alias(client, model, THEORY_ANY, "e1", fingerprint)
    finally:
        proc.close()


def _move_alias(client: mlflow.MlflowClient, model: str, alias: str, flag: str, fingerprint: str) -> None:
    """同じ指紋で flag の立った version の最速に、別名を移す。読んでから移すまでに変わっていたら、読み直す"""
    for _ in range(3):
        ok = [
            v
            for v in _versions(client, model)
            if v.tags.get(flag) == "True" and v.tags.get("physics_fingerprint") == fingerprint
        ]
        if not ok:
            return
        best = min(ok, key=lambda v: int(v.tags["time_ms"]))
        try:
            cur = client.get_model_version_by_alias(model, alias)
        except mlflow.exceptions.MlflowException:
            cur = None
        same_fp = cur is not None and cur.tags.get("physics_fingerprint") == fingerprint
        if same_fp and int(cur.tags["time_ms"]) <= int(best.tags["time_ms"]):
            return
        # compare-and-set：移す直前に、まだ同じ version を指しているかを確かめる
        try:
            again = client.get_model_version_by_alias(model, alias).version
        except mlflow.exceptions.MlflowException:
            again = None
        if again != (cur.version if cur else None):
            continue
        client.set_registered_model_alias(model, alias, best.version)
        print(f"{model} {alias} → v{best.version}（{best.tags['run_name']}、{int(best.tags['time_ms']) / 1000} 秒）")
        return


def export(mode: str = DEFAULT_MODE) -> Path:
    client = _client(mode)
    model = model_name(mode)
    try:
        v = client.get_model_version_by_alias(model, THEORY)
    except mlflow.exceptions.MlflowException as e:
        raise SystemExit(f"{model} に別名 {THEORY} が無い。先に submit で記録を載せる") from e
    fingerprint = current_physics(mode)["fingerprint"]
    if v.tags.get("physics_fingerprint") != fingerprint:
        raise SystemExit(
            f"{model} の別名 {THEORY}（v{v.version}）は物理の指紋 {v.tags.get('physics_fingerprint')} の記録で、"
            f"モード {mode} の今の指紋 {fingerprint} と違う。submit で今の物理の記録を載せてから書き出す"
        )
    with tempfile.TemporaryDirectory() as tmp:
        local = Path(client.download_artifacts(v.run_id, v.tags["artifact"], tmp))
        rec = json.loads(local.read_text(encoding="utf-8"))
    out = {
        "hz": 30,
        "joints": ["rightHip", "leftHip", "rightKnee", "leftKnee"],
        "timeMs": int(v.tags["time_ms"]),
        "physicsFingerprint": v.tags["physics_fingerprint"],
        "rapier": v.tags["rapier"],
        "method": v.tags["method"],
        "source": f"{model} v{v.version}（{v.tags['run_name']}）",
        "inputs": rec["inputs"],
    }
    path = export_path(mode)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{path.relative_to(ROOT)} ← v{v.version}（{out['timeMs'] / 1000} 秒）")
    return path


def show(mode: str = DEFAULT_MODE) -> None:
    client = _client(mode)
    model = model_name(mode)
    aliases: dict[str, str] = {}
    for name in (THEORY, THEORY_ANY):
        try:
            ver = client.get_model_version_by_alias(model, name).version
            aliases[ver] = f"{aliases[ver]} {name}" if ver in aliases else name
        except mlflow.exceptions.MlflowException:
            pass
    for v in sorted(_versions(client, model), key=lambda v: int(v.tags.get("time_ms") or 10**9)):
        t = v.tags
        print(f"v{v.version:>3} {t.get('time_ms') or '-':>6} E1={t['e1']:<5} E2={t['e2']:<5} {t['run_name']:<22} {t['artifact']:<34} {aliases.get(v.version, '')}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", default=DEFAULT_MODE, help="モード（src/screen/game/modes.ts の一覧）")
    ap.add_argument("action", choices=["submit", "list", "export"])
    ap.add_argument("run_ids", nargs="*")
    args = ap.parse_args()
    if args.action == "submit":
        submit(args.run_ids or None, args.mode)
    elif args.action == "list":
        show(args.mode)
    else:
        export(args.mode)


if __name__ == "__main__":
    main()
