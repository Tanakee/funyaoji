import { afterEach, expect, inject, test } from "vite-plus/test";
import type { CreateRoomResponse } from "../shared/api.ts";
import {
  connectPhone,
  connectScreen,
  type Connection,
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
