import { afterEach, expect, inject, test } from "vite-plus/test";
import type { CreateRoomResponse } from "../shared/api.ts";
import {
  connectPhone,
  connectScreen,
  type Connection,
  type Latency,
  type PhoneReceived,
  type ScreenReceived,
} from "./client.ts";

// src/server/test-server.ts が立てた開発サーバーに、WebSocket のトランスポートでつなぐ
const serverUrl = inject("serverUrl");

/** メッセージが届くのを待つ時間 */
const TIMEOUT = 3000;

const openConnections = new Set<Connection<unknown>>();
afterEach(() => {
  for (const connection of openConnections) connection.close();
  openConnections.clear();
});

/** 届いたメッセージを順に取り出せるようにする */
class Inbox<T> {
  private readonly received: T[] = [];
  private waiting: ((message: T) => void) | undefined;

  readonly push = (message: T): void => {
    if (this.waiting) {
      this.waiting(message);
      this.waiting = undefined;
    } else {
      this.received.push(message);
    }
  };

  next(): Promise<T> {
    const message = this.received.shift();
    if (message !== undefined) return Promise.resolve(message);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting = undefined;
        reject(new Error("メッセージが届きません"));
      }, TIMEOUT);
      this.waiting = (message) => {
        clearTimeout(timer);
        resolve(message);
      };
    });
  }
}

async function createRoom(): Promise<string> {
  const response = await fetch(new URL("/api/rooms", serverUrl), { method: "POST" });
  expect(response.status).toBe(200);
  const { roomCode } = (await response.json()) as CreateRoomResponse;
  return roomCode;
}

test("スクリーンがスマホの tilt を受け取り、小さいシーケンス番号のものは捨てる", async () => {
  const roomCode = await createRoom();
  const screenInbox = new Inbox<ScreenReceived>();
  const screen = connectScreen(roomCode, { onMessage: screenInbox.push }, { baseUrl: serverUrl });
  openConnections.add(screen);
  expect(await screenInbox.next()).toEqual({ type: "room", roomCode, joints: [] });

  const phoneInbox = new Inbox<PhoneReceived>();
  const phone = connectPhone(roomCode, { onMessage: phoneInbox.push }, { baseUrl: serverUrl });
  openConnections.add(phone);
  expect(await phoneInbox.next()).toEqual({ type: "joined", joint: "rightHip" });
  expect(await screenInbox.next()).toEqual({ type: "room", roomCode, joints: ["rightHip"] });

  phone.send({ type: "tilt", seq: 2, angle: 20 });
  phone.send({ type: "tilt", seq: 1, angle: 10 });
  phone.send({ type: "tilt", seq: 3, angle: 30 });
  expect(await screenInbox.next()).toEqual({ type: "tilt", seq: 2, angle: 20, joint: "rightHip" });
  expect(await screenInbox.next()).toEqual({ type: "tilt", seq: 3, angle: 30, joint: "rightHip" });
});

test("スマホが抜けた関節に次のスマホが入ると、シーケンス番号 0 から受け取る", async () => {
  const roomCode = await createRoom();
  const screenInbox = new Inbox<ScreenReceived>();
  const screen = connectScreen(roomCode, { onMessage: screenInbox.push }, { baseUrl: serverUrl });
  openConnections.add(screen);
  expect(await screenInbox.next()).toEqual({ type: "room", roomCode, joints: [] });

  const firstInbox = new Inbox<PhoneReceived>();
  const first = connectPhone(roomCode, { onMessage: firstInbox.push }, { baseUrl: serverUrl });
  openConnections.add(first);
  expect(await firstInbox.next()).toEqual({ type: "joined", joint: "rightHip" });
  expect(await screenInbox.next()).toEqual({ type: "room", roomCode, joints: ["rightHip"] });
  first.send({ type: "tilt", seq: 100, angle: 10 });
  expect(await screenInbox.next()).toEqual({
    type: "tilt",
    seq: 100,
    angle: 10,
    joint: "rightHip",
  });

  first.close();
  expect(await screenInbox.next()).toEqual({ type: "room", roomCode, joints: [] });

  const secondInbox = new Inbox<PhoneReceived>();
  const second = connectPhone(roomCode, { onMessage: secondInbox.push }, { baseUrl: serverUrl });
  openConnections.add(second);
  expect(await secondInbox.next()).toEqual({ type: "joined", joint: "rightHip" });
  expect(await screenInbox.next()).toEqual({ type: "room", roomCode, joints: ["rightHip"] });
  second.send({ type: "tilt", seq: 0, angle: 20 });
  expect(await screenInbox.next()).toEqual({ type: "tilt", seq: 0, angle: 20, joint: "rightHip" });
});

test("スクリーンが ping を送り、スマホが自動で返した pong から関節ごとの遅延を出す", async () => {
  const roomCode = await createRoom();
  const screenInbox = new Inbox<ScreenReceived>();
  const latencyInbox = new Inbox<Partial<Record<string, Latency>>>();
  const screen = connectScreen(
    roomCode,
    { onMessage: screenInbox.push, onLatency: latencyInbox.push },
    { baseUrl: serverUrl },
  );
  openConnections.add(screen);
  expect(await screenInbox.next()).toEqual({ type: "room", roomCode, joints: [] });

  const phone = connectPhone(roomCode, { onMessage: () => {} }, { baseUrl: serverUrl });
  openConnections.add(phone);
  expect(await screenInbox.next()).toEqual({ type: "room", roomCode, joints: ["rightHip"] });

  // 1秒ごとに届く。最初は ping を送る前なので空
  let latency = await latencyInbox.next();
  while (latency.rightHip === undefined) latency = await latencyInbox.next();
  expect(latency.rightHip.latest).toBeGreaterThanOrEqual(0);
});
