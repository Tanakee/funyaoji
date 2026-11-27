import { DurableObject } from "cloudflare:workers";
import { admitRoom, DAILY_ROOM_LIMIT, type DailyCount } from "./room-quota.ts";

/** ストレージのキー。その日に作ったルームの数（DailyCount） */
const COUNT_KEY = "count";

/**
 * 門番。ルームを作る回数を1日ごとに数え、上限を超えたら断る。
 * Worker 全体で1つ（index.ts の ROOM_GATE_NAME）。1つの Durable Object は1つずつ処理するので、数えもれが無い
 */
export class RoomGate extends DurableObject<Env> {
  admit(): { admitted: true } | { admitted: false; resetsAt: number } {
    const result = admitRoom(
      this.ctx.storage.kv.get<DailyCount>(COUNT_KEY),
      Date.now(),
      DAILY_ROOM_LIMIT,
    );
    if (!result.admitted) return result;
    this.ctx.storage.kv.put(COUNT_KEY, result.next);
    return { admitted: true };
  }
}
