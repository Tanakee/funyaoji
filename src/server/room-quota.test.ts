import { expect, test } from "vite-plus/test";
import { admitRoom, type DailyCount } from "./room-quota.ts";

// 日本時間 2026-11-28 10:00（UTC 01:00）
const NOW = Date.UTC(2026, 10, 28, 1, 0);

test("その日の数が上限に届いていたら断り、次の UTC の 0 時（日本時間の朝9時）を返す", () => {
  const full: DailyCount = { day: "2026-11-28", count: 3 };
  expect(admitRoom(full, NOW, 3)).toEqual({ admitted: false, resetsAt: Date.UTC(2026, 10, 29) });
  expect(admitRoom({ day: "2026-11-28", count: 2 }, NOW, 3)).toEqual({
    admitted: true,
    next: { day: "2026-11-28", count: 3 },
  });
});

test("日付が変わったら、数え直す", () => {
  const yesterday: DailyCount = { day: "2026-11-27", count: 3 };
  expect(admitRoom(yesterday, NOW, 3)).toEqual({
    admitted: true,
    next: { day: "2026-11-28", count: 1 },
  });
});
