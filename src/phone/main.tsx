import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhoneApp } from "./PhoneApp.tsx";
import { parseRoom } from "./model.ts";
import "./phone.css";

// iOS の Safari は、user-scalable=no を無視してピンチで拡大する。ジェスチャーごと止める
document.addEventListener("gesturestart", (event) => event.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PhoneApp room={parseRoom(location.search)} />
  </StrictMode>,
);
