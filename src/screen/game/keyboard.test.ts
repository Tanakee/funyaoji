import { expect, test } from "vite-plus/test";
import { moveInputs } from "./keyboard.ts";
import type { JointInputs } from "./types.ts";

const start = (): JointInputs => ({ rightHip: 0.3, leftHip: 0.3, rightKnee: 0, leftKnee: 0 });

test("押している間だけ、対応する関節の入力が動く", () => {
  const inputs = start();
  moveInputs(inputs, new Set(["KeyQ", "KeyL"]), 0.1);
  expect(inputs.rightHip).toBeCloseTo(0.6);
  expect(inputs.rightKnee).toBe(0); // 下げるキーでも 0 より下には行かない
  expect(inputs.leftHip).toBe(0.3);
  moveInputs(inputs, new Set(), 1);
  expect(inputs.rightHip).toBeCloseTo(0.6);
});

test("入力は 0〜1 の外に出ない", () => {
  const inputs = start();
  moveInputs(inputs, new Set(["KeyW", "KeyP", "KeyA"]), 10);
  expect(inputs).toEqual({ rightHip: 0, leftHip: 1, rightKnee: 0, leftKnee: 1 });
});

test("上げるキーと下げるキーを同時に押すと、動かない", () => {
  const inputs = start();
  moveInputs(inputs, new Set(["KeyO", "KeyL"]), 0.1);
  expect(inputs.rightKnee).toBe(0);
  const top = { ...start(), leftKnee: 1 };
  moveInputs(top, new Set(["KeyP", "Semicolon"]), 0.1);
  expect(top.leftKnee).toBe(1);
});
