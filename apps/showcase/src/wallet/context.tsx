/**
 * Showcase wallet context (Casper build).
 *
 * Discovers the Baret Casper provider injected on the page (`window.baret`)
 * and exposes the adapter shape the existing sites consume.
 *
 * Design rules:
 *  - `connect(provider)` ALWAYS requires an explicit provider. We never auto-
 *    pick from the list — that's how malicious wallets hijack the flow.
 *  - When a site action ("Swap", "Mint", etc.) needs a wallet, the site
 *    calls `openWalletModal()` — the user explicitly picks Baret from the
 *    picker.
 *  - The wallet modal renders ONCE inside the provider so every route
 *    shares the same picker state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  discoverCasperProviders,
  waitForCasperProvider,
  WalletStandardBridge,
  WalletStandardBridgeError,
  type CasperWalletProvider,
  type PayX402Result,
} from "./standard-bridge";
import { WalletModal } from "./WalletModal";

export interface WalletState {
  /** Baret Casper provider(s) detected on the page. */
  available: CasperWalletProvider[];
  /** True if a wallet is connected. */
  connected: boolean;
  /** Connected Casper account-hash (64 hex). */
  walletAddress: string | null;
  /** Algo-prefixed public key hex — needed to build transactions client-side. */
  publicKey: string | null;
  /** Connected provider's display name, e.g. "Baret" or "Casper Wallet". */
  walletName: string | null;
  shortAddress: string | null;
  connecting: boolean;
  openWalletModal: () => void;
  connect: (
    provider: CasperWalletProvider,
  ) => Promise<WalletStandardBridge | null>;
  disconnect: () => Promise<void>;
  /** Adapter shape the showcase sites consume. */
  adapter: {
    signAndSendTransaction: (
      transactionJson: string,
    ) => Promise<{ signature: string; signedTransaction: string }>;
    signTransaction: (
      transactionJson: string,
    ) => Promise<{ signedTransaction: string }>;
    signMessage: (message: string) => Promise<{ signedMessage: string }>;
    payX402: (requirements: unknown) => Promise<PayX402Result>;
  };
  appName: string;
}

/** Short display form for a Casper account-hash: aabb…ccdd. */
function shortAccountHash(s: string, head = 4, tail = 4): string {
  const bare = s.replace(/^(account-hash-|0x)/i, "");
  if (bare.length <= head + tail) return bare;
  return `${bare.slice(0, head)}…${bare.slice(-tail)}`;
}

const Ctx = createContext<WalletState | null>(null);

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useWallet must be used inside <WalletProvider>");
  return v;
}

export function WalletProvider({
  appName,
  children,
}: {
  appName: string;
  children: ReactNode;
}) {
  const [available, setAvailable] = useState<CasperWalletProvider[]>([]);
  const [bridge, setBridge] = useState<WalletStandardBridge | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  // Discover the Baret provider via the page globals. Re-poll on the
  // `baret:walletReady` event the inpage script dispatches so installs /
  // hot-reloads land without requiring a page refresh.
  useEffect(() => {
    const rescan = () => setAvailable(discoverCasperProviders());
    rescan();
    // Give a freshly-loaded extension a moment to register before settling.
    void waitForCasperProvider().then(rescan);
    window.addEventListener("baret:walletReady", rescan);
    return () => window.removeEventListener("baret:walletReady", rescan);
  }, []);

  const connect = useCallback(
    async (
      provider: CasperWalletProvider,
    ): Promise<WalletStandardBridge | null> => {
      if (!provider) return null;
      setConnecting(true);
      try {
        const b = await WalletStandardBridge.connect(provider);
        setBridge(b);
        setModalOpen(false);
        return b;
      } catch (err) {
        if (!(err instanceof WalletStandardBridgeError)) console.error(err);
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [],
  );

  const disconnect = useCallback(async () => {
    if (bridge) await bridge.disconnect().catch(() => {});
    setBridge(null);
  }, [bridge]);

  const openWalletModal = useCallback(() => {
    setModalOpen(true);
  }, []);
  const closeWalletModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const adapter = useMemo(
    () => ({
      signAndSendTransaction: async (transactionJson: string) => {
        if (!bridge)
          throw new WalletStandardBridgeError(
            "No wallet connected",
            "NOT_CONNECTED",
          );
        return bridge.signAndSendTransaction(transactionJson);
      },
      signTransaction: async (transactionJson: string) => {
        if (!bridge)
          throw new WalletStandardBridgeError(
            "No wallet connected",
            "NOT_CONNECTED",
          );
        return bridge.signTransaction(transactionJson);
      },
      signMessage: async (message: string) => {
        if (!bridge)
          throw new WalletStandardBridgeError(
            "No wallet connected",
            "NOT_CONNECTED",
          );
        return bridge.signMessage(message);
      },
      payX402: async (requirements: unknown) => {
        if (!bridge)
          throw new WalletStandardBridgeError(
            "No wallet connected",
            "NOT_CONNECTED",
          );
        return bridge.payX402(requirements);
      },
    }),
    [bridge],
  );

  const walletAddress = bridge?.account_pubkey() ?? null;
  const publicKey = bridge?.connectedAccount.publicKey ?? null;
  const walletName = bridge?.name ?? null;
  const value = useMemo<WalletState>(
    () => ({
      available,
      connected: !!bridge,
      walletAddress,
      publicKey,
      walletName,
      shortAddress: walletAddress ? shortAccountHash(walletAddress) : null,
      connecting,
      openWalletModal,
      connect,
      disconnect,
      adapter,
      appName,
    }),
    [
      available,
      bridge,
      walletAddress,
      publicKey,
      walletName,
      connecting,
      openWalletModal,
      connect,
      disconnect,
      adapter,
      appName,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      <WalletModal
        open={modalOpen}
        onClose={closeWalletModal}
        onConnect={(p) => {
          void connect(p);
        }}
        connecting={connecting}
        available={available}
      />
    </Ctx.Provider>
  );
}
