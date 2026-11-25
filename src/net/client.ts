// スクリーンとスマホが、ルームのサーバーにつなぐ（docs/api.md）
import {
  PhoneToServerMessage,
  ScreenToServerMessage,
  ServerToPhoneMessage,
  ServerToScreenMessage,
  type HeartbeatMessage,
  type Joint,
  type PingMessage,
  type RelayedPongMessage,
} from "../shared/messages.ts";
import { connect, type Connection, type ConnectionState } from "./connection.ts";
import { LatencyTracker, PING_INTERVAL_MS, type Latency } from "./latency.ts";
import { TiltSequencer } from "./tilt.ts";
import type { OpenTransport } from "./transport.ts";
import { webSocketTransport } from "./websocket.ts";

export type { Connection, ConnectionState } from "./connection.ts";
export type { Latency } from "./latency.ts";

export type Role = "screen" | "phone";

/** スクリーンが受け取るメッセージ。ハートビートの返事と pong は接続が受け取るので含まない */
export type ScreenReceived = Exclude<ServerToScreenMessage, HeartbeatMessage | RelayedPongMessage>;
/** スクリーンが送るメッセージ。ハートビートは接続が送るので含まない */
export type ScreenSent = Exclude<ScreenToServerMessage, HeartbeatMessage>;
/** スマホが受け取るメッセージ。ハートビートの返事と ping は接続が受け取るので含まない */
export type PhoneReceived = Exclude<ServerToPhoneMessage, HeartbeatMessage | PingMessage>;
/** スマホが送るメッセージ。ハートビートは接続が送るので含まない */
export type PhoneSent = Exclude<PhoneToServerMessage, HeartbeatMessage>;

export interface ClientHandlers<Receive> {
  onMessage: (message: Receive) => void;
  onStateChange?: (state: ConnectionState) => void;
}

export interface ScreenHandlers extends ClientHandlers<ScreenReceived> {
  /**
   * 関節ごとの片道の遅延。つながっているあいだ、ping を送るたび（1秒に1回）と room を受け取ったときに渡す。
   * つながっていないときは空にして渡す
   */
  onLatency?: (latency: Partial<Record<Joint, Latency>>) => void;
}

export interface ClientOptions {
  /** ページの URL（ブラウザでは location.href）。ホスト名と、http か https かを使う */
  baseUrl: string | URL;
  /** トランスポートを差し替える。省くと WebSocket */
  transport?: (url: URL) => OpenTransport;
}

export interface PhoneOptions extends ClientOptions {
  /** スマホの ID（phoneClientId()）。つなぎ直したときに、サーバーが同じ関節を渡すのに使う */
  clientId?: string;
}

/**
 * GET /api/rooms/<ルームコード>/ws?role=<role>&client=<ID> の URL。clientId を省くと client を付けない。
 * http と ws は ws に、https と wss は wss にする
 */
export function roomSocketUrl(
  baseUrl: string | URL,
  roomCode: string,
  role: Role,
  clientId?: string,
): URL {
  const url = new URL(`/api/rooms/${encodeURIComponent(roomCode)}/ws`, baseUrl);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  url.searchParams.set("role", role);
  if (clientId !== undefined) url.searchParams.set("client", clientId);
  return url;
}

/**
 * スクリーンとしてつなぐ。tilt は、関節ごとに受信済みより小さいシーケンス番号のものを捨ててから渡す。
 * 受信済みの番号は、抜けた関節のぶんを room で忘れ、つなぎ直したら全部忘れる。
 * 切れているあいだに関節の担当が入れ替わると、その関節は room から一度も抜けないことがあるため。
 * つながっているあいだ、つながっている関節ごとに1秒に1回 ping を送り、遅延を onLatency に渡す（docs/api.md の ping、pong）
 */
export function connectScreen(
  roomCode: string,
  handlers: ScreenHandlers,
  options: ClientOptions,
): Connection<ScreenSent> {
  let tilts = new TiltSequencer();
  const latency = new LatencyTracker();
  /** 最後に受け取った room の joints */
  let joints: readonly Joint[] = [];
  let pinger: ReturnType<typeof setInterval> | undefined;

  const sendPings = () => {
    const now = performance.now();
    latency.forgetStale(now);
    handlers.onLatency?.(latency.snapshot());
    for (const joint of joints) {
      connection.send({ type: "ping", id: latency.ping(joint, now), joint });
    }
  };

  const connection = connect<ServerToScreenMessage, ScreenSent>({
    open: openTransport(roomCode, "screen", options),
    schema: ServerToScreenMessage,
    onMessage(message) {
      if (message.type === "tilt" && !tilts.accept(message)) return;
      if (message.type === "room") {
        tilts.keepOnly(message.joints);
        latency.keepOnly(message.joints);
        joints = message.joints;
        handlers.onLatency?.(latency.snapshot());
      }
      if (message.type === "pong") {
        latency.pong(message.id, message.joint, performance.now());
        return;
      }
      handlers.onMessage(message);
    },
    onStateChange(state) {
      clearInterval(pinger);
      pinger = undefined;
      if (state.status === "open") {
        tilts = new TiltSequencer();
        // 前の接続の計測と ping は全部忘れる。関節は、つないだときに届く room で知る
        latency.reset();
        joints = [];
        pinger = setInterval(sendPings, PING_INTERVAL_MS);
      } else {
        handlers.onLatency?.({});
      }
      handlers.onStateChange?.(state);
    },
  });
  return connection;
}

/** スマホとしてつなぐ。ping には、すぐに同じ id の pong を返す（docs/api.md の ping、pong） */
export function connectPhone(
  roomCode: string,
  handlers: ClientHandlers<PhoneReceived>,
  options: PhoneOptions,
): Connection<PhoneSent> {
  const connection = connect<ServerToPhoneMessage, PhoneSent>({
    open: openTransport(roomCode, "phone", options, options.clientId),
    schema: ServerToPhoneMessage,
    onMessage(message) {
      // 受け取ってすぐ返す。ページには渡さない
      if (message.type === "ping") {
        connection.send({ type: "pong", id: message.id });
        return;
      }
      handlers.onMessage(message);
    },
    onStateChange: handlers.onStateChange,
  });
  return connection;
}

function openTransport(
  roomCode: string,
  role: Role,
  options: ClientOptions,
  clientId?: string,
): OpenTransport {
  const url = roomSocketUrl(options.baseUrl, roomCode, role, clientId);
  return (options.transport ?? webSocketTransport)(url);
}
