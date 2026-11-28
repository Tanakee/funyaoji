import { JOINTS, type Joint, type PlayResult } from "../shared/messages.ts";
import { JointBand } from "./JointBand.tsx";

const OUTCOME_LABELS: Record<PlayResult["outcome"], string> = {
  goal: "ゴール！",
  fell: "転倒",
  disconnected: "切断",
};

export function Result({
  joint,
  result,
  count,
  onRetry,
}: {
  joint: Joint;
  result: PlayResult;
  count: number;
  onRetry: () => void;
}) {
  const goal = result.outcome === "goal";
  const disabled = count !== JOINTS.length;
  return (
    <>
      <JointBand joint={joint} />
      <section className="result phone-content">
        <h1 className="result-outcome">{OUTCOME_LABELS[result.outcome]}</h1>
        <p className="result-value">
          {goal ? (result.timeMs / 1000).toFixed(2) : result.distanceM.toFixed(1)}
          <span>{goal ? "秒" : "m"}</span>
        </p>
        <div className="retry-actions">
          <button
            type="button"
            className="phone-button retry-button"
            disabled={disabled}
            onClick={onRetry}
          >
            もう一度
          </button>
          {disabled ? <p className="retry-hint">4人そろうと押せます</p> : null}
        </div>
      </section>
    </>
  );
}
