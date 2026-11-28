// 関節ごとの表示。角度と入力の対応は docs/api.md の tilt と、スクリーンの関節の動き
import { JOINT_DISPLAY, type JointDisplay } from "../shared/joints.ts";
import type { Joint } from "../shared/messages.ts";

export interface JointLabel extends JointDisplay {
  /** 待機（P3）に出す傾け方の1文。立てたとき（90度）の動きで伝える */
  tiltHint: string;
}

const HIP = { tiltHint: "立てると、脚が前に出る" };
const KNEE = { tiltHint: "立てると、ひざが曲がる" };

export const JOINT_LABELS: Record<Joint, JointLabel> = {
  rightHip: { ...JOINT_DISPLAY.rightHip, ...HIP },
  leftHip: { ...JOINT_DISPLAY.leftHip, ...HIP },
  rightKnee: { ...JOINT_DISPLAY.rightKnee, ...KNEE },
  leftKnee: { ...JOINT_DISPLAY.leftKnee, ...KNEE },
};
