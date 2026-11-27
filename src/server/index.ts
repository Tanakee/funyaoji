import { Hono, type Context } from "hono";
import type { CreateRoomRejected, CreateRoomResponse, PingResponse } from "../shared/api.ts";
import type { RejectedMessage } from "../shared/messages.ts";
import {
  isRoomCode,
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../shared/room.ts";

export { Room } from "./room.ts";
export { RoomGate } from "./room-gate.ts";

/** /api/ping の Durable Object の名前。小文字で、使わない文字の I を含むので、ルームコードと重ならない */
const PING_OBJECT_NAME = "ping";

/** ルームコードが重なったときに作り直す回数 */
const CREATE_ROOM_ATTEMPTS = 10;

/** 門番（RoomGate）の Durable Object の名前。Worker 全体で1つ */
const ROOM_GATE_NAME = "room-gate";

/**
 * 門番が「今日はもう作れない」と答えたとき、次に作れるようになる時刻（ミリ秒）。
 * この isolate のメモリに覚えておき、それまでは門番を呼ばずに断る（断るたびに Durable Object のリクエストを使わない）
 */
let roomGateClosedUntil = 0;

const app = new Hono<{ Bindings: Env }>();

app.get("/api/ping", async (c) => {
  const count = await c.executionCtx.exports.Room.getByName(PING_OBJECT_NAME).countCall();
  return c.json<PingResponse>({ count });
});

app.post("/api/rooms", async (c) => {
  const rejected = await rejectRoomCreation(c);
  if (rejected) return rejected;
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

/**
 * ルームを作るのを断るときは、429 のレスポンスを返す。作ってよければ undefined。
 * 先に IP ごとの連打を調べ（Durable Object を使わない）、通ったものだけ門番で1日の数を調べる
 */
async function rejectRoomCreation(c: Context<{ Bindings: Env }>): Promise<Response | undefined> {
  const ip = c.req.header("cf-connecting-ip") ?? "unknown";
  if (!(await c.env.ROOM_RATE_LIMIT.limit({ key: ip })).success) {
    console.log({ event: "rejected", reason: "too-many-requests" });
    return c.json<CreateRoomRejected>({ reason: "too-many-requests" }, 429, {
      "Retry-After": "60",
    });
  }
  let resetsAt = roomGateClosedUntil;
  // 断られた応答が届くまでに日付が変わっていたら、新しい日の分を聞き直す（1回で足りる）
  for (let attempt = 0; Date.now() >= resetsAt && attempt < 2; attempt++) {
    const result = await c.executionCtx.exports.RoomGate.getByName(ROOM_GATE_NAME).admit();
    if (result.admitted) return undefined;
    resetsAt = result.resetsAt;
  }
  if (resetsAt > Date.now()) roomGateClosedUntil = resetsAt;
  console.log({ event: "rejected", reason: "daily-limit" });
  const retryAfter = Math.max(1, Math.ceil((resetsAt - Date.now()) / 1000));
  return c.json<CreateRoomRejected>({ reason: "daily-limit" }, 429, {
    "Retry-After": String(retryAfter),
  });
}

function rejectNoRoom(): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.send(JSON.stringify({ type: "rejected", reason: "no-room" } satisfies RejectedMessage));
  server.close(4001, "no-room");
  return new Response(null, { status: 101, webSocket: client });
}

export default app;
