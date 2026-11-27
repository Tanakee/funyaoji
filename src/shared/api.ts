import * as v from "valibot";

export const PingResponse = v.object({ count: v.number() });
export type PingResponse = v.InferOutput<typeof PingResponse>;

/** POST /api/rooms のレスポンス */
export const CreateRoomResponse = v.object({ roomCode: v.string() });
export type CreateRoomResponse = v.InferOutput<typeof CreateRoomResponse>;

/**
 * POST /api/rooms で断ったときのレスポンス（429）。
 * too-many-requests は同じ IP からの連打、daily-limit はその日に作れる数を使い切ったとき
 */
export const CreateRoomRejected = v.object({
  reason: v.picklist(["too-many-requests", "daily-limit"]),
});
export type CreateRoomRejected = v.InferOutput<typeof CreateRoomRejected>;
