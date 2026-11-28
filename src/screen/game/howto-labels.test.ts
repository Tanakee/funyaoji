import { describe, expect, it } from "vite-plus/test";
import { JOINT_DISPLAY } from "../../shared/joints.ts";
import { labelPositions, nameLabelFrame, nameTextColor } from "./howto-labels.ts";

describe("遊び方の札", () => {
  it("脚の左右それぞれに、部位の中心と同じ高さで出す", () => {
    const part = { x: 20, y: 200 };
    for (const joint of ["leftHip", "leftKnee"] as const) {
      expect(labelPositions(joint, part, 80, 0)).toMatchObject({ nameX: -60, y: 200 });
    }
    for (const joint of ["rightHip", "rightKnee"] as const) {
      expect(labelPositions(joint, part, 80, 0)).toMatchObject({ nameX: 100, y: 200 });
    }
  });

  it("両方あるときは OK! を名前の外側に並べ、単独のときは部位に寄せる", () => {
    const part = { x: 20, y: 200 };
    expect(labelPositions("leftKnee", part, 80, 50)).toEqual({ nameX: -60, okX: -131, y: 200 });
    expect(labelPositions("rightHip", part, 80, 50)).toEqual({ nameX: 100, okX: 171, y: 200 });
    expect(labelPositions("rightHip", part, 0, 50).okX).toBe(85);
  });

  it("名前を1.5秒出したあと0.3秒で消し、再び動かすと時間を数え直す", () => {
    const shown = nameLabelFrame(0, 1, 0.1);
    expect(shown.alpha).toBe(1);
    const held = nameLabelFrame(shown.remainingSec, 0, 1.5);
    expect(held.alpha).toBeCloseTo(1);
    const fading = nameLabelFrame(held.remainingSec, 0, 0.15);
    expect(fading.alpha).toBeCloseTo(0.5);
    expect(nameLabelFrame(fading.remainingSec, 0, 0.15).alpha).toBeCloseTo(0);
    expect(nameLabelFrame(fading.remainingSec, 1, 0.1)).toEqual(shown);
  });

  it("部位の色に対してコントラストが高い文字色を選ぶ", () => {
    const palette = { seatOutline: 0x1f3a68, seatPaper: 0xfbf8f0 };
    const textColor = (joint: keyof typeof JOINT_DISPLAY) =>
      nameTextColor(Number.parseInt(JOINT_DISPLAY[joint].color.slice(1), 16), palette);
    expect(textColor("leftKnee")).toBe(palette.seatOutline);
    expect(textColor("rightKnee")).toBe(palette.seatOutline);
    expect(textColor("leftHip")).toBe(palette.seatPaper);
    expect(textColor("rightHip")).toBe(palette.seatPaper);
  });
});
