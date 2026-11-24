// スクリーンとスマホが、ルームのサーバーにつなぐ（docs/api.md）
import {
  PhoneToServerMessage,
  ScreenToServerMessage,
  ServerToPhoneMessage,
  ServerToScreenMessage,
  type HeartbeatMessage,
} from "../shared/messages.ts";
import { connect, type Connection, type ConnectionState } from "./connection.ts";
import { TiltSequencer } from "./tilt.ts";
import type { OpenTransport } from "./transport.ts";
import { webSocketTransport } from "./websocket.ts";

export type { Connection, ConnectionState } from "./connection.ts";

export type Role = "screen" | "phone";

/** スクリーンが受け取るメッセージ。ハートビートの返事は接続が受け取るので含まない */
export type ScreenReceived = Exclude<ServerToScreenMessage, HeartbeatMessage>;
/** スクリーンが送るメッセージ。ハートビートは接続が送るので含まない */
export type ScreenSent = Exclude<ScreenToServerMessage, HeartbeatMessage>;
/** スマホが受け取るメッセージ。ハートビートの返事は接続が受け取るので含まない */
export type PhoneReceived = Exclude<ServerToPhoneMessage, HeartbeatMessage>;
/** スマホが送るメッセージ。ハートビートは接続が送るので含まない */
export type PhoneSent = Exclude<PhoneToServerMessage, HeartbeatMessage>;

export interface ClientHandlers<Receive> {
  onMessage: (message: Receive) => void;
  onStateChange?: (state: ConnectionState) => void;
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
 * 受信済みの番号は、つなぎ直しても覚えておく（抜けた関節の番号は room で忘れる）
 */
export function connectScreen(
  roomCode: string,
  handlers: ClientHandlers<ScreenReceived>,
  options: ClientOptions,
): Connection<ScreenSent> {
  const tilts = new TiltSequencer();
  return connect<ServerToScreenMessage, ScreenSent>({
    open: openTransport(roomCode, "screen", options),
    schema: ServerToScreenMessage,
    onMessage(message) {
      if (message.type === "tilt" && !tilts.accept(message)) return;
      if (message.type === "room") tilts.keepOnly(message.joints);
      handlers.onMessage(message);
    },
    onStateChange: handlers.onStateChange,
  });
}

/** スマホとしてつなぐ */
export function connectPhone(
  roomCode: string,
  handlers: ClientHandlers<PhoneReceived>,
  options: PhoneOptions,
): Connection<PhoneSent> {
  return connect<ServerToPhoneMessage, PhoneSent>({
    open: openTransport(roomCode, "phone", options, options.clientId),
    schema: ServerToPhoneMessage,
    onMessage: handlers.onMessage,
    onStateChange: handlers.onStateChange,
  });
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
