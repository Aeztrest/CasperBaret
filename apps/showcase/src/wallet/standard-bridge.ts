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
    sign: (deployJson: string, pk: string) => Promise<{ deployJson: string }>;
    signTransaction: (deployJson: string, pk: string) => Promise<{ deployJson: string }>;
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
      return res?.deployJson ?? deployJson;
    },

    payX402: async () => {
      throw new Error(
        "x402 micropayments require Baret Wallet. Connect Baret to use Scrybe.",
      );
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

/** Minimal shape returned for each EIP-6963 announced wallet. */
export interface Eip6963WalletInfo {
  name: string;
  icon: string;
  rdns: string;
}

const BARET_RDNS = "dev.baret.wallet";

/**
 * Synchronously discover all EIP-6963 wallets (MetaMask, Phantom, etc.).
 * Dispatches `eip6963:requestProvider`; all conforming wallets respond
 * synchronously via `eip6963:announceProvider`. Baret's own EVM provider
 * is filtered out (it's already shown as the Casper wallet).
 */
export function discoverEip6963Providers(): Eip6963WalletInfo[] {
  const found: Eip6963WalletInfo[] = [];
  const seen = new Set<string>();

  const handler = (event: Event) => {
    const info = (event as CustomEvent<{ info: Eip6963WalletInfo }>).detail?.info;
    if (!info?.rdns || seen.has(info.rdns) || info.rdns === BARET_RDNS) return;
    seen.add(info.rdns);
    found.push({ name: info.name, icon: info.icon, rdns: info.rdns });
  };

  window.addEventListener("eip6963:announceProvider", handler);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  window.removeEventListener("eip6963:announceProvider", handler);

  return found;
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
