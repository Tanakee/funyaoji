import { describe, expect, test } from "vite-plus/test";
import { OBSTACLE_COURSE, courseFor, floorHeightAt, landmarks, type Block } from "./course.ts";

describe("コース", () => {
  test("障害物モードだけに障害物があり、ほかのモードは平らな地面", () => {
    expect(courseFor("normal")).toEqual([]);
    expect(courseFor("hard")).toEqual([]);
    expect(courseFor("obstacle")).toBe(OBSTACLE_COURSE);
  });

  test("障害物はスタートとゴールの間にあり、重ならない", () => {
    const sorted = [...OBSTACLE_COURSE].sort((a, b) => a.x - b.x);
    expect(sorted[0]?.x).toBeGreaterThan(1);
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1] as Block;
      expect((sorted[i] as Block).x).toBeGreaterThanOrEqual(prev.x + prev.width - 1e-9);
    }
    const last = sorted.at(-1) as Block;
    expect(last.x + last.width).toBeLessThan(10);
  });

  test("足元の面の高さは、真上の障害物のいちばん高い面。無い所は 0", () => {
    const course: Block[] = [
      { kind: "step", x: 1, width: 1, height: 0.1 },
      { kind: "hurdle", x: 1.5, width: 0.1, height: 0.3 },
    ];
    expect(floorHeightAt(course, 0.5)).toBe(0);
    expect(floorHeightAt(course, 1.2)).toBe(0.1);
    expect(floorHeightAt(course, 1.55)).toBe(0.3);
    expect(floorHeightAt(course, 2.5)).toBe(0);
  });

  test("画面に出す名前は、ハードルごとに1つ、続いた段をまとめて階段に1つ", () => {
    const marks = landmarks(OBSTACLE_COURSE);
    expect(marks.map((m) => m.name)).toEqual(["ハードル", "階段", "ハードル"]);
    const stairs = OBSTACLE_COURSE.filter((b) => b.kind === "step");
    const from = Math.min(...stairs.map((b) => b.x));
    const to = Math.max(...stairs.map((b) => b.x + b.width));
    expect(marks[1]?.x).toBeCloseTo((from + to) / 2);
    expect(marks[1]?.height).toBe(Math.max(...stairs.map((b) => b.height)));
  });
});
