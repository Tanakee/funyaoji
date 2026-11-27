import { useSyncExternalStore } from "react";
import { DebugPanel } from "./DebugPanel.tsx";
import { Hud } from "./Hud.tsx";
import { Lobby } from "./Lobby.tsx";
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
      {flow.kind === "lobby" && <Lobby view={view} />}
      {flow.kind === "countdown" && (
        // key で、数字が変わるたびにアニメーションをやり直す
        <div className="overlay countdown" key={flow.count} aria-live="assertive">
          <span className="countdown-number">{flow.count}</span>
        </div>
      )}
      <Hud view={view} />
      {flow.kind === "result" && <ResultScreen result={flow.result} />}
      <DebugPanel session={session} view={view} />
    </>
  );
}
