import type { Joint, PlayResult } from "../shared/messages.ts";
import { JointBand } from "./JointBand.tsx";

const OUTCOME_LABELS: Record<PlayResult["outcome"], string> = {
  goal: "ゴール！",
  fell: "転倒",
  disconnected: "切断",
};

export function Result({ joint, result }: { joint: Joint; result: PlayResult }) {
  const goal = result.outcome === "goal";
  return (
    <>
      <JointBand joint={joint} />
      <section className="result phone-content">
        <h1 className="result-outcome">{OUTCOME_LABELS[result.outcome]}</h1>
        <p className="result-value">
          {goal ? (result.timeMs / 1000).toFixed(2) : result.distanceM.toFixed(1)}
          <span>{goal ? "秒" : "m"}</span>
        </p>
        {/* #89 でもう一度ボタンを置く場所を空けておく */}
        <div className="retry-slot" aria-hidden="true" />
      </section>
    </>
  );
}
