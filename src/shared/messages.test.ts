import * as v from "valibot";
import { describe, expect, test } from "vite-plus/test";
import {
  JOINTS,
  PhoneToServerMessage,
  ScreenToServerMessage,
  ServerToPhoneMessage,
  ServerToScreenMessage,
} from "./messages.ts";

const directions = {
  ServerToPhoneMessage,
  ServerToScreenMessage,
  PhoneToServerMessage,
  ScreenToServerMessage,
};
type Direction = keyof typeof directions;

function acceptedBy(message: unknown): Direction[] {
  return (Object.keys(directions) as Direction[]).filter(
    (name) => v.safeParse(directions[name], message).success,
  );
}

// docs/api.md の例と、フィールドの表から作った例。期待する送信方向は、メッセージの表（送信元 → 送信先）から取る
const accepted: { name: string; message: unknown; directions: Direction[] }[] = [
  {
    name: "joined",
    message: { type: "joined", joint: "rightHip" },
    directions: ["ServerToPhoneMessage"],
  },
  {
    name: "rejected",
    message: { type: "rejected", reason: "full" },
    directions: ["ServerToPhoneMessage"],
  },
  {
    name: "rejected: playing",
    message: { type: "rejected", reason: "playing" },
    directions: ["ServerToPhoneMessage"],
  },
  {
    name: "rejected: no-room",
    message: { type: "rejected", reason: "no-room" },
    directions: ["ServerToPhoneMessage"],
  },
  {
    name: "room",
    message: { type: "room", roomCode: "K7Q2", joints: ["rightHip", "leftHip"] },
    directions: ["ServerToPhoneMessage", "ServerToScreenMessage"],
  },
  {
    name: "phase: lobby",
    message: { type: "phase", phase: "lobby" },
    directions: ["ServerToPhoneMessage", "ScreenToServerMessage"],
  },
  {
    name: "phase: playing",
    message: { type: "phase", phase: "playing", mode: "10m" },
    directions: ["ServerToPhoneMessage", "ScreenToServerMessage"],
  },
  {
    name: "phase: result (goal)",
    message: {
      type: "phase",
      phase: "result",
      result: { outcome: "goal", distanceM: 10, timeMs: 32500 },
    },
    directions: ["ServerToPhoneMessage", "ScreenToServerMessage"],
  },
  {
    name: "phase: result (fell, 後ろに進むと負の距離)",
    message: { type: "phase", phase: "result", result: { outcome: "fell", distanceM: -1.5 } },
    directions: ["ServerToPhoneMessage", "ScreenToServerMessage"],
  },
  {
    name: "phase: result (timeout)",
    message: { type: "phase", phase: "result", result: { outcome: "timeout", distanceM: 6 } },
    directions: ["ServerToPhoneMessage", "ScreenToServerMessage"],
  },
  {
    name: "phase: result (disconnected)",
    message: { type: "phase", phase: "result", result: { outcome: "disconnected", distanceM: 3 } },
    directions: ["ServerToPhoneMessage", "ScreenToServerMessage"],
  },
  {
    name: "tilt (スマホの送信)",
    message: { type: "tilt", seq: 128, angle: 42 },
    directions: ["PhoneToServerMessage"],
  },
  {
    name: "tilt (スクリーンの受信)",
    message: { type: "tilt", seq: 128, angle: 42, joint: "rightHip" },
    // サーバーは、スマホが付けた joint を捨てて受け取る
    directions: ["ServerToScreenMessage", "PhoneToServerMessage"],
  },
  {
    name: "status",
    message: { type: "status", active: ["rightHip", "leftKnee"] },
    directions: ["ServerToPhoneMessage", "ScreenToServerMessage"],
  },
  {
    name: "ping",
    message: { type: "ping", id: 7, joint: "rightHip" },
    directions: ["ServerToPhoneMessage", "ScreenToServerMessage"],
  },
  {
    name: "pong (スマホの送信)",
    message: { type: "pong", id: 7 },
    directions: ["PhoneToServerMessage"],
  },
  {
    name: "pong (スクリーンの受信)",
    message: { type: "pong", id: 7, joint: "rightHip" },
    directions: ["ServerToScreenMessage", "PhoneToServerMessage"],
  },
];

const rejected: { name: string; message: unknown }[] = [
  { name: "未知の type", message: { type: "hello" } },
  { name: "type が無い", message: { seq: 1, angle: 0 } },
  { name: "オブジェクトではない", message: "tilt" },
  { name: "未知の joint (joined)", message: { type: "joined", joint: "head" } },
  { name: "未知の joint (room)", message: { type: "room", roomCode: "K7Q2", joints: ["head"] } },
  { name: "joint が無い (joined)", message: { type: "joined" } },
  { name: "joint が無い (ping)", message: { type: "ping", id: 7 } },
  { name: "未知の reason", message: { type: "rejected", reason: "banned" } },
  { name: "phase が未知", message: { type: "phase", phase: "paused" } },
  { name: "playing に mode が無い", message: { type: "phase", phase: "playing" } },
  { name: "playing の mode が 10m 以外", message: { type: "phase", phase: "playing", mode: "5m" } },
  { name: "result に result が無い", message: { type: "phase", phase: "result" } },
  {
    name: "goal に timeMs が無い",
    message: { type: "phase", phase: "result", result: { outcome: "goal", distanceM: 10 } },
  },
  {
    name: "未知の outcome",
    message: { type: "phase", phase: "result", result: { outcome: "quit", distanceM: 1 } },
  },
  {
    name: "distanceM が数値ではない",
    message: { type: "phase", phase: "result", result: { outcome: "fell", distanceM: "1" } },
  },
  { name: "angle が数値ではない", message: { type: "tilt", seq: 1, angle: "42" } },
];

describe("メッセージのスキーマ", () => {
  test("関節の順番は参加順の割り当て", () => {
    expect(JOINTS).toEqual(["rightHip", "leftHip", "rightKnee", "leftKnee"]);
  });

  test.each(accepted)("$name は、メッセージの表にある送信方向だけが受け入れる", (c) => {
    expect(acceptedBy(c.message)).toEqual(c.directions);
  });

  test.each(rejected)("$name は、どの送信方向でも拒否する", (c) => {
    expect(acceptedBy(c.message)).toEqual([]);
  });

  test("スクリーンが受信する tilt は joint が無いと拒否する", () => {
    const result = v.safeParse(ServerToScreenMessage, { type: "tilt", seq: 128, angle: 42 });
    expect(result.success).toBe(false);
  });

  test("スクリーンが受信する tilt は、未知の joint を拒否する", () => {
    const result = v.safeParse(ServerToScreenMessage, {
      type: "tilt",
      seq: 1,
      angle: 0,
      joint: "head",
    });
    expect(result.success).toBe(false);
  });

  test("スマホが joint を付けて tilt を送っても、サーバーが受け取る値には joint が残らない", () => {
    const result = v.parse(PhoneToServerMessage, {
      type: "tilt",
      seq: 1,
      angle: 10,
      joint: "leftKnee",
    });
    expect(result).toEqual({ type: "tilt", seq: 1, angle: 10 });
  });
});
