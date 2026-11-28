// 強化学習の観測と行動（docs/ml.md の「問題の定義」）。学習の環境（scripts/rl/）とゲームで同じものを使う。
// DOM にも Node にも依存しない
import { JOINTS } from "../../../shared/messages.ts";
import { INITIAL_POSES, JOINT_SPECS } from "../body.ts";
import { GOAL_M, SIT_MS, type SimReadout } from "../sim.ts";
import type { JointInputs } from "../types.ts";

/** AI が行動を変える頻度（1秒あたり）。スマホの tilt と同じ */
export const ACTION_HZ = 30;
/** 入力の目盛り。物理に渡す前に、入力を 1/INPUT_STEPS にそろえる */
export const INPUT_STEPS = 1000;
/** ゴールまでの残りを actor に見せるときの上限（m） */
export const GOAL_VIEW_M = 1.5;
/** actor の観測の数 */
export const ACTOR_OBS = 22;
/** 決まった歩き方を土台にするとき、actor の観測に足す数（歩き方の位相の sin・cos） */
export const PHASE_OBS = 2;
/** critic だけが追加で見る数（上限を切らないゴールまでの残り） */
export const CRITIC_EXTRA_OBS = 1;

const STAND_TORSO_Y = INITIAL_POSES.torso.y;

/** 入力を 0〜1 に収め、1/1000 の目盛りにそろえる。記録に書く値と、物理に渡す値は同じになる */
export function quantize(u: number): number {
  const c = Number.isFinite(u) ? Math.min(1, Math.max(0, u)) : 0;
  return Math.round(c * INPUT_STEPS) / INPUT_STEPS;
}

/** JOINTS の順の4つの値を、関節ごとの入力にする */
export function toJointInputs(values: readonly number[]): JointInputs {
  const out = {} as JointInputs;
  JOINTS.forEach((j, i) => (out[j] = values[i] ?? 0));
  return out;
}

/**
 * 観測。actor は先頭の ACTOR_OBS 個を、critic は全部を見る。
 * prev は前に物理に渡した入力（1/1000 にそろえたあと、JOINTS の順）。
 * phase（rad）を渡すと、決まった歩き方の位相として、actor の観測の最後に sin・cos を足す
 */
export function observe(r: SimReadout, prev: readonly number[], phase?: number): number[] {
  const t = r.parts.torso;
  const out = [t.y - STAND_TORSO_Y, Math.sin(t.rot), Math.cos(t.rot), t.vx, t.vy, t.w];
  for (const j of JOINTS) {
    const [a, b] = JOINT_SPECS[j].range;
    out.push((r.joints[j].angle - a) / (b - a));
  }
  for (const j of JOINTS) out.push(r.joints[j].speed * 0.1);
  out.push(r.footContact.right ? 1 : 0, r.footContact.left ? 1 : 0);
  out.push(...prev);
  out.push(Math.min(1, r.sittingMs / SIT_MS));
  const remaining = Math.max(0, GOAL_M - r.distanceM);
  out.push(Math.min(remaining, GOAL_VIEW_M) / GOAL_VIEW_M);
  if (phase !== undefined) out.push(Math.sin(phase), Math.cos(phase));
  // ここから critic だけ
  out.push(remaining / GOAL_M);
  return out;
}
