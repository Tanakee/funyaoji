// 関節ごとの表示。角度と入力の対応は docs/api.md の tilt と、スクリーンの関節の動き
import { JOINT_DISPLAY, type JointDisplay } from "../shared/joints.ts";
import type { Joint } from "../shared/messages.ts";

export interface JointLabel extends JointDisplay {
  /** もも（true）か、ひざ（false）か。絵で、自分の部位と糸の付け所を描き分ける */
  hip: boolean;
  /** 傾け方の1文 */
  tiltHint: string;
}

const HIP = { hip: true, tiltHint: "立てると、脚が前に出る" };
const KNEE = { hip: false, tiltHint: "立てると、ひざが曲がる" };

export const JOINT_LABELS: Record<Joint, JointLabel> = {
  rightHip: { ...JOINT_DISPLAY.rightHip, ...HIP },
  leftHip: { ...JOINT_DISPLAY.leftHip, ...HIP },
  rightKnee: { ...JOINT_DISPLAY.rightKnee, ...KNEE },
  leftKnee: { ...JOINT_DISPLAY.leftKnee, ...KNEE },
};
