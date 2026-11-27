// スマホのページの状態。React の外に置く、純粋な関数だけ
import type { ConnectionState, PhoneReceived } from "../net/client.ts";
import { isRoomCode, normalizeRoomCode } from "../shared/room.ts";
import type { Joint, PhaseMessage, PlayResult, RejectedMessage } from "../shared/messages.ts";

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
  /** 許可されなかった。もう一度押せる */
  | { kind: "permission-denied" }
  /** つないでいる。joined か rejected を待つ */
  | { kind: "connecting" }
  | {
      kind: "joined";
      joint: Joint;
      /** 接続中のスマホの数 */
      count: number;
      phase: RoomPhase;
      /** 自分の関節に、スクリーンへの入力が届いている（プレイ中だけ意味がある） */
      active: boolean;
      /** reconnecting のあいだも、関節などの表示は残す */
      link: "open" | "reconnecting";
    }
  /** 断られた。playing のときだけ、自動でつなぎ直している */
  | { kind: "rejected"; reason: RejectReason }
  /** 閉じた。もうつなぎ直さない。replaced は別のタブに置き換えられたとき */
  | { kind: "closed"; replaced: boolean };

export type PhoneEvent =
  | { type: "tap-join" }
  | { type: "permission"; granted: boolean }
  | { type: "connection"; state: ConnectionState }
  | { type: "message"; message: PhoneReceived };

/** サーバーが、同じ ID の新しい接続に置き換えて閉じたときの close コード（docs/api.md） */
const REPLACED = 4000;

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
      return state.kind === "ready" || state.kind === "permission-denied"
        ? { kind: "asking-permission" }
        : state;
    case "permission":
      if (state.kind !== "asking-permission") return state;
      return event.granted ? { kind: "connecting" } : { kind: "permission-denied" };
    case "connection":
      return onConnection(state, event.state);
    case "message":
      return onMessage(state, event.message);
  }
}

function onConnection(state: PhoneState, connection: ConnectionState): PhoneState {
  switch (connection.status) {
    case "connecting":
      return state;
    case "open":
      return state.kind === "joined" && state.link !== "open" ? { ...state, link: "open" } : state;
    case "reconnecting":
      return state.kind === "joined" && state.link !== "reconnecting"
        ? { ...state, link: "reconnecting" }
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
  switch (message.type) {
    case "joined":
      if (state.kind === "joined") {
        // つなぎ直したとき。phase はこのあと届くので、届かなければロビーに戻す
        return {
          ...state,
          joint: message.joint,
          phase: { kind: "lobby" },
          active: false,
          link: "open",
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
