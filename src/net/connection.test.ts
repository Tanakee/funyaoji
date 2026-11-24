import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  HEARTBEAT,
  HEARTBEAT_INTERVAL_MS,
  ServerToPhoneMessage,
  type PhoneToServerMessage,
} from "../shared/messages.ts";
import { connect, LIVENESS_TIMEOUT_MS } from "./connection.ts";
import type { TransportHandlers } from "./transport.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

test("開いているあいだ5秒ごとにハートビートを送り、閉じたら止める", () => {
  const sent: string[] = [];
  let handlers: TransportHandlers | undefined;
  const connection = connect<ServerToPhoneMessage, PhoneToServerMessage>({
    open: (h) => {
      handlers = h;
      return { send: (data) => sent.push(data) > 0, close: () => {} };
    },
    schema: ServerToPhoneMessage,
    onMessage: () => {},
  });

  handlers!.onOpen();
  vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
  handlers!.onMessage(HEARTBEAT);
  vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
  expect(sent).toEqual([HEARTBEAT, HEARTBEAT]);

  connection.close();
  expect(vi.getTimerCount()).toBe(0);
});

/** 開いたトランスポートを順に覚える、偽のトランスポート */
function connectFake() {
  const opened: { handlers: TransportHandlers; closed: boolean }[] = [];
  const received: unknown[] = [];
  const connection = connect<ServerToPhoneMessage, PhoneToServerMessage>({
    open(handlers) {
      const transport = { handlers, closed: false };
      opened.push(transport);
      return {
        send: () => true,
        close: () => {
          transport.closed = true;
        },
      };
    },
    schema: ServerToPhoneMessage,
    onMessage: (message) => received.push(message),
  });
  return { connection, opened, received };
}

const JOINED = JSON.stringify({ type: "joined", joint: "rightHip" });

test("思いがけず切れたら、1秒・2秒と待ってつなぎ直し、つながったあとのメッセージも渡す", () => {
  const { connection, opened, received } = connectFake();
  opened[0]!.handlers.onOpen();
  opened[0]!.handlers.onClose({ code: 1006, reason: "" });
  expect(connection.state).toEqual({ status: "reconnecting", attempt: 1 });

  vi.advanceTimersByTime(999);
  expect(opened).toHaveLength(1);
  vi.advanceTimersByTime(1);
  expect(opened).toHaveLength(2);
  opened[1]!.handlers.onClose({ code: 1006, reason: "" });
  expect(connection.state).toEqual({ status: "reconnecting", attempt: 2 });
  // 2回目は1回目より長く待つ
  vi.advanceTimersByTime(1000);
  expect(opened).toHaveLength(2);
  vi.advanceTimersByTime(1000);
  expect(opened).toHaveLength(3);

  opened[2]!.handlers.onOpen();
  opened[2]!.handlers.onMessage(JOINED);
  expect(connection.state).toEqual({ status: "open" });
  expect(received).toEqual([{ type: "joined", joint: "rightHip" }]);
  // 古いトランスポートから遅れて届いたものは捨てる
  opened[0]!.handlers.onMessage(JOINED);
  expect(received).toHaveLength(1);

  connection.close();
  expect(vi.getTimerCount()).toBe(0);
});

test("こちらから閉じたとき・no-room か full で断られたとき・4000 で閉じたときは、つなぎ直さない。playing で断られたときは、つなぎ直す", () => {
  const byClose = connectFake();
  byClose.opened[0]!.handlers.onOpen();
  byClose.connection.close();
  byClose.opened[0]!.handlers.onClose({ code: 1000, reason: "" });
  expect(byClose.connection.state).toEqual({ status: "closed", code: 1000, reason: "" });

  const results = [byClose];
  for (const reason of ["no-room", "full"]) {
    const rejected = connectFake();
    rejected.opened[0]!.handlers.onOpen();
    rejected.opened[0]!.handlers.onMessage(JSON.stringify({ type: "rejected", reason }));
    rejected.opened[0]!.handlers.onClose({ code: 4001, reason: "" });
    expect(rejected.connection.state).toEqual({ status: "closed", code: 4001, reason: "" });
    results.push(rejected);
  }

  const replaced = connectFake();
  replaced.opened[0]!.handlers.onOpen();
  replaced.opened[0]!.handlers.onClose({ code: 4000, reason: "" });
  expect(replaced.connection.state).toEqual({ status: "closed", code: 4000, reason: "" });
  results.push(replaced);

  const playing = connectFake();
  playing.opened[0]!.handlers.onOpen();
  playing.opened[0]!.handlers.onMessage(JSON.stringify({ type: "rejected", reason: "playing" }));
  playing.opened[0]!.handlers.onClose({ code: 4001, reason: "" });

  vi.advanceTimersByTime(60_000);
  for (const { opened } of results) expect(opened).toHaveLength(1);
  expect(playing.opened.length).toBeGreaterThan(1);
  playing.connection.close();
  expect(vi.getTimerCount()).toBe(0);
});

test("ハートビートの返事もほかのメッセージも10秒届かなければ、閉じてつなぎ直す", () => {
  const { connection, opened } = connectFake();
  opened[0]!.handlers.onOpen();
  vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS);
  opened[0]!.handlers.onMessage(HEARTBEAT);

  // 返事が届いてから10秒たつまでは切らない
  vi.advanceTimersByTime(LIVENESS_TIMEOUT_MS - 1);
  expect(connection.state).toEqual({ status: "open" });
  vi.advanceTimersByTime(1);
  expect(opened[0]!.closed).toBe(true);
  expect(connection.state).toEqual({ status: "reconnecting", attempt: 1 });

  vi.advanceTimersByTime(1000);
  expect(opened).toHaveLength(2);
  connection.close();
});
