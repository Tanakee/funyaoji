// メッセージの仕様は docs/api.md
import * as v from "valibot";

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
});
export type RoomMessage = v.InferOutput<typeof RoomMessage>;

export const PlayResult = v.variant("outcome", [
  v.object({ outcome: v.literal("goal"), distanceM: FiniteNumber, timeMs: FiniteNumber }),
  v.object({
    outcome: v.picklist(["fell", "timeout", "disconnected"]),
    distanceM: FiniteNumber,
  }),
]);
export type PlayResult = v.InferOutput<typeof PlayResult>;

export const PhaseMessage = v.variant("phase", [
  v.object({ type: v.literal("phase"), phase: v.literal("lobby") }),
  v.object({ type: v.literal("phase"), phase: v.literal("playing"), mode: v.literal("10m") }),
  v.object({ type: v.literal("phase"), phase: v.literal("result"), result: PlayResult }),
]);
export type PhaseMessage = v.InferOutput<typeof PhaseMessage>;

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

export const ServerToPhoneMessage = v.variant("type", [
  JoinedMessage,
  RejectedMessage,
  RoomMessage,
  PhaseMessage,
  StatusMessage,
  PingMessage,
]);
export type ServerToPhoneMessage = v.InferOutput<typeof ServerToPhoneMessage>;

export const ServerToScreenMessage = v.variant("type", [
  RoomMessage,
  RelayedTiltMessage,
  RelayedPongMessage,
]);
export type ServerToScreenMessage = v.InferOutput<typeof ServerToScreenMessage>;

export const PhoneToServerMessage = v.variant("type", [TiltMessage, PongMessage]);
export type PhoneToServerMessage = v.InferOutput<typeof PhoneToServerMessage>;

export const ScreenToServerMessage = v.variant("type", [PhaseMessage, StatusMessage, PingMessage]);
export type ScreenToServerMessage = v.InferOutput<typeof ScreenToServerMessage>;
