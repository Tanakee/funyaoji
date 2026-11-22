import { describe, expect, test } from "vite-plus/test";
import {
  connectPhone,
  connectScreen,
  roomSocketUrl,
  type PhoneReceived,
  type ScreenReceived,
} from "./client.ts";
import { FakeTransport } from "./fake-transport.ts";

describe("roomSocketUrl", () => {
  test("http のページからは ws で、role を付けてつなぐ", () => {
    expect(roomSocketUrl("http://localhost:5173/screen", "K7Q2", "screen").href).toBe(
      "ws://localhost:5173/api/rooms/K7Q2/ws?role=screen",
    );
  });

  test("https のページからは wss でつなぐ", () => {
    expect(roomSocketUrl("https://example.com/play?room=K7Q2", "K7Q2", "phone").href).toBe(
      "wss://example.com/api/rooms/K7Q2/ws?role=phone",
    );
  });
});

describe("connectScreen", () => {
  function setup() {
    const transport = new FakeTransport();
    const received: ScreenReceived[] = [];
    const connection = connectScreen(
      "K7Q2",
      { onMessage: (message) => received.push(message) },
      { baseUrl: "http://localhost:5173/screen", transport: transport.factory },
    );
    transport.emitOpen();
    return { transport, received, connection };
  }

  test("role=screen の URL でトランスポートを開く", () => {
    const { transport } = setup();
    expect(transport.url?.href).toBe("ws://localhost:5173/api/rooms/K7Q2/ws?role=screen");
  });

  test("関節ごとに、受信済みより小さいシーケンス番号の tilt を捨てる", () => {
    const { transport, received } = setup();
    transport.emitMessage({ type: "tilt", seq: 2, angle: 20, joint: "rightHip" });
    transport.emitMessage({ type: "tilt", seq: 1, angle: 10, joint: "rightHip" });
    transport.emitMessage({ type: "tilt", seq: 1, angle: 30, joint: "leftHip" });
    transport.emitMessage({ type: "tilt", seq: 3, angle: 40, joint: "rightHip" });
    expect(received).toEqual([
      { type: "tilt", seq: 2, angle: 20, joint: "rightHip" },
      { type: "tilt", seq: 1, angle: 30, joint: "leftHip" },
      { type: "tilt", seq: 3, angle: 40, joint: "rightHip" },
    ]);
  });

  test("関節のスマホが抜けたら、次に入ったスマホの小さい番号を受け取る", () => {
    const { transport, received } = setup();
    transport.emitMessage({ type: "tilt", seq: 500, angle: 20, joint: "rightHip" });
    transport.emitMessage({ type: "room", roomCode: "K7Q2", joints: [] });
    transport.emitMessage({ type: "room", roomCode: "K7Q2", joints: ["rightHip"] });
    transport.emitMessage({ type: "tilt", seq: 0, angle: 10, joint: "rightHip" });
    expect(received.at(-1)).toEqual({ type: "tilt", seq: 0, angle: 10, joint: "rightHip" });
  });

  test("joint の無い tilt（スマホの送る形）は捨てる", () => {
    const { transport, received } = setup();
    transport.emitMessage({ type: "tilt", seq: 1, angle: 10 });
    expect(received).toEqual([]);
  });

  test("ScreenToServerMessage を送れる", () => {
    const { transport, connection } = setup();
    connection.send({ type: "phase", phase: "lobby" });
    expect(transport.sent).toEqual(['{"type":"phase","phase":"lobby"}']);
  });
});

describe("connectPhone", () => {
  test("role=phone の URL で開き、スマホが受け取るメッセージだけを渡す", () => {
    const transport = new FakeTransport();
    const received: PhoneReceived[] = [];
    connectPhone(
      "K7Q2",
      { onMessage: (message) => received.push(message) },
      { baseUrl: "http://localhost:5173/play?room=K7Q2", transport: transport.factory },
    );
    expect(transport.url?.href).toBe("ws://localhost:5173/api/rooms/K7Q2/ws?role=phone");
    transport.emitOpen();
    transport.emitMessage({ type: "joined", joint: "rightHip" });
    transport.emitMessage({ type: "ping", id: 1, joint: "rightHip" });
    // スクリーンが受け取る種類は捨てる
    transport.emitMessage({ type: "pong", id: 1, joint: "rightHip" });
    expect(received).toEqual([
      { type: "joined", joint: "rightHip" },
      { type: "ping", id: 1, joint: "rightHip" },
    ]);
  });
});
