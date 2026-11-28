// 糸の見た目の値。決まりは docs/screens.md の「糸」
import type { Joint } from "../../shared/messages.ts";

/** これより小さい入力の変化（約1.8度）は、置いたままのスマホの揺れとみなして光らせない */
export const TILT_GLOW_THRESHOLD = 0.02;
export const TILT_GLOW_HOLD_SEC = 0.25;
export const TILT_GLOW_FADE_SEC = 0.3;

const GLOW_DURATION_SEC = TILT_GLOW_HOLD_SEC + TILT_GLOW_FADE_SEC;

/**
 * 関節ごとの光り方（0〜1）。傾きが変わっている間は 1 で、止まると消える。
 * value が undefined（参加していない席）なら 0 にして、前の値を忘れる。参加して最初の値では光らせない
 */
export class TiltGlow {
  private readonly samples = new Map<Joint, { reference: number; elapsedSec: number }>();

  update(joint: Joint, value: number | undefined, dtSec: number): number {
    if (value === undefined) {
      this.samples.delete(joint);
      return 0;
    }
    const sample = this.samples.get(joint);
    if (!sample) {
      this.samples.set(joint, { reference: value, elapsedSec: GLOW_DURATION_SEC });
      return 0;
    }
    // 差がしきい値と等しいときの丸め誤差を吸収する
    if (Math.abs(value - sample.reference) + Number.EPSILON >= TILT_GLOW_THRESHOLD) {
      sample.reference = value;
      sample.elapsedSec = 0;
      return 1;
    }
    sample.elapsedSec = Math.min(GLOW_DURATION_SEC, sample.elapsedSec + dtSec);
    if (sample.elapsedSec <= TILT_GLOW_HOLD_SEC) return 1;
    return (GLOW_DURATION_SEC - sample.elapsedSec) / TILT_GLOW_FADE_SEC;
  }
}

export interface StringLook {
  /** たるんだときの曲がり具合に掛ける割合 */
  slack: number;
  coreWidth: number;
  outlineWidth: number;
  alpha: number;
  /** 芯の色を空の色に寄せる割合 */
  skyBlend: number;
  /** 結び玉の位置。0 が札、1 が部位の先 */
  knotPosition: number;
  knotRadius: number;
}

/** 張り（0 がたるんだ、1 が張り切った）での糸の見た目。大きさは 1280×720 での値 */
export function stringLook(tension: number): StringLook {
  const t = Math.min(1, Math.max(0, tension));
  const coreWidth = 1.5 + 3 * t;
  return {
    slack: 1 - t,
    coreWidth,
    outlineWidth: coreWidth + 2.5,
    alpha: 0.45 + 0.55 * t,
    skyBlend: 0.5 * (1 - t),
    knotPosition: 0.75 - 0.55 * t,
    knotRadius: 5 + 2 * t,
  };
}

type Point = { x: number; y: number };

export function quadraticBezierPoint(start: Point, control: Point, end: Point, u: number): Point {
  const startWeight = (1 - u) ** 2;
  const controlWeight = 2 * (1 - u) * u;
  const endWeight = u ** 2;
  return {
    x: startWeight * start.x + controlWeight * control.x + endWeight * end.x,
    y: startWeight * start.y + controlWeight * control.y + endWeight * end.y,
  };
}

export function mixRgb(from: number, to: number, ratio: number): number {
  const channel = (shift: number) => {
    const a = (from >> shift) & 0xff;
    const b = (to >> shift) & 0xff;
    return Math.round(a + (b - a) * ratio);
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
