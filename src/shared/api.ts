import * as v from "valibot";

export const PingResponse = v.object({ count: v.number() });
export type PingResponse = v.InferOutput<typeof PingResponse>;

/** POST /api/rooms のレスポンス */
export const CreateRoomResponse = v.object({ roomCode: v.string() });
export type CreateRoomResponse = v.InferOutput<typeof CreateRoomResponse>;
