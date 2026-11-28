// 人差し指の曲げを、傾きと同じ 0〜90度に直す。カメラにもブラウザにも触らない、純粋な関数だけ（docs/game.md の「操作方法」）
import { MAX_ANGLE } from "../tilt.ts";

/** MediaPipe の手のランドマーク1点。world landmarks（手の中心からのメートル）を渡す */
export interface Point {
  x: number;
  y: number;
  z: number;
}

/** MediaPipe の手のランドマークの番号。5 が人差し指の付け根、6 が第2関節、8 が指先 */
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_TIP = 8;

/** これより小さい曲げ（度）は、伸ばしている（入力 0）とみなす。伸ばした指も少しは曲がって見える */
export const STRAIGHT_DEG = 15;
/** これより大きい曲げ（度）は、曲げきった（入力 1）とみなす。第2関節で直角に曲げたくらい */
export const BENT_DEG = 90;

/**
 * 人差し指の曲げ（度）。付け根から第2関節への向きと、第2関節から指先への向きのなす角で、まっすぐなら 0。
 * 3次元の点で測るので、手とカメラの距離や、手の向きが変わっても値がぶれにくい。点が足りなければ undefined
 */
export function indexBendDeg(landmarks: readonly Point[]): number | undefined {
  const mcp = landmarks[INDEX_MCP];
  const pip = landmarks[INDEX_PIP];
  const tip = landmarks[INDEX_TIP];
  if (mcp === undefined || pip === undefined || tip === undefined) return undefined;
  const a = { x: pip.x - mcp.x, y: pip.y - mcp.y, z: pip.z - mcp.z };
  const b = { x: tip.x - pip.x, y: tip.y - pip.y, z: tip.z - pip.z };
  const lengths = Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z);
  if (!(lengths > 0)) return undefined;
  const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / lengths;
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

/** 曲げ（度）を、tilt の angle と同じ 0〜90度に直す。STRAIGHT_DEG で 0、BENT_DEG で 90 */
export function bendToAngle(bendDeg: number): number {
  const ratio = (bendDeg - STRAIGHT_DEG) / (BENT_DEG - STRAIGHT_DEG);
  return Math.min(1, Math.max(0, ratio)) * MAX_ANGLE;
}

/**
 * 1フレームの検出結果から、送る角度を決める。手が映っていなければ 0（指を伸ばしたのと同じ）。
 * 手を外した脚が、曲げたまま固まらないようにする
 */
export function fingerAngle(hand: readonly Point[] | undefined): number {
  if (hand === undefined) return 0;
  const bend = indexBendDeg(hand);
  return bend === undefined ? 0 : bendToAngle(bend);
}
