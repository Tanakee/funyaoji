/// <reference lib="dom" />
// 物理の不具合を、直接測る（docs/ml.md の「数えない走り」の (E2)）。
// 記録を物理の1ステップずつ再生し、関節が範囲を越えた量・地面へのめり込み・胴の跳ね上がり・速さを測る
import { JOINTS } from "../../src/shared/messages.ts";
import {
  INITIAL_POSES,
  JOINT_SPECS,
  PART_NAMES,
  PART_SHAPES,
  STEP_S,
  type Pose,
} from "../../src/screen/game/body.ts";
import { quantize, toJointInputs } from "../../src/screen/game/ai/observe.ts";
import type { InputRecord } from "../../src/screen/game/ai/record.ts";
import { Sim } from "../../src/screen/game/sim.ts";

export interface Anomaly {
  /** 関節が範囲を越えた量の最大（rad） */
  jointOvershoot: number;
  /** 関節が 0.05 rad より大きく範囲を越えていた、いちばん長い続いた時間（秒） */
  jointOvershootS: number;
  /** 部位の形が地面より下に入った深さの最大（m） */
  penetration: number;
  /** 0.02m より深くめり込んでいた、いちばん長い続いた時間（秒） */
  penetrationS: number;
  /** 胴の中心が、立った姿勢より上がった高さの最大（m） */
  jump: number;
  /** 胴の前後の速さの最大（m/s） */
  peakSpeed: number;
  /** 胴の回る速さの最大（rad/s） */
  peakSpin: number;
  outcome: string;
  timeMs: number | null;
}

const OVERSHOOT_RAD = 0.05;
const PENETRATION_M = 0.02;

/** 部位の形の、いちばん低い点の高さ */
function lowest(name: (typeof PART_NAMES)[number], pose: Pose): number {
  const c = Math.cos(pose.rot);
  const s = Math.sin(pose.rot);
  let low = Infinity;
  for (const shape of PART_SHAPES[name]) {
    if (shape.kind === "ball") {
      low = Math.min(low, pose.y + shape.ox * s + shape.oy * c - shape.r);
      continue;
    }
    for (const dx of [-1, 1]) {
      for (const dy of [-1, 1]) {
        const x = shape.ox + dx * shape.hw;
        const y = shape.oy + dy * shape.hh;
        low = Math.min(low, pose.y + x * s + y * c);
      }
    }
  }
  return low;
}

export function measure(record: InputRecord): Anomaly {
  const sim = new Sim();
  sim.start();
  const a: Anomaly = {
    jointOvershoot: 0,
    jointOvershootS: 0,
    penetration: 0,
    penetrationS: 0,
    jump: 0,
    peakSpeed: 0,
    peakSpin: 0,
    outcome: "timeout",
    timeMs: null,
  };
  let overRun = 0;
  let penRun = 0;
  const sub = Math.round(1 / record.hz / STEP_S);
  try {
    outer: for (const values of record.inputs) {
      const inputs = toJointInputs(values.map(quantize));
      for (let k = 0; k < sub; k++) {
        sim.advance(inputs, STEP_S);
        const r = sim.readout();
        let over = 0;
        for (const j of JOINTS) {
          const [lo, hi] = [Math.min(...JOINT_SPECS[j].range), Math.max(...JOINT_SPECS[j].range)];
          const ang = r.joints[j].angle;
          over = Math.max(over, lo - ang, ang - hi);
        }
        a.jointOvershoot = Math.max(a.jointOvershoot, over);
        overRun = over > OVERSHOOT_RAD ? overRun + STEP_S : 0;
        a.jointOvershootS = Math.max(a.jointOvershootS, overRun);
        let pen = 0;
        for (const name of PART_NAMES) pen = Math.max(pen, -lowest(name, r.parts[name]));
        a.penetration = Math.max(a.penetration, pen);
        penRun = pen > PENETRATION_M ? penRun + STEP_S : 0;
        a.penetrationS = Math.max(a.penetrationS, penRun);
        const t = r.parts.torso;
        a.jump = Math.max(a.jump, t.y - INITIAL_POSES.torso.y);
        a.peakSpeed = Math.max(a.peakSpeed, Math.abs(t.vx));
        a.peakSpin = Math.max(a.peakSpin, Math.abs(t.w));
        if (r.status === "ended") break outer;
      }
    }
    const end = sim.state();
    a.outcome = end.result?.outcome ?? "timeout";
    a.timeMs = end.result?.outcome === "goal" ? end.result.timeMs : null;
    return a;
  } finally {
    sim.free();
  }
}
