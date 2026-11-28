// スクリーンのゲーム（物理演算と描画）と、その外（React の UI・通信）のあいだの形（docs/design.md の「ディレクトリ構成」）
import type { Joint, Mode, PlayResult } from "../../shared/messages.ts";

/**
 * 関節ごとの入力。0〜1 の目標の位置。
 * 股関節は 0 が後ろ・1 が前、ひざは 0 が伸ばした・1 が曲げた。
 * 傾き（tilt）もキーボードも、この形に直して書き込む。ゲームは毎フレーム読むだけ
 */
export type JointInputs = Record<Joint, number>;

/**
 * 席の状態。joined は room の joints にいる（active は入力が届いている）。
 * reserved は抜けて、つなぎ直しを待っている（残り秒数）
 */
export type SeatState =
  | { kind: "empty" }
  | { kind: "joined"; active: boolean }
  | { kind: "reserved"; remainingSec: number };

export interface SeatView {
  state: SeatState;
  /** 札の近くに部位の名前を出す（ロビー） */
  showName: boolean;
  /** キーボードで動かしているときの、キーの表示 */
  key?: string;
}

export type Seats = Record<Joint, SeatView>;

/** プレイの終わり方のうち、ゲームが決めるもの。切断は通信の側が決める */
export type GameResult = Exclude<PlayResult, { outcome: "disconnected" }>;

export interface GameOptions {
  /** 描画の Canvas を入れる要素。大きさはこの要素に合わせる */
  container: HTMLElement;
  /** 毎フレーム読む入力。呼び出し側が持ち、書き換える。ゲームは書き換えない */
  inputs: JointInputs;
  /** ゴール・転倒のどちらかで、1回の走りにつき1回だけ呼ぶ */
  onEnd: (result: GameResult) => void;
}

export interface Game {
  /** 席の状態を、札・糸・部位の色に出す */
  setSeats(seats: Seats): void;
  /** おじさんをスタートラインに立たせ直し、止めて待つ。タイムは 0 に戻る。mode はこの走りのモード */
  reset(mode: Mode): void;
  /** 物理演算とタイムを進め始める。reset() のあとに呼ぶ */
  start(): void;
  /** おじさんを空中に吊り直して関節を動かす。距離とタイムは進めず、ゴールと転倒は判定しない */
  practice(): void;
  /**
   * 物理演算とタイムをいまの場所で止め、最後の絵を残す。onEnd は呼ばない。いまの距離（m）を返す。
   * showResult のときは、結果の画面の表示にする（距離とタイムを消し、止まった場所を映す）
   */
  stop(options?: { showResult?: boolean }): number;
  /** Canvas と物理演算の世界を片付ける */
  destroy(): void;
}

/** 傾き（度。0 が水平、90 が手前に立てた状態）を入力に直す */
export function tiltToInput(angleDeg: number): number {
  return Math.min(1, Math.max(0, angleDeg / 90));
}
