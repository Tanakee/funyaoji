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
/** 受け付けるタイムの上限（ミリ秒）。制限時間は設けないので（Issue #81）、明らかにおかしな値を断るためだけの値 */
export const RANKING_MAX_TIME_MS = 60 * 60_000;
/** 上位として返す件数 */
export const RANKING_TOP_COUNT = 10;

/** 整える前の文字列の長さ（UTF-16 のコード単位で数える）の上限。極端に長い文字列を、正規化する前に断る */
const TEAM_NAME_RAW_MAX_LENGTH = 100;
/** 孤立したサロゲート（UTF-16 として壊れた文字）を含まない */
const WELL_FORMED_PATTERN = /^\P{Cs}*$/u;
/**
 * 制御文字（改行・タブを含む）、行と段落の区切り、書式の文字（文字の向きを変える文字や幅のない空白）を含まない。
 * 書式の文字のうち、絵文字をつなぐ ZWJ（U+200D）だけは家族の絵文字などに要るので許す
 */
const TEAM_NAME_PATTERN = /^(?:[^\p{Cc}\p{Zl}\p{Zp}\p{Cf}]|\u{200D})*$/u;
/** 空白と見えない文字（ZWJ や異体字セレクタなど）だけでできている */
const INVISIBLE_ONLY_PATTERN = /^[\s\p{Default_Ignorable_Code_Point}]*$/u;

/** チーム名。NFKC で正規化して前後の空白を除き、1〜10文字にする */
export const TeamName = v.pipe(
  v.string(),
  v.maxLength(TEAM_NAME_RAW_MAX_LENGTH),
  v.regex(WELL_FORMED_PATTERN, "チーム名に壊れた文字が含まれています"),
  // 全角の英数字や全角の空白を半角にそろえてから、前後の空白を除く
  v.normalize("NFKC"),
  v.trim(),
  v.regex(TEAM_NAME_PATTERN, "チーム名に改行や見えない文字は使えません"),
  v.check((name) => !INVISIBLE_ONLY_PATTERN.test(name), "チーム名を入れてください"),
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

/**
 * POST /api/rooms で断ったときのレスポンス（429）。
 * too-many-requests は同じ IP からの連打、daily-limit はその日に作れる数を使い切ったとき
 */
export const CreateRoomRejected = v.object({
  reason: v.picklist(["too-many-requests", "daily-limit"]),
});
export type CreateRoomRejected = v.InferOutput<typeof CreateRoomRejected>;
