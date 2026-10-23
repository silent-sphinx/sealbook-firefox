import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Popup } from "./Popup";
import "./styles.css";

const host = document.getElementById("root");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Popup />
    </StrictMode>,
  );
}
