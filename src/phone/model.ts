// スマホのページの状態。React の外に置く、純粋な関数だけ
import type { ConnectionState, PhoneReceived } from "../net/client.ts";
import { isRoomCode, normalizeRoomCode } from "../shared/room.ts";
import {
  ROOM_CLOSED_CODE,
  type Joint,
  type PhaseMessage,
  type PlayResult,
  type RejectedMessage,
} from "../shared/messages.ts";

export type RejectReason = RejectedMessage["reason"];

/** ルームの進行。サーバーが phase を送らないうちは lobby とみなす */
export type RoomPhase =
  | { kind: "lobby" }
  | { kind: "playing" }
  | { kind: "result"; result: PlayResult };

/** ページが取りうる状態は、この中のどれか1つだけ */
export type PhoneState =
  /** URL に有効なルームコードが無い */
  | { kind: "invalid-room" }
  /** 参加ボタンを出している */
  | { kind: "ready" }
  /** 傾きの読み取りの許可を求めている（iOS） */
  | { kind: "asking-permission" }
  /** 許可のあと、傾きが届くかを確かめている。届かない端末は、ルームにつながずに断る */
  | { kind: "checking-tilt" }
  /** 傾きを読み取れない端末。ルームにはつないでいない */
  | { kind: "unsupported" }
  /**
   * 許可されなかった。iOS は一度断ると Safari を開いているあいだ覚えていて、
   * もう一度求めても許可の画面を出さずにすぐ断るので、ページからはやり直せない。Safari を開き直してもらう
   */
  | { kind: "permission-denied" }
  /** つないでいる。joined か rejected を待つ */
  | { kind: "connecting" }
  | {
      kind: "joined";
      joint: Joint;
      /** 接続中のスマホの数 */
      count: number;
      phase: RoomPhase;
      /** 自分の関節の入力がスクリーンに届いている（プレイ中だけ意味がある） */
      active: boolean;
      /**
       * 切れてから、つなぎ直して joined を受け取るまでは reconnecting。
       * トランスポートが開いただけでは、まだ参加できていない（断られることもある）ので open にしない。
       * reconnecting のあいだも、関節などの表示は残す
       */
      link: "open" | "reconnecting";
      /** link が reconnecting になった時刻（ミリ秒）。open のあいだは undefined */
      reconnectingSince: number | undefined;
    }
  /** 断られた。playing のときだけ、自動でつなぎ直している */
  | { kind: "rejected"; reason: RejectReason }
  /** 閉じた。もうつなぎ直さない。replaced は別のタブに置き換えられたとき */
  | { kind: "closed"; replaced: boolean }
  | { kind: "ended"; joint?: Joint };

export type PhoneEvent =
  | { type: "tap-join" }
  | { type: "permission"; granted: boolean }
  | { type: "tilt-check"; supported: boolean }
  /** at は、接続の状態が変わった時刻（ミリ秒） */
  | { type: "connection"; state: ConnectionState; at: number }
  | { type: "message"; message: PhoneReceived };

/** サーバーが、同じ ID の新しい接続に置き換えて閉じたときの close コード（docs/api.md） */
const REPLACED = 4000;

/** サーバーが、切れたスマホの関節を取っておく時間（docs/api.md の「スマホの ID と関節の予約」） */
export const RECONNECT_GRACE_MS = 60_000;

/** つなぎ直しの残り秒数。切り上げて、0 より下にはしない */
export function reconnectRemainingSeconds(since: number, now: number): number {
  return Math.max(0, Math.ceil((since + RECONNECT_GRACE_MS - now) / 1000));
}

/** ?room= のルームコード。無い・形が違うときは undefined */
export function parseRoom(search: string): string | undefined {
  const raw = new URLSearchParams(search).get("room");
  if (raw === null) return undefined;
  const code = normalizeRoomCode(raw.trim());
  return isRoomCode(code) ? code : undefined;
}

export function initialState(room: string | undefined): PhoneState {
  return room === undefined ? { kind: "invalid-room" } : { kind: "ready" };
}

export function reduce(state: PhoneState, event: PhoneEvent): PhoneState {
  switch (event.type) {
    case "tap-join":
      return state.kind === "ready" ? { kind: "asking-permission" } : state;
    case "permission":
      if (state.kind !== "asking-permission") return state;
      return event.granted ? { kind: "checking-tilt" } : { kind: "permission-denied" };
    case "tilt-check":
      if (state.kind !== "checking-tilt") return state;
      return event.supported ? { kind: "connecting" } : { kind: "unsupported" };
    case "connection":
      return onConnection(state, event.state, event.at);
    case "message":
      return onMessage(state, event.message);
  }
}

function onConnection(state: PhoneState, connection: ConnectionState, at: number): PhoneState {
  if (state.kind === "ended") return state;
  if (connection.status === "closed" && connection.code === ROOM_CLOSED_CODE) {
    return { kind: "ended", joint: state.kind === "joined" ? state.joint : undefined };
  }
  switch (connection.status) {
    case "connecting":
    case "open":
      // 参加し直せたかは joined で分かる
      return state;
    case "reconnecting":
      // joined を受け取るまでに何回切れても、最初に切れた時刻を残す
      return state.kind === "joined" && state.link !== "reconnecting"
        ? { ...state, link: "reconnecting", reconnectingSince: at }
        : state;
    case "closed":
      // 断られたあとに閉じるので、断った理由を残す
      if (state.kind === "rejected" || state.kind === "invalid-room") return state;
      if (state.kind === "joined" || state.kind === "connecting") {
        return { kind: "closed", replaced: connection.code === REPLACED };
      }
      return state;
  }
}

function onMessage(state: PhoneState, message: PhoneReceived): PhoneState {
  if (state.kind === "ended") return state;
  switch (message.type) {
    case "room-closed":
      return { kind: "ended", joint: state.kind === "joined" ? state.joint : undefined };
    case "joined":
      if (state.kind === "joined") {
        // つなぎ直したとき。phase はこのあと届くので、届かなければロビーに戻す
        return {
          ...state,
          joint: message.joint,
          phase: { kind: "lobby" },
          active: false,
          link: "open",
          reconnectingSince: undefined,
        };
      }
      if (state.kind === "connecting" || state.kind === "rejected") {
        return {
          kind: "joined",
          joint: message.joint,
          count: 1,
          phase: { kind: "lobby" },
          active: false,
          link: "open",
          reconnectingSince: undefined,
        };
      }
      return state;
    case "rejected":
      // 参加していたスマホも、つなぎ直したときに断られることがある（60秒を過ぎて、次のプレイが始まっていたなど）
      return state.kind === "connecting" || state.kind === "rejected" || state.kind === "joined"
        ? { kind: "rejected", reason: message.reason }
        : state;
    case "room":
      return state.kind === "joined" ? { ...state, count: message.joints.length } : state;
    case "phase":
      return state.kind === "joined"
        ? { ...state, phase: toRoomPhase(message), active: false }
        : state;
    case "status": {
      if (state.kind !== "joined") return state;
      const active = message.active.includes(state.joint);
      return active === state.active ? state : { ...state, active };
    }
  }
}

function toRoomPhase(message: PhaseMessage): RoomPhase {
  switch (message.phase) {
    case "lobby":
      return { kind: "lobby" };
    case "playing":
      return { kind: "playing" };
    case "result":
      return { kind: "result", result: message.result };
  }
}
