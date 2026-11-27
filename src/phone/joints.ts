// 関節ごとの表示。角度と入力の対応は docs/api.md の tilt と、スクリーンの関節の動き
import type { Joint } from "../shared/messages.ts";

export interface JointLabel {
  /** 関節の名前 */
  name: string;
  /** スマホを立てたとき（90度）の動き */
  upright: string;
  /** スマホを寝かせたとき（0度）の動き */
  flat: string;
}

const HIP = { upright: "前へ", flat: "後ろへ" } as const;
const KNEE = { upright: "曲げる", flat: "伸ばす" } as const;

export const JOINT_LABELS: Record<Joint, JointLabel> = {
  rightHip: { name: "右もも", ...HIP },
  leftHip: { name: "左もも", ...HIP },
  rightKnee: { name: "右ひざ", ...KNEE },
  leftKnee: { name: "左ひざ", ...KNEE },
};
