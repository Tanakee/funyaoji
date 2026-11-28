import { useSyncExternalStore } from "react";
import { DebugControls } from "./DebugControls.tsx";
import { DebugPanel } from "./DebugPanel.tsx";
import { Hud, RestartHint } from "./Hud.tsx";
import { Lobby } from "./Lobby.tsx";
import { OperatorControls } from "./OperatorControls.tsx";
import { ResultScreen } from "./ResultScreen.tsx";
import type { ScreenSession } from "./session.ts";
import "./screen.css";

/**
 * スクリーンの UI。ゲームの Canvas は #stage に React の外で置いてあり、ここは、その上に重ねる画面を出す。
 * ロビーと結果は不透明な画面で Canvas を隠し、カウントダウンとプレイ中は Canvas を見せる
 */
export function ScreenApp({ session }: { session: ScreenSession }) {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { flow } = view;
  return (
    <>
      {flow.kind === "lobby" && <Lobby session={session} view={view} />}
      {flow.kind === "countdown" && (
        // key で、数字が変わるたびにアニメーションをやり直す
        <div className="overlay countdown" key={flow.count} aria-live="assertive">
          <span className="countdown-number">{flow.count}</span>
        </div>
      )}
      <Hud view={view} />
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
