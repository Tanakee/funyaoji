// 試作（あとで捨てる）：強化学習で作った AI。観測を作り、小さいニューラルネットを計算して、4つの関節の入力を返す
// DOM にも Node にも依存しない。学習（lab/rl/server.ts）とブラウザ（main.ts）で同じものを使う
import { JOINTS, neutralInput, type JointName, type Params, type Sim } from "./sim.ts";

/** 学習した重み。ml/ の train.py が書き出す policy.json の形 */
export interface Policy {
  obsMean: number[];
  obsStd: number[];
  clipObs: number;
  /** 全結合の層。最後の層のほかは、出力に tanh をかける */
  layers: { w: number[][]; b: number[] }[];
}

/** AI が行動を変える頻度（1秒あたり）。スマホの tilt と同じ */
export const ACTION_HZ = 30;
export const OBS_DIM = 20;

/** 立った姿勢の胴の中心の高さ */
export function standingTorsoY(params: Params): number {
  const b = params.body;
  return b.thigh.hh * 2 + b.shin.hh * 2 + b.foot.hh * 2 + b.torso.hh;
}

/** 右足・左足が地面に着いているか（足の下の角が地面から 3cm 以内） */
export function footContact(sim: Sim): [boolean, boolean] {
  const out: [boolean, boolean] = [false, false];
  for (const part of sim.parts) {
    if (part.name !== "shin") continue;
    const foot = part.shapes[1];
    if (!foot || foot.kind !== "box") continue;
    const t = part.body.translation();
    const r = part.body.rotation();
    const c = Math.cos(r);
    const s = Math.sin(r);
    let low = Infinity;
    for (const sx of [-1, 1]) {
      const x = foot.ox + sx * foot.hw;
      const y = foot.oy - foot.hh;
      low = Math.min(low, t.y + x * s + y * c);
    }
    out[part.side === "right" ? 0 : 1] = low < 0.03;
  }
  return out;
}

/**
 * 観測（20個の数）。前後の位置は入れない（どこにいても同じ歩き方になる）
 * 胴の高さ・傾き（sin, cos）・速度（前後, 上下）・回る速さ、関節の角度4つ、関節の回る速さ4つ、足の接地2つ、前の行動4つ
 */
export function observe(sim: Sim, prev: number[]): number[] {
  const t = sim.torso.translation();
  const v = sim.torso.linvel();
  const rot = sim.torso.rotation();
  const out = [
    t.y - standingTorsoY(sim.params),
    Math.sin(rot),
    Math.cos(rot),
    v.x,
    v.y,
    sim.torso.angvel(),
  ];
  for (const j of JOINTS) {
    const { lo, hi } = sim.range[j];
    out.push((sim.jointAngle(j) - lo) / (hi - lo));
  }
  for (const j of JOINTS) {
    const { parent, child } = sim.children[j];
    out.push((child.angvel() - parent.angvel()) * 0.1);
  }
  const [r, l] = footContact(sim);
  out.push(r ? 1 : 0, l ? 1 : 0);
  out.push(...prev);
  return out;
}

/** 観測から、4つの関節の入力（0〜1。JOINTS の順）を計算する */
export function act(policy: Policy, obs: number[]): number[] {
  let x = obs.map((o, i) => {
    const z = (o - policy.obsMean[i]!) / policy.obsStd[i]!;
    return Math.min(policy.clipObs, Math.max(-policy.clipObs, z));
  });
  policy.layers.forEach((layer, k) => {
    const last = k === policy.layers.length - 1;
    x = layer.w.map((row, i) => {
      let sum = layer.b[i]!;
      for (let j = 0; j < row.length; j++) sum += row[j]! * x[j]!;
      return last ? sum : Math.tanh(sum);
    });
  });
  return x.map((a) => (Math.min(1, Math.max(-1, a)) + 1) / 2);
}

/** 物理の1ステップ（1/240 秒）ごとに input() を呼ぶと、ACTION_HZ ごとに行動を計算し直して返す */
export class PolicyDriver {
  private prev: number[];
  private readonly sub: number;
  private readonly policy: Policy;

  constructor(policy: Policy, sim: Sim) {
    this.policy = policy;
    this.sub = Math.round(1 / sim.world.timestep / ACTION_HZ);
    const n = neutralInput(sim.params.mode);
    this.prev = JOINTS.map((j) => n[j]);
  }

  input(sim: Sim): Record<JointName, number> {
    const step = Math.round(sim.time / sim.world.timestep);
    if (step % this.sub === 0) this.prev = act(this.policy, observe(sim, this.prev));
    const out = {} as Record<JointName, number>;
    JOINTS.forEach((j, i) => (out[j] = this.prev[i]!));
    return out;
  }
}
