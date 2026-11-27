import { JOINTS } from "../../shared/messages.ts";
import { NEUTRAL_INPUTS } from "./body.ts";
import type { JointInputs } from "./types.ts";

// 試作（#55）のお手本の歩き方。脚を交互に振る
const GAIT = { T: 2.16, h0: 0.34, A: 0.38, K: 0.76, kp: 0.21 };
const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** お手本の入力。プレイ開始からの秒数に対する、全関節の目標位置（0〜1） */
export function demoGait(tSec: number): JointInputs {
  const out = { ...NEUTRAL_INPUTS };
  for (const j of JOINTS) {
    const ph = (tSec / GAIT.T) * Math.PI * 2 + (j.startsWith("left") ? Math.PI : 0);
    out[j] = j.endsWith("Hip")
      ? clamp(GAIT.h0 + GAIT.A * Math.sin(ph))
      : clamp(GAIT.K * Math.max(0, Math.sin(ph + GAIT.kp)));
  }
  return out;
}
