import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpDown, ChevronDown, Settings, Info } from "lucide-react";
import { NativeTransferBuilder, PublicKey } from "casper-js-sdk";
import { SiteShell } from "../../components/SiteShell";
import { ResultOverlay, type ResultState } from "../../blackthorn/ResultOverlay";
import { RiskPreview } from "../../blackthorn/RiskPreview";
import { buildScenario } from "../../blackthorn/transactions";
import { useWallet } from "../../wallet/context";

// In production the showcase is on Vercel but the API server is on Render.
const SWAP_API_BASE =
  (import.meta.env.VITE_SCRYBE_API as string | undefined) ??
  "https://baret-server.onrender.com";

interface SwapConfig {
  enabled: boolean;
  treasuryPublicKey: string;
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

export default function NovaSwap() {
  const { connected, openWalletModal, walletAddress, publicKey, walletName, adapter } = useWallet();
  const [fromToken, setFromToken] = useState(TOKENS[0]);
  const [toToken, setToToken] = useState(TOKENS[1]);
  // Default above Casper's own 2.5 CSPR native-transfer minimum, so the real
  // CSPR->USDC pair works out of the box without the user hitting that wall first.
  const [amount, setAmount] = useState("3");
  const [dangerous, setDangerous] = useState(false);
  const [resultState, setResultState] = useState<ResultState>("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [previewTx, setPreviewTx] = useState<string | null>(null);
  const [swapping, setSwapping] = useState(false);
  const [swapConfig, setSwapConfig] = useState<SwapConfig | null>(null);

  useEffect(() => {
    fetch(`${SWAP_API_BASE}/health`)
      .then((r) => r.json())
      .then((body) => {
        const s = body?.swap;
        if (s?.enabled && s?.treasuryPublicKey) {
          setSwapConfig({
            enabled: true,
            treasuryPublicKey: s.treasuryPublicKey,
            rateAtomicUsdcPerCspr: s.rateAtomicUsdcPerCspr,
            minCspr: s.minCspr,
            maxCspr: s.maxCspr,
          });
        }
      })
      .catch(() => { /* real swap disabled — falls back to the scenario demo */ });
  }, []);

  const outputAmount = fromToken.price * parseFloat(amount || "0") / toToken.price;
  const success = signature !== null;
  // The only pair with a real settlement path: everything else (CSX, yCSPR
  // — fictional demo tokens with no real contract) stays the scenario demo.
  const isRealPair = fromToken.symbol === "CSPR" && toToken.symbol === "USDC";
  const doingRealSwap = isRealPair && !dangerous && !!swapConfig;
  const scenarioLabel = dangerous
    ? `Swap ${amount} ${fromToken.symbol} → ${toToken.symbol} (danger scenario · drainer pattern)`
    : `Swap ${amount} ${fromToken.symbol} → ${outputAmount.toFixed(4)} ${toToken.symbol}`;

  async function handleSwap() {
    if (!connected || !walletAddress) { openWalletModal(); return; }
    if (doingRealSwap) {
      await handleRealSwap();
      return;
    }
    try {
      const __built = await buildScenario(dangerous ? "novaswap-danger" : "novaswap-safe", walletAddress); const tx = __built.transactionXdr;
      setPreviewTx(tx);   // opens RiskPreview — user decides how to send
    } catch (e) {
      setResultState("error");
      setResultMessage(e instanceof Error ? e.message : String(e));
    }
  }

  /**
   * The real swap: a plain native CSPR transfer to the treasury, signed by
   * the connected wallet, relayed through the server (which confirms the
   * treasury's balance actually moved before paying out USDC(test) at a
   * fixed rate). Casper's Transaction V1 model has no "attach value to a
   * contract call" primitive without bespoke session Wasm, so this avoids
   * that entirely — one real transfer in, one real transfer back.
   */
  async function handleRealSwap() {
    if (!swapConfig || !publicKey) return;
    if (walletName !== "Baret") {
      setResultState("error");
      setResultMessage(
        "Real swap settlement is currently verified with the Baret wallet only — " +
        "other wallets sign a legacy Deploy format whose on-chain confirmation this demo " +
        "can't yet reliably track. Connect Baret to swap for real.",
      );
      return;
    }
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
        .chainName("casper-test")
        .payment(100_000_000)
        .amount(motes)
        .build();

      const { signedTransaction } = await adapter.signTransaction(JSON.stringify(txn.toJSON()));

      const res = await fetch(`${SWAP_API_BASE}/demo/swap/cspr-to-usdc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signedTransaction: JSON.parse(signedTransaction) }),
      }).then((r) => r.json());

      if (!res.success) {
        throw new Error(res.error ?? "Swap failed at the server.");
      }

      const usdcOut = Number(res.usdcAtomic) / 1e6;
      setSignature(res.usdcTransactionHash);
      setResultMessage(
        `Received ${usdcOut.toFixed(2)} USDC(test). CSPR transfer: ${res.csprTransactionHash.slice(0, 10)}…${res.note ? ` ${res.note}` : ""}`,
      );
      setResultState("confirmed");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/SIGN_REJECTED|POPUP_CLOSED|User cancel|declined/.test(msg)) {
        setResultState("blocked"); setResultMessage(msg);
      } else {
        setResultState("error"); setResultMessage(msg);
      }
    } finally {
      setSwapping(false);
    }
  }

  async function sendViaBlackthorn() {
    if (!previewTx) return;
    setPreviewTx(null);
    setResultState("awaiting"); setSignature(null); setResultMessage(null);
    try {
      const { signature: sig } = await adapter.signAndSendTransaction(previewTx);
      setSignature(sig); setResultState("confirmed");
    } catch (e) {
      if ((e instanceof Error && /SIGN_REJECTED|POPUP_CLOSED|User cancel|declined/.test(e.message))) {
        setResultState("blocked"); setResultMessage(e.message);
      } else {
        setResultState("error"); setResultMessage(e instanceof Error ? e.message : String(e));
      }
    }
  }
  // "Without protection" = same path through the connected wallet, but no
  // pre-sign review on the site side. Demo aid only — the wallet still
  // applies its own policy, since Baret is the wallet itself. To truly
  // bypass, swap to a different non-Baret wallet from the picker.
  async function sendRaw() {
    return sendViaBlackthorn();
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
                <span className="text-xs text-ink-400">Balance: —</span>
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
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black text-white" style={{ background: "#e11428" }}>✦</span>
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
                <span className="text-xs text-ink-400">Balance: —</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="flex-1 text-2xl font-bold text-ink-200">
                  {isNaN(outputAmount) ? "0" : outputAmount.toFixed(2)}
                </span>
                <button className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold text-ink-50 bg-paper border border-white/10">
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-black text-white" style={{ background: "#2775ca" }}>$</span>
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

      <RiskPreview
        open={previewTx !== null}
        transactionXdr={previewTx}
        userWallet={walletAddress ?? null}
        scenarioLabel={scenarioLabel}
        onClose={() => setPreviewTx(null)}
        onProceedWithBlackthorn={sendViaBlackthorn}
        onProceedRaw={sendRaw}
      />
    </SiteShell>
  );
}
