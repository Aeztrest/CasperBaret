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
// Official Casper Wallet icon — the wallet's real mark (red rounded tile,
// white "C" glyph), background keyed out to transparent.
const OFFICIAL_CASPER_ICON =
  "data:image/png;base64,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";

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

