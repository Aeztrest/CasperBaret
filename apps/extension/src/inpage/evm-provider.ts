/**
 * Baret EIP-1193 provider + EIP-6963 announcement (page MAIN world).
 *
 * Installs `window.ethereum` and announces via `eip6963:announceProvider` so
 * EVM dApps (RainbowKit, wagmi, ethers, etc.) discover Baret as a wallet.
 *
 * State-changing methods are forwarded to the background service worker
 * through the existing content-script bridge (same `callPageBridge` used by
 * the Casper provider). Read-only JSON-RPC is proxied directly to the Monad
 * testnet RPC endpoint to avoid background hops.
 *
 * All `evm.*` methods are routed to `background/evm/handlers.ts` via the
 * `bx-wallet-standard` port — no new port is needed.
 */

import { callPageBridge } from "./page-bridge";

const MONAD_RPC_URL = "https://testnet-rpc.monad.xyz";
const MONAD_CHAIN_ID_HEX = "0x279f"; // 10143

const ICON_DATA_URL: `data:image/svg+xml;base64,${string}` = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
    <rect width="24" height="24" rx="6" fill="#FF6A00"/>
    <path d="M12 5L18 18H6Z" fill="#FFFFFF"/>
    <rect x="4" y="19" width="16" height="1.6" rx="0.8" fill="#FFFFFF"/>
  </svg>`;
  return `data:image/svg+xml;base64,${btoa(svg)}` as `data:image/svg+xml;base64,${string}`;
})();

type ProviderEvent = "connect" | "disconnect" | "accountsChanged" | "chainChanged" | "message";

interface RequestArgs {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

class BaretEvmProvider {
  readonly isBaretWallet = true;
  readonly isMetaMask = false;

  private listeners = new Map<ProviderEvent, Set<(...args: unknown[]) => void>>();
  private cachedChainId = MONAD_CHAIN_ID_HEX;

  async request(args: RequestArgs): Promise<unknown> {
    const { method } = args;
    const params = (Array.isArray(args.params) ? args.params : []) as unknown[];
    const origin = window.location.origin;

    switch (method) {
      case "eth_requestAccounts": {
        const r = await callPageBridge<{ accounts: string[] }>("evm.requestAccounts", { origin });
        this.emit("accountsChanged", r.accounts);
        this.emit("connect", { chainId: this.cachedChainId });
        return r.accounts;
      }

      case "eth_accounts": {
        const r = await callPageBridge<{ accounts: string[] }>("evm.accounts", { origin });
        return r.accounts;
      }

      case "eth_chainId": {
        const r = await callPageBridge<{ chainId: string }>("evm.chainId", { origin });
        this.cachedChainId = r.chainId;
        return r.chainId;
      }

      case "net_version": {
        const r = await callPageBridge<{ chainId: string }>("evm.chainId", { origin });
        return String(Number.parseInt(r.chainId, 16));
      }

      case "wallet_switchEthereumChain": {
        const first = (params[0] ?? {}) as { chainId?: string };
        const chainId = first.chainId ?? MONAD_CHAIN_ID_HEX;
        await callPageBridge<{ ok: true }>("evm.switchChain", { origin, chainId });
        this.cachedChainId = chainId;
        this.emit("chainChanged", chainId);
        return null;
      }

      case "personal_sign": {
        const { message, address } = decodePersonalSign(params);
        const r = await callPageBridge<{ signature: string }>("evm.personalSign", { origin, message, address });
        return r.signature;
      }

      case "eth_sign": {
        const address = String(params[0] ?? "");
        const message = String(params[1] ?? "");
        const r = await callPageBridge<{ signature: string }>("evm.personalSign", { origin, message, address });
        return r.signature;
      }

      case "eth_signTypedData_v4": {
        const address = String(params[0] ?? "");
        const raw = params[1];
        const typedData = typeof raw === "string" ? raw : JSON.stringify(raw);
        const r = await callPageBridge<{ signature: string }>("evm.signTypedData", { origin, address, typedData });
        return r.signature;
      }

      case "eth_sendTransaction": {
        const transaction = params[0] ?? {};
        const r = await callPageBridge<{ txHash: string }>("evm.sendTransaction", { origin, transaction });
        return r.txHash;
      }

      case "eth_signTransaction": {
        const transaction = params[0] ?? {};
        const r = await callPageBridge<{ signedTransaction: string }>("evm.signTransaction", { origin, transaction });
        return r.signedTransaction;
      }

      default:
        return rpcProxy(method, params);
    }
  }

  async enable(): Promise<string[]> {
    return this.request({ method: "eth_requestAccounts" }) as Promise<string[]>;
  }

  on(event: ProviderEvent, handler: (...args: unknown[]) => void): this {
    let set = this.listeners.get(event);
    if (!set) { set = new Set(); this.listeners.set(event, set); }
    set.add(handler);
    return this;
  }

  removeListener(event: ProviderEvent, handler: (...args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(handler);
    return this;
  }

  private emit(event: ProviderEvent, ...args: unknown[]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const fn of handlers) {
      try { fn(...args); } catch { /* ignore */ }
    }
  }
}

function decodePersonalSign(params: unknown[]): { message: string; address: string } {
  const a = String(params[0] ?? "");
  const b = String(params[1] ?? "");
  const aIsAddr = /^0x[0-9a-fA-F]{40}$/.test(a);
  if (aIsAddr) return { message: b, address: a };
  return { message: a, address: b };
}

async function rpcProxy(method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(MONAD_RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? `RPC error for ${method}`);
  return json.result;
}

export function installEip1193Provider(): void {
  const provider = new BaretEvmProvider();

  try {
    Object.defineProperty(window, "ethereum", {
      value: provider,
      writable: false,
      configurable: true,
    });
  } catch {
    (window as unknown as { ethereum?: unknown }).ethereum ??= provider;
  }

  const info = {
    uuid: "a4e2f3b1-baret-4c8d-9e2a-baret000monad",
    name: "Baret",
    icon: ICON_DATA_URL,
    rdns: "dev.baret.wallet",
  };

  const announce = () => {
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({ info, provider }),
      }),
    );
  };

  window.addEventListener("eip6963:requestProvider", announce);
  // Announce immediately so wallets that already fired the request event
  // (before our script ran) can still discover us.
  announce();
}
