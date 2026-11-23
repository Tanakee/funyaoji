import { expect, test } from "vite-plus/test";
import type { Joint } from "../shared/messages.ts";
import { TiltSequencer } from "./tilt.ts";

const tilt = (joint: Joint, seq: number) => ({ type: "tilt" as const, joint, seq, angle: 0 });

test("関節ごとに、受信済みより小さいシーケンス番号を捨てる", () => {
  const sequencer = new TiltSequencer();
  expect(sequencer.accept(tilt("rightHip", 5))).toBe(true);
  expect(sequencer.accept(tilt("rightHip", 4))).toBe(false);
  expect(sequencer.accept(tilt("rightHip", 5))).toBe(true);
  expect(sequencer.accept(tilt("leftHip", 1))).toBe(true);
});

test("接続中でなくなった関節の番号は忘れる", () => {
  const sequencer = new TiltSequencer();
  sequencer.accept(tilt("rightHip", 100));
  sequencer.keepOnly([]);
  expect(sequencer.accept(tilt("rightHip", 0))).toBe(true);
});
