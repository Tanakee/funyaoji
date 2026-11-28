import { expect, test } from "vite-plus/test";
import { screenLayoutCssVars, screenScale } from "./layout.ts";

test("基準の画面では等倍、1920×1080 では 1.5 倍になる", () => {
  expect(screenScale(1280, 720)).toBe(1);
  expect(screenScale(1920, 1080)).toBe(1.5);
});

test("画面が極端に小さくても大きくても、倍率を範囲内に収める", () => {
  expect(screenScale(100, 100)).toBe(0.6);
  expect(screenScale(7680, 4320)).toBe(2.2);
});

test("幅と高さのうち、小さい方の倍率を使う", () => {
  expect(screenScale(1920, 720)).toBe(1);
  expect(screenScale(1280, 1080)).toBe(1);
});

test("CSS にはレイアウトの値を単位なしの文字列で渡す", () => {
  expect(screenLayoutCssVars()).toEqual({
    "--layout-base-w": "1280",
    "--layout-base-h": "720",
    "--layout-safe-x": "54",
    "--layout-safe-y": "40",
    "--layout-band-h": "120",
    "--layout-scale-min": "0.6",
    "--layout-scale-max": "2.2",
  });
});
