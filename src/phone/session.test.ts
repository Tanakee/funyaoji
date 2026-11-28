import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import type { TransportHandlers } from "../net/transport.ts";
import type { PhoneEvent } from "./model.ts";
import { startSession } from "./session.ts";

const opened: { handlers: TransportHandlers; closed: boolean }[] = [];

vi.mock("../net/client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../net/client.ts")>();
  return {
    ...actual,
    connectPhone: (...[room, handlers, options]: Parameters<typeof actual.connectPhone>) =>
      actual.connectPhone(room, handlers, {
        ...options,
        transport: () => (handlers) => {
          const transport = { handlers, closed: false };
          opened.push(transport);
          return {
            send: () => true,
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

test("60秒より前に開き始めたトランスポートが、60秒を過ぎて full で断られたら、つなぎ直さない", () => {
  const { stop, closed } = joinThenDrop();
  vi.advanceTimersByTime(1_000);
  for (const [i, delay] of [2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000].entries()) {
    opened[i + 1]!.handlers.onClose({ code: 1006, reason: "" });
    vi.advanceTimersByTime(delay);
  }
  vi.advanceTimersByTime(5_500); // 60.5秒
  const last = opened.at(-1)!;
  last.handlers.onOpen();
  last.handlers.onMessage(JSON.stringify({ type: "rejected", reason: "full" }));
  last.handlers.onClose({ code: 4001, reason: "" });
  expect(closed()).toBe(true);
  vi.advanceTimersByTime(60_000);
  expect(opened).toHaveLength(9);
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

test.each(["full", "playing"])("%s で断られたスマホは、60秒を過ぎてもつなぎ直す", (reason) => {
  const events: PhoneEvent[] = [];
  const session = startSession("K7Q2", (event) => events.push(event));
  for (let i = 0; i < 12; i++) {
    const { handlers } = opened[i]!;
    handlers.onOpen();
    handlers.onMessage(JSON.stringify({ type: "rejected", reason }));
    handlers.onClose({ code: 4001, reason: "" });
    vi.advanceTimersByTime(10_000);
  }
  expect(opened).toHaveLength(13);
  expect(events.some((e) => e.type === "connection" && e.state.status === "closed")).toBe(false);
  opened[12]!.handlers.onOpen();
  opened[12]!.handlers.onMessage(JSON.stringify({ type: "rejected", reason }));
  opened[12]!.handlers.onClose({ code: 4001, reason: "" });
  session.stop();
  vi.advanceTimersByTime(60_000);
  expect(opened).toHaveLength(13);
});
