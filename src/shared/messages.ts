// メッセージの仕様は docs/api.md
import * as v from "valibot";
import { COUNTDOWN_KINDS } from "./countdown.ts";

// 参加順に割り当てる順番
export const JOINTS = ["rightHip", "leftHip", "rightKnee", "leftKnee"] as const;
export const Joint = v.picklist(JOINTS);
export type Joint = v.InferOutput<typeof Joint>;

// JSON の 1e999 は Infinity になり、中継のときに null に変わる。有限の数だけを通す
const FiniteNumber = v.pipe(v.number(), v.finite());

export const JoinedMessage = v.object({
  type: v.literal("joined"),
  joint: Joint,
});
export type JoinedMessage = v.InferOutput<typeof JoinedMessage>;

export const RejectedMessage = v.object({
  type: v.literal("rejected"),
  reason: v.picklist(["full", "playing", "no-room"]),
});
export type RejectedMessage = v.InferOutput<typeof RejectedMessage>;

export const RoomMessage = v.object({
  type: v.literal("room"),
  roomCode: v.string(),
  joints: v.array(Joint),
  vacated: v.optional(Joint),
});
export type RoomMessage = v.InferOutput<typeof RoomMessage>;

/**
 * 遊び方（モード。docs/game.md の「モード」）。normal はノーマル（前の「10m モード」）、hard は転びやすいハード、
 * obstacle はハードルと階段を越える障害物。スクリーンのロビーで選ぶ
 */
export const MODES = ["normal", "hard", "obstacle"] as const;
export const Mode = v.picklist(MODES);
export type Mode = v.InferOutput<typeof Mode>;

/**
 * 操作方法。tilt はスマホの傾き、camera は前面カメラに映した人差し指の曲げ（docs/game.md の「操作方法」）。
 * モードとは別に、スクリーンのロビーで選ぶ
 */
export const INPUT_METHODS = ["tilt", "camera"] as const;
export const InputMethod = v.picklist(INPUT_METHODS);
export type InputMethod = v.InferOutput<typeof InputMethod>;

export const PlayResult = v.variant("outcome", [
  v.object({ outcome: v.literal("goal"), distanceM: FiniteNumber, timeMs: FiniteNumber }),
  v.object({
    outcome: v.picklist(["fell", "disconnected"]),
    distanceM: FiniteNumber,
  }),
]);
export type PlayResult = v.InferOutput<typeof PlayResult>;

const CountdownTime = v.pipe(FiniteNumber, v.minValue(0), v.maxValue(10_000));
const Countdown = v.object({
  kind: v.picklist(COUNTDOWN_KINDS),
  durationMs: CountdownTime,
  remainingMs: CountdownTime,
  delayMs: v.record(Joint, v.pipe(FiniteNumber, v.integer(), v.minValue(0))),
});

export const PhaseMessage = v.variant("phase", [
  v.object({ type: v.literal("phase"), phase: v.literal("lobby"), input: InputMethod }),
  v.object({
    type: v.literal("phase"),
    phase: v.literal("playing"),
    mode: Mode,
    input: InputMethod,
    countdown: v.optional(Countdown),
  }),
  v.object({ type: v.literal("phase"), phase: v.literal("result"), result: PlayResult }),
]);
export type PhaseMessage = v.InferOutput<typeof PhaseMessage>;

export const HowtoMessage = v.object({
  type: v.literal("howto"),
  ready: v.array(Joint),
});
export type HowtoMessage = v.InferOutput<typeof HowtoMessage>;

export const StatusMessage = v.object({
  type: v.literal("status"),
  active: v.array(Joint),
});
export type StatusMessage = v.InferOutput<typeof StatusMessage>;

// スマホが送る形。担当の関節はサーバーが付けるので、スマホは joint を持たない
export const TiltMessage = v.object({
  type: v.literal("tilt"),
  seq: FiniteNumber,
  angle: FiniteNumber,
});
export type TiltMessage = v.InferOutput<typeof TiltMessage>;

export const RelayedTiltMessage = v.object({ ...TiltMessage.entries, joint: Joint });
export type RelayedTiltMessage = v.InferOutput<typeof RelayedTiltMessage>;

// ping の joint は宛先のスマホ。スクリーンが付けて送る
export const PingMessage = v.object({
  type: v.literal("ping"),
  id: FiniteNumber,
  joint: Joint,
});
export type PingMessage = v.InferOutput<typeof PingMessage>;

export const PongMessage = v.object({
  type: v.literal("pong"),
  id: FiniteNumber,
});
export type PongMessage = v.InferOutput<typeof PongMessage>;

export const RelayedPongMessage = v.object({ ...PongMessage.entries, joint: Joint });
export type RelayedPongMessage = v.InferOutput<typeof RelayedPongMessage>;

export const StartMessage = v.object({ type: v.literal("start") });
export type StartMessage = v.InferOutput<typeof StartMessage>;

export const RetryMessage = v.object({ type: v.literal("retry") });
export type RetryMessage = v.InferOutput<typeof RetryMessage>;

export const RelayedStartMessage = v.object({ ...StartMessage.entries, joint: Joint });
export type RelayedStartMessage = v.InferOutput<typeof RelayedStartMessage>;

export const RelayedRetryMessage = v.object({ ...RetryMessage.entries, joint: Joint });
export type RelayedRetryMessage = v.InferOutput<typeof RelayedRetryMessage>;

export const ReadyMessage = v.object({ type: v.literal("ready") });
export type ReadyMessage = v.InferOutput<typeof ReadyMessage>;

export const RelayedReadyMessage = v.object({ ...ReadyMessage.entries, joint: Joint });
export type RelayedReadyMessage = v.InferOutput<typeof RelayedReadyMessage>;

// 接続が生きていることを知らせる。サーバーは中継せず、同じ文字列をそのまま返す
export const HeartbeatMessage = v.object({ type: v.literal("heartbeat") });
export type HeartbeatMessage = v.InferOutput<typeof HeartbeatMessage>;

/** ハートビートとして送る文字列。サーバーは、この文字列と完全に一致するものにだけ返す */
export const HEARTBEAT = JSON.stringify({ type: "heartbeat" } satisfies HeartbeatMessage);
/** スマホとスクリーンがハートビートを送る間隔 */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/** 運営がルームを閉じる。room-closed は終了の通知と、スクリーンへの受け付けの返事。 */
export const CloseRoomMessage = v.object({ type: v.literal("close-room") });
export const RoomClosedMessage = v.object({ type: v.literal("room-closed") });
/** このコードでも終了が分かるようにし、通知を受け取れなくても再接続しない。 */
export const ROOM_CLOSED_CODE = 4003;
/** 「抜ける」を受け付けて閉じたときの close コード。left が届かなくても、つなぎ直さない */
export const LEFT_CODE = 4004;

/** スマホの「抜ける」。left はサーバーの受け付けの返事 */
export const LeaveMessage = v.object({ type: v.literal("leave") });
export type LeaveMessage = v.InferOutput<typeof LeaveMessage>;

export const LeftMessage = v.object({ type: v.literal("left") });
export type LeftMessage = v.InferOutput<typeof LeftMessage>;

export const ServerToPhoneMessage = v.variant("type", [
  JoinedMessage,
  RoomClosedMessage,
  RejectedMessage,
  RoomMessage,
  PhaseMessage,
  HowtoMessage,
  StatusMessage,
  PingMessage,
  HeartbeatMessage,
  LeftMessage,
]);
export type ServerToPhoneMessage = v.InferOutput<typeof ServerToPhoneMessage>;

// スクリーンも、ルームが無いときは rejected（no-room）を受け取る。
// 接続したときは、サーバーが保持している最後の phase を受け取る
export const ServerToScreenMessage = v.variant("type", [
  RoomClosedMessage,
  RejectedMessage,
  RoomMessage,
  PhaseMessage,
  RelayedTiltMessage,
  RelayedPongMessage,
  RelayedStartMessage,
  RelayedRetryMessage,
  RelayedReadyMessage,
  HowtoMessage,
  HeartbeatMessage,
]);
export type ServerToScreenMessage = v.InferOutput<typeof ServerToScreenMessage>;

export const PhoneToServerMessage = v.variant("type", [
  TiltMessage,
  PongMessage,
  StartMessage,
  RetryMessage,
  ReadyMessage,
  HeartbeatMessage,
  LeaveMessage,
]);
export type PhoneToServerMessage = v.InferOutput<typeof PhoneToServerMessage>;

export const ScreenToServerMessage = v.variant("type", [
  CloseRoomMessage,
  PhaseMessage,
  HowtoMessage,
  StatusMessage,
  PingMessage,
  HeartbeatMessage,
]);
export type ScreenToServerMessage = v.InferOutput<typeof ScreenToServerMessage>;
