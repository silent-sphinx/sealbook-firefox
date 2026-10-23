import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Pair } from "./Pair";
import "../popup/styles.css";

const host = document.getElementById("root");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Pair />
    </StrictMode>,
  );
}
