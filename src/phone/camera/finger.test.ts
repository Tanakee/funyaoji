import { describe, expect, test } from "vite-plus/test";
import {
  BENT_DEG,
  bendToAngle,
  fingerAngle,
  indexBendDeg,
  STRAIGHT_DEG,
  type Point,
} from "./finger.ts";

/** 人差し指の付け根・第2関節・指先だけを置いた手。ほかの点は使わないので原点にする */
function hand(mcp: Point, pip: Point, tip: Point): Point[] {
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  points[5] = mcp;
  points[6] = pip;
  points[8] = tip;
  return points;
}

/** 第2関節で deg 度だけ曲げた指。xy 平面に置き、z だけずらしても同じ角度になる */
function bentFinger(deg: number, z = 0): Point[] {
  const rad = (deg * Math.PI) / 180;
  return hand(
    { x: 0, y: 0, z },
    { x: 0, y: -0.04, z },
    { x: 0.03 * Math.sin(rad), y: -0.04 - 0.03 * Math.cos(rad), z },
  );
}

describe("indexBendDeg", () => {
  test("まっすぐなら 0、直角なら 90", () => {
    expect(indexBendDeg(bentFinger(0))).toBeCloseTo(0);
    expect(indexBendDeg(bentFinger(90))).toBeCloseTo(90);
    expect(indexBendDeg(bentFinger(45, 0.5))).toBeCloseTo(45);
  });

  test("点が足りない・重なっているときは undefined", () => {
    expect(indexBendDeg([])).toBeUndefined();
    const p = { x: 0, y: 0, z: 0 };
    expect(indexBendDeg(hand(p, p, p))).toBeUndefined();
  });
});

describe("bendToAngle", () => {
  test("伸ばした範囲は 0、曲げきると 90、間はまっすぐにつなぐ", () => {
    expect(bendToAngle(0)).toBe(0);
    expect(bendToAngle(STRAIGHT_DEG)).toBe(0);
    expect(bendToAngle((STRAIGHT_DEG + BENT_DEG) / 2)).toBeCloseTo(45);
    expect(bendToAngle(BENT_DEG)).toBe(90);
    expect(bendToAngle(170)).toBe(90);
  });
});

describe("fingerAngle", () => {
  test("手が映っていなければ 0", () => {
    expect(fingerAngle(undefined)).toBe(0);
    expect(fingerAngle([])).toBe(0);
  });

  test("曲げた指は、曲げに応じた角度", () => {
    expect(fingerAngle(bentFinger(BENT_DEG))).toBeCloseTo(90);
    expect(fingerAngle(bentFinger(5))).toBe(0);
  });
});
