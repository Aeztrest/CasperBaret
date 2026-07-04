import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Download, Plus } from "lucide-react";
import { useRpc, useWalletState } from "../shared/state-context";
import { tokensFor, formatTokenAmount, CSPR_LOGO, type TokenDef } from "../shared/tokens";
import { TokenIcon } from "../shared/TokenIcon";
import { ReceiveScreen } from "./ReceiveScreen";
import { SendScreen } from "./SendScreen";
import { AcquireSheet } from "./AcquireSheet";

const MOTES_PER_CSPR = 1_000_000_000;

// Poll balance every 6s while the popup is open.
const POLL_INTERVAL_MS = 6_000;
// After an airdrop, poll faster (every 3s) for up to 30s until balance changes.
const POST_AIRDROP_POLL_MS = 3_000;
const POST_AIRDROP_DURATION_MS = 30_000;

interface TokenBalance {
  raw: string;
  available: boolean;
}

export function Home() {
  const state = useWalletState();
  const rpc = useRpc();
  const [balance, setBalance] = useState<number | null>(null);
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalance>>({});
  const [overlay, setOverlay] = useState<"send" | "receive" | "acquire" | null>(null);
  const postAirdropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const tokens = state ? tokensFor(state.network) : [];

  const fetchBalance = useCallback(async () => {
    if (!state?.authorityAddress) return;
    try {
      const r = await rpc.call("wallet.balance", { address: state.authorityAddress });
      setBalance(Number(r.motes) / MOTES_PER_CSPR);
    } catch { /* keep last */ }
  }, [state?.authorityAddress, rpc]);

  const fetchTokens = useCallback(async () => {
    if (!state?.authorityAddress) return;
    await Promise.all(
      tokensFor(state.network).map(async (t) => {
        try {
          const r = await rpc.call("wallet.tokenBalance", {
            packageHash: t.packageHash,
            address: state.authorityAddress!,
          });
          setTokenBalances((p) => ({ ...p, [t.packageHash]: { raw: r.raw, available: r.available } }));
        } catch {
          setTokenBalances((p) => ({ ...p, [t.packageHash]: { raw: "0", available: false } }));
        }
      }),
    );
  }, [state?.authorityAddress, state?.network, rpc]);

  // Background polling while popup is open.
  useEffect(() => {
    void fetchBalance();
    void fetchTokens();
    const id = setInterval(() => { void fetchBalance(); void fetchTokens(); }, POLL_INTERVAL_MS);
    pollRef.current = id;
    return () => { clearInterval(id); if (postAirdropTimer.current) clearTimeout(postAirdropTimer.current); };
  }, [fetchBalance, fetchTokens]);

  // After airdrop: poll at 3s cadence for 30s so balance updates promptly.
  const onFunded = useCallback(() => {
    if (postAirdropTimer.current) clearTimeout(postAirdropTimer.current);
    // Switch to fast poll.
    if (pollRef.current) clearInterval(pollRef.current);
    const fast = setInterval(() => { void fetchBalance(); void fetchTokens(); }, POST_AIRDROP_POLL_MS);
    pollRef.current = fast;
    // Return to normal after 30s.
    postAirdropTimer.current = setTimeout(() => {
      clearInterval(fast);
      const normal = setInterval(() => { void fetchBalance(); void fetchTokens(); }, POLL_INTERVAL_MS);
      pollRef.current = normal;
    }, POST_AIRDROP_DURATION_MS);
  }, [fetchBalance, fetchTokens]);

  return (
    <div className="flex-1 flex flex-col relative">
      <div className="flex-1 overflow-y-auto flex flex-col">

        {/* ── Portfolio hero ─────────────────────── */}
        <div className="px-4 pt-5 pb-4">
          <p className="text-[11px] uppercase tracking-widest font-semibold text-text-faint mb-1">
            Total balance
          </p>
          <div className="flex items-end gap-1.5">
            <span className="text-3xl font-extrabold tabular-nums tracking-tight leading-none">
              {balance === null ? "—" : balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
            </span>
            <span className="text-base font-bold text-text-faint mb-0.5">CSPR</span>
          </div>

          {/* ── Action buttons ──────────────────── */}
          <div className="grid grid-cols-3 gap-2 mt-4">
            <ActionBtn icon={Send}     label="Send"      onClick={() => setOverlay("send")} />
            <ActionBtn icon={Download} label="Receive"   onClick={() => setOverlay("receive")} />
            <ActionBtn icon={Plus}     label="Add funds" onClick={() => setOverlay("acquire")} />
          </div>
        </div>

        {/* ── Token list ─────────────────────────── */}
        <div
          className="mx-4 mb-4 rounded-card overflow-hidden"
          style={{ border: "1px solid var(--line)", background: "var(--bg-card)" }}
        >
          <p className="px-4 pt-3 pb-2 text-[10px] uppercase tracking-widest font-bold text-text-faint">
            Assets
          </p>

          {/* CSPR row */}
          <TokenRow
            symbol="CSPR"
            name="Casper"
            logo={CSPR_LOGO}
            amount={balance === null ? null : balance.toLocaleString(undefined, { maximumFractionDigits: 4 })}
            onClick={() => setOverlay("acquire")}
          />

          {/* CEP-18 tokens */}
          {tokens.map((t) => (
            <TokenRow
              key={t.packageHash}
              symbol={t.symbol}
              name={t.name}
              logo={t.logo}
              badge={t.kind === "stablecoin" ? "stable" : undefined}
              amount={amountFor(tokenBalances[t.packageHash], t)}
              onClick={() => setOverlay("acquire")}
            />
          ))}
        </div>
      </div>

      {/* ── Overlays (outside scroll so they cover full popup) ── */}
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
          onSent={fetchBalance}
        />
      )}
      {overlay === "acquire" && state?.authorityAddress && (
        <AcquireSheet
          address={state.authorityAddress}
          network={state.network}
          tokens={tokens}
          onClose={() => setOverlay(null)}
          onFunded={onFunded}
        />
      )}
    </div>
  );
}

function amountFor(bal: TokenBalance | undefined, token: TokenDef): string | null {
  if (!bal) return null;
  if (!bal.available) return "—";
  return formatTokenAmount(bal.raw, token.decimals);
}

function TokenRow({
  symbol, name, amount, badge, logo, onClick,
}: {
  symbol: string;
  name: string;
  amount: string | null;
  badge?: string;
  logo?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-3 text-left border-t transition-colors hover:bg-white/[0.03] active:bg-white/[0.05]"
      style={{ borderColor: "var(--line)" }}
    >
      <TokenIcon symbol={symbol} logo={logo} size={36} />

      {/* Name + badge */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-sm font-semibold leading-none">{symbol}</span>
          {badge && (
            <span
              className="text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded"
              style={{ background: "var(--ok-dim)", color: "var(--ok)" }}
            >
              {badge}
            </span>
          )}
        </div>
        <span className="text-[11px] text-text-faint leading-none">{name}</span>
      </div>

      {/* Amount */}
      <span className="text-sm font-bold tabular-nums text-right shrink-0">
        {amount === null ? <span className="text-text-faint text-xs">…</span> : amount}
      </span>
    </button>
  );
}

function ActionBtn({
  icon: Icon, label, onClick,
}: {
  icon: typeof Send;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 py-3 rounded-card transition-colors hover:bg-white/[0.06] active:bg-white/[0.09]"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--line)" }}
    >
      <Icon size={15} className="text-text" />
      <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">{label}</span>
    </button>
  );
}
