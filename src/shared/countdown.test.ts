import { expect, it } from "vite-plus/test";
import { COUNTDOWNS, countdownLeadMs, countdownStep } from "./countdown.ts";

it("開始は 3・2・1 を1秒ずつ表示し、3000ms で GO! になる", () => {
  expect(countdownStep("count", -10)).toEqual({ label: "", untilMs: 0 });
  expect(countdownStep("count", 0).label).toBe("3");
  expect(countdownStep("count", 999)).toEqual({ label: "3", untilMs: 1_000 });
  expect(countdownStep("count", 1_000)).toEqual({ label: "2", untilMs: 2_000 });
  expect(countdownStep("count", 1_999).label).toBe("2");
  expect(countdownStep("count", 2_000)).toEqual({ label: "1" });
  expect(countdownStep("count", 2_999).label).toBe("1");
  expect(COUNTDOWNS.count).toMatchObject({ durationMs: 3_000, startLabel: "GO!" });
});

it("やり直しは 1500ms まで「よーい」を表示し、開始の合図は「ドン！」になる", () => {
  expect(countdownStep("readyGo", 0)).toEqual({ label: "よーい" });
  expect(countdownStep("readyGo", 1_499).label).toBe("よーい");
  expect(COUNTDOWNS.readyGo).toMatchObject({ durationMs: 1_500, startLabel: "ドン！" });
});

it("最初の表示を待つ時間は、いちばん遅いスマホの遅延で、1000ms まで", () => {
  expect(countdownLeadMs({})).toBe(0);
  expect(countdownLeadMs({ rightHip: 42, leftKnee: 130 })).toBe(130);
  expect(countdownLeadMs({ rightHip: 1_300 })).toBe(1_000);
});
