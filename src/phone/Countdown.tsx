import { useEffect, useState, type ReactNode } from "react";
import {
  COUNTDOWN_GUIDANCE,
  COUNTDOWNS,
  countdownStep,
  GO_DISPLAY_MS,
} from "../shared/countdown.ts";
import type { Joint } from "../shared/messages.ts";
import { JointBand } from "./JointBand.tsx";
import type { PhoneCountdown } from "./model.ts";

export function Countdown({
  countdown,
  joint,
  children,
}: {
  countdown: PhoneCountdown;
  joint: Joint;
  children: ReactNode;
}) {
  const { kind, durationMs, endsAt } = countdown;
  const [now, setNow] = useState(() => performance.now());
  const started = now >= endsAt;
  const finished = now >= endsAt + GO_DISPLAY_MS;
  const startedAt = endsAt - durationMs;
  const step = countdownStep(kind, now - startedAt);
  const nextAt = started
    ? endsAt + GO_DISPLAY_MS
    : Math.min(endsAt, startedAt + (step.untilMs ?? durationMs));

  useEffect(() => {
    if (finished) return;
    // React が描画した時刻からではなく、次の表示に切り替える時刻までを待つ
    const timer = setTimeout(
      () => setNow(performance.now()),
      Math.max(0, Math.ceil(nextAt - performance.now())),
    );
    return () => clearTimeout(timer);
  }, [finished, nextAt, now]);

  if (finished) return children;
  return (
    <>
      <JointBand joint={joint} />
      <section className="phone-countdown phone-content" aria-live="assertive">
        {/* 最初の表示の前は、スクリーンと同じく数字を出さない。案内の位置が動かないように、空白で高さを取る */}
        <span className="phone-countdown-label">
          {started ? COUNTDOWNS[kind].startLabel : step.label || "\u00a0"}
        </span>
        {!started && <p>{COUNTDOWN_GUIDANCE}</p>}
      </section>
    </>
  );
}
