import * as v from "valibot";
import {
  CreateRoomRejected,
  CreateRoomResponse,
  RankingsResponse,
  SubmitRankingResponse,
  TooManyRequests,
  type RankingEntry,
  type SubmitRankingInput,
} from "../shared/api.ts";
import type { Mode } from "../shared/messages.ts";

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

/**
 * ゴールしたタイムをランキングに保存し、その順位と上位を返す（POST /api/rankings）。
 * チーム名の正規化とタイムの丸めはサーバーが行う。入力欄で先に確かめるときは、src/shared/api.ts の TeamName を使う
 */
export async function submitRanking(input: SubmitRankingInput): Promise<SubmitRankingResponse> {
  const response = await fetch("/api/rankings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 429) {
    const body: unknown = await response
      .clone()
      .json()
      .catch(() => null);
    const rejected = v.safeParse(TooManyRequests, body);
    if (rejected.success) {
      throw new Error("保存する回数が多すぎます。1分ほど待ってから、もう一度送ってください");
    }
  }
  if (!response.ok) {
    throw new Error(`/api/rankings が ${response.status} を返しました：${await response.text()}`);
  }
  const result = v.safeParse(SubmitRankingResponse, await response.json());
  if (!result.success) {
    throw new Error("/api/rankings のレスポンスの形が違います");
  }
  return result.output;
}

/** ランキングの上位を、速い順に返す（GET /api/rankings） */
export async function fetchRankings(mode: Mode): Promise<RankingEntry[]> {
  const response = await fetch(`/api/rankings?mode=${encodeURIComponent(mode)}`);
  if (!response.ok) {
    throw new Error(`/api/rankings が ${response.status} を返しました`);
  }
  const result = v.safeParse(RankingsResponse, await response.json());
  if (!result.success) {
    throw new Error("/api/rankings のレスポンスの形が違います");
  }
  return result.output.rankings;
}
