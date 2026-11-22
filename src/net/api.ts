import * as v from "valibot";
import { CreateRoomResponse } from "../shared/api.ts";

/** ルームを作り、ルームコードを返す（POST /api/rooms） */
export async function createRoom(): Promise<string> {
  const response = await fetch("/api/rooms", { method: "POST" });
  if (!response.ok) {
    throw new Error(`/api/rooms が ${response.status} を返しました`);
  }
  const result = v.safeParse(CreateRoomResponse, await response.json());
  if (!result.success) {
    throw new Error("/api/rooms のレスポンスの形が違います");
  }
  return result.output.roomCode;
}
