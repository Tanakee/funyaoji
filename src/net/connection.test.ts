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
function connectFake(shouldReconnect?: () => boolean) {
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
    shouldReconnect,
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

test("shouldReconnect が false なら、トランスポートを開かずに閉じる", () => {
  let allowed = true;
  const { connection, opened } = connectFake(() => allowed);
  opened[0]!.handlers.onOpen();
  opened[0]!.handlers.onClose({ code: 1006, reason: "" });
  vi.advanceTimersByTime(1000);
  expect(opened).toHaveLength(2);

  opened[1]!.handlers.onClose({ code: 1006, reason: "" });
  expect(connection.state).toEqual({ status: "reconnecting", attempt: 2 });
  // つなぎ直すのを待っているあいだに false になったら、待ち終わったときに開かずに閉じる
  allowed = false;
  vi.advanceTimersByTime(2000);
  expect(opened).toHaveLength(2);
  expect(connection.state).toEqual({ status: "closed", code: 1000, reason: "" });
  expect(vi.getTimerCount()).toBe(0);
});

test("shouldReconnect が false なら、切れたときに待たずに閉じる。checkReconnect は待っているときだけ閉じる", () => {
  let allowed = true;
  const { connection, opened } = connectFake(() => allowed);
  opened[0]!.handlers.onOpen();
  opened[0]!.handlers.onClose({ code: 1006, reason: "" });
  vi.advanceTimersByTime(1000);
  // 開いている途中は、checkReconnect で閉じない
  allowed = false;
  connection.checkReconnect();
  expect(opened[1]!.closed).toBe(false);
  expect(connection.state).toEqual({ status: "reconnecting", attempt: 1 });
  opened[1]!.handlers.onClose({ code: 1006, reason: "" });
  expect(connection.state).toEqual({ status: "closed", code: 1000, reason: "" });
  expect(vi.getTimerCount()).toBe(0);

  // つなぎ直すのを待っているときは、checkReconnect で閉じる
  allowed = true;
  const waiting = connectFake(() => allowed);
  waiting.opened[0]!.handlers.onOpen();
  waiting.opened[0]!.handlers.onClose({ code: 1006, reason: "" });
  allowed = false;
  waiting.connection.checkReconnect();
  expect(waiting.connection.state).toEqual({ status: "closed", code: 1000, reason: "" });
  expect(waiting.opened).toHaveLength(1);
  expect(vi.getTimerCount()).toBe(0);
});

test("表に戻って待たずにつなぎ直すときも、shouldReconnect を聞く", async () => {
  const listeners = new Set<() => void>();
  const page = {
    visibilityState: "hidden",
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  // connection.ts は読み込んだときに document を覚えるので、差し替えてから読み込み直す
  vi.stubGlobal("document", page);
  vi.resetModules();
  try {
    const { connect: connectWithPage } = await import("./connection.ts");
    const opened: TransportHandlers[] = [];
    let allowed = true;
    const connection = connectWithPage<ServerToPhoneMessage, PhoneToServerMessage>({
      open(handlers) {
        opened.push(handlers);
        return { send: () => true, close: () => {} };
      },
      schema: ServerToPhoneMessage,
      onMessage: () => {},
      shouldReconnect: () => allowed,
    });
    opened[0]!.onOpen();
    opened[0]!.onClose({ code: 1006, reason: "" });
    expect(connection.state).toEqual({ status: "reconnecting", attempt: 1 });
    allowed = false;

    page.visibilityState = "visible";
    for (const listener of listeners) listener();
    expect(opened).toHaveLength(1);
    expect(connection.state).toEqual({ status: "closed", code: 1000, reason: "" });
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
