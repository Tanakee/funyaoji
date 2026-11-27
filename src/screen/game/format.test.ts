import { expect, test } from "vite-plus/test";
import { formatDistance, formatTime } from "./format.ts";

test("距離は小数 1 桁で、負の値はそのまま、-0.0 にならない", () => {
  expect(formatDistance(3.456)).toBe("3.5");
  expect(formatDistance(-1.24)).toBe("-1.2");
  expect(formatDistance(-0.04)).toBe("0.0");
});

test("タイムは秒の小数 2 桁", () => {
  expect(formatTime(0)).toBe("0.00");
  expect(formatTime(12_345)).toBe("12.35");
});
