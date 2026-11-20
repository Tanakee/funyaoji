import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhoneApp } from "./PhoneApp.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PhoneApp />
  </StrictMode>,
);
