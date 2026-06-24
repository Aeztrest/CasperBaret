import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WalletContextProvider } from "../shared/state-context";
import { PopupApp } from "./PopupApp";
import "../index.css";

// Opened as a standalone sign/connect window (popup-window.ts appends ?popout=1)?
// Switch the canvas from the fixed 360×600 toolbar-popup size to viewport-fill so
// the wallet spans the whole window instead of sitting in a box in its corner.
if (new URLSearchParams(window.location.search).has("popout")) {
  document.documentElement.dataset.popout = "true";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WalletContextProvider surface="popup">
      <PopupApp />
    </WalletContextProvider>
  </StrictMode>,
);
