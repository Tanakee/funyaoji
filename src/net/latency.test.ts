import { expect, test } from "vite-plus/test";
import { LatencyTracker } from "./latency.ts";

test("往復時間の半分を記録し、最新の値と中央値を出す。知らない id の pong は無視する", () => {
  const tracker = new LatencyTracker();
  for (const [sentAt, rtt] of [
    [0, 40],
    [1000, 200],
    [2000, 60],
  ]) {
    const id = tracker.ping("rightHip", sentAt);
    tracker.pong(id, "rightHip", sentAt + rtt);
  }
  tracker.pong(999, "rightHip", 5000);
  expect(tracker.snapshot()).toEqual({ rightHip: { latest: 30, median: 30, missed: 0 } });
});
