// 試作（あとで捨てる）：設定を、歩き方の機械（bot.ts）で走らせて測る。Node で直接動かす
import {
  Sim,
  DEFAULT_PARAMS,
  DEFAULT_BODY,
  GOAL_M,
  JOINTS,
  neutralInput,
  type Params,
  type JointName,
} from "../sim.ts";
import { gaitInput, makeNoise, NO_NOISE, type Gait, type Noise } from "../bot.ts";

// 物理エンジン（Rapier）の WebAssembly を読み込む。どの関数よりも先に1回だけ要る
await Sim.init();

export { Sim, DEFAULT_PARAMS, DEFAULT_BODY, GOAL_M, JOINTS, gaitInput, makeNoise, NO_NOISE };
export type { Params, Gait, Noise, JointName };

/** 4人の息の合わなさ。delay: タイミングのずれ（秒）、scale: 動かす幅のずれ */
export const NOISE_LEVELS = {
  small: { delay: 0.08, scale: 0.1 },
  mid: { delay: 0.15, scale: 0.2 },
  large: { delay: 0.25, scale: 0.3 },
} as const;
export type NoiseLevel = keyof typeof NOISE_LEVELS;

/** 1回の走りの結果。異常の検出に使う値も入れる */
export interface RunResult {
  ended: "goal" | "fell" | "stuck" | "timeout";
  time: number;
  distance: number;
  /** 胴の前後の速さの最大（m/s） */
  peakSpeed: number;
  /** 胴の中心の高さの最大（m） */
  maxTorsoY: number;
  /** 両足が地面から離れていた時間の割合 */
  airFrac: number;
}

/** 1コマ（1/60秒）ごとに呼ばれる。記録に使う */
export type OnFrame = (sim: Sim, input: Record<JointName, number>) => void;

export const MAX_TIME = 30;
/** この秒数のあいだに 0.3m 進まなければ、座り込んだなどで止まったとみなして打ち切る */
export const STUCK_TIME = 6;

/** 入力を作る関数。標準は、脚を交互に振る歩き方（gaitInput）にずれを足したもの */
// 体の状態を見て決めるもの（強化学習の AI）は、3つめの sim を使う
export type Controller = (time: number, noise: Noise, sim?: Sim) => Record<JointName, number>;

export function gaitController(g: Gait): Controller {
  return (time, noise) => gaitInput(g, time, noise);
}

export function run(
  params: Params,
  controller: Controller,
  noise: Noise = NO_NOISE,
  onFrame?: OnFrame,
  maxTime = MAX_TIME,
): RunResult {
  const sim = new Sim(params);
  let peakSpeed = 0;
  let maxTorsoY = 0;
  let air = 0;
  let steps = 0;
  let input = controller(0, noise);
  let progressX = 0;
  let progressT = 0;
  let stuck = false;
  const stepsPerFrame = Math.round(1 / 60 / sim.world.timestep);
  while (sim.time < maxTime && !sim.ended) {
    if (steps % stepsPerFrame === 0) {
      input = controller(sim.time, noise, sim);
      onFrame?.(sim, input);
    }
    sim.step(input);
    steps++;
    const v = sim.torso.linvel();
    peakSpeed = Math.max(peakSpeed, Math.abs(v.x));
    maxTorsoY = Math.max(maxTorsoY, sim.torso.translation().y);
    if (!footContact(sim).some(Boolean)) air++;
    if (sim.distance > progressX + 0.3) {
      progressX = sim.distance;
      progressT = sim.time;
    } else if (sim.time - progressT > STUCK_TIME) {
      stuck = true;
      break;
    }
  }
  onFrame?.(sim, input);
  return {
    ended: sim.ended ?? (stuck ? "stuck" : "timeout"),
    time: sim.time,
    distance: sim.distance,
    peakSpeed,
    maxTorsoY,
    airFrac: air / Math.max(1, steps),
  };
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

/** 立った姿勢の胴の中心の高さ。跳ねているかの判定に使う */
export function standingTorsoY(params: Params): number {
  const b = params.body;
  return b.thigh.hh * 2 + b.shin.hh * 2 + b.foot.hh * 2 + b.torso.hh;
}

/** ゴールした走りが、物理の計算の不具合や不自然な動きでないかを確かめる。問題があれば理由を返す */
export function sanity(params: Params, r: RunResult): string[] {
  const out: string[] = [];
  const avg = r.distance / Math.max(0.01, r.time);
  if (avg > 2.5) out.push(`平均の速さ ${avg.toFixed(1)}m/s が速すぎる`);
  if (r.peakSpeed > 5) out.push(`最大の速さ ${r.peakSpeed.toFixed(1)}m/s が速すぎる`);
  const stand = standingTorsoY(params);
  if (r.maxTorsoY > stand + 0.25)
    out.push(`胴が ${(r.maxTorsoY - stand).toFixed(2)}m 跳ね上がった`);
  if (r.airFrac > 0.3) out.push(`両足が浮いている時間が ${(r.airFrac * 100).toFixed(0)}%`);
  return out;
}

/** 決まった種から乱数を作る */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const r2 = (x: number) => Math.round(x * 100) / 100;

/** 歩き方を乱数で n 個作る。値は小数2桁に丸める（丸めた値で測るので、記録と再生が一致する） */
export function randomGaits(n: number, seed = 11): Gait[] {
  const rnd = rng(seed);
  return Array.from({ length: n }, () => ({
    T: r2(0.6 + rnd() * 1.6),
    h0: r2(0.15 + rnd() * 0.35),
    A: r2(0.1 + rnd() * 0.4),
    K: r2(rnd() * 0.9),
    kp: r2(rnd() * Math.PI * 2),
  }));
}

export interface Robustness {
  level: NoiseLevel;
  runs: number;
  goals: number;
  falls: number;
  /** 座り込むなどして進まなくなった回数 */
  stuck: number;
  avgDistance: number;
  /** ゴールした走りのうち、sanity で引っかかったもの */
  suspicious: number;
}

/** ずれを足して runs 回走らせる。種は level ごとに固定 */
export function robustness(
  params: Params,
  controller: Controller,
  level: NoiseLevel,
  runs = 16,
): Robustness {
  const { delay, scale } = NOISE_LEVELS[level];
  let goals = 0;
  let falls = 0;
  let stuckN = 0;
  let dist = 0;
  let suspicious = 0;
  for (let k = 1; k <= runs; k++) {
    const r = run(params, controller, makeNoise(1000 + k * 31, delay, scale));
    if (r.ended === "goal") {
      goals++;
      if (sanity(params, r).length) suspicious++;
    }
    if (r.ended === "fell") falls++;
    if (r.ended === "stuck") stuckN++;
    dist += Math.max(0, Math.min(GOAL_M, r.distance));
  }
  return { level, runs, goals, falls, stuck: stuckN, avgDistance: dist / runs, suspicious };
}

export interface Evaluation {
  /** 乱数の歩き方のうち、ずれなしで 10m に着いた数 / 試した数 */
  walkable: [number, number];
  /** ずれ中に強い歩き方（いちばん良かったもの） */
  best?: {
    gait: Gait;
    nominal: RunResult;
    problems: string[];
    small: Robustness;
    mid: Robustness;
    large: Robustness;
    /** 1つの関節を中立で止めても 10m に着くか。着く関節があれば、操作しなくても歩ける体になっている */
    walksWithout: JointName[];
  };
  /** 主な物差し：best のずれ中のゴール率（0〜1）。同じなら平均距離で比べる */
  score: number;
}

/**
 * 設定の良し悪しを測る。
 * 1. 歩き方を乱数で gaits 個作り、ずれなしで走らせて、10m に着くものを集める
 * 2. 着いたもの（異常なものは除く）の上から shortlist 個を、ずれ中で8回ずつ走らせて、いちばん強い歩き方を選ぶ
 * 3. 選んだ歩き方を、ずれ小・中・大で16回ずつ走らせる（選ぶときと別の種）
 */
export function evaluate(
  params: Params,
  opts: { gaits?: number; shortlist?: number; seed?: number } = {},
): Evaluation {
  const gaits = randomGaits(opts.gaits ?? 300, opts.seed ?? 11);
  const ok: { gait: Gait; r: RunResult }[] = [];
  for (const g of gaits) {
    const r = run(params, gaitController(g));
    if (r.ended === "goal" && sanity(params, r).length === 0) ok.push({ gait: g, r });
  }
  const walkable: [number, number] = [ok.length, gaits.length];
  if (!ok.length) return { walkable, score: 0 };
  let pick: { gait: Gait; r: RunResult; sc: number } | undefined;
  const { delay, scale } = NOISE_LEVELS.mid;
  for (const c of ok.slice(0, opts.shortlist ?? 40)) {
    let sc = 0;
    for (let k = 1; k <= 8; k++) {
      const r = run(params, gaitController(c.gait), makeNoise(k * 97, delay, scale));
      sc += (r.ended === "goal" ? 100 : 0) + Math.min(GOAL_M, Math.max(0, r.distance));
    }
    if (!pick || sc > pick.sc) pick = { ...c, sc };
  }
  const ctl = gaitController(pick!.gait);
  const best = {
    gait: pick!.gait,
    nominal: pick!.r,
    problems: sanity(params, pick!.r),
    small: robustness(params, ctl, "small"),
    mid: robustness(params, ctl, "mid"),
    large: robustness(params, ctl, "large"),
    walksWithout: agency(params, ctl),
  };
  return { walkable, best, score: best.mid.goals / best.mid.runs + best.mid.avgDistance / 1000 };
}

/** 関節を1つずつ中立の入力で止めて走らせ、それでもゴールした関節を返す */
export function agency(params: Params, controller: Controller): JointName[] {
  const neutral = neutralInput(params.mode);
  const out: JointName[] = [];
  for (const j of JOINTS) {
    const r = run(params, (t, n) => ({ ...controller(t, n), [j]: neutral[j] }));
    if (r.ended === "goal") out.push(j);
  }
  return out;
}

/** 結果を1行にまとめる */
export function summary(name: string, e: Evaluation): string {
  const [w, n] = e.walkable;
  if (!e.best) return `${name} | 歩ける歩き方 ${w}/${n} | なし`;
  const b = e.best;
  const f = (r: Robustness) =>
    `${r.goals}/${r.runs}（平均 ${r.avgDistance.toFixed(1)}m、転倒 ${r.falls}、停止 ${r.stuck}${r.suspicious ? `、異常 ${r.suspicious}` : ""}）`;
  return `${name} | 歩ける歩き方 ${w}/${n} | ずれなし ${b.nominal.time.toFixed(1)}秒 | ずれ小 ${f(b.small)} | 中 ${f(b.mid)} | 大 ${f(b.large)}${b.walksWithout.length ? ` | 止めても歩ける関節 ${b.walksWithout.join("・")}` : ""} | ${JSON.stringify(b.gait)}`;
}
