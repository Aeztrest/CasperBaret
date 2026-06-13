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
 */

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
  signTransaction: (transactionJson: string) => Promise<string>;
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

  /**
   * Sign (and notionally submit) a Casper transaction. The connected wallet
   * runs its own Baret firewall here as the authoritative gatekeeper, then
   * returns the signed transaction JSON. For the demo we surface a short
   * "signature" identifier derived from the signed payload so the success
   * overlay has something to render — this showcase doesn't broadcast.
   */
  async signAndSendTransaction(
    transactionJson: string,
  ): Promise<{ signature: string; signedTransaction: string }> {
    let signed: string;
    try {
      signed = await this.provider.signTransaction(transactionJson);
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
    return { signature: deriveSignatureId(signed), signedTransaction: signed };
  }

  /** Sign a transaction without broadcasting. */
  async signTransaction(
    transactionJson: string,
  ): Promise<{ signedTransaction: string }> {
    const { signedTransaction } =
      await this.signAndSendTransaction(transactionJson);
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
export function discoverCasperProviders(): CasperWalletProvider[] {
  const out: CasperWalletProvider[] = [];
  const provider = window.baret ?? window.CasperWalletProvider;
  if (provider) out.push(provider);
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

/** Derive a short, stable id from a signed transaction payload for the UI. */
function deriveSignatureId(signed: string): string {
  // Try to pull an approval/signature hex out of the signed tx JSON; otherwise
  // hash the payload into a deterministic display id.
  try {
    const obj = JSON.parse(signed) as Record<string, unknown>;
    const hash = deepFindHex(obj);
    if (hash) return hash;
  } catch {
    /* not JSON — fall through */
  }
  let h = 0;
  for (let i = 0; i < signed.length; i++) {
    h = (Math.imul(31, h) + signed.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, "0").repeat(8).slice(0, 64);
}

function deepFindHex(value: unknown, depth = 0): string | null {
  if (depth > 6 || value == null) return null;
  if (typeof value === "string") {
    return /^[0-9a-f]{64,130}$/i.test(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = deepFindHex(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      const r = deepFindHex(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}
