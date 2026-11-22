import { describe, expect, test } from "vite-plus/test";
import type { Joint } from "../shared/messages.ts";
import { TiltSequencer } from "./tilt.ts";

const tilt = (joint: Joint, seq: number) => ({ type: "tilt" as const, joint, seq, angle: 0 });

describe("TiltSequencer", () => {
  test("受信済みより小さいシーケンス番号は捨てる", () => {
    const sequencer = new TiltSequencer();
    expect(sequencer.accept(tilt("rightHip", 5))).toBe(true);
    expect(sequencer.accept(tilt("rightHip", 4))).toBe(false);
    expect(sequencer.accept(tilt("rightHip", 6))).toBe(true);
    expect(sequencer.accept(tilt("rightHip", 5))).toBe(false);
  });

  test("同じ番号は捨てない", () => {
    const sequencer = new TiltSequencer();
    expect(sequencer.accept(tilt("rightHip", 5))).toBe(true);
    expect(sequencer.accept(tilt("rightHip", 5))).toBe(true);
  });

  test("関節ごとに比べる", () => {
    const sequencer = new TiltSequencer();
    expect(sequencer.accept(tilt("rightHip", 100))).toBe(true);
    expect(sequencer.accept(tilt("leftHip", 1))).toBe(true);
    expect(sequencer.accept(tilt("leftHip", 0))).toBe(false);
  });

  test("接続中でなくなった関節の番号は忘れる。次のスマホは小さい番号から始められる", () => {
    const sequencer = new TiltSequencer();
    sequencer.accept(tilt("rightHip", 100));
    sequencer.accept(tilt("leftHip", 100));
    sequencer.keepOnly(["leftHip"]);
    expect(sequencer.accept(tilt("rightHip", 0))).toBe(true);
    expect(sequencer.accept(tilt("leftHip", 99))).toBe(false);
  });
});
