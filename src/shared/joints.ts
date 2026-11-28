// 部位ごとの名前と色。値の決まりは docs/screens.md の「4人の色と並び」。
// 色を選び直すときは、どの色覚でも見分けられるかを色差（CIEDE2000）で確かめる
import type { Joint } from "./messages.ts";

export interface JointDisplay {
  name: string;
  color: string;
  textOnColor: string;
}

const DARK_TEXT = "#2b2b28";
const LIGHT_TEXT = "#ffffff";

export const JOINT_DISPLAY: Record<Joint, JointDisplay> = {
  leftKnee: { name: "左ひざ", color: "#56b4e9", textOnColor: DARK_TEXT },
  leftHip: { name: "左もも", color: "#1f4e9e", textOnColor: LIGHT_TEXT },
  rightKnee: { name: "右ひざ", color: "#f2b705", textOnColor: DARK_TEXT },
  rightHip: { name: "右もも", color: "#c23a1a", textOnColor: LIGHT_TEXT },
};

/** 画面の上の席の並び（左から）。参加の順（JOINTS）とは別 */
export const SEATS = [
  "leftKnee",
  "leftHip",
  "rightKnee",
  "rightHip",
] as const satisfies readonly Joint[];
