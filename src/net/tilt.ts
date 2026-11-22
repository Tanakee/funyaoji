import type { Joint, RelayedTiltMessage } from "../shared/messages.ts";

/**
 * 関節ごとに、受信済みの tilt のシーケンス番号を覚え、それより小さい番号のものを捨てる。
 * シーケンス番号はスマホごとに数えるので、関節ごとに比べる
 */
export class TiltSequencer {
  private readonly lastSeq = new Map<Joint, number>();

  /** 使ってよい tilt なら true。受信済みの番号より小さければ false */
  accept(tilt: RelayedTiltMessage): boolean {
    const last = this.lastSeq.get(tilt.joint);
    if (last !== undefined && tilt.seq < last) return false;
    this.lastSeq.set(tilt.joint, tilt.seq);
    return true;
  }

  /**
   * 接続中の関節（room の joints）の番号だけを残す。
   * 担当のスマホが抜けた関節に次のスマホが入ると、番号は数え直しになるので、抜けた関節の番号を忘れる
   */
  keepOnly(joints: readonly Joint[]): void {
    for (const joint of this.lastSeq.keys()) {
      if (!joints.includes(joint)) this.lastSeq.delete(joint);
    }
  }
}
