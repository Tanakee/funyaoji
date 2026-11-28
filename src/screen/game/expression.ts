import { JOINTS } from "../../shared/messages.ts";
import type { Expression } from "./art.ts";
import { NEUTRAL_INPUTS } from "./body.ts";
import type { GameResult, JointInputs } from "./types.ts";

const STRAIN_THRESHOLD = 1.4;
/** 力む顔が出たり消えたりしないよう、しきい値を下回ってからも保つ時間 */
const STRAIN_HOLD_MS = 500;

export class UncleExpression {
  private straining = false;
  private belowSinceMs: number | undefined;

  update(inputs: JointInputs, nowMs: number, outcome?: GameResult["outcome"]): Expression {
    if (outcome === "fell" || outcome === "goal") return outcome;
    const effort = JOINTS.reduce(
      (sum, joint) => sum + Math.abs(inputs[joint] - NEUTRAL_INPUTS[joint]),
      0,
    );
    // 小数の足し算で、しきい値ちょうどの入力を取りこぼさない
    if (effort >= STRAIN_THRESHOLD - Number.EPSILON) {
      this.straining = true;
      this.belowSinceMs = undefined;
    } else if (this.straining) {
      this.belowSinceMs ??= nowMs;
      this.straining = nowMs - this.belowSinceMs < STRAIN_HOLD_MS;
    }
    return this.straining ? "strain" : "normal";
  }
}
