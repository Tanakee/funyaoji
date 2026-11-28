// 関節ごとの色。スクリーンのおじさんの脚と、スマホの画面を同じ色にして、4人が自分の脚を見つけられるようにする
import type { Joint } from "./messages.ts";

/** ももは股関節の色、すねはひざの色で描く（0xRRGGBB） */
export const JOINT_COLORS: Record<Joint, number> = {
  rightHip: 0xe4572e,
  leftHip: 0x2e86ab,
  rightKnee: 0xf3a712,
  leftKnee: 0x4caf7d,
};

/** CSS で使う形（#rrggbb） */
export function jointCssColor(joint: Joint): string {
  return `#${JOINT_COLORS[joint].toString(16).padStart(6, "0")}`;
}
