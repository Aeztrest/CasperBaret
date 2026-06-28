/**
 * Acquire sheet — in-wallet "how to get funds" for every asset.
 *
 * CSPR is dispensed by Baret's own treasury-backed faucet (one tap → 1,000 CSPR
 * via the wallet.airdrop RPC → apps/server POST /demo/faucet), with the
 * captcha-gated cspr.live faucet kept as a fallback. The demo USDC (CEP-18) has
 * no faucet yet, so its card explains how to receive it by transfer. Rendered
 * as a full-surface overlay so it works in the popup and (wrapped) in options.
 */

import { useState } from "react";
import { X, Copy, Check, ExternalLink, Coins, Loader2, Droplet } from "lucide-react";
import type { TokenDef } from "../shared/tokens";
import { useRpc } from "../shared/state-context";

interface Props {
  address: string;
  network: string;
  tokens: TokenDef[];
  onClose: () => void;
  /** Called after a successful CSPR claim so the caller can refresh balances. */
  onFunded?: () => void;
}

const NETWORK_LABEL: Record<string, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
};

const CSPR_LIVE_FAUCET = "https://testnet.cspr.live/tools/faucet";

function explorerBase(network: string): string {
  return network === "mainnet" ? "https://cspr.live" : "https://testnet.cspr.live";
}

function useCopy(address: string) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };
  return { copied, copy };
}

export function AcquireSheet({ address, network, tokens, onClose, onFunded }: Props) {
  const rpc = useRpc();
  const isTestnet = network === "testnet";

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { copied, copy } = useCopy(address);

  const requestCspr = async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await rpc.call("wallet.airdrop", undefined as never);
      setMsg(`Sent ${r.amountCspr.toLocaleString()} CSPR — arriving in a few seconds.`);
      onFunded?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setTimeout(() => { setMsg(null); setErr(null); }, 8000);
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ background: "var(--bg)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm">Add funds</p>
          <span className="pill pill-live">{NETWORK_LABEL[network] ?? network}</span>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-input hover:bg-black/5">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 px-4 py-4 flex flex-col gap-3 overflow-y-auto">
        {/* Native CSPR */}
        <section className="card !p-4">
          <CardHeader symbol="CSPR" title="Casper (CSPR)" />

          {isTestnet ? (
            <>
              <p className="text-xs text-text-muted leading-relaxed mb-3">
                Get free testnet CSPR for gas — straight to your wallet, no captcha.
                1,000 CSPR per claim, ~2&nbsp;min cooldown.
                {" "}<span className="text-text-faint">First request may take up to 30&nbsp;s while the server wakes up.</span>
              </p>
              <button onClick={requestCspr} disabled={busy} className="btn-primary w-full !py-2.5 text-sm">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Droplet size={13} />}
                {busy ? "Requesting…" : "Request 1,000 CSPR"}
              </button>

              {msg && (
                <p className="text-[11px] mt-2 flex items-center gap-1.5" style={{ color: "var(--ok)" }}>
                  <Check size={11} /> {msg}
                </p>
              )}
              {err && (
                <p className="text-[11px] mt-2" style={{ color: "var(--bad)" }}>{err}</p>
              )}

              <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{ borderColor: "var(--line)" }}>
                <a
                  href={CSPR_LIVE_FAUCET}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-text-faint hover:text-text inline-flex items-center gap-1"
                >
                  cspr.live faucet <ExternalLink size={10} />
                </a>
                <CopyAddressButton copied={copied} onCopy={copy} />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-text-muted leading-relaxed mb-3">
                Buy CSPR on an exchange (Coinbase, Gate, Kraken…) and withdraw to your
                address over the Casper mainnet network.
              </p>
              <CopyAddressButton copied={copied} onCopy={copy} wide />
            </>
          )}
        </section>

        {/* CEP-18 tokens (e.g. demo USDC) */}
        {tokens.map((t) => (
          <TokenAcquireCard key={t.packageHash} token={t} network={network} address={address} />
        ))}
      </div>
    </div>
  );
}

function CardHeader({ symbol, title }: { symbol: string; title: string }) {
  return (
    <div className="flex items-center gap-3 mb-2">
      <div
        className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
        style={{ background: "var(--accent-dim)", color: "var(--accent-soft)" }}
      >
        {symbol.slice(0, 3)}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold leading-none">{title}</p>
        <p className="text-text-faint text-[10px] mt-1 flex items-center gap-1">
          <Coins size={10} /> {symbol}
        </p>
      </div>
    </div>
  );
}

function CopyAddressButton({ copied, onCopy, wide }: { copied: boolean; onCopy: () => void; wide?: boolean }) {
  return (
    <button onClick={onCopy} className={`btn-ghost !py-1.5 text-xs ${wide ? "w-full" : ""}`}>
      {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy address"}
    </button>
  );
}

function TokenAcquireCard({ token, network, address }: { token: TokenDef; network: string; address: string }) {
  const { copied, copy } = useCopy(address);
  const steps = [
    "Copy your address (button below).",
    "Share it with whoever holds USDC (treasury / teammate).",
    "They send you some via a CEP-18 transfer.",
  ];
  return (
    <section className="card !p-4">
      <CardHeader symbol={token.symbol} title={token.name} />
      <p className="text-xs text-text-muted leading-relaxed mb-3">
        CEP-18 stablecoin used for x402 micropayments on Casper testnet.
        No public faucet yet — receive it by transfer.
      </p>
      <ol className="space-y-1.5 mb-3">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-[11px] text-text-muted">
            <span
              className="shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold"
              style={{ background: "var(--bg-elevated)", color: "var(--text-faint)" }}
            >
              {i + 1}
            </span>
            <span>{s}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap gap-2">
        <a
          href={`${explorerBase(network)}/contract-package/${token.packageHash}`}
          target="_blank"
          rel="noreferrer"
          className="btn-primary !py-2 text-xs"
        >
          View on cspr.live <ExternalLink size={11} />
        </a>
        <CopyAddressButton copied={copied} onCopy={copy} />
      </div>
    </section>
  );
}
