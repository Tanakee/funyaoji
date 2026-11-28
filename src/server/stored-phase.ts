// ルームの Durable Object に保存してある phase を、今の形に直す
import type { PhaseMessage } from "../shared/messages.ts";

/** 前の版が保存した phase。playing の mode が、今は無い値（10m）のことがある */
export type StoredPhase =
  | PhaseMessage
  | (Omit<Extract<PhaseMessage, { phase: "playing" }>, "mode"> & { mode: "10m" });

/**
 * 保存してある phase を、送れる形にして返す。前の「10m モード」の playing は、ノーマル（normal）に読み替える
 * （docs/game.md の「モード」）。読み替えないと、デプロイをまたいだルームで、新しい版のスマホとスクリーンが
 * 検査で捨てて、ロビーに戻れなくなる
 */
export function upgradeStoredPhase(phase: StoredPhase | undefined): PhaseMessage | undefined {
  if (phase?.phase !== "playing") return phase;
  return phase.mode === "10m" ? { ...phase, mode: "normal" } : phase;
}
