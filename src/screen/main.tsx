import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createRoom } from "../net/api.ts";
import { ScreenApp, type CreateRoomResult } from "./ui/ScreenApp.tsx";

// React の外で1回だけ作る。StrictMode で描画が2回走っても、ルームは1つ
const room = createRoom().then(
  (roomCode): CreateRoomResult => ({ ok: true, roomCode }),
  (error: unknown): CreateRoomResult => ({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  }),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ScreenApp room={room} />
  </StrictMode>,
);
