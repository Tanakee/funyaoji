import { useState } from "react";
import type { PlayResult } from "../../shared/messages.ts";
import "./screen.css";

type Outcome = PlayResult["outcome"];

const outcomes: Outcome[] = ["goal", "fell", "disconnected"];

export function isMockOutcome(value: string | null): value is Outcome {
  return outcomes.some((outcome) => outcome === value);
}

const mockResults = {
  goal: { outcome: "goal", distanceM: 10, timeMs: 18_420 },
  fell: { outcome: "fell", distanceM: 6.35 },
  disconnected: { outcome: "disconnected", distanceM: 3.8 },
} satisfies Record<Outcome, PlayResult>;

const resultCopy: Record<Outcome, { label: string; title: string; note: string }> = {
  goal: { label: "GOAL", title: "ゴール！", note: "10m を走りきった！" },
  fell: { label: "FELL", title: "転倒", note: "おじさんが転んでしまった" },
  disconnected: { label: "DISCONNECTED", title: "切断", note: "参加者との接続が切れました" },
};

function initialOutcome(): Outcome {
  const requested = new URLSearchParams(window.location.search).get("outcome");
  return outcomes.find((outcome) => outcome === requested) ?? "goal";
}

export function ResultScreen() {
  const [outcome, setOutcome] = useState<Outcome>(initialOutcome);
  const result = mockResults[outcome];
  const copy = resultCopy[outcome];

  function selectOutcome(next: Outcome) {
    setOutcome(next);
    const url = new URL(window.location.href);
    url.searchParams.set("outcome", next);
    window.history.replaceState(null, "", url);
  }

  return (
    <main className={`result-screen result-screen--${outcome}`}>
      <header className="result-header">
        <div className="brand-mark" aria-hidden="true">
          ふ
        </div>
        <div className="brand-name">ふにゃおじ</div>
        <span className="header-mode">10m モード</span>
      </header>

      <div className="result-layout">
        <section className="result-main" aria-labelledby="result-title">
          <div className="eyebrow">
            <span className="eyebrow-line" />
            PLAY RESULT
          </div>
          <div className="result-illustration" aria-hidden="true">
            <div className="illustration-sun" />
            <div className="illustration-track track-back" />
            <div className="illustration-track track-front" />
            <div className="illustration-person">
              <span className="person-head" />
              <span className="person-body" />
              <span className="person-arm arm-left" />
              <span className="person-arm arm-right" />
              <span className="person-leg leg-left" />
              <span className="person-leg leg-right" />
            </div>
          </div>
          <div className="result-heading">
            <span className="result-label">{copy.label}</span>
            <h1 id="result-title">{copy.title}</h1>
            <p>{copy.note}</p>
          </div>
        </section>

        <section className="result-panel" aria-label="プレイ結果">
          <div className="panel-topline">今回の記録</div>
          <div className="metric">
            <span className="metric-label">
              進んだ距離 <span>DISTANCE</span>
            </span>
            <div className="metric-value">
              {result.distanceM.toFixed(2)}
              <small>m</small>
            </div>
          </div>
          {result.outcome === "goal" && (
            <div className="metric metric-time">
              <span className="metric-label">
                ゴールタイム <span>TIME</span>
              </span>
              <div className="metric-value">
                {(result.timeMs / 1000).toFixed(2)}
                <small>秒</small>
              </div>
            </div>
          )}
          <div className="panel-footer">みんなで動かした、ひとつの記録。</div>
        </section>
      </div>

      <nav className="mock-controls" aria-label="モック結果の切り替え">
        <span className="mock-controls-label">表示確認</span>
        {outcomes.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={outcome === item}
            onClick={() => selectOutcome(item)}
          >
            {resultCopy[item].title}
          </button>
        ))}
      </nav>
    </main>
  );
}
