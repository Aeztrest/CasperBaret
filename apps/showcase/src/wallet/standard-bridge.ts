/**
 * Showcase ↔ Baret Casper wallet bridge.
 *
 * The Baret browser extension injects a provider at `window.baret` (with a
 * loose `window.CasperWalletProvider` alias) in the page's MAIN world. This
 * bridge wraps that provider into the small adapter shape the existing site
 * code consumes: `connect`, `account_pubkey`, `signTransaction`,
 * `signAndSendTransaction`, `signMessage`, and a `payX402(requirements)`
 * passthrough that runs the wallet's x402 firewall and returns an X-PAYMENT
 * header value.
 *
 * For wallets without native payX402 (e.g. official Casper Wallet), we
 * implement x402 signing client-side using sigScheme "casperMessage":
 * the EIP-712 digest is hex-encoded and signed as a string; the server's
 * verifyX402Signature handles this via the sigScheme field.
 *
 * Imports are intentionally from casper-js-sdk and @casper-ecosystem/casper-eip-712
 * directly (NOT via @casper-baret/casper-core dist) to avoid bundling keys.ts
 * which uses Node.js Buffer in a way that breaks vite-plugin-node-polyfills
 * for workspace packages outside the Vite root.
 */

import { hashTypedData, buildDomain, CASPER_DOMAIN_TYPES } from "@casper-ecosystem/casper-eip-712";
import { PublicKey } from "casper-js-sdk";
import type { CasperPaymentRequirements, ExactCasperPayload } from "@casper-baret/casper-core";

// Casper's public RPC nodes don't send CORS headers, so the browser can't
// call them directly (preflight fails with no Access-Control-Allow-Origin).
// The server relays the already-signed transaction instead — see
// apps/server/src/api/routes/broadcast.ts.
const API_BASE =
  (import.meta.env.VITE_SCRYBE_API as string | undefined) ??
  "https://baret-server.onrender.com";

// ── Inline x402 helpers ────────────────────────────────────────────────────
// Kept local to avoid importing casper-core dist files that use Node.js Buffer
// as a global — that import chain breaks vite-plugin-node-polyfills for
// workspace packages outside the Vite root.

const X402_VERSION = 2;

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from",         type: "address"  },
    { name: "to",           type: "address"  },
    { name: "value",        type: "uint256"  },
    { name: "validAfter",   type: "uint256"  },
    { name: "validBefore",  type: "uint256"  },
    { name: "nonce",        type: "bytes32"  },
  ],
};

function toX402Addr(ref: string): string {
  const h = ref.replace(/^0x/i, "").replace(/^account-hash-/i, "").replace(/^hash-/i, "");
  if (/^[0-9a-fA-F]{66}$/.test(h) && h.slice(0, 2) === "00") return h.toLowerCase();
  if (/^[0-9a-fA-F]{64}$/.test(h)) return ("00" + h).toLowerCase();
  throw new Error(`cannot convert to x402 address: ${ref}`);
}

function randomNonceHex(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uint8ArrayToHex(arr: Uint8Array): string {
  return Array.from(arr, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeX402Header(payload: ExactCasperPayload, accepted: CasperPaymentRequirements): string {
  return btoa(JSON.stringify({ x402Version: X402_VERSION, payload, accepted }));
}

// ──────────────────────────────────────────────────────────────────────────

export class WalletStandardBridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "WalletStandardBridgeError";
  }
}

export interface BridgeAccount {
  /** User-facing address (public key hex). */
  walletAddress: string;
  /** Bare 64-hex account hash. */
  accountHash: string;
  /** Algo-prefixed public key hex. */
  publicKey: string;
}

/** Result of `window.baret.connect()`. */
interface BaretConnectResult {
  publicKey: string;
  accountHash: string;
  address: string;
}

/** Result of `window.baret.payX402()`. */
export interface PayX402Result {
  headerValue: string;
}

/**
 * The Baret Casper provider injected as `window.baret`. We only declare the
 * surface the showcase needs.
 */
export interface CasperWalletProvider {
  name: string;
  icon: string;
  connect: () => Promise<BaretConnectResult>;
  disconnect: () => Promise<void>;
  isConnected: () => Promise<boolean>;
  getActivePublicKey: () => Promise<string>;
  getNetwork: () => Promise<{ network: string; caip2: string }>;
  signMessage: (message: string) => Promise<string>;
  /** `label`/`claimedChange`, when given, are shown on Baret's Sign Request
   * screen as a claim from this site about the expected outcome (e.g. an
   * off-chain follow-up payout) — other wallets simply ignore them. */
  signTransaction: (
    transactionJson: string,
    label?: string,
    claimedChange?: { symbol: string; amount: string },
  ) => Promise<string>;
  payX402: (requirements: unknown) => Promise<PayX402Result>;
}

declare global {
  interface Window {
    baret?: CasperWalletProvider;
    CasperWalletProvider?: CasperWalletProvider;
  }
}

export class WalletStandardBridge {
  constructor(
    public readonly provider: CasperWalletProvider,
    public readonly account: BridgeAccount,
  ) {}

  get name(): string {
    return this.provider.name;
  }
  get icon(): string {
    return this.provider.icon;
  }

  static async connect(
    provider: CasperWalletProvider,
  ): Promise<WalletStandardBridge> {
    let result: BaretConnectResult;
    try {
      result = await provider.connect();
    } catch (err) {
      throw new WalletStandardBridgeError(
        err instanceof Error ? err.message : String(err),
        "CONNECT_REJECTED",
      );
    }
    if (!result?.publicKey || !result?.accountHash) {
      throw new WalletStandardBridgeError(
        `${provider.name} did not return an account`,
        "NO_ACCOUNTS",
      );
    }
    return new WalletStandardBridge(provider, {
      walletAddress: result.address || result.publicKey,
      accountHash: result.accountHash,
      publicKey: result.publicKey,
    });
  }

  /** The connected account-hash — the canonical Casper account identifier. */
  account_pubkey(): string {
    return this.account.accountHash;
  }

  get connectedAccount(): BridgeAccount {
    return this.account;
  }

  async disconnect(): Promise<void> {
    await this.provider.disconnect().catch(() => {});
  }

  private async signOnly(
    transactionJson: string,
    label?: string,
    claimedChange?: { symbol: string; amount: string },
  ): Promise<string> {
    let signed: string;
    try {
      signed = await this.provider.signTransaction(transactionJson, label, claimedChange);
    } catch (err) {
      throw new WalletStandardBridgeError(
        err instanceof Error ? err.message : String(err),
        "SIGN_REJECTED",
      );
    }
    if (!signed) {
      throw new WalletStandardBridgeError(
        `${this.provider.name} did not return a signed transaction`,
        "NO_SIGNED_TX",
      );
    }
    return signed;
  }

  /**
   * Sign a Casper transaction with the connected wallet (Baret's firewall is
   * the authoritative gatekeeper here), then relay it through the server to
   * actually submit it to the network (public Casper RPC nodes don't allow
   * browser CORS) and return the real, on-chain transaction hash.
   */
  async signAndSendTransaction(
    transactionJson: string,
  ): Promise<{ signature: string; signedTransaction: string }> {
    const signed = await this.signOnly(transactionJson);

    let res: { success?: boolean; transactionHash?: string; error?: string };
    try {
      res = await fetch(`${API_BASE}/demo/broadcast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction: JSON.parse(signed) }),
      }).then((r) => r.json());
    } catch (err) {
      throw new WalletStandardBridgeError(
        `Broadcast failed: ${err instanceof Error ? err.message : String(err)}`,
        "BROADCAST_FAILED",
      );
    }
    if (!res.success || !res.transactionHash) {
      throw new WalletStandardBridgeError(
        res.error ?? "Broadcast failed at the server.",
        "BROADCAST_FAILED",
      );
    }

    return { signature: res.transactionHash, signedTransaction: signed };
  }

  /**
   * Sign a transaction without broadcasting — used when a server relay will
   * submit it instead (e.g. NovaSwap's real swap, which needs the server to
   * observe the treasury's balance change before paying out). `label` is
   * shown on Baret's Sign Request screen as the site's own claim about the
   * expected outcome (Baret's analyzer can only simulate this transaction's
   * own on-chain effect, not a separate off-chain follow-up like a payout).
   */
  async signTransaction(
    transactionJson: string,
    label?: string,
    claimedChange?: { symbol: string; amount: string },
  ): Promise<{ signedTransaction: string }> {
    const signedTransaction = await this.signOnly(transactionJson, label, claimedChange);
    return { signedTransaction };
  }

  /** Sign an arbitrary message (Casper signMessage). */
  async signMessage(message: string): Promise<{ signedMessage: string }> {
    const signedMessage = await this.provider.signMessage(message);
    return { signedMessage };
  }

  /**
   * Run an x402 payment through the wallet firewall. Returns the X-PAYMENT
   * header value to replay on the retried request. The wallet applies the
   * user's policy caps; payments outside caps surface a popup or are refused.
   */
  async payX402(requirements: unknown): Promise<PayX402Result> {
    try {
      return await this.provider.payX402(requirements);
    } catch (err) {
      throw new WalletStandardBridgeError(
        err instanceof Error ? err.message : String(err),
        "X402_FAILED",
      );
    }
  }
}

/**
 * Discover the Baret Casper provider on the page. Baret installs itself as
 * `window.baret` (with a `window.CasperWalletProvider` alias). Returns a
 * stable list the picker renders; empty when the extension isn't present yet.
 */
// Official Casper Wallet icon (Casper Network red diamond / node shape)
const OFFICIAL_CASPER_ICON = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <rect width="24" height="24" rx="5" fill="#1A1A2E"/>
    <polygon points="12,3 20,8 20,16 12,21 4,16 4,8" fill="none" stroke="#FF473A" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="2.5" fill="#FF473A"/>
    <line x1="12" y1="5" x2="12" y2="9.5" stroke="#FF473A" stroke-width="1" opacity="0.7"/>
    <line x1="12" y1="14.5" x2="12" y2="19" stroke="#FF473A" stroke-width="1" opacity="0.7"/>
    <line x1="5.5" y1="8.5" x2="9.8" y2="10.8" stroke="#FF473A" stroke-width="1" opacity="0.7"/>
    <line x1="14.2" y1="13.2" x2="18.5" y2="15.5" stroke="#FF473A" stroke-width="1" opacity="0.7"/>
    <line x1="18.5" y1="8.5" x2="14.2" y2="10.8" stroke="#FF473A" stroke-width="1" opacity="0.7"/>
    <line x1="9.8" y1="13.2" x2="5.5" y2="15.5" stroke="#FF473A" stroke-width="1" opacity="0.7"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}`;
})();

/**
 * Official Casper Wallet (by Casper Association) sets window.CasperWalletProvider
 * as a constructor function, not a plain provider object.  We wrap it so it
 * appears in the picker with the right name/icon and a working connect flow.
 */
function wrapOfficialCasperWallet(ctor: unknown): CasperWalletProvider {
  type OfficialProvider = {
    requestConnection: () => Promise<boolean | void>;
    disconnectFromSite: () => Promise<void>;
    getActivePublicKey: () => Promise<string>;
    isConnected: () => Promise<boolean>;
    signMessage: (msg: string, pk: string) => Promise<{ signatureHex: string }>;
    // Confirmed live: resolves { cancelled, signatureHex, signature } — a
    // raw signature over the transaction's own hash, not a re-serialized
    // signed deploy/transaction. There is no `deployJson` field to read.
    sign: (deployJson: string, pk: string) => Promise<{ cancelled?: boolean; signatureHex?: string }>;
    signTransaction: (deployJson: string, pk: string) => Promise<{ cancelled?: boolean; signatureHex?: string }>;
  };
  const factory = ctor as () => OfficialProvider;
  let inst: OfficialProvider | null = null;
  const get = () => { inst ??= factory(); return inst; };

  return {
    name: "Casper Wallet",
    icon: OFFICIAL_CASPER_ICON,

    connect: () =>
      new Promise((resolve, reject) => {
        const provider = get();
        // The official wallet fires "casper-wallet:connected" after requestConnection.
        const onConnected = () => {
          provider.getActivePublicKey().then(
            (pk) => resolve({ publicKey: pk, accountHash: pk, address: pk }),
            reject,
          );
        };
        window.addEventListener("casper-wallet:connected", onConnected, { once: true });
        Promise.resolve(provider.requestConnection())
          .then((approved) => {
            // Some builds resolve the promise directly (true = connected)
            if (approved === true) {
              window.removeEventListener("casper-wallet:connected", onConnected);
              provider.getActivePublicKey().then(
                (pk) => resolve({ publicKey: pk, accountHash: pk, address: pk }),
                reject,
              );
            } else if (approved === false) {
              window.removeEventListener("casper-wallet:connected", onConnected);
              reject(new Error("Connection rejected by Casper Wallet"));
            }
            // If void, wait for the event (handled above)
          })
          .catch((err) => {
            window.removeEventListener("casper-wallet:connected", onConnected);
            reject(err);
          });
      }),

    disconnect: async () => { await get().disconnectFromSite().catch(() => {}); },
    isConnected: async () => get().isConnected().catch(() => false),
    getActivePublicKey: async () => get().getActivePublicKey(),
    getNetwork: async () => ({ network: "testnet", caip2: "casper:casper-test" }),

    signMessage: async (message: string) => {
      const pk = await get().getActivePublicKey();
      const res = await get().signMessage(message, pk);
      return res?.signatureHex ?? "";
    },

    signTransaction: async (deployJson: string) => {
      const pk = await get().getActivePublicKey();
      // Official wallet has both .sign() and .signTransaction() depending on version
      const signFn = get().sign ?? get().signTransaction;
      const res = await signFn(deployJson, pk);
      if (res?.cancelled) {
        throw new Error("User declined the signature in Casper Wallet.");
      }
      if (!res?.signatureHex) {
        throw new Error(
          "Casper Wallet did not return a signed transaction for this request.",
        );
      }
      // Confirmed live: this wallet's sign() only ever returns a raw
      // signature over the transaction's own hash (no algo-byte prefix),
      // never a re-serialized signed deploy/transaction — attach it as an
      // approval on the ORIGINAL payload ourselves. The public key's own
      // first byte ("01" ed25519 / "02" secp256k1) IS the algo prefix
      // approvals expect, so no separate lookup is needed.
      const algoByte = pk.slice(0, 2);
      const parsed = JSON.parse(deployJson) as { approvals?: unknown[] };
      const approvals = Array.isArray(parsed.approvals) ? parsed.approvals : [];
      approvals.push({ signer: pk, signature: algoByte + res.signatureHex });
      const signed = JSON.stringify({ ...parsed, approvals });
      return signed;
    },

    payX402: async (requirements: unknown) => {
      const req = requirements as CasperPaymentRequirements;
      const pubKeyStr = await get().getActivePublicKey();

      // Derive account hash from the algo-prefixed public key
      const sdkPubKey = PublicKey.fromHex(pubKeyStr);
      const accountHashHex = sdkPubKey.accountHash().toHex();
      const fromX402 = toX402Addr(accountHashHex);
      const toX402 = toX402Addr(req.payTo);

      const name = (req.extra.name ?? req.extra.assetName) as string | undefined;
      const version = (req.extra.version as string | undefined) ?? "1";
      if (!name) throw new Error("payment requirements missing extra.name for EIP-712 domain");

      const assetHex = req.asset.replace(/^0x/i, "").toLowerCase();
      const now = Math.floor(Date.now() / 1000);
      const validAfter = now - 600;
      const validBefore = now + req.maxTimeoutSeconds;
      const nonceHex = randomNonceHex();

      const domain = buildDomain(name, version, req.network, "0x" + assetHex);
      const message = {
        from: "0x" + fromX402,
        to: "0x" + toX402,
        value: BigInt(req.amount),
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce: "0x" + nonceHex,
      };

      const digest = hashTypedData(
        domain,
        TRANSFER_WITH_AUTHORIZATION_TYPES,
        "TransferWithAuthorization",
        message,
        { domainTypes: CASPER_DOMAIN_TYPES },
      );

      const digestHex = uint8ArrayToHex(digest);

      // Debug: log the exact values so we can identify what the wallet signs.
      // Open browser DevTools → Console to see these values.
      console.info("[casper-wallet-x402] signing", { pubKeyStr, digestHex });

      const sigResult = await get().signMessage(digestHex, pubKeyStr);
      const rawSigHex = sigResult?.signatureHex ?? sigResult as unknown as string ?? "";
      console.info("[casper-wallet-x402] signature returned", {
        rawSigHex,
        cancelled: (sigResult as { cancelled?: boolean })?.cancelled,
      });
      let sigHex = rawSigHex.replace(/^0x/, "");

      // Normalize to 65 bytes (algo byte + 64 raw): some wallet builds return
      // 64-byte raw signatures without the algo prefix.
      if (sigHex.length === 128) {
        const algoByte = pubKeyStr.startsWith("02") ? "02" : "01";
        sigHex = algoByte + sigHex;
      }

      const payload: ExactCasperPayload = {
        signature: sigHex,
        publicKey: pubKeyStr,
        authorization: {
          from: fromX402,
          to: toX402,
          value: req.amount,
          validAfter: String(validAfter),
          validBefore: String(validBefore),
          nonce: nonceHex,
        },
        sigScheme: "casperMessage",
      };

      return { headerValue: encodeX402Header(payload, req) };
    },
  };
}

export function discoverCasperProviders(): CasperWalletProvider[] {
  const out: CasperWalletProvider[] = [];
  if (window.baret) out.push(window.baret);

  const cwp = window.CasperWalletProvider;
  if (cwp && cwp !== window.baret) {
    if (typeof cwp === "function") {
      // Official Casper Wallet sets window.CasperWalletProvider as a constructor
      out.push(wrapOfficialCasperWallet(cwp));
    } else if (typeof (cwp as { name?: string }).name === "string" && (cwp as { name?: string }).name) {
      // Another plain Casper provider object with a proper name
      out.push(cwp as CasperWalletProvider);
    }
    // Skip nameless objects — they're incomplete / stale aliases
  }
  return out;
}


/**
 * Wait briefly for the Baret provider to register. The inpage script fires a
 * `baret:walletReady` event on install; we resolve as soon as it lands (or the
 * provider is already present), otherwise time out.
 */
export function waitForCasperProvider(timeoutMs = 1500): Promise<CasperWalletProvider | null> {
  if (window.baret ?? window.CasperWalletProvider) {
    return Promise.resolve(window.baret ?? window.CasperWalletProvider ?? null);
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (p: CasperWalletProvider | null) => {
      if (done) return;
      done = true;
      window.removeEventListener("baret:walletReady", onReady);
      resolve(p);
    };
    const onReady = () => finish(window.baret ?? window.CasperWalletProvider ?? null);
    window.addEventListener("baret:walletReady", onReady);
    setTimeout(() => finish(window.baret ?? window.CasperWalletProvider ?? null), timeoutMs);
  });
}

