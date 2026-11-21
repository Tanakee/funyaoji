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
    directions: ["ServerToPhoneMessage", "ServerToScreenMessage"],
  },
  {
    name: "rejected: playing",
    message: { type: "rejected", reason: "playing" },
    directions: ["ServerToPhoneMessage", "ServerToScreenMessage"],
  },
  {
    name: "rejected: no-room",
    message: { type: "rejected", reason: "no-room" },
    directions: ["ServerToPhoneMessage", "ServerToScreenMessage"],
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

// フィールドを1つ消した形と、1つを null にした形。result の中のフィールドも対象にする
function brokenForms(message: object): { label: string; message: unknown }[] {
  const forms: { label: string; message: unknown }[] = [];
  for (const [key, value] of Object.entries(message)) {
    const { [key]: _removed, ...rest } = message as Record<string, unknown>;
    forms.push({ label: `${key} が無い`, message: rest });
    forms.push({ label: `${key} が null`, message: { ...message, [key]: null } });
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const form of brokenForms(value)) {
        forms.push({ label: `${key}.${form.label}`, message: { ...message, [key]: form.message } });
      }
    }
  }
  return forms;
}

const broken = accepted.flatMap((c) =>
  brokenForms(c.message as object).map((form) => ({
    name: `${c.name}: ${form.label}`,
    message: form.message,
    directions: c.directions,
  })),
);

const rejected: { name: string; message: unknown }[] = [
  { name: "未知の type", message: { type: "hello" } },
  { name: "type が無い", message: { seq: 1, angle: 0 } },
  { name: "オブジェクトではない", message: "tilt" },
  { name: "未知の joint (joined)", message: { type: "joined", joint: "head" } },
  { name: "未知の joint (room)", message: { type: "room", roomCode: "K7Q2", joints: ["head"] } },
  { name: "未知の joint (ping)", message: { type: "ping", id: 7, joint: "head" } },
  { name: "未知の joint (status)", message: { type: "status", active: ["head"] } },
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

  // 必須のフィールドが欠けたメッセージを、元と同じ送信方向がすべて受け入れることは無い
  test.each(broken)("$name は、受け入れる送信方向が減る", (c) => {
    const still = acceptedBy(c.message);
    expect(c.directions).toEqual(expect.arrayContaining(still));
    expect(still.length).toBeLessThan(c.directions.length);
  });

  test.each(rejected)("$name は、どの送信方向でも拒否する", (c) => {
    expect(acceptedBy(c.message)).toEqual([]);
  });

  test("スクリーンが受信する tilt は joint が無いと拒否する", () => {
    const result = v.safeParse(ServerToScreenMessage, { type: "tilt", seq: 128, angle: 42 });
    expect(result.success).toBe(false);
  });

  test.each([
    { name: "tilt", message: { type: "tilt", seq: 1, angle: 0, joint: "head" } },
    { name: "pong", message: { type: "pong", id: 7, joint: "head" } },
  ])("スクリーンが受信する $name は、未知の joint を拒否する", (c) => {
    expect(v.safeParse(ServerToScreenMessage, c.message).success).toBe(false);
  });

  test.each([
    { name: "seq", text: '{"type":"tilt","seq":1e999,"angle":42}' },
    { name: "angle", text: '{"type":"tilt","seq":1,"angle":-1e999}' },
  ])("JSON で有限でない数になる $name の tilt は、サーバーが拒否する", (c) => {
    expect(v.safeParse(PhoneToServerMessage, JSON.parse(c.text)).success).toBe(false);
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
