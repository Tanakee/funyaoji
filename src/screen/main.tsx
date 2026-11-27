import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRoom } from "../net/api.ts";
import { isMockOutcome, ResultScreen } from "./ui/ResultScreen.tsx";
import { ScreenApp, type CreateRoomResult } from "./ui/ScreenApp.tsx";

const mockOutcome = new URLSearchParams(location.search).get("outcome");

// モック表示のときはルームを作らない。通常画面では StrictMode の再描画でも1つだけ作る
const room = isMockOutcome(mockOutcome)
  ? undefined
  : createRoom().then(
      (roomCode): CreateRoomResult => ({ ok: true, roomCode }),
      (error: unknown): CreateRoomResult => ({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      }),
    );

createRoot(document.getElementById("root")!).render(
  <StrictMode>{room ? <ScreenApp room={room} /> : <ResultScreen />}</StrictMode>,
);
