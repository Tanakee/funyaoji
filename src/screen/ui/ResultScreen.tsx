import type { PlayResult } from "../../shared/messages.ts";
import type { ScreenSession, ScreenView } from "./session.ts";

type Outcome = PlayResult["outcome"];

const resultCopy: Record<Outcome, { label: string; title: string; note: string }> = {
  goal: { label: "GOAL", title: "ゴール！", note: "10m を走りきった！" },
  fell: { label: "FELL", title: "転倒", note: "おじさんが転んでしまった" },
  disconnected: { label: "DISCONNECTED", title: "切断", note: "参加者との接続が切れました" },
};

export function ResultScreen({
  session,
  view,
  result,
}: {
  session: ScreenSession;
  view: ScreenView;
  result: PlayResult;
}) {
  const { outcome } = result;
  const copy = resultCopy[outcome];

  return (
    <main className={`overlay result-screen result-screen--${outcome}`}>
      <header className="screen-header">
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
          {outcome === "goal" && (
            <div className="result-ranking" aria-live="polite">
              {view.ranking.status === "loading" && <p>ランキングを保存中…</p>}
              {view.ranking.status === "failed" && <p>ランキングを保存できませんでした</p>}
              {view.ranking.status === "ready" && (
                <>
                  <p>今回の順位：{view.ranking.data.entry.rank}位</p>
                  <ol aria-label="ランキング上位10件">
                    {view.ranking.data.rankings.map((entry, index) => (
                      <li key={`${entry.createdAt}-${index}`}>
                        {entry.rank}位 {entry.teamName} {(entry.timeMs / 1000).toFixed(2)}秒
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          )}
          <div className="panel-footer">みんなで動かした、ひとつの記録。</div>
        </section>
      </div>

      <p className="result-hint">
        <kbd>Space</kbd> か <kbd>R</kbd> でもう一度（同じ4人・同じ担当）
      </p>
      {view.debug.enabled && (
        <button
          type="button"
          className="debug-button debug-button--start"
          onClick={() => session.restart()}
        >
          もう一度
        </button>
      )}
    </main>
  );
}
