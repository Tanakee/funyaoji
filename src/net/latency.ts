import type { Joint } from "../shared/messages.ts";

/** スクリーンが、つながっている関節ごとに ping を送る間隔 */
export const PING_INTERVAL_MS = 1_000;
/** この時間 pong が返らない ping は忘れる */
export const PING_TIMEOUT_MS = 5_000;
/** 中央値をとる、直近の計測の数 */
export const LATENCY_SAMPLES = 10;

/** 関節ごとの片道の遅延（往復時間の半分。ミリ秒） */
export interface Latency {
  latest: number;
  median: number;
}

/**
 * ping を送った時刻を覚え、pong が返ったら、関節ごとに片道の遅延（往復時間の半分）を記録する。
 * 時刻は呼び出し側が渡す（performance.now()）
 */
export class LatencyTracker {
  /** 時刻から数え始め、前に開いたページの ping と id が重ならないようにする（createTiltSeq と同じ） */
  private nextId = Date.now();
  /** 返事を待っている ping。id → 送った時刻と宛先の関節 */
  private readonly pending = new Map<number, { sentAt: number; joint: Joint }>();
  /** 関節ごとの直近の計測。古い順 */
  private readonly samples = new Map<Joint, number[]>();

  /** ping を送る前に呼ぶ。送る id を返す */
  ping(joint: Joint, now: number): number {
    const id = this.nextId++;
    this.pending.set(id, { sentAt: now, joint });
    return id;
  }

  /**
   * pong を受け取ったら呼ぶ。知らない id（忘れた ping・つなぎ直す前の ping）、
   * 宛先の関節が違うもの、PING_TIMEOUT_MS より古いものは無視する
   */
  pong(id: number, joint: Joint, now: number): void {
    const sent = this.pending.get(id);
    if (sent === undefined || sent.joint !== joint) return;
    this.pending.delete(id);
    if (now - sent.sentAt > PING_TIMEOUT_MS) return;
    const list = this.samples.get(sent.joint) ?? [];
    list.push((now - sent.sentAt) / 2);
    if (list.length > LATENCY_SAMPLES) list.shift();
    this.samples.set(sent.joint, list);
  }

  /** PING_TIMEOUT_MS より前に送って返事の無い ping を忘れる */
  forgetStale(now: number): void {
    for (const [id, { sentAt }] of this.pending) {
      if (now - sentAt > PING_TIMEOUT_MS) this.pending.delete(id);
    }
  }

  /** 接続中の関節（room の joints）の計測だけを残す。抜けた関節に次のスマホが入ったとき、前の値を出さない */
  keepOnly(joints: readonly Joint[]): void {
    for (const joint of this.samples.keys()) {
      if (!joints.includes(joint)) this.samples.delete(joint);
    }
    for (const [id, { joint }] of this.pending) {
      if (!joints.includes(joint)) this.pending.delete(id);
    }
  }

  /**
   * 計測と、返事を待っている ping を全部忘れる。つなぎ直したら呼ぶ。
   * 前の接続で送った ping の pong は返らない。切れているあいだに関節の担当が入れ替わると、
   * その関節は room から一度も抜けないことがあるため、計測も忘れる
   */
  reset(): void {
    this.pending.clear();
    this.samples.clear();
  }

  /** 関節ごとの最新の値と、直近の中央値 */
  snapshot(): Partial<Record<Joint, Latency>> {
    const result: Partial<Record<Joint, Latency>> = {};
    for (const [joint, list] of this.samples) {
      if (list.length === 0) continue;
      result[joint] = { latest: list[list.length - 1], median: median(list) };
    }
    return result;
  }
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
