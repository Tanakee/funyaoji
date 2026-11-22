import { afterEach, describe, expect, inject, test } from "vite-plus/test";
import type { CreateRoomResponse, PingResponse } from "../shared/api.ts";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, isRoomCode } from "../shared/room.ts";

// src/server/test-server.ts が立てた開発サーバーに、HTTP と WebSocket でつないで確かめる
const serverUrl = inject("serverUrl");

/** メッセージが届くのを待つ時間 */
const TIMEOUT = 3000;

/** テストで開いた接続。テストが失敗しても、終わったら閉じる */
const openClients = new Set<Client>();
afterEach(() => {
  // 閉じるのを待たない。サーバーから閉じた接続は、開発サーバーでは close が届くのが遅いため
  for (const client of openClients) client.dispose();
  openClients.clear();
});

/** WebSocket の接続。届いたメッセージを順に取り出せる */
class Client {
  private readonly ws: WebSocket;
  private readonly received: unknown[] = [];
  private waiting: ((message: unknown) => void) | undefined;
  /** 閉じられたときの close コード */
  readonly closed: Promise<number>;

  constructor(roomCode: string, role: string) {
    const url = new URL(`/api/rooms/${roomCode}/ws?role=${role}`, serverUrl);
    url.protocol = "ws:";
    this.ws = new WebSocket(url);
    openClients.add(this);
    this.ws.addEventListener("message", (event) => {
      const message: unknown = JSON.parse(event.data as string);
      if (this.waiting) {
        this.waiting(message);
        this.waiting = undefined;
      } else {
        this.received.push(message);
      }
    });
    this.closed = new Promise((resolve) => {
      this.ws.addEventListener("close", (event) => resolve(event.code));
    });
  }

  /** 次のメッセージ。届いていなければ待つ */
  next(): Promise<unknown> {
    if (this.received.length > 0) return Promise.resolve(this.received.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        // あとから届いたメッセージを、待つのをやめたところに渡さない
        this.waiting = undefined;
        reject(new Error("メッセージが届きません"));
      }, TIMEOUT);
      this.waiting = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    });
  }

  /** まだ取り出していないメッセージの数 */
  get pending(): number {
    return this.received.length;
  }

  async send(data: string): Promise<void> {
    if (this.ws.readyState === WebSocket.CONNECTING) {
      await new Promise((resolve) => this.ws.addEventListener("open", resolve, { once: true }));
    }
    this.ws.send(data);
  }

  /** まだ開いていれば閉じる。閉じるのは待たない */
  dispose(): void {
    if (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  async close(): Promise<void> {
    this.ws.close();
    await this.closed;
  }
}

/** これまでに作ったルームのコード */
const createdRoomCodes = new Set<string>();

async function createRoom(): Promise<string> {
  const response = await fetch(new URL("/api/rooms", serverUrl), { method: "POST" });
  expect(response.status).toBe(200);
  const { roomCode } = (await response.json()) as CreateRoomResponse;
  createdRoomCodes.add(roomCode);
  return roomCode;
}

/** スクリーンと、関節がすべて埋まるまでのスマホ4台をつなぐ */
async function fillRoom(roomCode: string): Promise<{ screen: Client; phones: Client[] }> {
  const screen = new Client(roomCode, "screen");
  await screen.next();
  const phones: Client[] = [];
  for (let i = 0; i < 4; i++) {
    const phone = new Client(roomCode, "phone");
    await phone.next(); // joined
    await screen.next(); // room
    phones.push(phone);
  }
  return { screen, phones };
}

async function closeAll(clients: Client[]): Promise<void> {
  await Promise.all(clients.map((c) => c.close()));
}

describe("POST /api/rooms", () => {
  test("使える文字だけの4文字のルームコードを返す", async () => {
    const roomCode = await createRoom();
    expect(roomCode).toHaveLength(ROOM_CODE_LENGTH);
    for (const char of roomCode) expect(ROOM_CODE_ALPHABET).toContain(char);
  });

  test("作るたびに別のルームコードを返す", async () => {
    const codes = await Promise.all([createRoom(), createRoom(), createRoom()]);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("GET /api/ping", () => {
  test("呼ぶたびに回数が増える", async () => {
    const ping = async () =>
      ((await (await fetch(new URL("/api/ping", serverUrl))).json()) as PingResponse).count;
    const first = await ping();
    expect(await ping()).toBe(first + 1);
  });
});

describe("GET /api/rooms/:roomCode/ws", () => {
  test("Upgrade のヘッダーが無ければ 426 を返す", async () => {
    const roomCode = await createRoom();
    const response = await fetch(new URL(`/api/rooms/${roomCode}/ws?role=phone`, serverUrl));
    expect(response.status).toBe(426);
  });

  test("スクリーンがつなぐと、room が届く", async () => {
    const roomCode = await createRoom();
    const screen = new Client(roomCode, "screen");
    expect(await screen.next()).toEqual({ type: "room", roomCode, joints: [] });
    await screen.close();
  });

  test("スマホには、つないだ順に rightHip・leftHip・rightKnee・leftKnee を割り当てる", async () => {
    const roomCode = await createRoom();
    const screen = new Client(roomCode, "screen");
    await screen.next();
    const expected = ["rightHip", "leftHip", "rightKnee", "leftKnee"];
    const phones: Client[] = [];
    for (const [i, joint] of expected.entries()) {
      const phone = new Client(roomCode, "phone");
      phones.push(phone);
      expect(await phone.next()).toEqual({ type: "joined", joint });
      const room = { type: "room", roomCode, joints: expected.slice(0, i + 1) };
      expect(await phone.next()).toEqual(room);
      expect(await screen.next()).toEqual(room);
    }
    // 前からいるスマホにも、参加者が変わるたびに room が届く
    for (const [i, phone] of phones.entries()) {
      for (let n = i + 2; n <= expected.length; n++) {
        expect(await phone.next()).toEqual({
          type: "room",
          roomCode,
          joints: expected.slice(0, n),
        });
      }
    }
    await closeAll([screen, ...phones]);
  });

  test("ルームコードは小文字でも受け付ける", async () => {
    const roomCode = await createRoom();
    const phone = new Client(roomCode.toLowerCase(), "phone");
    expect(await phone.next()).toEqual({ type: "joined", joint: "rightHip" });
    expect(await phone.next()).toEqual({ type: "room", roomCode, joints: ["rightHip"] });
    await phone.close();
  });

  test("5台目のスマホは full で断り、4001 で閉じる", async () => {
    const roomCode = await createRoom();
    const { screen, phones } = await fillRoom(roomCode);
    const fifth = new Client(roomCode, "phone");
    expect(await fifth.next()).toEqual({ type: "rejected", reason: "full" });
    expect(await fifth.closed).toBe(4001);
    await closeAll([screen, ...phones]);
  });

  test("無いルームには、no-room で断り、4001 で閉じる", async () => {
    // 作っていないルームと、ルームコードの形でないもの
    const notCreated = ["ZZZZ", "YYYY", "XXXX"].find((code) => !createdRoomCodes.has(code))!;
    expect(isRoomCode(notCreated)).toBe(true);
    for (const roomCode of [notCreated, "ABC"]) {
      for (const role of ["screen", "phone"]) {
        const client = new Client(roomCode, role);
        expect(await client.next()).toEqual({ type: "rejected", reason: "no-room" });
        expect(await client.closed).toBe(4001);
      }
    }
  });

  test("スマホの tilt を、担当の関節を付けてスクリーンに送る。別の関節が書かれていても上書きする", async () => {
    const roomCode = await createRoom();
    const { screen, phones } = await fillRoom(roomCode);
    // phones[2] の担当は rightKnee
    await phones[2]!.send(JSON.stringify({ type: "tilt", seq: 1, angle: 10, joint: "leftHip" }));
    expect(await screen.next()).toEqual({ type: "tilt", seq: 1, angle: 10, joint: "rightKnee" });
    await closeAll([screen, ...phones]);
  });

  test("形の正しくないメッセージは捨てる", async () => {
    const roomCode = await createRoom();
    const { screen, phones } = await fillRoom(roomCode);
    const phone = phones[0]!;
    for (const data of [
      "not json",
      JSON.stringify({ type: "tilt", seq: 1, angle: "x" }),
      '{"type":"tilt","seq":2,"angle":1e309}',
      JSON.stringify({ type: "unknown" }),
    ]) {
      await phone.send(data);
    }
    // 1つの接続のメッセージは順に処理されるので、最後に送った正しい tilt だけが届けばよい
    await phone.send(JSON.stringify({ type: "tilt", seq: 3, angle: -5 }));
    expect(await screen.next()).toEqual({ type: "tilt", seq: 3, angle: -5, joint: "rightHip" });
    expect(screen.pending).toBe(0);
    await closeAll([screen, ...phones]);
  });

  test("スマホが切れると関節を空け、room を送り直す。次のスマホは空いた関節に入る", async () => {
    const roomCode = await createRoom();
    const { screen, phones } = await fillRoom(roomCode);
    await phones[1]!.close(); // leftHip
    const room = { type: "room", roomCode, joints: ["rightHip", "rightKnee", "leftKnee"] };
    expect(await screen.next()).toEqual(room);

    const again = new Client(roomCode, "phone");
    expect(await again.next()).toEqual({ type: "joined", joint: "leftHip" });
    expect(await screen.next()).toEqual({
      type: "room",
      roomCode,
      joints: ["rightHip", "leftHip", "rightKnee", "leftKnee"],
    });
    await closeAll([screen, phones[0]!, phones[2]!, phones[3]!, again]);
  });

  test("スクリーンがつなぎ直すと、新しい接続に room を送り、tilt は新しい接続にだけ送る", async () => {
    const roomCode = await createRoom();
    const { screen, phones } = await fillRoom(roomCode);
    const screen2 = new Client(roomCode, "screen");
    expect(await screen2.next()).toEqual({
      type: "room",
      roomCode,
      joints: ["rightHip", "leftHip", "rightKnee", "leftKnee"],
    });
    await phones[3]!.send(JSON.stringify({ type: "tilt", seq: 1, angle: 0 }));
    expect(await screen2.next()).toEqual({ type: "tilt", seq: 1, angle: 0, joint: "leftKnee" });
    // 古い接続に遅れて届かないことを確かめるため、少し待つ
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(screen.pending).toBe(0);
    // 古い接続は、開発サーバーでは閉じたことが届かない（下の skip を参照）ので、閉じ終わるのを待たない
    void screen.close();
    await closeAll([screen2, ...phones]);
  });

  // 開発サーバー（@cloudflare/vite-plugin）では、Durable Object が Hibernation の接続を閉じても、
  // クライアントに close が届かない。本番で確かめるまで飛ばす
  test.skip("スクリーンがつなぎ直すと、古い接続を 4000 で閉じる", async () => {
    const roomCode = await createRoom();
    const screen = new Client(roomCode, "screen");
    await screen.next();
    const screen2 = new Client(roomCode, "screen");
    await screen2.next();
    expect(await screen.closed).toBe(4000);
    await screen2.close();
  });
});
