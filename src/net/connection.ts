import type * as v from "valibot";
import { HEARTBEAT, HEARTBEAT_INTERVAL_MS, type HeartbeatMessage } from "../shared/messages.ts";
import { parseMessage } from "../shared/parse.ts";
import type { OpenTransport, Transport } from "./transport.ts";

/** code はトランスポートの close コード。こちらから閉じたときは 1000 */
export type ConnectionState =
  | { status: "connecting" }
  | { status: "open" }
  | { status: "closed"; code: number; reason: string };

/** サーバーとの接続。Send は送れるメッセージ */
export interface Connection<Send> {
  /** 開いていれば送って true を返す。開いていなければ送らずに false を返す */
  send(message: Send): boolean;
  /** 閉じる。再接続はしない */
  close(): void;
  readonly state: ConnectionState;
}

export interface ConnectOptions<Receive extends { type: string }> {
  open: OpenTransport;
  /** 受信したメッセージを検証するスキーマ。合わないメッセージは捨てる */
  schema: v.GenericSchema<unknown, Receive>;
  /** 検証したメッセージ。ハートビートの返事は渡さない */
  onMessage: (message: Exclude<Receive, HeartbeatMessage>) => void;
  onStateChange?: (state: ConnectionState) => void;
}

/** こちらから閉じたときの close コード */
const NORMAL_CLOSURE = 1000;

/**
 * トランスポートを開き、受信したメッセージを検証して渡す。
 * 開いているあいだ、5秒ごとにハートビートを送る（docs/api.md の heartbeat）
 */
export function connect<Receive extends { type: string }, Send>(
  options: ConnectOptions<Receive>,
): Connection<Send> {
  let state: ConnectionState = { status: "connecting" };
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const setState = (next: ConnectionState) => {
    state = next;
    options.onStateChange?.(next);
  };
  const stopHeartbeat = () => {
    clearInterval(heartbeat);
    heartbeat = undefined;
  };

  const transport: Transport = options.open({
    onOpen() {
      if (state.status !== "connecting") return;
      // 先にタイマーを置く。onStateChange の中で close() されても、そこで止められる
      heartbeat = setInterval(() => transport.send(HEARTBEAT), HEARTBEAT_INTERVAL_MS);
      setState({ status: "open" });
    },
    onMessage(data) {
      if (state.status !== "open") return;
      const message = parseMessage(options.schema, data);
      if (message === undefined || message.type === "heartbeat") return;
      options.onMessage(message as Exclude<Receive, HeartbeatMessage>);
    },
    onClose({ code, reason }) {
      stopHeartbeat();
      if (state.status === "closed") return;
      setState({ status: "closed", code, reason });
    },
  });

  return {
    send(message) {
      if (state.status !== "open") return false;
      return transport.send(JSON.stringify(message));
    },
    close() {
      stopHeartbeat();
      if (state.status === "closed") return;
      // 閉じ終わるのを待たずに閉じたことにする。あとから届くメッセージと close は捨てる
      const closed: ConnectionState = { status: "closed", code: NORMAL_CLOSURE, reason: "" };
      state = closed;
      // 知らせる前にトランスポートを閉じる。onStateChange が例外を投げたり、プロセスを終えたりしても、閉じ損ねない
      try {
        transport.close();
      } finally {
        options.onStateChange?.(closed);
      }
    },
    get state() {
      return state;
    },
  };
}
