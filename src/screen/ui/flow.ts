// スクリーンの進行（docs/game.md の「状態の遷移」）。副作用の無い遷移だけをここに置く
import { JOINTS, type Joint, type PlayResult } from "../../shared/messages.ts";

/**
 * players はプレイを始めたときにスマホがいた関節。結果の画面でこれが抜けたらロビーに戻る
 * （カウントダウンとプレイ中は、つなぎ直しを待つ。session.ts）。入っていない関節はキーボードで動かす
 */
export type Flow =
  | { kind: "lobby" }
  | { kind: "countdown"; count: 3 | 2 | 1; players: readonly Joint[] }
  | { kind: "playing"; players: readonly Joint[] }
  | { kind: "result"; result: PlayResult; players: readonly Joint[] };

export type FlowEvent =
  /** 開始のキー。debug はスマホが4台そろっていなくても始める */
  | { type: "start"; joints: readonly Joint[]; debug: boolean }
  /** やり直しのキー。結果・プレイ中・カウントダウン中のどこからでも、同じ players で始める */
  | { type: "restart" }
  /** カウントダウンが1秒進んだ */
  | { type: "tick" }
  /** 終わった。ゴール・転倒はゲームが、切断はスクリーンが決める */
  | { type: "ended"; result: PlayResult }
  /** room が変わった。joints は接続中のスマホの関節 */
  | { type: "room"; joints: readonly Joint[] }
  /** ロビーに戻す。つなぎ直したとき、サーバーが playing を持っていたとき */
  | { type: "toLobby" };

export const INITIAL_FLOW: Flow = { kind: "lobby" };

/** 4台そろっているか */
export function isFull(joints: readonly Joint[]): boolean {
  return JOINTS.every((joint) => joints.includes(joint));
}

export function reduce(flow: Flow, event: FlowEvent): Flow {
  switch (event.type) {
    case "start":
      if (flow.kind !== "lobby") return flow;
      if (!event.debug && !isFull(event.joints)) return flow;
      return { kind: "countdown", count: 3, players: event.joints };
    case "restart":
      if (flow.kind === "lobby") return flow;
      return { kind: "countdown", count: 3, players: flow.players };
    case "tick":
      if (flow.kind !== "countdown") return flow;
      if (flow.count === 1) return { kind: "playing", players: flow.players };
      return { ...flow, count: flow.count === 3 ? 2 : 1 };
    case "ended":
      if (flow.kind !== "playing") return flow;
      return { kind: "result", result: event.result, players: flow.players };
    case "room":
      // 結果の画面で誰かが切れたら、ロビーに戻す。カウントダウンとプレイ中は、つなぎ直しを待つので戻さない
      if (flow.kind !== "result") return flow;
      return flow.players.every((joint) => event.joints.includes(joint)) ? flow : INITIAL_FLOW;
    case "toLobby":
      return flow.kind === "lobby" ? flow : INITIAL_FLOW;
  }
}
