// 決まった歩き方（体の状態を見ない、時間だけで決まる入力）。docs/ml.md の「決まった歩き方を土台にするか」の ①。
// お手本（demo.ts）と同じ式で、5つの値を変えられるようにしたもの。DOM にも Node にも依存しない
import { JOINTS } from "../../../shared/messages.ts";
import { ACTION_HZ, quantize } from "./observe.ts";
import type { InputRecord } from "./record.ts";

/** T：1歩の周期（秒）、h0：ももの中心、A：ももの振れ幅、K：ひざの曲げの大きさ、kp：ひざの位相のずれ（rad） */
export interface Gait {
  T: number;
  h0: number;
  A: number;
  K: number;
  kp: number;
}

/** お手本の歩き方の値（demo.ts と同じ） */
export const DEMO_GAIT: Gait = { T: 2.16, h0: 0.34, A: 0.38, K: 0.76, kp: 0.21 };

const clamp = (x: number) => Math.min(1, Math.max(0, x));

/** 歩き方の、tSec 秒のときの入力（JOINTS の順） */
export function gaitInputs(g: Gait, tSec: number): number[] {
  return JOINTS.map((j) => {
    const ph = (tSec / g.T) * Math.PI * 2 + (j.startsWith("left") ? Math.PI : 0);
    return j.endsWith("Hip")
      ? clamp(g.h0 + g.A * Math.sin(ph))
      : clamp(g.K * Math.max(0, Math.sin(ph + g.kp)));
  });
}

/** 歩き方を、毎秒30回の記録にする（1/1000 にそろえる） */
export function gaitRecord(g: Gait, seconds: number): InputRecord {
  const inputs: number[][] = [];
  for (let k = 0; k < seconds * ACTION_HZ; k++) {
    inputs.push(gaitInputs(g, k / ACTION_HZ).map(quantize));
  }
  return { hz: ACTION_HZ, joints: JOINTS, inputs };
}
