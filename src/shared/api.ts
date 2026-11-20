import * as v from "valibot";

export const PingResponse = v.object({ count: v.number() });
export type PingResponse = v.InferOutput<typeof PingResponse>;
