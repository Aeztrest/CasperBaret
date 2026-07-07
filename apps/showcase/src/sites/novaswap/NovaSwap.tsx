import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpDown, ChevronDown, Settings, Info } from "lucide-react";
import { NativeTransferBuilder, PublicKey } from "casper-js-sdk";
import { SiteShell } from "../../components/SiteShell";
import { ResultOverlay, type ResultState } from "../../blackthorn/ResultOverlay";
import { buildScenario } from "../../blackthorn/transactions";
import { useWallet } from "../../wallet/context";

// In production the showcase is on Vercel but the API server is on Render.
const SWAP_API_BASE =
  (import.meta.env.VITE_SCRYBE_API as string | undefined) ??
  "https://baret-server.onrender.com";

interface SwapConfig {
  enabled: boolean;
  treasuryPublicKey: string;
  treasuryAccountHash: string;
  asset: string;
  tokenName: string;
  tokenVersion: string;
  tokenDecimals: number;
  network: string;
  rateAtomicUsdcPerCspr: string;
  minCspr: number;
  maxCspr: number;
}

const THEME = {
  primary: "#e11428",
  accent: "#c00f20",
  bg: "#0d0e11",
  name: "NovaSwap",
  logo: (
    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-white" style={{ background: "linear-gradient(135deg,#e11428,#9e0e1b)" }}>
      N
    </div>
  ),
};

const TOKENS = [
  { symbol: "CSPR", name: "Casper", price: 175.0 },
  { symbol: "USDC", name: "USD Coin (CEP-18)", price: 1.0 },
  { symbol: "CSX", name: "CasperSwap", price: 3.4 },
  { symbol: "yCSPR", name: "Yield CSPR", price: 0.000028 },
];

/** Per-token icon, so it follows the token when "pay"/"receive" flip, not the row. */
function TokenIcon({ symbol }: { symbol: string }) {
  const style =
    symbol === "CSPR"
      ? { background: "#e11428", glyph: "✦" }
      : symbol === "USDC"
        ? { background: "#2775ca", glyph: "$" }
        : { background: "#6b7280", glyph: symbol.slice(0, 1) };
  return (
    <span
      className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0"
      style={{ background: style.background }}
    >
      {style.glyph}
    </span>
  );
}

export default function NovaSwap() {
  const { connected, openWalletModal, walletAddress, publicKey, adapter } = useWallet();
  const [fromToken, setFromToken] = useState(TOKENS[0]);
  const [toToken, setToToken] = useState(TOKENS[1]);
  // Default above Casper's own 2.5 CSPR native-transfer minimum, so the real
  // CSPR->USDC pair works out of the box without the user hitting that wall first.
  const [amount, setAmount] = useState("3");
  const [dangerous, setDangerous] = useState(false);
  const [resultState, setResultState] = useState<ResultState>("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapConfig, setSwapConfig] = useState<SwapConfig | null>(null);
  const [csprBalance, setCsprBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);

  // /demo/swap/config, not /health — ad blockers routinely block any URL
  // containing "health" (a common analytics-endpoint pattern), which
  // silently left every swap attempt falling back to the placeholder-
  // contract scenario demo with no visible error at all.
  useEffect(() => {
    fetch(`${SWAP_API_BASE}/demo/swap/config`)
      .then((r) => r.json())
      .then((s) => {
        if (!s?.enabled || !s?.treasuryPublicKey) return;
        setSwapConfig({
          enabled: true,
          treasuryPublicKey: s.treasuryPublicKey,
          treasuryAccountHash: PublicKey.fromHex(s.treasuryPublicKey).accountHash().toHex(),
          asset: s.asset,
          tokenName: s.tokenName,
          tokenVersion: s.tokenVersion,
          tokenDecimals: s.tokenDecimals,
          network: s.network,
          rateAtomicUsdcPerCspr: s.rateAtomicUsdcPerCspr,
          minCspr: s.minCspr,
          maxCspr: s.maxCspr,
        });
      })
      .catch(() => { /* real swap disabled — falls back to the scenario demo */ });
  }, []);

  const refreshBalances = () => {
    if (!walletAddress) return;
    fetch(`${SWAP_API_BASE}/demo/swap/balance?address=${encodeURIComponent(walletAddress)}`)
      .then((r) => r.json())
      .then((b) => {
        if (typeof b.csprMotes === "string") setCsprBalance(Number(b.csprMotes) / 1e9);
        if (typeof b.usdcAtomic === "string" && swapConfig) {
          setUsdcBalance(Number(b.usdcAtomic) / 10 ** swapConfig.tokenDecimals);
        }
      })
      .catch(() => { /* leave balances unknown */ });
  };

  useEffect(refreshBalances, [walletAddress, swapConfig?.tokenDecimals]);

  // The RPC node's "latest" balance can lag a couple seconds behind a
  // transaction we already confirmed executed (its own execution result
  // is authoritative and arrives first) — one extra refresh shortly after
  // catches that up instead of leaving stale figures on screen.
  const refreshBalancesSettled = () => {
    refreshBalances();
    setTimeout(refreshBalances, 3000);
  };

  const outputAmount = fromToken.price * parseFloat(amount || "0") / toToken.price;
  const success = signature !== null;
  // Both directions of the CSPR<->USDC pair have a real settlement path;
  // everything else (CSX, yCSPR — fictional demo tokens with no real
  // contract) stays the scenario demo.
  const isCsprToUsdc = fromToken.symbol === "CSPR" && toToken.symbol === "USDC";
  const isUsdcToCspr = fromToken.symbol === "USDC" && toToken.symbol === "CSPR";
  const isRealPair = isCsprToUsdc || isUsdcToCspr;
  const doingRealSwap = isRealPair && !dangerous && !!swapConfig;
  const balanceFor = (symbol: string): number | null =>
    symbol === "CSPR" ? csprBalance : symbol === "USDC" ? usdcBalance : null;

  async function handleSwap() {
    if (!connected || !walletAddress || !publicKey) { openWalletModal(); return; }
    if (doingRealSwap) {
      if (isCsprToUsdc) await handleCsprToUsdc();
      else await handleUsdcToCspr();
      return;
    }
    setResultState("awaiting"); setSignature(null); setResultMessage(null);
    try {
      const built = await buildScenario(dangerous ? "novaswap-danger" : "novaswap-safe", publicKey);
      const { signature: sig } = await adapter.signAndSendTransaction(built.transactionXdr);
      setSignature(sig); setResultState("confirmed"); setResultMessage(built.label);
    } catch (e) {
      console.error("[NovaSwap] scenario demo failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (/SIGN_REJECTED|POPUP_CLOSED|User cancel|declined/.test(msg)) {
        setResultState("blocked"); setResultMessage(msg);
      } else {
        setResultState("error"); setResultMessage(msg || "Unknown error — check the browser console for details.");
      }
    }
  }

  /**
   * CSPR -> USDC: a plain native CSPR transfer to the treasury, signed by
   * the connected wallet, relayed through the server (which confirms the
   * treasury's balance actually moved before paying out USDC(test) at a
   * fixed rate). Casper's Transaction V1 model has no "attach value to a
   * contract call" primitive without bespoke session Wasm, so this avoids
   * that entirely — one real transfer in, one real transfer back.
   *
   * Works with any wallet: some sign this as a legacy Deploy internally
   * instead of the Transaction V1 JSON handed to them, but the server
   * accepts either shape and can track both to confirmed execution equally
   * (see waitForConfirmedTransfers in casper-core).
   */
  async function handleCsprToUsdc() {
    if (!swapConfig || !publicKey) return;
    const csprAmount = parseFloat(amount || "0");
    if (!(csprAmount >= swapConfig.minCspr)) {
      setResultState("error");
      setResultMessage(`Minimum swap is ${swapConfig.minCspr} CSPR — Casper's own native-transfer floor.`);
      return;
    }
    if (csprAmount > swapConfig.maxCspr) {
      setResultState("error");
      setResultMessage(`Max ${swapConfig.maxCspr} CSPR per swap on this demo treasury.`);
      return;
    }

    setSwapping(true);
    setResultState("awaiting"); setSignature(null); setResultMessage(null);
    try {
      const motes = BigInt(Math.round(csprAmount * 1e9)).toString();
      const txn = new NativeTransferBuilder()
        .from(PublicKey.fromHex(publicKey))
        .target(PublicKey.fromHex(swapConfig.treasuryPublicKey))
        .chainName(swapConfig.network.includes("test") ? "casper-test" : "casper")
        .payment(100_000_000)
        .amount(motes)
        .build();

      // Baret's own simulation can only see this transaction's on-chain
      // effect (CSPR leaving) — it has no way to know the server will relay
      // USDC back, since that's a separate, off-chain step. Tell the Sign
      // Request screen explicitly so the user isn't just seeing "-3 CSPR"
      // with no indication anything comes back.
      const expectedUsdc = ((csprAmount * Number(swapConfig.rateAtomicUsdcPerCspr)) / 10 ** swapConfig.tokenDecimals).toFixed(2);
      const label = `NovaSwap sends back ~${expectedUsdc} USDC(test) at the current fixed rate once this transfer confirms.`;
      const claimedChange = { symbol: "USDC(test)", amount: `+${expectedUsdc}` };
      const { signedTransaction } = await adapter.signTransaction(
        JSON.stringify(txn.toJSON()),
        label,
        claimedChange,
      );

      const res = await fetch(`${SWAP_API_BASE}/demo/swap/cspr-to-usdc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction: JSON.parse(signedTransaction) }),
      }).then((r) => r.json());

      if (!res.success) {
        throw new Error(res.error ?? "Swap failed at the server.");
      }

      const usdcOut = Number(res.usdcAtomic) / 10 ** swapConfig.tokenDecimals;
      setSignature(res.usdcTransactionHash);
      setResultMessage(
        `Received ${usdcOut.toFixed(2)} USDC(test). CSPR transfer: ${res.csprTransactionHash.slice(0, 10)}…${res.note ? ` ${res.note}` : ""}`,
      );
      setResultState("confirmed");
      refreshBalancesSettled();
    } catch (e) {
      console.error("[NovaSwap] CSPR->USDC failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (/SIGN_REJECTED|POPUP_CLOSED|User cancel|declined/.test(msg)) {
        setResultState("blocked"); setResultMessage(msg);
      } else {
        setResultState("error"); setResultMessage(msg || "Unknown error — check the browser console for details.");
      }
    } finally {
      setSwapping(false);
    }
  }

  /**
   * USDC -> CSPR: settled the same way an x402 payment is — the payer signs
   * an off-chain EIP-712 TransferWithAuthorization (no gas, no transaction
   * submitted by the wallet at all) sending USDC to the treasury via
   * `adapter.payX402`, exactly like Scrybe's paywall. That works with any
   * wallet that can sign an x402 payment (Baret natively, the official
   * Casper Wallet via its signMessage), unlike the CSPR->USDC direction.
   * Once the server settles that authorization for real on-chain, it sends
   * CSPR back at the inverse of the same fixed rate.
   */
  async function handleUsdcToCspr() {
    if (!swapConfig || !publicKey) return;
    const usdcAmount = parseFloat(amount || "0");
    const usdcAtomic = BigInt(Math.round(usdcAmount * 10 ** swapConfig.tokenDecimals));
    // rateAtomicUsdcPerCspr is already "atomic USDC units per 1 WHOLE CSPR"
    // (matching the server's motes*rate/MOTES_PER_CSPR, where the two
    // 1e9's cancel) — dividing by 1e9 again here rounded both bounds down
    // to ~0, which is why this used to show "Max 0.00 USDC(test)".
    const minUsdcDisplay = (swapConfig.minCspr * Number(swapConfig.rateAtomicUsdcPerCspr)) / 10 ** swapConfig.tokenDecimals;
    const maxUsdcDisplay = (swapConfig.maxCspr * Number(swapConfig.rateAtomicUsdcPerCspr)) / 10 ** swapConfig.tokenDecimals;
    if (usdcAmount < minUsdcDisplay) {
      setResultState("error");
      setResultMessage(`Minimum swap is ${minUsdcDisplay.toFixed(2)} USDC(test) (so the CSPR paid back clears Casper's own 2.5 CSPR transfer floor).`);
      return;
    }
    if (usdcAmount > maxUsdcDisplay) {
      setResultState("error");
      setResultMessage(`Max ${maxUsdcDisplay.toFixed(2)} USDC(test) per swap on this demo treasury.`);
      return;
    }

    setSwapping(true);
    setResultState("awaiting"); setSignature(null); setResultMessage(null);
    try {
      const requirements = {
        scheme: "exact" as const,
        network: swapConfig.network,
        asset: swapConfig.asset,
        amount: usdcAtomic.toString(),
        payTo: `00${swapConfig.treasuryAccountHash}`,
        // Baret's own x402 parser caps this at 600s — 3600 was silently
        // rejected as an invalid PaymentRequirements before the sign
        // screen even opened.
        maxTimeoutSeconds: 300,
        // Wallets computing a UI amount from `amount` (atomic units) for cap
        // checks need the real decimals — omitting this made Baret assume 9
        // and silently under-report a 500-unit (6-decimal) payment as "0.5",
        // sliding it under the default 1.0 per-tx cap without ever asking to sign.
        extra: { name: swapConfig.tokenName, version: swapConfig.tokenVersion, decimals: swapConfig.tokenDecimals },
      };

      const { headerValue } = await adapter.payX402(requirements);

      const res = await fetch(`${SWAP_API_BASE}/demo/swap/usdc-to-cspr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headerValue }),
      }).then((r) => r.json());

      if (!res.success) {
        throw new Error(res.error ?? "Swap failed at the server.");
      }

      const csprOut = Number(res.csprMotes) / 1e9;
      setSignature(res.csprTransactionHash);
      setResultMessage(`Received ${csprOut.toFixed(4)} CSPR. USDC payment: ${res.usdcTransactionHash.slice(0, 10)}…`);
      setResultState("confirmed");
      refreshBalancesSettled();
    } catch (e) {
      console.error("[NovaSwap] USDC->CSPR failed:", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (/SIGN_REJECTED|POPUP_CLOSED|User cancel|declined|X402_FAILED/.test(msg)) {
        setResultState("blocked"); setResultMessage(msg);
      } else {
        setResultState("error"); setResultMessage(msg || "Unknown error — check the browser console for details.");
      }
    } finally {
      setSwapping(false);
    }
  }

  function flip() {
    const tmp = fromToken;
    setFromToken(toToken);
    setToToken(tmp);
  }

  return (
    <SiteShell
      theme={THEME}
      navLinks={[
        { label: "Swap" },
        { label: "Liquidity" },
        { label: "Analytics" },
        { label: "Governance" },
      ]}
    >
      <ResultOverlay
        state={resultState}
        signature={signature}
        message={resultMessage}
        onClose={() => setResultState("idle")}
      />

      <div className="min-h-screen flex flex-col items-center pt-8 pb-24 px-4">
        {/* Hero */}
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="text-4xl font-black font-display text-ink-50 mb-3">
            Swap any token,{" "}
            <span className="text-gradient">instantly.</span>
          </h1>
          <p className="text-ink-300 max-w-md">Best rates across all Casper liquidity sources. Powered by on-chain routing.</p>
        </motion.div>

        {/* Swap card */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="w-full max-w-md rounded-2xl p-1 shadow-card"
          style={{ background: "linear-gradient(145deg, rgba(225,20,40,0.08), #FFFFFF)", border: "1px solid rgba(225,20,40,0.25)" }}
        >
          <div className="rounded-xl p-5 space-y-3 bg-paper">
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-ink-300">Swap</span>
              <button className="text-ink-400 hover:text-ink-200 transition-colors">
                <Settings size={15} />
              </button>
            </div>

            {/* From */}
            <div className="p-4 rounded-xl" style={{ background: "#16171a", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-ink-400">You pay</span>
                <span className="text-xs text-ink-400">
                  Balance: {connected && balanceFor(fromToken.symbol) !== null ? balanceFor(fromToken.symbol)!.toFixed(4) : "—"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setSignature(null); setResultState("idle"); }}
                  className="flex-1 bg-transparent text-2xl font-bold text-ink-50 outline-none min-w-0"
                  placeholder="0"
                />
                <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold text-ink-50 bg-paper border border-white/10">
                  <TokenIcon symbol={fromToken.symbol} />
                  {fromToken.symbol}
                  <ChevronDown size={13} className="text-ink-400" />
                </button>
              </div>
              <p className="text-xs text-ink-400 mt-1.5">≈ ${(fromToken.price * parseFloat(amount || "0")).toFixed(2)}</p>
            </div>

            {/* Flip */}
            <div className="flex justify-center">
              <button
                onClick={flip}
                className="w-9 h-9 rounded-xl flex items-center justify-center transition-all hover:rotate-180 duration-300 bg-brand-500/10 text-brand-400"
                style={{ border: "1px solid rgba(225,20,40,0.3)" }}
              >
                <ArrowUpDown size={15} />
              </button>
            </div>

            {/* To */}
            <div className="p-4 rounded-xl" style={{ background: "#16171a", border: "1px solid rgba(255,255,255,0.08)" }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-ink-400">You receive</span>
                <span className="text-xs text-ink-400">
                  Balance: {connected && balanceFor(toToken.symbol) !== null ? balanceFor(toToken.symbol)!.toFixed(4) : "—"}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex-1 text-2xl font-bold text-ink-200">
                  {isNaN(outputAmount) ? "0" : outputAmount.toFixed(2)}
                </span>
                <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold text-ink-50 bg-paper border border-white/10">
                  <TokenIcon symbol={toToken.symbol} />
                  {toToken.symbol}
                  <ChevronDown size={13} className="text-ink-400" />
                </button>
              </div>
              <p className="text-xs text-ink-400 mt-1.5">≈ ${(outputAmount * toToken.price).toFixed(2)}</p>
            </div>

            {/* Route info */}
            <div className="flex items-center justify-between px-1 text-xs text-ink-400">
              <span>{doingRealSwap ? "Route: treasury (fixed rate)" : "Route: CasperSwap"}</span>
              <span className="flex items-center gap-1">
                {doingRealSwap ? "Real settlement" : "0.3% fee"} <Info size={11} />
              </span>
            </div>

            {/* Swap button */}
            {success ? (
              <motion.button
                onClick={() => { setSignature(null); setResultState("idle"); }}
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                className="w-full py-4 rounded-xl text-center font-bold text-emerald-400"
                style={{ background: "#ecfdf5", border: "1px solid rgba(16,185,129,0.3)" }}
              >
                ✓ Swap Successful — swap again
              </motion.button>
            ) : (
              <button
                onClick={handleSwap}
                disabled={swapping}
                className="w-full py-4 rounded-xl font-bold text-white transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait"
                style={{ background: "linear-gradient(135deg,#e11428,#c00f20)" }}
              >
                {!connected ? "Connect Wallet to Swap" : swapping ? "Swapping…" : "Swap"}
              </button>
            )}
          </div>
        </motion.div>

        {/* Demo toggle */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-8 flex items-center gap-3 px-5 py-3 rounded-2xl bg-bone border border-white/10"
        >
          <span className="text-xs text-ink-300">Simulate malicious swap</span>
          <button
            onClick={() => setDangerous(!dangerous)}
            className="relative w-10 h-5 rounded-full transition-colors"
            style={{ background: dangerous ? "#E8470A" : "rgba(255,255,255,0.1)" }}
          >
            <div
              className="absolute top-0.5 w-4 h-4 rounded-full bg-ink-800 shadow-card transition-transform"
              style={{ transform: dangerous ? "translateX(21px)" : "translateX(2px)" }}
            />
          </button>
          {dangerous && <span className="text-xs text-[#E8470A] font-medium">⚠ Danger mode</span>}
        </motion.div>
      </div>
    </SiteShell>
  );
}
