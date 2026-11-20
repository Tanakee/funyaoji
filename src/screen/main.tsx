import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { fetchPing } from "../net/api.ts";
import { ScreenApp, type PingResult } from "./ui/ScreenApp.tsx";

const ping = fetchPing().then(
  ({ count }): PingResult => ({ ok: true, count }),
  (error: unknown): PingResult => ({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  }),
);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ScreenApp ping={ping} />
  </StrictMode>,
);
