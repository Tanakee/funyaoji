// 部位ごとの名前と色。値の決まりは docs/screens.md の「4人の色と並び」。
// 色を選び直すときは、どの色覚でも見分けられるかを色差（CIEDE2000）で確かめる
import type { Joint } from "./messages.ts";

export interface JointDisplay {
  name: string;
  color: string;
  textOnColor: string;
}

const DARK_TEXT = "#1f3a68";
const LIGHT_TEXT = "#ffffff";

export const JOINT_DISPLAY: Record<Joint, JointDisplay> = {
  leftKnee: { name: "左ひざ", color: "#56b4e9", textOnColor: DARK_TEXT },
  leftHip: { name: "左もも", color: "#6a4cc0", textOnColor: LIGHT_TEXT },
  rightKnee: { name: "右ひざ", color: "#fad21e", textOnColor: DARK_TEXT },
  rightHip: { name: "右もも", color: "#c2510e", textOnColor: LIGHT_TEXT },
};

/** 画面の上の席の並び（左から）。参加の順（JOINTS）とは別 */
export const SEATS = [
  "leftKnee",
  "leftHip",
  "rightKnee",
  "rightHip",
] as const satisfies readonly Joint[];
