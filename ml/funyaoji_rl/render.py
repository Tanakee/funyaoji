"""入力の記録を動画にする（docs/ml.md の「学習の様子を見る」）。

Node（server.ts の replay）で記録を再生して、コマごとの体の位置を出し、Pillow で絵にする。
記録を複数渡すと、並べて同時にスタートさせる。GIF と mp4（imageio-ffmpeg）を作る。

使い方（ml/ で）：uv run python -m funyaoji_rl.render --out runs/x/video 記録1.json 記録2.json ...
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import imageio.v2 as imageio
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from .vec_env import NodeProcess

PANEL_W, PANEL_H = 420, 250
SCALE = 80  # 1m の画素数
GROUND_Y = PANEL_H - 50
GOAL_M = 10
FPS = 30
HOLD_S = 1.5

COLORS = {
    "torso": (232, 160, 90),
    "head": (245, 205, 160),
    "right": (70, 110, 190),
    "left": (150, 175, 220),
    "foot": (60, 60, 60),
}
PART_SIDE = {
    "torso": "torso",
    "rightThigh": "right",
    "rightShin": "right",
    "leftThigh": "left",
    "leftShin": "left",
}
# 奥の脚（左）を先に描く
DRAW_ORDER = ["leftThigh", "leftShin", "torso", "rightThigh", "rightShin"]


def _font(size: int) -> ImageFont.ImageFont:
    for name in ["meiryo.ttc", "YuGothM.ttc", "msgothic.ttc", "NotoSansCJK-Regular.ttc"]:
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def replay(proc: NodeProcess, inputs: list[list[float]]) -> dict[str, Any]:
    return proc.call({"cmd": "replay", "inputs": inputs})


def _shape_points(shape: dict, pose: dict, cam_x: float) -> list[tuple[float, float]] | tuple:
    c, s = math.cos(pose["rot"]), math.sin(pose["rot"])

    def to_px(lx: float, ly: float) -> tuple[float, float]:
        wx = pose["x"] + lx * c - ly * s
        wy = pose["y"] + lx * s + ly * c
        return (PANEL_W / 2 + (wx - cam_x) * SCALE, GROUND_Y - wy * SCALE)

    if shape["kind"] == "box":
        ox, oy, hw, hh = shape["ox"], shape["oy"], shape["hw"], shape["hh"]
        return [to_px(ox + dx * hw, oy + dy * hh) for dx, dy in [(-1, -1), (1, -1), (1, 1), (-1, 1)]]
    cx, cy = to_px(shape["ox"], shape["oy"])
    r = shape["r"] * SCALE
    return (cx - r, cy - r, cx + r, cy + r)


def draw_panel(
    shapes: dict[str, list[dict]], frame: dict, label: str, status: str, font, small
) -> Image.Image:
    img = Image.new("RGB", (PANEL_W, PANEL_H), (250, 248, 242))
    d = ImageDraw.Draw(img)
    cam_x = frame["poses"]["torso"]["x"]
    # 地面と、1m ごとの目盛り
    d.rectangle([0, GROUND_Y, PANEL_W, PANEL_H], fill=(214, 204, 184))
    first = math.floor(cam_x - PANEL_W / 2 / SCALE)
    for m in range(first, first + PANEL_W // SCALE + 2):
        px = PANEL_W / 2 + (m - cam_x) * SCALE
        goal = m == GOAL_M
        d.line([px, GROUND_Y, px, GROUND_Y + (18 if goal else 8)], fill=(200, 40, 40) if goal else (120, 110, 95), width=3 if goal else 1)
        if m >= 0:
            d.text((px + 3, GROUND_Y + 10), f"{m}m", fill=(110, 100, 85), font=small)
    if GOAL_M - 1 <= cam_x + PANEL_W / 2 / SCALE and cam_x - PANEL_W / 2 / SCALE <= GOAL_M:
        px = PANEL_W / 2 + (GOAL_M - cam_x) * SCALE
        d.line([px, 0, px, GROUND_Y], fill=(220, 60, 60), width=2)
    for name in DRAW_ORDER:
        pose = frame["poses"][name]
        for shape in shapes[name]:
            pts = _shape_points(shape, pose, cam_x)
            tag = shape["tag"]
            color = COLORS["foot"] if tag == "foot" else COLORS["head"] if tag == "head" else COLORS[PART_SIDE[name]]
            if shape["kind"] == "box":
                d.polygon(pts, fill=color, outline=(40, 40, 40))
            else:
                d.ellipse(pts, fill=color, outline=(40, 40, 40))
    d.rectangle([0, 0, PANEL_W - 1, PANEL_H - 1], outline=(190, 190, 190))
    d.text((10, 8), label, fill=(30, 30, 30), font=font)
    d.text((10, 32), f"{frame['distanceM']:.2f}m  {frame['elapsedMs'] / 1000:.2f}秒  {status}", fill=(60, 60, 60), font=small)
    return img


def render(
    shapes: dict[str, list[dict]],
    runs: list[tuple[str, list[list[float]]]],
    out_base: Path,
    cols: int = 2,
) -> tuple[Path, Path]:
    """記録を並べて同時に再生する動画を作り、GIF と mp4 の場所を返す"""
    proc = NodeProcess()
    try:
        replays = [replay(proc, inputs) for _, inputs in runs]
    finally:
        proc.close()
    font, small = _font(18), _font(14)
    n = len(runs)
    cols = min(cols, n)
    rows = math.ceil(n / cols)
    length = max(len(r["frames"]) for r in replays) + int(HOLD_S * FPS)
    frames: list[np.ndarray] = []
    for k in range(length):
        sheet = Image.new("RGB", (cols * PANEL_W, rows * PANEL_H), (255, 255, 255))
        for i, ((label, _), rep) in enumerate(zip(runs, replays)):
            fr = rep["frames"]
            done = k >= len(fr) - 1
            frame = fr[min(k, len(fr) - 1)]
            result = rep["result"]
            if done and result:
                status = "ゴール" if result["outcome"] == "goal" else "転倒"
            elif done:
                status = "打ち切り"
            else:
                status = ""
            panel = draw_panel(shapes, frame, label, status, font, small)
            sheet.paste(panel, ((i % cols) * PANEL_W, (i // cols) * PANEL_H))
        frames.append(np.asarray(sheet))
    out_base.parent.mkdir(parents=True, exist_ok=True)
    mp4 = out_base.with_suffix(".mp4")
    gif = out_base.with_suffix(".gif")
    imageio.mimwrite(mp4, frames, fps=FPS, macro_block_size=1)
    # GIF は小さくする（半分の大きさ、毎秒15コマ）
    small_frames = [
        np.asarray(Image.fromarray(f).resize((f.shape[1] // 2, f.shape[0] // 2))) for f in frames[::2]
    ]
    imageio.mimwrite(gif, small_frames, duration=1000 / (FPS / 2), loop=0)
    return gif, mp4


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True, help="出力の名前（拡張子なし）")
    ap.add_argument("--cols", type=int, default=2)
    ap.add_argument("records", type=Path, nargs="+")
    args = ap.parse_args()
    proc = NodeProcess()
    try:
        shapes = proc.call({"cmd": "init", "n": 1, "config": {}})["shapes"]
    finally:
        proc.close()
    runs = []
    for path in args.records:
        rec = json.loads(path.read_text(encoding="utf-8"))
        runs.append((rec.get("label", path.stem), rec["inputs"]))
    gif, mp4 = render(shapes, runs, args.out, args.cols)
    print(gif, mp4)


if __name__ == "__main__":
    main()
