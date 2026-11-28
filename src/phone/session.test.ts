import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { TransportHandlers } from "../net/transport.ts";
import type { PhoneEvent } from "./model.ts";
import { startSession } from "./session.ts";

const opened: { handlers: TransportHandlers; closed: boolean; sent: string[] }[] = [];

vi.mock("../net/client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../net/client.ts")>();
  return {
    ...actual,
    connectPhone: (...[room, handlers, options]: Parameters<typeof actual.connectPhone>) =>
      actual.connectPhone(room, handlers, {
        ...options,
        transport: () => (handlers) => {
          const transport = { handlers, closed: false, sent: [] as string[] };
          opened.push(transport);
          return {
            send: (data) => {
              transport.sent.push(data);
              return true;
            },
            close: () => {
              transport.closed = true;
            },
          };
        },
      }),
  };
});
vi.mock("./tilt.ts", () => ({
  startReadingTilt: () => () => {},
  startSendingTilt: () => () => {},
  setLatestAngle: () => {},
}));
vi.mock("./wakeLock.ts", () => ({ holdWakeLock: () => () => {} }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("location", { href: "http://localhost/play.html?room=K7Q2" });
  opened.length = 0;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const JOINED = JSON.stringify({ type: "joined", joint: "rightHip" });

test.each([
  { name: "未確認", ready: [], sendsAgain: true },
  { name: "確認済み", ready: ["rightHip"], sendsAgain: false },
  { name: "遊び方が終了", ready: undefined, sendsAgain: false },
])("準備OKが $name のときに同じ関節につなぎ直す", ({ ready, sendsAgain }) => {
  const session = startSession("K7Q2", () => {});
  const first = opened[0]!;
  first.handlers.onOpen();
  first.handlers.onMessage(JOINED);
  first.handlers.onMessage(JSON.stringify({ type: "howto", ready: [] }));
  if (ready !== undefined) {
    expect(session.send({ type: "ready" })).toBe(true);
    expect(first.sent).toEqual(['{"type":"ready"}']);
  }
  first.handlers.onClose({ code: 1006, reason: "" });
  if (ready === undefined) expect(session.send({ type: "ready" })).toBe(false);

  vi.advanceTimersByTime(1_000);
  const again = opened[1]!;
  again.handlers.onOpen();
  again.handlers.onMessage(JOINED);
  again.handlers.onMessage(JSON.stringify({ type: "phase", phase: "lobby", input: "tilt" }));
  if (ready !== undefined) again.handlers.onMessage(JSON.stringify({ type: "howto", ready }));
  expect(again.sent).toEqual(sendsAgain ? ['{"type":"ready"}'] : []);
  again.handlers.onMessage(
    JSON.stringify({ type: "room", roomCode: "K7Q2", joints: ["rightHip"] }),
  );

  if (ready !== undefined) {
    again.handlers.onMessage(JSON.stringify({ type: "howto", ready: ["rightHip"] }));
    expect(again.sent).toHaveLength(sendsAgain ? 1 : 0);
  }
  again.handlers.onMessage(JSON.stringify({ type: "phase", phase: "lobby", input: "tilt" }));
  again.handlers.onMessage(JSON.stringify({ type: "howto", ready: [] }));
  expect(again.sent).toHaveLength(sendsAgain ? 1 : 0);
  session.stop();
});

test("別の関節につなぎ直したときは準備OKを送り直さない", () => {
  const session = startSession("K7Q2", () => {});
  const first = opened[0]!;
  first.handlers.onOpen();
  first.handlers.onMessage(JOINED);
  first.handlers.onMessage(JSON.stringify({ type: "howto", ready: [] }));
  expect(session.send({ type: "ready" })).toBe(true);
  expect(first.sent).toEqual(['{"type":"ready"}']);
  first.handlers.onClose({ code: 1006, reason: "" });
  vi.advanceTimersByTime(1_000);
  const again = opened[1]!;
  again.handlers.onOpen();
  again.handlers.onMessage(JSON.stringify({ type: "joined", joint: "leftHip" }));
  again.handlers.onMessage(JSON.stringify({ type: "howto", ready: [] }));
  expect(again.sent).toEqual([]);
  session.stop();
});

test("抜けるの受け付けを待つあいだに切れたら、joined を受け取り直して leave を送る", () => {
  const session = startSession("K7Q2", () => {});
  const first = opened[0]!;
  first.handlers.onOpen();
  first.handlers.onMessage(JOINED);
  first.handlers.onMessage(JSON.stringify({ type: "howto", ready: [] }));
  session.leave();
  session.leave();
  expect(session.send({ type: "start" })).toBe(false);
  expect(session.send({ type: "retry" })).toBe(false);
  expect(session.send({ type: "ready" })).toBe(false);
  expect(first.sent).toEqual(['{"type":"leave"}']);
  expect(first.closed).toBe(false);

  first.handlers.onClose({ code: 1006, reason: "" });
  vi.advanceTimersByTime(1_000);
  const next = opened[1]!;
  next.handlers.onOpen();
  expect(next.sent).toEqual([]);
  next.handlers.onMessage(JOINED);
  next.handlers.onMessage(JSON.stringify({ type: "howto", ready: [] }));
  expect(next.sent).toEqual(['{"type":"leave"}']);
  session.stop();
});

test("抜けるを押してからつなぎ直して列に並べられたら、queued を渡して leave を送り直す", () => {
  const events: PhoneEvent[] = [];
  const session = startSession("K7Q2", (event) => events.push(event));
  opened[0]!.handlers.onOpen();
  opened[0]!.handlers.onMessage(JOINED);
  session.leave();
  opened[0]!.handlers.onClose({ code: 1006, reason: "" });
  vi.advanceTimersByTime(1_000);
  const next = opened[1]!;
  next.handlers.onOpen();
  next.handlers.onMessage(JSON.stringify({ type: "queued", reason: "playing" }));
  expect(events.at(-1)).toMatchObject({
    type: "message",
    message: { type: "queued", reason: "playing" },
  });
  expect(next.sent).toEqual(['{"type":"leave"}']);
  next.handlers.onMessage(JSON.stringify({ type: "left" }));
  expect(events.at(-1)).toMatchObject({ type: "connection", state: { status: "closed" } });
  vi.advanceTimersByTime(60_000);
  expect(opened).toHaveLength(2);
  session.stop();
});

test("順番待ちをやめると、leave を送ってから閉じる", () => {
  const session = startSession("K7Q2", () => {});
  opened[0]!.handlers.onOpen();
  opened[0]!.handlers.onMessage(JSON.stringify({ type: "queued", reason: "full" }));
  session.withdraw();
  expect(opened[0]!.sent).toEqual(['{"type":"leave"}']);
  expect(opened[0]!.closed).toBe(true);
  vi.advanceTimersByTime(60_000);
  expect(opened).toHaveLength(1);
});

function joinThenDrop() {
  const events: PhoneEvent[] = [];
  const session = startSession("K7Q2", (event) => events.push(event));
  opened[0]!.handlers.onOpen();
  opened[0]!.handlers.onMessage(JOINED);
  opened[0]!.handlers.onClose({ code: 1006, reason: "" });
  const closed = () => events.some((e) => e.type === "connection" && e.state.status === "closed");
  return { events, stop: () => session.stop(), closed };
}

test("60秒たっても戻れなければ閉じる。そのあとはトランスポートを開かない", () => {
  const { stop, closed } = joinThenDrop();
  // 開かないトランスポートは LIVENESS_TIMEOUT_MS で切れる
  vi.advanceTimersByTime(59_999);
  expect(closed()).toBe(false);
  vi.advanceTimersByTime(1);
  expect(closed()).toBe(true);
  const count = opened.length;
  vi.advanceTimersByTime(60_000);
  expect(opened).toHaveLength(count);
  stop();
});

test("60秒より前に開き始めたトランスポートは、60秒で切らずに結果を待つ", () => {
  const { stop, closed } = joinThenDrop();
  // 8回目は55秒に開き始める
  vi.advanceTimersByTime(1_000);
  for (const [i, delay] of [2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000].entries()) {
    opened[i + 1]!.handlers.onClose({ code: 1006, reason: "" });
    vi.advanceTimersByTime(delay);
  }
  const last = opened.at(-1)!;
  expect(opened).toHaveLength(9);
  vi.advanceTimersByTime(5_500); // 60.5秒
  expect(last.closed).toBe(false);
  expect(closed()).toBe(false);
  last.handlers.onOpen();
  last.handlers.onMessage(JOINED);
  expect(closed()).toBe(false);
  stop();
});

test("参加していたスマホが、つなぎ直して列に並べられたら、60秒で諦めずに列で待つ", () => {
  const { stop, closed } = joinThenDrop();
  vi.advanceTimersByTime(1_000);
  for (const [i, delay] of [2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000].entries()) {
    opened[i + 1]!.handlers.onClose({ code: 1006, reason: "" });
    vi.advanceTimersByTime(delay);
  }
  vi.advanceTimersByTime(5_500); // 60.5秒
  const last = opened.at(-1)!;
  last.handlers.onOpen();
  last.handlers.onMessage(JSON.stringify({ type: "queued", reason: "full" }));
  // ハートビートの返事が届くあいだは、つないだまま待つ
  for (let i = 0; i < 8; i++) {
    vi.advanceTimersByTime(9_000);
    last.handlers.onMessage(JSON.stringify({ type: "heartbeat" }));
  }
  expect(closed()).toBe(false);
  expect(last.closed).toBe(false);
  // 列で待つあいだに切れても、つなぎ直す
  last.handlers.onClose({ code: 1006, reason: "" });
  vi.advanceTimersByTime(1_000);
  expect(opened).toHaveLength(10);
  expect(closed()).toBe(false);
  stop();
});

test("60秒より前に開き始めたトランスポートが失敗したら、すぐ閉じる", () => {
  const { stop, closed } = joinThenDrop();
  vi.advanceTimersByTime(1_000);
  for (const [i, delay] of [2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000].entries()) {
    opened[i + 1]!.handlers.onClose({ code: 1006, reason: "" });
    vi.advanceTimersByTime(delay);
  }
  vi.advanceTimersByTime(5_500); // 60.5秒
  opened.at(-1)!.handlers.onClose({ code: 1006, reason: "" });
  expect(closed()).toBe(true);
  expect(opened).toHaveLength(9);
  stop();
});

test.each(["full", "playing"])(
  "queued（%s）で並んだスマホは、切れても60秒を過ぎてもつなぎ直す",
  (reason) => {
    const events: PhoneEvent[] = [];
    const session = startSession("K7Q2", (event) => events.push(event));
    for (let i = 0; i < 12; i++) {
      const { handlers } = opened[i]!;
      handlers.onOpen();
      handlers.onMessage(JSON.stringify({ type: "queued", reason }));
      handlers.onClose({ code: 1006, reason: "" });
      vi.advanceTimersByTime(10_000);
    }
    expect(opened).toHaveLength(13);
    expect(events.some((e) => e.type === "connection" && e.state.status === "closed")).toBe(false);
    session.stop();
    vi.advanceTimersByTime(60_000);
    expect(opened).toHaveLength(13);
  },
);

test("列で待っているあいだに joined が届いたら、同じ接続で送れるようになる", () => {
  const session = startSession("K7Q2", () => {});
  opened[0]!.handlers.onOpen();
  opened[0]!.handlers.onMessage(JSON.stringify({ type: "queued", reason: "full" }));
  expect(session.send({ type: "start" })).toBe(false);
  opened[0]!.handlers.onMessage(JOINED);
  expect(session.send({ type: "start" })).toBe(true);
  expect(opened).toHaveLength(1);
  session.stop();
});
