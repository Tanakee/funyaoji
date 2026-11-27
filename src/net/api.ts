import * as v from "valibot";
import { CreateRoomRejected, CreateRoomResponse } from "../shared/api.ts";

/** POST /api/rooms が断った理由ごとに、スクリーンに出す文 */
const REJECTED_MESSAGES: Record<CreateRoomRejected["reason"], string> = {
  "too-many-requests": "作る回数が多すぎます。1分ほど待ってから、開き直してください",
  "daily-limit": "今日はもう作れません。日本時間の朝9時に戻ります",
};

/** ルームを作り、ルームコードを返す（POST /api/rooms） */
export async function createRoom(): Promise<string> {
  const response = await fetch("/api/rooms", { method: "POST" });
  if (response.status === 429) {
    const rejected = v.safeParse(CreateRoomRejected, await response.json().catch(() => null));
    if (rejected.success) throw new Error(REJECTED_MESSAGES[rejected.output.reason]);
  }
  if (!response.ok) {
    throw new Error(`/api/rooms が ${response.status} を返しました`);
  }
  const result = v.safeParse(CreateRoomResponse, await response.json());
  if (!result.success) {
    throw new Error("/api/rooms のレスポンスの形が違います");
  }
  return result.output.roomCode;
}
