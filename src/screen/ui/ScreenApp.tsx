import { useSyncExternalStore } from "react";
import { COUNTDOWN_GUIDANCE } from "../../shared/countdown.ts";
import { DebugControls } from "./DebugControls.tsx";
import { DebugPanel } from "./DebugPanel.tsx";
import { HowTo } from "./HowTo.tsx";
import { RestartHint } from "./Hud.tsx";
import { Lobby } from "./Lobby.tsx";
import { OperatorControls } from "./OperatorControls.tsx";
import { ResultScreen } from "./ResultScreen.tsx";
import type { ScreenSession } from "./session.ts";
import "./screen.css";

/**
 * スクリーンの UI。ゲームの Canvas は #stage に React の外で置いてあり、ここは、その上に重ねる画面を出す。
 * ロビーと結果でも Canvas のおじさんと地面を見せる。縦向きのスマホで ?debug を開いたときは背景を塗る
 */
export function ScreenApp({ session }: { session: ScreenSession }) {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { flow } = view;
  return (
    <>
      {flow.kind === "lobby" && <Lobby session={session} view={view} />}
      {flow.kind === "howto" && <HowTo view={view} ready={flow.ready} />}
      {flow.kind === "countdown" && (
        // key で、数字が変わるたびにアニメーションをやり直す
        <div className="overlay countdown" aria-live="assertive">
          {/* 最初の表示の前（遅いスマホに届くのを待つあいだ）は、空白で高さだけを取る */}
          <span className="countdown-number" key={flow.step.label}>
            {flow.step.label || "\u00a0"}
          </span>
          <p className="countdown-guidance">{COUNTDOWN_GUIDANCE}</p>
        </div>
      )}
      {view.startLabel !== undefined && (
        <div className="overlay countdown" aria-live="assertive">
          <span className="countdown-number countdown-start">{view.startLabel}</span>
        </div>
      )}
      {flow.kind === "finish" && (
        <div className="overlay countdown" aria-live="assertive">
          <span className="finish-label">FINISH</span>
        </div>
      )}
      <RestartHint view={view} />
      <DebugControls session={session} view={view} />
      {flow.kind === "result" && (
        <ResultScreen session={session} view={view} result={flow.result} />
      )}
      <DebugPanel session={session} view={view} />
      <OperatorControls session={session} view={view} />
    </>
  );
}
