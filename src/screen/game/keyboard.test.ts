import { expect, test } from "vite-plus/test";
import type { Joint } from "../../shared/messages.ts";
import { KEY_RATE_PER_S, moveInputs, PRESSED_INPUT, RELEASED_INPUT } from "./keyboard.ts";
import type { JointInputs } from "./types.ts";

const start = (): JointInputs => ({ rightHip: 0.3, leftHip: 0.3, rightKnee: 0, leftKnee: 0 });

test("押している間、対応する関節の入力が、押したときの値へ少しずつ動く", () => {
  const inputs = start();
  const driving = new Set<Joint>();
  moveInputs(inputs, new Set(["KeyQ", "KeyO"]), 0.05, driving);
  expect(inputs.rightHip).toBeCloseTo(0.3 + KEY_RATE_PER_S * 0.05);
  expect(inputs.rightKnee).toBeCloseTo(KEY_RATE_PER_S * 0.05);
  expect(inputs.leftHip).toBe(0.3);
  expect(inputs.leftKnee).toBe(0);
  moveInputs(inputs, new Set(["KeyQ", "KeyO"]), 10, driving);
  expect(inputs.rightHip).toBe(PRESSED_INPUT.hip);
  expect(inputs.rightKnee).toBe(PRESSED_INPUT.knee);
});

test("離すと、離したときの値へ少しずつ戻り、着いたら手を放す", () => {
  const inputs: JointInputs = {
    ...start(),
    leftHip: PRESSED_INPUT.hip,
    leftKnee: PRESSED_INPUT.knee,
  };
  const driving = new Set<Joint>(["leftHip", "leftKnee"]);
  moveInputs(inputs, new Set(), 0.05, driving);
  expect(inputs.leftHip).toBeCloseTo(PRESSED_INPUT.hip - KEY_RATE_PER_S * 0.05);
  moveInputs(inputs, new Set(), 10, driving);
  expect(inputs.leftHip).toBe(RELEASED_INPUT.hip);
  expect(inputs.leftKnee).toBe(RELEASED_INPUT.knee);
  expect(driving.size).toBe(0);
  // 手を放したあとは、ほかから書かれた値（つまみなど）を戻さない
  inputs.leftHip = 0.9;
  moveInputs(inputs, new Set(), 1, driving);
  expect(inputs.leftHip).toBe(0.9);
});

test("一度も押していない関節は動かさない", () => {
  const inputs = start();
  moveInputs(inputs, new Set(), 1, new Set());
  expect(inputs).toEqual(start());
});

test("controls が false の関節は、押していても動かさない", () => {
  const inputs = start();
  const driving = new Set<Joint>(["rightHip"]);
  moveInputs(inputs, new Set(["KeyQ", "KeyW"]), 1, driving, (joint) => joint !== "rightHip");
  expect(inputs.rightHip).toBe(0.3);
  expect(inputs.leftHip).toBe(PRESSED_INPUT.hip);
  expect(driving.has("rightHip")).toBe(false);
});
