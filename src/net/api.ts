import * as v from "valibot";
import { PingResponse } from "../shared/api.ts";

export async function fetchPing(): Promise<PingResponse> {
  const response = await fetch("/api/ping");
  if (!response.ok) {
    throw new Error(`/api/ping が ${response.status} を返しました`);
  }
  const result = v.safeParse(PingResponse, await response.json());
  if (!result.success) {
    throw new Error("/api/ping のレスポンスの形が違います");
  }
  return result.output;
}
