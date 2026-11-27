// 1日に作れるルームの数の決め方。Durable Object（room-gate.ts）から切り離し、Node.js でテストできるようにする

/**
 * 1日に作れるルームの数。本番とプレビューは別に数える（ストレージが別のため）。
 * 根拠は docs/cloudflare.md の「ルームを作る回数の上限」
 */
export const DAILY_ROOM_LIMIT = 200;

/** その日に作ったルームの数。day は UTC の日付（YYYY-MM-DD）。UTC の 0 時は日本時間の朝 9 時 */
export type DailyCount = { day: string; count: number };

export type AdmitResult =
  | { admitted: true; next: DailyCount }
  // resetsAt は次に作れるようになる時刻（ミリ秒）。次の UTC の 0 時
  | { admitted: false; resetsAt: number };

/** ルームを1つ作ってよいかを決める。日付が変わっていれば、数え直す */
export function admitRoom(prev: DailyCount | undefined, now: number, limit: number): AdmitResult {
  const date = new Date(now);
  const day = date.toISOString().slice(0, 10);
  const count = prev?.day === day ? prev.count : 0;
  if (count >= limit) {
    const resetsAt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
    return { admitted: false, resetsAt };
  }
  return { admitted: true, next: { day, count: count + 1 } };
}
