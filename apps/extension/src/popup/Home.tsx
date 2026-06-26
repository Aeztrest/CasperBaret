/**
 * Popup home tab.
 *
 * Shows a portfolio token list (native CSPR + configured CEP-18 tokens like the
 * demo USDC) so the user can see every asset and how much they hold at a glance.
 * Send/Receive open as full-popup overlays; Faucet opens the captcha-gated
 * Casper faucet with the address pre-copied (no programmatic airdrop exists).
 */

import { useCallback, useEffect, useState } from "react";
import { Send, Download, Sparkles, Loader2 } from "lucide-react";
import { useRpc, useWalletState } from "../shared/state-context";
import { tokensFor, formatTokenAmount, type TokenDef } from "../shared/tokens";
import { ReceiveScreen } from "./ReceiveScreen";
import { SendScreen } from "./SendScreen";

const MOTES_PER_CSPR = 1_000_000_000;

// Casper's testnet faucet is captcha-gated — there's no programmatic airdrop
// (unlike Solana's friendbot). So the button copies the authority address and
// opens the faucet page; the user pastes it and solves the captcha there.
const FAUCET_URL = "https://testnet.cspr.live/tools/faucet";

interface TokenBalance {
  raw: string;
  available: boolean;
}

export function Home() {
  const state = useWalletState();
  const rpc = useRpc();
  const [balance, setBalance] = useState<number | null>(null);
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalance>>({});
  const [airdropMsg, setAirdropMsg] = useState<string | null>(null);
  const [airdropError, setAirdropError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<"send" | "receive" | null>(null);

  const tokens = state ? tokensFor(state.network) : [];

  const refreshBalance = useCallback(async () => {
    if (!state?.authorityAddress) return;
    try {
      const r = await rpc.call("wallet.balance", { address: state.authorityAddress });
      setBalance(Number(r.motes) / MOTES_PER_CSPR);
    } catch {
      /* keep last value */
    }
  }, [state?.authorityAddress, rpc]);

  const refreshTokens = useCallback(async () => {
    if (!state?.authorityAddress) return;
    const list = tokensFor(state.network);
    await Promise.all(
      list.map(async (t) => {
        try {
          const r = await rpc.call("wallet.tokenBalance", {
            packageHash: t.packageHash,
            address: state.authorityAddress!,
          });
          setTokenBalances((prev) => ({ ...prev, [t.packageHash]: { raw: r.raw, available: r.available } }));
        } catch {
          setTokenBalances((prev) => ({ ...prev, [t.packageHash]: { raw: "0", available: false } }));
        }
      }),
    );
  }, [state?.authorityAddress, state?.network, rpc]);

  useEffect(() => {
    let cancelled = false;
    void refreshBalance();
    void refreshTokens();
    return () => { cancelled = true; void cancelled; };
  }, [refreshBalance, refreshTokens]);

  const onAirdrop = async () => {
    setAirdropError(null);
    setAirdropMsg(null);

    if (state?.network !== "testnet") {
      setAirdropError("The faucet is only available on testnet.");
      setTimeout(() => setAirdropError(null), 4000);
      return;
    }

    try {
      if (state.authorityAddress) {
        await navigator.clipboard.writeText(state.authorityAddress);
      }
    } catch {
      /* clipboard optional */
    }

    window.open(FAUCET_URL, "_blank", "noopener,noreferrer");
    setAirdropMsg("Address copied — paste it on the faucet page, solve the captcha, then come back.");
    setTimeout(() => setAirdropMsg(null), 6000);
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4 relative">
      <section
        className="rounded-card p-4 relative overflow-hidden"
        style={{
          background: "linear-gradient(135deg, rgba(225,20,40,0.08), rgba(225,20,40,0.015))",
          border: "1px solid var(--line)",
        }}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="label !mb-0">Assets</p>
        </div>

        <div className="flex flex-col divide-y" style={{ borderColor: "var(--line)" }}>
          <TokenRow
            symbol="CSPR"
            name="Casper"
            amount={balance === null ? null : balance.toFixed(4)}
          />
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

        <div className="mt-4 grid grid-cols-3 gap-2">
          <ActionButton icon={Send} label="Send" onClick={() => setOverlay("send")} />
          <ActionButton icon={Download} label="Receive" onClick={() => setOverlay("receive")} />
          <ActionButton icon={Sparkles} label="Faucet" onClick={onAirdrop} />
        </div>

        {airdropMsg && (
          <div
            className="mt-3 px-3 py-1.5 rounded-input text-[11px] flex items-center gap-1.5"
            style={{ background: "var(--ok-dim)", color: "var(--ok)" }}
          >
            <Sparkles size={11} /> {airdropMsg}
          </div>
        )}
        {airdropError && (
          <div
            className="mt-3 px-3 py-1.5 rounded-input text-[11px]"
            style={{ background: "var(--bad-dim)", color: "var(--bad)" }}
          >
            {airdropError}
          </div>
        )}
      </section>

      <section className="card flex-1 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <p className="label !mb-0">Recent activity</p>
          <span className="text-[10px] text-text-faint">live in T26</span>
        </div>
        <p className="text-xs text-text-faint">
          Your transactions, dApp signatures, and x402 payments will live here
          once the allowance ledger is online.
        </p>
      </section>

      {overlay === "receive" && state?.authorityAddress && (
        <ReceiveScreen
          address={state.authorityAddress}
          network={state.network}
          onClose={() => setOverlay(null)}
        />
      )}
      {overlay === "send" && state?.authorityAddress && (
        <SendScreen
          authorityAddress={state.authorityAddress}
          network={state.network}
          balanceCspr={balance}
          onClose={() => setOverlay(null)}
          onSent={refreshBalance}
        />
      )}
    </div>
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
          className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
          style={{ background: "var(--accent-dim)", color: "var(--accent-soft)" }}
        >
          {symbol.slice(0, 3)}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold leading-none">{symbol}</span>
            {badge && <span className="pill pill-ok">{badge}</span>}
          </div>
          <span className="text-text-faint text-[10px] truncate block mt-0.5">{name}</span>
        </div>
      </div>
      <span className="text-base font-extrabold font-mono tracking-tight tabular-nums">
        {amount === null ? "…" : amount}
      </span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  loading,
}: {
  icon: typeof Send;
  label: string;
  onClick?: () => void;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick || loading}
      className="flex flex-col items-center gap-1 py-2.5 rounded-input transition-all
                 hover:bg-black/[0.06] disabled:opacity-50 disabled:cursor-not-allowed"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)" }}
    >
      {loading ? (
        <Loader2 size={14} className="animate-spin text-text" />
      ) : (
        <Icon size={14} className="text-text" />
      )}
      <span className="text-[10px] font-semibold uppercase tracking-wider">{label}</span>
    </button>
  );
}
