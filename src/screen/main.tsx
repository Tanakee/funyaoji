import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ScreenApp } from "./ui/ScreenApp.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ScreenApp />
  </StrictMode>,
);
