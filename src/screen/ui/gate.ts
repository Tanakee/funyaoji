// ゲームの画面の代わりに出す画面（「はじめる」・待つ型・お知らせ型）を、ScreenView から決める
import type { ScreenView } from "./session.ts";

export type ScreenGate =
  | { kind: "loading"; progress: number }
  | { kind: "start" }
  | { kind: "waiting"; title: string }
  | {
      kind: "notice";
      title: string;
      reason: string;
      /** 次にすること */
      next?: string;
      /** 「読み込み直す」を置くか */
      reload: boolean;
    };

type Notice = Extract<ScreenGate, { kind: "notice" }>;

const MAYBE_NETWORK = "会場の回線が不安定かもしれません";
/** 別のスクリーンに置き換えられたときの close コード（docs/api.md） */
const REPLACED_CODE = 4000;

function roomFailed(room: Extract<ScreenView["room"], { status: "failed" }>): Notice {
  switch (room.reason) {
    case "daily-limit":
      // 読み込み直しても作れないので、ボタンは置かない
      return {
        kind: "notice",
        title: "今日はこれ以上ルームを作れません",
        reason: "今日の分を使い切りました",
        next: "朝9時を過ぎたら遊べます",
        reload: false,
      };
    case "too-many-requests":
      return {
        kind: "notice",
        title: "ルームを作れません",
        reason: "短い時間に作りすぎました",
        next: "1分ほど待ってから読み込み直してください",
        reload: true,
      };
    default:
      return { kind: "notice", title: "ルームを作れません", reason: MAYBE_NETWORK, reload: true };
  }
}

function closedReason(view: ScreenView, code: number, rejected: string | undefined): string {
  // ルームの作り直しの途中で旧ルームが閉じたときは、その理由を出す
  if (view.recreation.status === "failed") return view.recreation.message;
  if (code === REPLACED_CODE) return "別のスクリーンに切り替わりました";
  if (rejected === "no-room") return "このルームはもうありません";
  return MAYBE_NETWORK;
}

/** 出すものが無ければ undefined（ロビーやプレイの画面を出す） */
export function screenGate(view: ScreenView): ScreenGate | undefined {
  const { room } = view;
  if (view.game === "failed") {
    return {
      kind: "notice",
      title: "ゲームを読み込めません",
      reason: MAYBE_NETWORK,
      reload: true,
    };
  }
  if (room.status === "failed") return roomFailed(room);
  // 作り直しで旧ルームを閉じている間の closed は、すぐ新しいルームに替わるので出さない
  if (
    room.status === "ready" &&
    room.connection.status === "closed" &&
    view.recreation.status !== "closing"
  ) {
    return {
      kind: "notice",
      title: "サーバーとの接続が切れました",
      reason: closedReason(view, room.connection.code, room.rejected),
      reload: true,
    };
  }
  if (!view.started) {
    return view.game === "loading"
      ? { kind: "loading", progress: view.loadProgress }
      : { kind: "start" };
  }
  if (room.status === "creating" || room.connection.status === "connecting") {
    return { kind: "waiting", title: "準備しています" };
  }
  if (room.connection.status === "reconnecting") {
    // つなぎ直しは続くので、お知らせ型には切り替えない。読み込み直すと別のルームになる
    return { kind: "waiting", title: "サーバーにつなぎ直しています" };
  }
  return undefined;
}
