import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

// The showcase manages x402 payments explicitly via window.baret.payX402().
// This flag tells the Baret inpage interceptor to pass 402 responses through
// so the page's own payment flow runs (and respects which wallet is connected).
(window as unknown as { __baretX402Managed?: boolean }).__baretX402Managed = true;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
