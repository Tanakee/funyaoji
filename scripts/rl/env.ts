/// <reference lib="dom" />
// ゲームのコード（sim.ts → types.ts）が DOM の型（HTMLElement）を参照するので、Node の型の検査に DOM の型を足す
// 強化学習の環境（docs/ml.md の「問題の定義」）。おじさん1体を、行動1つ（1/30 秒）ずつ進め、観測と報酬を返す
import { createHash } from "node:crypto";
import RAPIER from "@dimforge/rapier2d-compat";
import { JOINTS } from "../../src/shared/messages.ts";
import { NEUTRAL_INPUTS } from "../../src/screen/game/body.ts";
import { demoGait } from "../../src/screen/game/demo.ts";
import { gaitInputs, type Gait } from "../../src/screen/game/ai/gait.ts";
import {
  ACTION_HZ,
  ACTOR_OBS,
  PHASE_OBS,
  observe,
  quantize,
  toJointInputs,
} from "../../src/screen/game/ai/observe.ts";
import { replay, type InputRecord } from "../../src/screen/game/ai/record.ts";
import { Sim } from "../../src/screen/game/sim.ts";

export interface EnvConfig {
  /** r1：前進 ＋ 時間の減点 ＋ ゴール・転倒。r2：ゴール ＋ ポテンシャル型の整形 */
  reward: "r1" | "r2";
  /** r2：ゴールしたときの報酬 */
  goal: number;
  /** r2：Φ = k・x の k */
  k: number;
  /** r2：整形の割引率。PPO の γ と同じ値にする */
  gamma: number;
  /** 学習の上限時間（秒）。超えたら打ち切り（truncated） */
  maxTimeS: number;
  /** 終わったときに、入力の記録を info に入れる */
  record: boolean;
  /** 物理の1ステップ（秒）。省くとゲームと同じ */
  stepS?: number;
  /**
   * 土台の歩き方（③）。入れると、関節の入力は「土台の入力 ＋ 行動 × scale」になり、
   * 観測に歩き方の位相が増える
   */
  base?: { gait: Gait; scale: number };
}

/** actor の観測の数 */
export function actorObs(cfg: EnvConfig): number {
  return ACTOR_OBS + (cfg.base ? PHASE_OBS : 0);
}

export const DEFAULT_CONFIG: EnvConfig = {
  reward: "r2",
  goal: 30,
  k: 1,
  gamma: 0.99,
  maxTimeS: 30,
  record: false,
};

/** r1 の重み（試作と同じ） */
const R1 = { forward: 1, timePerS: -0.5, goal: 5, fall: -5 };

export type Outcome = "goal" | "fell" | "timeout";

export interface EpisodeInfo {
  outcome: Outcome;
  /** ゴールしたときだけ、Sim のタイム */
  timeMs: number | null;
  distanceM: number;
  elapsedMs: number;
  /** やり直す前の最後の観測 */
  final: number[];
  inputs?: number[][];
}

const NEUTRAL = JOINTS.map((j) => NEUTRAL_INPUTS[j]);

export class Env {
  private sim!: Sim;
  private prev: number[] = NEUTRAL;
  private inputs: number[][] = [];
  /** 行動を進めた回数 */
  private count = 0;
  private readonly cfg: EnvConfig;

  constructor(cfg: EnvConfig) {
    this.cfg = cfg;
    this.reset();
  }

  reset(): number[] {
    this.sim?.free();
    this.sim = new Sim(this.cfg.stepS === undefined ? {} : { stepS: this.cfg.stepS });
    this.sim.start();
    this.prev = NEUTRAL;
    this.inputs = [];
    this.count = 0;
    return this.obs();
  }

  obs(): number[] {
    const r = this.sim.readout();
    const base = this.cfg.base;
    const phase = base ? (this.count / ACTION_HZ / base.gait.T) * Math.PI * 2 : undefined;
    return observe(r, this.prev, phase);
  }

  /** 行動（-1〜1 が4つ、JOINTS の順）で 1/30 秒進める */
  step(action: readonly number[]): { reward: number; info?: EpisodeInfo } {
    const base = this.cfg.base;
    if (!base) return this.stepInputs(JOINTS.map((_, i) => ((action[i] ?? 0) + 1) / 2));
    // 土台の入力は、毎秒30回の何回目かから出す（記録の再生と同じ時刻）
    const g = gaitInputs(base.gait, this.count / ACTION_HZ);
    return this.stepInputs(g.map((u, i) => u + (action[i] ?? 0) * base.scale));
  }

  /** 関節の入力（0〜1、JOINTS の順）で 1/30 秒進める */
  stepInputs(raw: readonly number[]): { reward: number; info?: EpisodeInfo } {
    const cfg = this.cfg;
    const u = raw.map(quantize);
    const before = this.sim.readout();
    this.sim.advance(toJointInputs(u), 1 / ACTION_HZ);
    this.prev = u;
    this.count++;
    if (cfg.record) this.inputs.push(u);
    const state = this.sim.state();
    const x0 = before.distanceM;
    const x1 = state.distanceM;
    const ended = state.status === "ended";
    const timeout = !ended && state.elapsedMs >= cfg.maxTimeS * 1000;
    const goal = state.result?.outcome === "goal";

    let reward: number;
    if (cfg.reward === "r1") {
      reward = R1.forward * (x1 - x0) + R1.timePerS / ACTION_HZ;
      if (ended) reward += goal ? R1.goal : R1.fall;
    } else {
      // 終わった状態の Φ は 0。打ち切りは続きがある扱いなので 0 にしない
      const phiNext = ended ? 0 : cfg.k * x1;
      reward = (goal ? cfg.goal : 0) + cfg.gamma * phiNext - cfg.k * x0;
    }

    if (!ended && !timeout) return { reward };
    const info: EpisodeInfo = {
      outcome: ended ? (goal ? "goal" : "fell") : "timeout",
      timeMs: state.result?.outcome === "goal" ? state.result.timeMs : null,
      distanceM: x1,
      elapsedMs: state.elapsedMs,
      final: this.obs(),
    };
    if (cfg.record) info.inputs = this.inputs;
    return { reward, info };
  }

  free(): void {
    this.sim.free();
  }
}

/** お手本の歩き方を毎秒30回の記録にしたもの。物理の指紋に使う */
export function demoRecord(seconds = 40): InputRecord {
  const inputs: number[][] = [];
  for (let k = 0; k < seconds * ACTION_HZ; k++) {
    const g = demoGait(k / ACTION_HZ);
    inputs.push(JOINTS.map((j) => quantize(g[j])));
  }
  return { hz: ACTION_HZ, joints: JOINTS, inputs };
}

/**
 * 物理の指紋（docs/ml.md の「物理の指紋」）。決まった入力の列（お手本の歩き方）を再生し、
 * 終わりの状態からハッシュを作る。実際に入っている Rapier の版も返す
 */
export function physicsFingerprint(): { fingerprint: string; rapier: string } {
  const end = replay(demoRecord());
  const h = createHash("sha256").update(JSON.stringify(end)).digest("hex").slice(0, 12);
  return { fingerprint: h, rapier: RAPIER.version() };
}
