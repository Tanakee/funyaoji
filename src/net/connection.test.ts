import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  HEARTBEAT,
  HEARTBEAT_INTERVAL_MS,
  ServerToPhoneMessage,
  type PhoneToServerMessage,
} from "../shared/messages.ts";
import { connect } from "./connection.ts";
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
  vi.advanceTimersByTime(HEARTBEAT_INTERVAL_MS * 2);
  expect(sent).toEqual([HEARTBEAT, HEARTBEAT]);

  connection.close();
  expect(vi.getTimerCount()).toBe(0);
});
