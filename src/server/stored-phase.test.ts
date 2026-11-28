import { describe, expect, test } from "vite-plus/test";
import { ServerToPhoneMessage, ServerToScreenMessage } from "../shared/messages.ts";
import { parseMessage } from "../shared/parse.ts";
import { upgradeStoredPhase, type StoredPhase } from "./stored-phase.ts";

/** つなぎ直したスクリーンとスマホが、受け取った phase を検査で捨てないか */
function accepted(phase: unknown): boolean {
  const data = JSON.stringify(phase);
  return (
    parseMessage(ServerToScreenMessage, data) !== undefined &&
    parseMessage(ServerToPhoneMessage, data) !== undefined
  );
}

describe("upgradeStoredPhase", () => {
  test("前の版が保存した 10m の playing を、ノーマルに読み替え、つなぎ直した側が受け取れる", () => {
    const countdown = { kind: "count", durationMs: 3000, remainingMs: 3000, delayMs: {} } as const;
    for (const stored of [
      { type: "phase", phase: "playing", mode: "10m", input: "tilt" },
      { type: "phase", phase: "playing", mode: "10m", input: "camera", countdown },
    ] as const satisfies readonly StoredPhase[]) {
      expect(accepted(stored)).toBe(false);
      const upgraded = upgradeStoredPhase(stored);
      expect(upgraded).toEqual({ ...stored, mode: "normal" });
      expect(accepted(upgraded)).toBe(true);
    }
  });

  test("今の形の phase と、保存の無いときは、そのまま返す", () => {
    for (const stored of [
      { type: "phase", phase: "lobby", input: "camera" },
      { type: "phase", phase: "playing", mode: "hard", input: "tilt" },
      { type: "phase", phase: "result", result: { outcome: "fell", distanceM: 1 } },
    ] as const satisfies readonly StoredPhase[]) {
      expect(upgradeStoredPhase(stored)).toBe(stored);
    }
    expect(upgradeStoredPhase(undefined)).toBeUndefined();
  });
});
