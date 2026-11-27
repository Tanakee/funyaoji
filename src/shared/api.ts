import * as v from "valibot";
import { Mode } from "./messages.ts";

export const PingResponse = v.object({ count: v.number() });
export type PingResponse = v.InferOutput<typeof PingResponse>;

/** POST /api/rooms のレスポンス */
export const CreateRoomResponse = v.object({ roomCode: v.string() });
export type CreateRoomResponse = v.InferOutput<typeof CreateRoomResponse>;

// ランキング（POST /api/rankings・GET /api/rankings）。決めた値の理由は docs/design.md の「ランキング」

/** チーム名の文字数（書記素で数える。絵文字や濁点の付いた文字も1文字）の上限 */
export const TEAM_NAME_MAX_LENGTH = 10;
/** 受け付けるタイムの上限（ミリ秒）。制限時間が決まるまでのゆるい値（Issue #81） */
export const RANKING_MAX_TIME_MS = 10 * 60_000;
/** 上位として返す件数 */
export const RANKING_TOP_COUNT = 10;

/** 整える前の文字列の長さの上限。極端に長い文字列を、正規化する前に断る */
const TEAM_NAME_RAW_MAX_LENGTH = 100;
/** 制御文字（改行・タブを含む）、行と段落の区切り、文字の向きを変える文字を含まない */
const TEAM_NAME_PATTERN = /^[^\p{Cc}\p{Zl}\p{Zp}‪-‮⁦-⁩]*$/u;

/** チーム名。NFKC で正規化して前後の空白を除き、1〜10文字にする */
export const TeamName = v.pipe(
  v.string(),
  v.maxLength(TEAM_NAME_RAW_MAX_LENGTH),
  // 全角の英数字や全角の空白を半角にそろえてから、前後の空白を除く
  v.normalize("NFKC"),
  v.trim(),
  v.regex(TEAM_NAME_PATTERN, "チーム名に改行や制御文字は使えません"),
  v.minGraphemes(1, "チーム名を入れてください"),
  v.maxGraphemes(TEAM_NAME_MAX_LENGTH, `チーム名は${TEAM_NAME_MAX_LENGTH}文字までです`),
);

/** タイム（ミリ秒）。整数に丸め、1ミリ秒から上限までを受け付ける */
export const RankingTimeMs = v.pipe(
  v.number(),
  v.finite(),
  v.transform(Math.round),
  v.minValue(1),
  v.maxValue(RANKING_MAX_TIME_MS),
);

/** POST /api/rankings のリクエスト。日時はサーバーが付ける */
export const SubmitRankingRequest = v.object({
  mode: Mode,
  teamName: TeamName,
  timeMs: RankingTimeMs,
});
/** 送る前の形（正規化と丸めの前） */
export type SubmitRankingInput = v.InferInput<typeof SubmitRankingRequest>;
/** 検査して整えたあとの形 */
export type SubmitRankingRequest = v.InferOutput<typeof SubmitRankingRequest>;

/** ランキングの1件。rank は1から始まる順位。createdAt は保存した時刻（ミリ秒） */
export const RankingEntry = v.object({
  rank: v.number(),
  teamName: v.string(),
  timeMs: v.number(),
  createdAt: v.number(),
});
export type RankingEntry = v.InferOutput<typeof RankingEntry>;

/** GET /api/rankings のレスポンス。速い順 */
export const RankingsResponse = v.object({ mode: Mode, rankings: v.array(RankingEntry) });
export type RankingsResponse = v.InferOutput<typeof RankingsResponse>;

/** POST /api/rankings のレスポンス。保存した1件と、保存したあとの上位 */
export const SubmitRankingResponse = v.object({
  entry: RankingEntry,
  rankings: v.array(RankingEntry),
});
export type SubmitRankingResponse = v.InferOutput<typeof SubmitRankingResponse>;
