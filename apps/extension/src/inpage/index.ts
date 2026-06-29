/**
 * Inpage entry point. Runs in the page's MAIN world.
 *
 * Installs the Baret Casper wallet provider as `window.baret` (plus a loose
 * `window.CasperWalletProvider` alias) and the x402 fetch interceptor. The
 * showcase calls `window.baret.connect()` and `window.baret.payX402(req)`;
 * HTTP-402 traffic on the page is auto-routed through Baret for policy review.
 */

import { installCasperWalletProvider } from "./wallet-standard";
import { installX402Interceptor } from "./x402-interceptor";

try {
  installCasperWalletProvider();
  console.info("[BARET] Casper wallet provider installed (window.baret)");
} catch (err) {
  console.error("[BARET] wallet provider install failed:", err);
}

try {
  installX402Interceptor();
} catch (err) {
  console.error("[BARET] x402 interceptor failed:", err);
}
