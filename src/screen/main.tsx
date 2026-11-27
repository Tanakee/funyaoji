import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScreenApp } from "./ui/ScreenApp.tsx";
import { ScreenSession } from "./ui/session.ts";

// ゲームの Canvas は #stage に React の外で置く。ルーム・通信・ゲームは、ページに1つのセッションが持つ
const session = new ScreenSession(document.getElementById("stage")!);
session.open();
// 開発中にこのファイルが差し替わったら、前のセッションの接続とキー入力を片付ける
import.meta.hot?.dispose(() => session.dispose());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ScreenApp session={session} />
  </StrictMode>,
);
