import { describe, expect, inject, test } from "vite-plus/test";
import {
  RANKING_MAX_TIME_MS,
  type RankingsResponse,
  type SubmitRankingResponse,
} from "../shared/api.ts";

// src/server/test-server.ts が立てた開発サーバーに、HTTP でつないで確かめる
const serverUrl = inject("serverUrl");

/** POST /api/rankings を呼ぶ。ip を省くと、IP ごとの回数の上限に当たらないように、呼ぶたびに別の IP にする */
function submit(body: unknown, ip: string = crypto.randomUUID()): Promise<Response> {
  return fetch(new URL("/api/rankings", serverUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify(body),
  });
}

describe("/api/rankings", () => {
  test("保存したタイムを、速い順に上位として返す。チーム名は NFKC で正規化し、前後の空白を除く", async () => {
    // ほかのテストのデータと見分けるため、チーム名に印を付ける
    const tag = crypto.randomUUID().slice(0, 4);
    for (const [teamName, timeMs] of [
      [`${tag}c`, 3],
      [`${tag}a`, 1],
      [`${tag}b`, 2],
    ] as const) {
      const response = await submit({ mode: "10m", teamName, timeMs });
      expect(response.status).toBe(201);
    }
    // 全角の英字と全角の空白
    const response = await submit({ mode: "10m", teamName: `　${tag}ＺＺ `, timeMs: 2 });
    const saved = (await response.json()) as SubmitRankingResponse;
    expect(saved.entry.teamName).toBe(`${tag}ZZ`);

    const top = (await (
      await fetch(new URL("/api/rankings?mode=10m", serverUrl))
    ).json()) as RankingsResponse;
    const mine = top.rankings.filter((e) => e.teamName.startsWith(tag));
    // 同じタイムは先に保存したものが上
    expect(mine.map((e) => e.teamName)).toEqual([`${tag}a`, `${tag}b`, `${tag}ZZ`, `${tag}c`]);
    // 保存したときに返した順位と、上位の中の順位が合う
    expect(saved.entry.rank).toBe(mine[2]?.rank);
  });

  test("形や範囲の正しくない値は 400 で断る", async () => {
    for (const body of [
      { mode: "50m", teamName: "a", timeMs: 1000 },
      { mode: "10m", teamName: "  ", timeMs: 1000 },
      { mode: "10m", teamName: "a\nb", timeMs: 1000 },
      { mode: "10m", teamName: "\u200B", timeMs: 1000 },
      { mode: "10m", teamName: "\u200D", timeMs: 1000 },
      { mode: "10m", teamName: "12345678901", timeMs: 1000 },
      { mode: "10m", teamName: "a", timeMs: 0 },
      { mode: "10m", teamName: "a", timeMs: RANKING_MAX_TIME_MS + 1 },
      "10m",
    ]) {
      const response = await submit(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    const response = await fetch(new URL("/api/rankings", serverUrl));
    expect(response.status).toBe(400);
  });

  // ローカルの Rate Limiting は時計の分の区切りで数え直すので、区切りをまたいでも断られるまで呼ぶ
  test("同じ IP から続けて保存すると、429（too-many-requests）で断る", async () => {
    const ip = crypto.randomUUID();
    let response: Response | undefined;
    for (let i = 0; i < 11; i++) {
      response = await submit({ mode: "10m", teamName: "連打", timeMs: RANKING_MAX_TIME_MS }, ip);
      if (response.status === 429) break;
    }
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("60");
    expect(await response?.json()).toEqual({ reason: "too-many-requests" });
  });
});
