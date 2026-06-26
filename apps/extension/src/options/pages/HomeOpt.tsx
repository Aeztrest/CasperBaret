/**
 * Options home dashboard (Stellar build).
 *
 * Live-polls authority + smart-wallet balances every 8 seconds. Until the
 * smart-wallet contract is provisioned, the authority key IS the wallet — we
 * surface its balance in the hero so the user always sees a real number.
 */

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Send,
  Download,
  Sparkles,
  ExternalLink,
  Shield,
  Clock,
  ArrowRight,
  Copy,
  Check,
} from "lucide-react";
import { useRpc, useWalletState } from "../../shared/state-context";
import type { GuardPolicy } from "@casper-baret/casper-guard";
import { tokensFor, formatTokenAmount, type TokenDef } from "../../shared/tokens";
import {
  OptionsSendModal,
  OptionsReceiveModal,
} from "../components/SendReceiveModal";

const MOTES_PER_CSPR = 1_000_000_000;

// Casper's testnet faucet is captcha-gated — no programmatic airdrop. The
// button copies the address and opens the faucet page (see popup Home.tsx).
const FAUCET_URL = "https://testnet.cspr.live/tools/faucet";

interface TokenBalance {
  raw: string;
  available: boolean;
}

export function HomeOpt() {
  const state = useWalletState();
  const rpc = useRpc();
  const [walletBal, setWalletBal] = useState<number | null>(null);
  const [authBal, setAuthBal] = useState<number | null>(null);
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalance>>({});
  const [policy, setPolicy] = useState<GuardPolicy | null>(null);
  const [airdropMsg, setAirdropMsg] = useState<string | null>(null);
  const [airdropError, setAirdropError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<"send" | "receive" | null>(null);
  const [copied, setCopied] = useState(false);

  const tokens = state ? tokensFor(state.network) : [];

  const refresh = useCallback(async () => {
    if (!state) return;
    try {
      if (state.walletAddress) {
        const r = await rpc.call("wallet.balance", {
          address: state.walletAddress,
        });
        setWalletBal(Number(r.motes) / MOTES_PER_CSPR);
      } else {
        setWalletBal(null);
      }
      if (state.authorityAddress) {
        const r = await rpc.call("wallet.balance", {
          address: state.authorityAddress,
        });
        setAuthBal(Number(r.motes) / MOTES_PER_CSPR);
      }
      const owner = state.walletAddress ?? state.authorityAddress;
      if (owner) {
        await Promise.all(
          tokensFor(state.network).map(async (t) => {
            try {
              const tb = await rpc.call("wallet.tokenBalance", {
                packageHash: t.packageHash,
                address: owner,
              });
              setTokenBalances((prev) => ({ ...prev, [t.packageHash]: { raw: tb.raw, available: tb.available } }));
            } catch {
              setTokenBalances((prev) => ({ ...prev, [t.packageHash]: { raw: "0", available: false } }));
            }
          }),
        );
      }
    } catch {
      /* ignore — UI shows last known */
    }
  }, [state, rpc]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    void rpc
      .call("policy.read", undefined as never)
      .then((p) => setPolicy(p as GuardPolicy));
  }, [rpc]);

  const onAirdrop = async () => {
    setAirdropError(null);
    setAirdropMsg(null);
    if (state?.network !== "testnet") {
      setAirdropError("The faucet is only available on testnet.");
      setTimeout(() => setAirdropError(null), 4000);
      return;
    }
    const owner = state.walletAddress ?? state.authorityAddress;
    try {
      if (owner) await navigator.clipboard.writeText(owner);
    } catch {
      /* clipboard optional */
    }
    window.open(FAUCET_URL, "_blank", "noopener,noreferrer");
    setAirdropMsg("Address copied — paste it on the faucet page, solve the captcha, then come back.");
    setTimeout(() => setAirdropMsg(null), 6000);
  };

  const onCopyAddress = async () => {
    const addr = state?.walletAddress ?? state?.authorityAddress;
    if (!addr) return;
    try {
      await navigator.clipboard.writeText(addr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  if (!state) return null;

  const heroBalance = state.walletAddress ? walletBal : authBal;
  const heroAddress = state.walletAddress ?? state.authorityAddress;
  const heroLabel = state.walletAddress
    ? "Smart wallet"
    : "Authority key (smart wallet pending)";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Welcome back</h1>
        <p className="text-text-muted text-sm mt-1">
          Your wallet is live on {state.network}. Every transaction passes
          Blackthorn before signing.
        </p>
      </div>

      <section
        className="rounded-card p-6 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(225,20,40,0.08), rgba(225,20,40,0.015))",
          border: "1px solid var(--line)",
        }}
      >
        <div className="flex items-center gap-2 mb-1">
          <p className="label !mb-0">{heroLabel}</p>
          <button
            onClick={onCopyAddress}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-text-muted hover:text-text rounded-input px-1.5 py-0.5 hover:bg-black/[0.05]"
            title="Copy address"
          >
            {shortAddr(heroAddress)}
            {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} className="text-text-faint" />}
          </button>
        </div>
        <p className="text-5xl font-extrabold leading-none font-mono tracking-tight">
          {heroBalance === null ? "—" : heroBalance.toFixed(4)}
          <span className="text-2xl text-text-faint font-bold ml-2">CSPR</span>
        </p>
        <p className="text-text-faint text-xs mt-2">
          {state.walletAddress
            ? walletBal && walletBal > 0
              ? "Funds available in your smart-wallet contract."
              : "Smart wallet empty — receive CSPR or move some from your authority."
            : "Provision the smart-wallet contract from Settings to upgrade (Passkey sub-keys, x402 allowances)."}
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => setOverlay("send")}>
            <Send size={13} /> Send
          </button>
          <button className="btn-ghost" onClick={() => setOverlay("receive")}>
            <Download size={13} /> Receive
          </button>
          <button onClick={onAirdrop} className="btn-ghost">
            <Sparkles size={13} /> Faucet
          </button>
        </div>

        {airdropMsg && (
          <p
            className="text-[11px] mt-3"
            style={{ color: "var(--ok)" }}
          >
            {airdropMsg}
          </p>
        )}
        {airdropError && (
          <p
            className="text-[11px] mt-3"
            style={{ color: "var(--bad)" }}
          >
            {airdropError}
          </p>
        )}
      </section>

      <section className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-bold text-sm">Assets</h2>
          <span className="text-[10px] text-text-faint">{state.network}</span>
        </div>
        <div className="flex flex-col divide-y" style={{ borderColor: "var(--line)" }}>
          <TokenRow symbol="CSPR" name="Casper" amount={heroBalance === null ? null : heroBalance.toFixed(4)} />
          {tokens.map((t) => (
            <TokenRow
              key={t.packageHash}
              symbol={t.symbol}
              name={t.name}
              badge={t.kind === "stablecoin" ? "stable" : undefined}
              amount={amountFor(tokenBalances[t.packageHash], t)}
            />
          ))}
        </div>
      </section>

      <div className="grid md:grid-cols-2 gap-4">
        <Link to="/policies" className="card hover:bg-black/[0.03] transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield size={14} className="text-accent-soft" />
              <h2 className="font-bold text-sm">Active policy</h2>
            </div>
            <ArrowRight size={13} className="text-text-faint" />
          </div>
          <PolicySummary policy={policy} />
        </Link>

        <Link to="/sites" className="card hover:bg-black/[0.03] transition-colors">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-accent-soft" />
              <h2 className="font-bold text-sm">Connected sites</h2>
            </div>
            <ArrowRight size={13} className="text-text-faint" />
          </div>
          <p className="text-text-faint text-xs leading-relaxed">
            Every dApp you connect, every x402 paywall you visit. Per-origin
            caps, pause, revoke.
          </p>
        </Link>
      </div>

      {state.walletAddress && (
        <section className="card">
          <div className="flex items-center justify-between gap-4 mb-3">
            <h2 className="font-bold text-sm">Authority key</h2>
            <a
              href={csprLiveAccount(state.authorityAddress, state.network)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent-soft hover:text-text inline-flex items-center gap-1"
            >
              View on cspr.live <ExternalLink size={11} />
            </a>
          </div>
          <p className="font-mono text-xs text-text-muted break-all mb-2">
            {state.authorityAddress}
          </p>
          <p className="text-text-faint text-xs">
            Signs auth entries + tx envelopes on your behalf. Balance:{" "}
            <span className="font-mono text-text-muted">
              {authBal === null ? "—" : `${authBal.toFixed(4)} CSPR`}
            </span>
            .
          </p>
        </section>
      )}

      {overlay === "send" && state.authorityAddress && (
        <OptionsSendModal
          authorityAddress={state.authorityAddress}
          network={state.network}
          balanceCspr={authBal}
          onClose={() => setOverlay(null)}
          onSent={refresh}
        />
      )}
      {overlay === "receive" && heroAddress && (
        <OptionsReceiveModal
          address={heroAddress}
          network={state.network}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}

function PolicySummary({ policy }: { policy: GuardPolicy | null }) {
  if (!policy) return <p className="text-xs text-text-faint">Loading…</p>;
  const rows: Array<[string, string]> = [
    [
      "Max loss per tx",
      policy.maxLossPercent != null ? `${policy.maxLossPercent}%` : "—",
    ],
    ["Block risky contracts", policy.blockRiskyContracts ? "On" : "Off"],
    ["Block CEP-18 allowances", policy.blockCep18AllowanceGrants ? "On" : "Off"],
    [
      "Require preflight success",
      policy.requireSuccessfulSimulation !== false ? "Yes" : "No",
    ],
    [
      "x402 hourly cap",
      policy.x402HourlyCap != null
        ? `$${policy.x402HourlyCap.toFixed(2)}`
        : "—",
    ],
  ];
  return (
    <ul className="space-y-1.5 text-xs">
      {rows.map(([label, value]) => (
        <li key={label} className="flex justify-between">
          <span className="text-text-faint">{label}</span>
          <span className="font-medium">{value}</span>
        </li>
      ))}
    </ul>
  );
}

/** Display amount for a CEP-18 token, or "—" when the balance couldn't be read. */
function amountFor(bal: TokenBalance | undefined, token: TokenDef): string | null {
  if (!bal) return null; // still loading
  if (!bal.available) return "—";
  return formatTokenAmount(bal.raw, token.decimals);
}

function TokenRow({
  symbol,
  name,
  amount,
  badge,
}: {
  symbol: string;
  name: string;
  amount: string | null;
  badge?: string;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
          style={{ background: "var(--accent-dim)", color: "var(--accent-soft)" }}
        >
          {symbol.slice(0, 3)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold leading-none">{symbol}</span>
            {badge && <span className="pill pill-ok">{badge}</span>}
          </div>
          <span className="text-text-faint text-[11px] truncate block mt-0.5">{name}</span>
        </div>
      </div>
      <span className="text-lg font-extrabold font-mono tracking-tight tabular-nums">
        {amount === null ? "…" : amount}
      </span>
    </div>
  );
}

function shortAddr(s: string | null): string {
  if (!s) return "—";
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}

function csprLiveAccount(addr: string | null, network: string): string {
  if (!addr) return "#";
  const base = network === "mainnet" ? "https://cspr.live" : "https://testnet.cspr.live";
  return `${base}/account/${addr}`;
}
