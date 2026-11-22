import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  HEARTBEAT,
  HEARTBEAT_INTERVAL_MS,
  ServerToPhoneMessage,
  type PhoneToServerMessage,
} from "../shared/messages.ts";
import { connect, type ConnectionState } from "./connection.ts";
import { FakeTransport } from "./fake-transport.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const transport = new FakeTransport();
  const received: unknown[] = [];
  const states: ConnectionState[] = [];
  const connection = connect<ServerToPhoneMessage, PhoneToServerMessage>({
    open: transport.open,
    schema: ServerToPhoneMessage,
    onMessage: (message) => received.push(message),
    onStateChange: (state) => states.push(state),
  });
  return { transport, received, states, connection };
}

describe("状態", () => {
  test("開くまでは connecting、開くと open、閉じると close コードを持つ closed になる", () => {
    const { transport, states, connection } = setup();
    expect(connection.state).toEqual({ status: "connecting" });
    transport.emitOpen();
    expect(connection.state).toEqual({ status: "open" });
    transport.emitClose({ code: 4002, reason: "" });
    expect(connection.state).toEqual({ status: "closed", code: 4002, reason: "" });
    expect(states).toEqual([{ status: "open" }, { status: "closed", code: 4002, reason: "" }]);
  });

  test("こちらから閉じると、すぐに closed になり、トランスポートを閉じる", () => {
    const { transport, connection } = setup();
    transport.emitOpen();
    connection.close();
    expect(connection.state).toEqual({ status: "closed", code: 1000, reason: "" });
    expect(transport.closeCalls).toBe(1);
    // あとからトランスポートが閉じたと知らせても、状態は変わらない
    transport.emitClose({ code: 1005, reason: "" });
    expect(connection.state).toEqual({ status: "closed", code: 1000, reason: "" });
  });

  test("開く前につながらなかったときも closed になる", () => {
    const { transport, connection } = setup();
    transport.emitClose({ code: 1006, reason: "" });
    expect(connection.state).toEqual({ status: "closed", code: 1006, reason: "" });
  });
});

describe("受信", () => {
  test("スキーマに合うメッセージを渡す", () => {
    const { transport, received } = setup();
    transport.emitOpen();
    transport.emitMessage({ type: "joined", joint: "leftKnee" });
    expect(received).toEqual([{ type: "joined", joint: "leftKnee" }]);
  });

  test("JSON でない・スキーマに合わない・相手が受け取らない種類のメッセージは捨てる", () => {
    const { transport, received } = setup();
    transport.emitOpen();
    transport.emitMessage("{");
    transport.emitMessage({ type: "joined", joint: "neck" });
    transport.emitMessage({ type: "tilt", seq: 1, angle: 10, joint: "rightHip" });
    expect(received).toEqual([]);
  });

  test("ハートビートの返事は渡さない", () => {
    const { transport, received } = setup();
    transport.emitOpen();
    transport.emitMessage(HEARTBEAT);
    expect(received).toEqual([]);
  });

  test("閉じたあとに届いたメッセージは渡さない", () => {
    const { transport, received, connection } = setup();
    transport.emitOpen();
    connection.close();
    transport.emitMessage({ type: "joined", joint: "leftKnee" });
    expect(received).toEqual([]);
  });
});

describe("送信", () => {
  test("メッセージを JSON にして送る", () => {
    const { transport, connection } = setup();
    transport.emitOpen();
    expect(connection.send({ type: "tilt", seq: 1, angle: 42 })).toBe(true);
    expect(transport.sent).toEqual(['{"type":"tilt","seq":1,"angle":42}']);
  });

  test("開く前と閉じたあとは送らずに false を返す", () => {
    const { transport, connection } = setup();
    expect(connection.send({ type: "pong", id: 1 })).toBe(false);
    transport.emitOpen();
    connection.close();
    expect(connection.send({ type: "pong", id: 1 })).toBe(false);
    expect(transport.sent).toEqual([]);
  });
});

describe("ハートビート", () => {
  test("開いているあいだ、5秒ごとに決まった文字列を送る", () => {
    const { transport } = setup();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    // 開く前は送らない
    expect(transport.sent).toEqual([]);
    transport.emitOpen();
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS - 1);
    expect(transport.sent).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(transport.sent).toEqual(['{"type":"heartbeat"}']);
    vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
    expect(transport.sent).toEqual(Array(3).fill('{"type":"heartbeat"}'));
  });

  test("ほかのメッセージを送っていても、ハートビートは止めない", () => {
    const { transport, connection } = setup();
    transport.emitOpen();
    for (let i = 0; i < HEARTBEAT_INTERVAL_MS / 100; i++) {
      connection.send({ type: "tilt", seq: i, angle: 0 });
      vi.advanceTimersByTime(100);
    }
    expect(transport.sent.filter((data) => data === HEARTBEAT)).toHaveLength(1);
  });

  test("サーバーが閉じたら止める", () => {
    const { transport } = setup();
    transport.emitOpen();
    transport.emitClose({ code: 4002, reason: "" });
    expect(vi.getTimerCount()).toBe(0);
  });

  test("こちらから閉じたら止める", () => {
    const { transport, connection } = setup();
    transport.emitOpen();
    connection.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
