// 「はじめる」の画面（S1）・待つ型・お知らせ型（docs/screens.md）
import { useState } from "react";
import { HANGING_OJISAN, SITTING_OJISAN } from "../../shared/figures.tsx";
import type { ScreenGate } from "./gate.ts";

/** ボタンが沈むのが見えてから、次に進むまでの時間 */
const PRESS_MS = 150;

export function GateScreen({ gate, onStart }: { gate: ScreenGate; onStart: () => void }) {
  switch (gate.kind) {
    case "loading":
    case "start":
      return (
        <main className="overlay gate">
          <h1 className="gate-title gate-title--game">ふにゃおじ</h1>
          {HANGING_OJISAN}
          {gate.kind === "loading" ? (
            <>
              <div
                className="gate-progress"
                role="progressbar"
                aria-label="読み込みの進み"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(gate.progress * 100)}
              >
                <div
                  className="gate-progress-bar"
                  style={{ transform: `scaleX(${gate.progress})` }}
                />
              </div>
              <p className="gate-text">読み込んでいます</p>
            </>
          ) : (
            <>
              <PressButton
                onPress={() => {
                  // 全画面は、押した操作の中でしか頼めない。断られても先に進む
                  document.documentElement.requestFullscreen?.().catch(() => {});
                }}
                onDone={onStart}
              >
                はじめる
              </PressButton>
              <p className="gate-text">押すと音が鳴り、全画面になります</p>
            </>
          )}
        </main>
      );
    case "waiting":
      return (
        <main className="overlay gate" aria-live="polite">
          {/* 背景はすぐに塗り、中身だけを遅れて出す */}
          <div className="gate-delayed gate-body">
            <div className="figure-swing">{HANGING_OJISAN}</div>
            <h1 className="gate-title">{gate.title}</h1>
            <p className="gate-text">スマホを立てると、糸を引けます</p>
          </div>
        </main>
      );
    case "notice":
      return (
        <main className="overlay gate" role="alert">
          {SITTING_OJISAN}
          <h1 className="gate-title">{gate.title}</h1>
          <p className="gate-text">{gate.reason}</p>
          {gate.next && <p className="gate-text">{gate.next}</p>}
          {gate.reload && <PressButton onDone={() => location.reload()}>読み込み直す</PressButton>}
        </main>
      );
  }
}

/** 押すとすぐ沈み、沈んだのが見えてから onDone を呼ぶ */
function PressButton({
  children,
  onPress,
  onDone,
}: {
  children: string;
  onPress?: () => void;
  onDone: () => void;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      type="button"
      className="gate-button"
      data-pressed={pressed || undefined}
      onClick={() => {
        if (pressed) return;
        setPressed(true);
        onPress?.();
        setTimeout(onDone, PRESS_MS);
      }}
    >
      {children}
    </button>
  );
}
