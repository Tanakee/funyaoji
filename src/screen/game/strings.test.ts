import { expect, test } from "vite-plus/test";
import {
  mixRgb,
  quadraticBezierPoint,
  stringLook,
  TiltGlow,
  TILT_GLOW_FADE_SEC,
  TILT_GLOW_HOLD_SEC,
  TILT_GLOW_THRESHOLD,
} from "./strings.ts";

test("傾きが 0 の糸はたるみ、1 の糸は張る", () => {
  expect(stringLook(0)).toEqual({
    slack: 1,
    coreWidth: 1.5,
    outlineWidth: 4,
    alpha: 0.45,
    skyBlend: 0.5,
    knotPosition: 0.75,
    knotRadius: 5,
  });
  const taut = stringLook(1);
  expect(taut).toEqual({
    slack: 0,
    coreWidth: 4.5,
    outlineWidth: 7,
    alpha: 1,
    skyBlend: 0,
    knotPosition: expect.closeTo(0.2),
    knotRadius: 7,
  });
});

test("糸の見た目に使う入力は 0〜1 に収める", () => {
  expect(stringLook(-1)).toEqual(stringLook(0));
  expect(stringLook(2)).toEqual(stringLook(1));
});

test("結び玉の位置は糸の始点と終点を結ぶ曲線上にある", () => {
  const start = { x: 0, y: 0 };
  const control = { x: 4, y: 8 };
  const end = { x: 8, y: 4 };
  expect(quadraticBezierPoint(start, control, end, 0)).toEqual(start);
  expect(quadraticBezierPoint(start, control, end, 0.5)).toEqual({ x: 4, y: 5 });
  expect(quadraticBezierPoint(start, control, end, 1)).toEqual(end);
});

test("色は RGB の成分ごとに混ぜる", () => {
  expect(mixRgb(0xff0000, 0x00ffff, 0)).toBe(0xff0000);
  expect(mixRgb(0xff0000, 0x00ffff, 0.5)).toBe(0x808080);
  expect(mixRgb(0xff0000, 0x00ffff, 1)).toBe(0x00ffff);
});

test("初回の入力と、基準からの差がしきい値未満の入力では光らない", () => {
  const glow = new TiltGlow();
  expect(glow.update("leftHip", 0.5, 0.016)).toBe(0);
  expect(glow.update("leftHip", 0.519, 0.016)).toBe(0);
  expect(glow.update("leftHip", 0.481, 0.016)).toBe(0);
});

test("基準からの差がしきい値に達した関節だけが光る", () => {
  const glow = new TiltGlow();
  glow.update("leftHip", 0.1, 0);
  glow.update("rightHip", 0.1, 0);
  expect(glow.update("leftHip", 0.12, 0.016)).toBe(1);
  expect(glow.update("rightHip", 0.1, 0.016)).toBe(0);
  expect(glow.update("rightHip", 0, 0.016)).toBe(1);
});

test("点灯を 0.25 秒保ち、その後 0.3 秒で消える", () => {
  const glow = new TiltGlow();
  glow.update("leftHip", 0, 0);
  expect(glow.update("leftHip", TILT_GLOW_THRESHOLD, 0.1)).toBe(1);
  expect(glow.update("leftHip", TILT_GLOW_THRESHOLD, TILT_GLOW_HOLD_SEC)).toBe(1);
  expect(glow.update("leftHip", TILT_GLOW_THRESHOLD, TILT_GLOW_FADE_SEC / 2)).toBeCloseTo(0.5);
  expect(glow.update("leftHip", TILT_GLOW_THRESHOLD, TILT_GLOW_FADE_SEC / 2)).toBe(0);
});

test("傾きが変わるたびに点灯時間を計り直す", () => {
  const glow = new TiltGlow();
  glow.update("leftHip", 0, 0);
  glow.update("leftHip", 0.3, 0);
  glow.update("leftHip", 0.3, 0.4);
  expect(glow.update("leftHip", 0.6, 0.016)).toBe(1);
  expect(glow.update("leftHip", 0.6, TILT_GLOW_HOLD_SEC)).toBe(1);
});

test("参加が途切れると消灯し、次の入力を基準にする", () => {
  const glow = new TiltGlow();
  glow.update("leftHip", 0, 0);
  expect(glow.update("leftHip", 0.5, 0.016)).toBe(1);
  expect(glow.update("leftHip", undefined, 0.016)).toBe(0);
  expect(glow.update("leftHip", 0.9, 0.016)).toBe(0);
  expect(glow.update("leftHip", 1, 0.016)).toBe(1);
});
