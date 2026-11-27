import { Hono } from "hono";
import * as v from "valibot";
import {
  SubmitRankingRequest,
  type CreateRoomResponse,
  type PingResponse,
  type RankingsResponse,
  type SubmitRankingResponse,
} from "../shared/api.ts";
import { Mode, type RejectedMessage } from "../shared/messages.ts";
import {
  isRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../shared/room.ts";

export { Ranking } from "./ranking.ts";
export { Room } from "./room.ts";

/** /api/ping の Durable Object の名前。小文字で、使わない文字の I を含むので、ルームコードと重ならない */
const PING_OBJECT_NAME = "ping";

/** ランキングの Durable Object の名前。全体で1つ */
const RANKING_OBJECT_NAME = "rankings";

/** ルームコードが重なったときに作り直す回数 */
const CREATE_ROOM_ATTEMPTS = 10;

const app = new Hono<{ Bindings: Env }>();

app.get("/api/ping", async (c) => {
  const count = await c.executionCtx.exports.Room.getByName(PING_OBJECT_NAME).countCall();
  return c.json<PingResponse>({ count });
});

app.post("/api/rooms", async (c) => {
  for (let i = 0; i < CREATE_ROOM_ATTEMPTS; i++) {
    const roomCode = generateRoomCode();
    if (await c.executionCtx.exports.Room.getByName(roomCode).create(roomCode)) {
      return c.json<CreateRoomResponse>({ roomCode });
    }
  }
  return c.text("ルームを作れませんでした", 503);
});

app.get("/api/rooms/:roomCode/ws", (c) => {
  if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
    return c.text("WebSocket の接続が必要です", 426);
  }
  const role = c.req.query("role");
  if (role !== "screen" && role !== "phone") {
    return c.text("role には screen か phone を指定してください", 400);
  }
  const roomCode = normalizeRoomCode(c.req.param("roomCode"));
  if (!isRoomCode(roomCode)) {
    // ルームコードの形でなければ、Durable Object を作らずに断る
    console.log({ event: "rejected", reason: "no-room", invalid: true });
    return rejectNoRoom();
  }
  const url = new URL(c.req.url);
  url.searchParams.set("role", role);
  return c.executionCtx.exports.Room.getByName(roomCode).fetch(new Request(url, c.req.raw));
});

app.get("/api/rankings", async (c) => {
  const mode = v.safeParse(Mode, c.req.query("mode"));
  if (!mode.success) return c.text("mode には 10m を指定してください", 400);
  const rankings = await c.executionCtx.exports.Ranking.getByName(RANKING_OBJECT_NAME).getTop(
    mode.output,
  );
  return c.json<RankingsResponse>({ mode: mode.output, rankings });
});

// 乱用対策（Issue #66）を掛けるときは、この前にミドルウェアを足す。検査で断るものは Durable Object を呼ばない
app.post("/api/rankings", async (c) => {
  const body: unknown = await c.req.json().catch(() => undefined);
  const parsed = v.safeParse(SubmitRankingRequest, body);
  if (!parsed.success) {
    return c.text(`ランキングに保存できない値です：${parsed.issues[0].message}`, 400);
  }
  const result = await c.executionCtx.exports.Ranking.getByName(RANKING_OBJECT_NAME).submit(
    parsed.output,
  );
  // チーム名はログに書かない
  console.log({
    event: "ranking-saved",
    mode: parsed.output.mode,
    timeMs: parsed.output.timeMs,
    rank: result.entry.rank,
  });
  return c.json<SubmitRankingResponse>(result, 201);
});

/** 文字の出やすさが偏らないように、文字の数で割り切れない範囲の乱数は捨てて引き直す */
function generateRoomCode(): string {
  const size = ROOM_CODE_ALPHABET.length;
  const limit = 256 - (256 % size);
  let code = "";
  while (code.length < ROOM_CODE_LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH))) {
      if (b < limit && code.length < ROOM_CODE_LENGTH) code += ROOM_CODE_ALPHABET[b % size];
    }
  }
  return code;
}

function rejectNoRoom(): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.send(JSON.stringify({ type: "rejected", reason: "no-room" } satisfies RejectedMessage));
  server.close(4001, "no-room");
  return new Response(null, { status: 101, webSocket: client });
}

export default app;
