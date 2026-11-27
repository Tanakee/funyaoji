// スクリーンの進行（docs/game.md の「状態の遷移」）。副作用の無い遷移だけをここに置く
import { JOINTS, type Joint, type PlayResult } from "../../shared/messages.ts";
import type { GameResult } from "../game/types.ts";

/**
 * players はプレイを始めたときにスマホがいた関節。これが抜けたらロビーに戻る。
 * 入っていない関節はキーボードで動かす
 */
export type Flow =
  | { kind: "lobby" }
  | { kind: "countdown"; count: 3 | 2 | 1; players: readonly Joint[] }
  | { kind: "playing"; players: readonly Joint[] }
  | { kind: "result"; result: PlayResult; players: readonly Joint[] };

export type FlowEvent =
  /** 開始のキー。debug はスマホが4台そろっていなくても始める */
  | { type: "start"; joints: readonly Joint[]; debug: boolean }
  /** やり直しのキー。同じ players で始める */
  | { type: "restart" }
  /** カウントダウンが1秒進んだ */
  | { type: "tick" }
  /** ゲームが終わった */
  | { type: "ended"; result: GameResult }
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
      if (flow.kind !== "result") return flow;
      return { kind: "countdown", count: 3, players: flow.players };
    case "tick":
      if (flow.kind !== "countdown") return flow;
      if (flow.count === 1) return { kind: "playing", players: flow.players };
      return { ...flow, count: flow.count === 3 ? 2 : 1 };
    case "ended":
      if (flow.kind !== "playing") return flow;
      return { kind: "result", result: event.result, players: flow.players };
    case "room":
      // 誰かが切れたら、カウントダウン・プレイ・結果のどれからもロビーに戻る
      if (flow.kind === "lobby") return flow;
      return flow.players.every((joint) => event.joints.includes(joint)) ? flow : INITIAL_FLOW;
    case "toLobby":
      return flow.kind === "lobby" ? flow : INITIAL_FLOW;
  }
}
