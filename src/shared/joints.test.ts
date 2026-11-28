import { describe, expect, test } from "vite-plus/test";
import { JOINT_DISPLAY, SEATS } from "./joints.ts";
import { JOINTS } from "./messages.ts";

function wcagLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function wcagContrast(a: string, b: string): number {
  const [hi, lo] = [wcagLuminance(a), wcagLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("JOINT_DISPLAY", () => {
  test.each(JOINTS)("%s の色の上の文字は、コントラスト比 4.5 以上", (joint) => {
    const { color, textOnColor } = JOINT_DISPLAY[joint];
    expect(wcagContrast(color, textOnColor)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("SEATS", () => {
  test("どの関節も1回ずつ入る", () => {
    expect([...SEATS].sort()).toEqual([...JOINTS].sort());
  });
});
