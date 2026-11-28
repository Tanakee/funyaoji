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
      const response = await submit({ mode: "normal", input: "tilt", teamName, timeMs });
      expect(response.status).toBe(201);
    }
    // 全角の英字と全角の空白
    const response = await submit({
      mode: "normal",
      input: "tilt",
      teamName: `　${tag}ＺＺ `,
      timeMs: 2,
    });
    const saved = (await response.json()) as SubmitRankingResponse;
    expect(saved.entry.teamName).toBe(`${tag}ZZ`);

    const top = (await (
      await fetch(new URL("/api/rankings?mode=normal&input=tilt", serverUrl))
    ).json()) as RankingsResponse;
    const mine = top.rankings.filter((e) => e.teamName.startsWith(tag));
    // 同じタイムは先に保存したものが上
    expect(mine.map((e) => e.teamName)).toEqual([`${tag}a`, `${tag}b`, `${tag}ZZ`, `${tag}c`]);
    // 保存したときに返した順位と、上位の中の順位が合う
    expect(saved.entry.rank).toBe(mine[2]?.rank);
  });

  test("形や範囲の正しくない値は 400 で断る", async () => {
    for (const body of [
      { mode: "50m", input: "tilt", teamName: "a", timeMs: 1000 },
      // 前の「10m モード」の値は、もう受け付けない
      { mode: "10m", input: "tilt", teamName: "a", timeMs: 1000 },
      { mode: "normal", teamName: "a", timeMs: 1000 },
      { mode: "normal", input: "mouse", teamName: "a", timeMs: 1000 },
      { mode: "normal", input: "tilt", teamName: "  ", timeMs: 1000 },
      { mode: "normal", input: "tilt", teamName: "a\nb", timeMs: 1000 },
      { mode: "normal", input: "tilt", teamName: "\u200B", timeMs: 1000 },
      { mode: "normal", input: "tilt", teamName: "\u200D", timeMs: 1000 },
      { mode: "normal", input: "tilt", teamName: "12345678901", timeMs: 1000 },
      { mode: "normal", input: "tilt", teamName: "a", timeMs: 0 },
      { mode: "normal", input: "tilt", teamName: "a", timeMs: RANKING_MAX_TIME_MS + 1 },
      "normal",
    ]) {
      const response = await submit(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
    }
    for (const query of [
      "",
      "?mode=normal",
      "?mode=normal&input=mouse",
      "?mode=10m&input=tilt",
      "?input=tilt",
    ]) {
      const response = await fetch(new URL(`/api/rankings${query}`, serverUrl));
      expect(response.status, query).toBe(400);
    }
  });

  test("傾きとカメラのランキングは分かれる", async () => {
    const tag = crypto.randomUUID().slice(0, 4);
    await submit({ mode: "normal", input: "tilt", teamName: `${tag}t`, timeMs: 1 });
    const response = await submit({
      mode: "normal",
      input: "camera",
      teamName: `${tag}c`,
      timeMs: 2,
    });
    const saved = (await response.json()) as SubmitRankingResponse;
    // 傾きの記録より遅くても、カメラの中では自分の順位になる
    expect(saved.rankings.some((e) => e.teamName === `${tag}t`)).toBe(false);
    for (const [input, name] of [
      ["tilt", `${tag}t`],
      ["camera", `${tag}c`],
    ] as const) {
      const top = (await (
        await fetch(new URL(`/api/rankings?mode=normal&input=${input}`, serverUrl))
      ).json()) as RankingsResponse;
      expect(top.input).toBe(input);
      expect(top.rankings.filter((e) => e.teamName.startsWith(tag)).map((e) => e.teamName)).toEqual(
        [name],
      );
    }
  });

  test("ノーマルとハードのランキングは分かれる", async () => {
    const tag = crypto.randomUUID().slice(0, 4);
    await submit({ mode: "normal", input: "tilt", teamName: `${tag}n`, timeMs: 1 });
    const response = await submit({ mode: "hard", input: "tilt", teamName: `${tag}h`, timeMs: 2 });
    const saved = (await response.json()) as SubmitRankingResponse;
    // ノーマルの記録より遅くても、ハードの中では自分の順位になる
    expect(saved.rankings.some((e) => e.teamName === `${tag}n`)).toBe(false);
    for (const [mode, name] of [
      ["normal", `${tag}n`],
      ["hard", `${tag}h`],
    ] as const) {
      const top = (await (
        await fetch(new URL(`/api/rankings?mode=${mode}&input=tilt`, serverUrl))
      ).json()) as RankingsResponse;
      expect(top.mode).toBe(mode);
      expect(top.rankings.filter((e) => e.teamName.startsWith(tag)).map((e) => e.teamName)).toEqual(
        [name],
      );
    }
  });

  // ローカルの Rate Limiting は時計の分の区切りで数え直すので、区切りをまたいでも断られるまで呼ぶ
  test("同じ IP から続けて保存すると、429（too-many-requests）で断る", async () => {
    const ip = crypto.randomUUID();
    let response: Response | undefined;
    for (let i = 0; i < 11; i++) {
      response = await submit(
        { mode: "normal", input: "tilt", teamName: "連打", timeMs: RANKING_MAX_TIME_MS },
        ip,
      );
      if (response.status === 429) break;
    }
    expect(response?.status).toBe(429);
    expect(response?.headers.get("Retry-After")).toBe("60");
    expect(await response?.json()).toEqual({ reason: "too-many-requests" });
  });
});
