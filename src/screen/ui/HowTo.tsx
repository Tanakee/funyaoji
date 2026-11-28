import type { Joint } from "../../shared/messages.ts";
import { isFull } from "./flow.ts";
import type { ScreenView } from "./session.ts";

export function HowTo({ view, ready }: { view: ScreenView; ready: readonly Joint[] }) {
  const { input, joints, howtoRemainingSec } = view;
  const full = isFull(joints);
  const readyCount = joints.filter((joint) => ready.includes(joint)).length;
  return (
    <>
      <section className="howto" aria-labelledby="howto-title">
        <h1 id="howto-title">{input === "tilt" ? "スマホを傾けてみよう" : "指を曲げてみよう"}</h1>
        <p className="howto-instruction">分かったら「準備OK」を押そう</p>
        <p className="howto-count" aria-live="polite">
          準備OK <strong>{readyCount}</strong> / {joints.length}人
        </p>
        <p className="howto-time" aria-live="polite">
          {howtoRemainingSec !== undefined && howtoRemainingSec > 0
            ? `あと${howtoRemainingSec}秒で始まる`
            : !full && "4人そろったら始まる"}
        </p>
      </section>
      {full && (
        <p className="howto-skip">
          <kbd>Space</kbd> 遊び方を飛ばす
        </p>
      )}
    </>
  );
}
