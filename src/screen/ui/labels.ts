import type { Joint } from "../../shared/messages.ts";

/** 画面に出す関節の名前 */
export const JOINT_LABELS: Record<Joint, string> = {
  rightHip: "右もも",
  leftHip: "左もも",
  rightKnee: "右ひざ",
  leftKnee: "左ひざ",
};
