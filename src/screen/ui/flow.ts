// スクリーンの進行（docs/game.md の「状態の遷移」）。副作用の無い遷移だけをここに置く
import {
  COUNTDOWNS,
  countdownLeadMs,
  countdownStep,
  type CountdownKind,
} from "../../shared/countdown.ts";
import { JOINTS, type Joint, type PlayResult } from "../../shared/messages.ts";

/**
 * players はプレイを始めたときにスマホがいた関節。結果の画面でこれが抜けたらロビーに戻る
 * （カウントダウンとプレイ中は、つなぎ直しを待つ。session.ts）。入っていない関節はキーボードで動かす
 */
export type Flow =
  | { kind: "lobby" }
  | { kind: "howto"; ready: readonly Joint[] }
  | {
      kind: "countdown";
      countdownKind: CountdownKind;
      step: ReturnType<typeof countdownStep>;
      players: readonly Joint[];
    }
  | { kind: "playing"; players: readonly Joint[] }
  /** ゴールの線を越えて、FINISH を出している。この間はやり直せない（記録を落とさないため） */
  | { kind: "finish"; result: PlayResult; players: readonly Joint[] }
  | { kind: "result"; result: PlayResult; players: readonly Joint[] };

export type FlowEvent =
  /**
   * 開始のキー。debug はスマホが4台そろっていなくても始める。
   * delayMs は関節ごとの片道の遅延。いちばん遅いスマホのぶん、最初の表示を待つ（countdownLeadMs）
   */
  | {
      type: "start";
      joints: readonly Joint[];
      debug: boolean;
      delayMs?: Partial<Record<Joint, number>>;
    }
  | { type: "ready"; joint: Joint }
  | { type: "howto"; ready: readonly Joint[] }
  | { type: "begin"; joints: readonly Joint[]; delayMs?: Partial<Record<Joint, number>> }
  /** やり直しのキー。結果・プレイ中・カウントダウン中のどこからでも、同じ players で始める */
  | { type: "restart"; delayMs?: Partial<Record<Joint, number>> }
  /** カウントダウンのタイマーが動いた。elapsedMs は最初の表示からの経過時間。その前は負 */
  | { type: "tick"; elapsedMs: number }
  /** 終わった。ゴール・転倒はゲームが、切断はスクリーンが決める */
  | { type: "ended"; result: PlayResult }
  /** FINISH を出し終えた */
  | { type: "finished" }
  /** room が変わった。joints は接続中のスマホの関節 */
  | { type: "room"; joints: readonly Joint[] }
  /** ロビーに戻す。つなぎ直したとき、サーバーが playing を持っていたとき */
  | { type: "toLobby" };

export const INITIAL_FLOW: Flow = { kind: "lobby" };

/** 4台そろっているか */
export function isFull(joints: readonly Joint[]): boolean {
  return JOINTS.every((joint) => joints.includes(joint));
}

function firstCountdown(
  joints: readonly Joint[],
  delayMs: Partial<Record<Joint, number>> = {},
): Flow {
  return {
    kind: "countdown",
    countdownKind: "count",
    step: countdownStep("count", -countdownLeadMs(delayMs)),
    players: joints,
  };
}

export function reduce(flow: Flow, event: FlowEvent): Flow {
  switch (event.type) {
    case "start":
      if (flow.kind !== "lobby") return flow;
      if (event.debug) return firstCountdown(event.joints, event.delayMs);
      return isFull(event.joints) ? { kind: "howto", ready: [] } : flow;
    case "ready":
      if (flow.kind !== "howto" || flow.ready.includes(event.joint)) return flow;
      return { kind: "howto", ready: [...flow.ready, event.joint] };
    case "howto":
      return flow.kind === "howto" ? { kind: "howto", ready: event.ready } : flow;
    case "begin":
      if (flow.kind !== "howto" || !isFull(event.joints)) return flow;
      return firstCountdown(event.joints, event.delayMs);
    case "restart":
      if (flow.kind === "lobby" || flow.kind === "howto" || flow.kind === "finish") return flow;
      return {
        kind: "countdown",
        countdownKind: "readyGo",
        step: countdownStep("readyGo", -countdownLeadMs(event.delayMs ?? {})),
        players: flow.players,
      };
    case "tick": {
      if (flow.kind !== "countdown") return flow;
      if (event.elapsedMs >= COUNTDOWNS[flow.countdownKind].durationMs) {
        return { kind: "playing", players: flow.players };
      }
      const step = countdownStep(flow.countdownKind, event.elapsedMs);
      return step === flow.step ? flow : { ...flow, step };
    }
    case "ended":
      if (flow.kind !== "playing") return flow;
      return {
        kind: event.result.outcome === "goal" ? "finish" : "result",
        result: event.result,
        players: flow.players,
      };
    case "finished":
      if (flow.kind !== "finish") return flow;
      return { kind: "result", result: flow.result, players: flow.players };
    case "room":
      // 結果の画面で誰かが切れたら、ロビーに戻す。カウントダウンとプレイ中は、つなぎ直しを待つので戻さない
      if (flow.kind !== "result") return flow;
      return flow.players.every((joint) => event.joints.includes(joint)) ? flow : INITIAL_FLOW;
    case "toLobby":
      return flow.kind === "lobby" ? flow : INITIAL_FLOW;
  }
}
