import type { PingResponse } from "../shared/api.ts";

export async function fetchPing(): Promise<PingResponse> {
  const response = await fetch("/api/ping");
  if (!response.ok) {
    throw new Error(`/api/ping が ${response.status} を返しました`);
  }
  const body: unknown = await response.json();
  if (
    typeof body !== "object" ||
    body === null ||
    !("count" in body) ||
    typeof body.count !== "number"
  ) {
    throw new Error("/api/ping のレスポンスの形が違います");
  }
  return { count: body.count };
}
