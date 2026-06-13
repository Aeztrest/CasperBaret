/**
 * Baret Casper wallet provider (page MAIN world).
 *
 * Exposes `window.baret` — the connect + x402 surface the showcase calls — and
 * a loosely-compatible `window.CasperWalletProvider` alias so generic Casper
 * dApps can detect us. Each method posts an RPC to the content script (which
 * forwards to the background service worker), then resolves with the result.
 */

import { callPageBridge } from "./page-bridge";

/* ────────────── Public result types ────────────── */

export interface ConnectResult {
  /** Algo-prefixed public key hex ("01"+64hex). */
  publicKey: string;
  /** Bare 64-hex account hash. */
  accountHash: string;
  /** User-facing address (public key hex). */
  address: string;
}

export interface PayX402Result {
  /** base64 X-PAYMENT header value to replay on the retried request. */
  headerValue: string;
}

const ORIGIN = () => window.location.origin;

/* ────────────── Brand glyph for the wallet picker ────────────── */

const ICON_DATA_URL: `data:image/svg+xml;base64,${string}` = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <rect width="24" height="24" rx="6" fill="#FF6A00"/>
    <path d="M12 5L18 18H6Z" fill="#FFFFFF"/>
    <rect x="4" y="19" width="16" height="1.6" rx="0.8" fill="#FFFFFF"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}` as `data:image/svg+xml;base64,${string}`;
})();

/* ────────────── Provider implementation ────────────── */

async function connect(): Promise<ConnectResult> {
  const r = await callPageBridge<{
    publicKey: string;
    accountHash: string;
    authorityAddress: string;
  }>("ws.connect", { origin: ORIGIN() });
  return {
    publicKey: r.publicKey,
    accountHash: r.accountHash,
    address: r.authorityAddress,
  };
}

async function disconnect(): Promise<void> {
  await callPageBridge("ws.disconnect", { origin: ORIGIN() }).catch(() => {});
}

async function isConnected(): Promise<boolean> {
  const r = await callPageBridge<{ connected: boolean }>("ws.isConnected", {
    origin: ORIGIN(),
  }).catch(() => ({ connected: false }));
  return r.connected;
}

async function getActivePublicKey(): Promise<string> {
  const r = await callPageBridge<{ publicKey: string }>("ws.getAddress", {
    origin: ORIGIN(),
  });
  return r.publicKey;
}

async function getNetwork(): Promise<{ network: string; caip2: string }> {
  return callPageBridge<{ network: string; caip2: string }>("ws.getNetwork", {
    origin: ORIGIN(),
  });
}

async function signMessage(message: string): Promise<string> {
  const r = await callPageBridge<{ signedMessage: string }>("ws.signMessage", {
    origin: ORIGIN(),
    message,
  });
  return r.signedMessage;
}

async function signTransaction(transaction: string): Promise<string> {
  const r = await callPageBridge<{ signedTransaction: string }>(
    "ws.signTransaction",
    { origin: ORIGIN(), transaction },
  );
  return r.signedTransaction;
}

/**
 * Pay an x402 payment through the firewall. The background applies the user's
 * policy caps and returns the X-PAYMENT header value to replay.
 */
async function payX402(requirements: unknown): Promise<PayX402Result> {
  const r = await callPageBridge<{ headerValue: string }>("ws.payX402", {
    origin: ORIGIN(),
    requirements,
  });
  return { headerValue: r.headerValue };
}

/* ────────────── Provider object ────────────── */

export const baret = {
  name: "Baret" as const,
  icon: ICON_DATA_URL,
  connect,
  disconnect,
  isConnected,
  getActivePublicKey,
  getNetwork,
  signMessage,
  signTransaction,
  payX402,
};

export type BaretProvider = typeof baret;

/* ────────────── Install hook ────────────── */

export function installCasperWalletProvider(): void {
  // Primary: window.baret — the showcase + docs target this.
  Object.defineProperty(window, "baret", {
    value: baret,
    writable: false,
    configurable: false,
  });
  // Loose compatibility alias for generic Casper Wallet detection.
  try {
    if (!(window as unknown as Record<string, unknown>).CasperWalletProvider) {
      Object.defineProperty(window, "CasperWalletProvider", {
        value: baret,
        writable: false,
        configurable: true,
      });
    }
  } catch {
    /* ignore */
  }
  // Fire a discovery event so adapters that subscribe pick us up.
  try {
    window.dispatchEvent(
      new CustomEvent("baret:walletReady", { detail: { provider: baret } }),
    );
  } catch {
    /* ignore */
  }
}
