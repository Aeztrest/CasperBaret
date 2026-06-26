/**
 * Acquire sheet — in-wallet "how to get funds" for every asset.
 *
 * Casper has no programmatic faucet (captcha-gated) and the demo USDC is a
 * CEP-18 with no public faucet yet, so this surface gives the user a clear,
 * actionable path for each token instead of a dead end: copy address, open the
 * right page, follow the steps. Rendered as a full-surface overlay so it works
 * unchanged in the popup and (wrapped in a modal) in the options page.
 */

import { useState } from "react";
import { X, Copy, Check, ExternalLink, Coins } from "lucide-react";
import type { TokenDef } from "../shared/tokens";

interface Props {
  address: string;
  network: string;
  tokens: TokenDef[];
  onClose: () => void;
}

const NETWORK_LABEL: Record<string, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
};

const FAUCET_URL = "https://testnet.cspr.live/tools/faucet";

function explorerBase(network: string): string {
  return network === "mainnet" ? "https://cspr.live" : "https://testnet.cspr.live";
}

export function AcquireSheet({ address, network, tokens, onClose }: Props) {
  const isTestnet = network === "testnet";

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
        <AssetCard
          symbol="CSPR"
          title="Casper (CSPR)"
          blurb={
            isTestnet
              ? "Free testnet CSPR from the Casper faucet — needed for transaction gas."
              : "Buy CSPR on an exchange (Coinbase, Gate, Kraken…) and withdraw to your address below."
          }
          steps={
            isTestnet
              ? [
                  "Copy your address (button below).",
                  "Open the Casper faucet and paste it.",
                  "Solve the captcha and request — CSPR arrives in seconds.",
                ]
              : [
                  "Copy your address (button below).",
                  "On your exchange, withdraw CSPR to it.",
                  "Pick the Casper mainnet network when withdrawing.",
                ]
          }
          address={address}
          primary={
            isTestnet
              ? { label: "Copy address & open faucet", href: FAUCET_URL }
              : undefined
          }
        />

        {/* CEP-18 tokens (e.g. demo USDC) */}
        {tokens.map((t) => (
          <AssetCard
            key={t.packageHash}
            symbol={t.symbol}
            title={`${t.name}`}
            blurb="Demo CEP-18 stablecoin used for x402 micropayments. No public faucet yet — receive it by transfer."
            steps={[
              "Copy your address (button below).",
              "Share it with whoever holds the demo token (treasury / teammate).",
              "They send you some via a CEP-18 transfer.",
            ]}
            address={address}
            note="A one-click demo-USDC faucet is planned."
            primary={{
              label: "View token on cspr.live",
              href: `${explorerBase(network)}/contract-package/${t.packageHash}`,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function AssetCard({
  symbol,
  title,
  blurb,
  steps,
  address,
  primary,
  note,
}: {
  symbol: string;
  title: string;
  blurb: string;
  steps: string[];
  address: string;
  primary?: { label: string; href: string };
  note?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  const onPrimary = async () => {
    await copyAddress();
    if (primary) window.open(primary.href, "_blank", "noopener,noreferrer");
  };

  return (
    <section className="card !p-4">
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

      <p className="text-xs text-text-muted leading-relaxed mb-3">{blurb}</p>

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
        {primary && (
          <button onClick={onPrimary} className="btn-primary !py-2 text-xs">
            {primary.label} <ExternalLink size={11} />
          </button>
        )}
        <button onClick={copyAddress} className="btn-ghost !py-2 text-xs">
          {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy address"}
        </button>
      </div>

      {note && <p className="text-[10px] text-text-faint mt-2">{note}</p>}
    </section>
  );
}
