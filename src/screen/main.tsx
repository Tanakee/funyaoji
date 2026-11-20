import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { fetchPing } from "../net/api.ts";
import { ScreenApp } from "./ui/ScreenApp.tsx";

const ping = fetchPing();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ScreenApp ping={ping} />
  </StrictMode>,
);
