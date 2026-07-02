/**
 * Scrybe — pay-per-question oracle, x402 over Casper testnet.
 *
 * This is Baret's flagship demo. The user types a question, the merchant
 * server responds HTTP 402 with CasperPaymentRequirements, this page hands
 * them to `window.baret.payX402()` (the wallet runs its x402 firewall +
 * policy caps and returns an X-PAYMENT header), the header is replayed to the
 * merchant, the merchant verifies + settles through the casper-x402
 * facilitator, and the answer comes back with the on-chain proof.
 *
 * The page hides the protocol details behind a "How it works" disclosure so
 * non-technical visitors see one clean CTA: "Pay $0.001 → Ask".
 */

import { useState, useEffect, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Sparkles, ExternalLink, ShieldCheck, AlertTriangle,
  Loader2, Zap, ChevronDown, Lock,
} from "lucide-react";
import { useWallet } from "../../wallet/context";
import {
  createX402PaymentHeader,
  type PaymentRequirements,
} from "./build-x402";

type Phase =
  | "asking"          // sent first fetch
  | "paywalled"       // got 402, building payment
  | "signing"         // requirements handed to the wallet firewall
  | "settling"        // header replayed to the server
  | "answered"        // 200 + proof
  | "error";

interface AnswerEntry {
  id: string;
  question: string;
  phase: Phase;
  answer?: string;
  settlement?: string;
  payer?: string;
  network?: string;
  paywall?: PaymentRequirements;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

// In production the showcase is on Vercel but the API server is on Render.
// VITE_SCRYBE_API can be set to /api (Vite proxy) during local dev.
const SCRYBE_API_BASE =
  (import.meta.env.VITE_SCRYBE_API as string | undefined) ??
  "https://baret-server.onrender.com";

const SUGGESTIONS = [
  "What is the Casper Network?",
  "How does Casper proof-of-stake work?",
  "What is a CEP-18 token?",
  "Explain x402 payments on Casper",
];

export default function Scrybe() {
  const { connected, walletAddress, shortAddress, openWalletModal, adapter, disconnect } = useWallet();
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<AnswerEntry[]>([]);
  const [pending, setPending] = useState(false);
  const [pendingQ, setPendingQ] = useState<string | null>(null);

  // If the user submitted a question without being connected, run it once
  // they finish picking a wallet.
  useEffect(() => {
    if (connected && walletAddress && pendingQ) {
      const q = pendingQ;
      setPendingQ(null);
      void runPayment(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, walletAddress, pendingQ]);

  async function submit(q: string) {
    const trimmed = q.trim();
    if (!trimmed || pending) return;
    if (!connected || !walletAddress) {
      setPendingQ(trimmed);
      openWalletModal();
      return;
    }
    void runPayment(trimmed);
  }

  async function runPayment(q: string) {
    setPending(true);
    setQuestion("");
    const entryId = `ask-${Date.now()}`;
    const entry: AnswerEntry = { id: entryId, question: q, phase: "asking", startedAt: Date.now() };
    setHistory((prev) => [...prev, entry]);
    const update = (patch: Partial<AnswerEntry>) =>
      setHistory((prev) => prev.map((e) => e.id === entryId ? { ...e, ...patch } : e));

    try {
      // Tell the Baret extension interceptor to stand down — this page manages
      // its own x402 flow so the user sees the payment progress steps.
      (window as unknown as { __baretX402Managed?: boolean }).__baretX402Managed = true;

      // 1. First request — expect 402
      const initial = await fetch(
        `${SCRYBE_API_BASE}/demo/scrybe?q=${encodeURIComponent(q)}`,
        { headers: { accept: "application/json" } },
      );

      if (initial.status === 200) {
        // unlikely (server always requires payment) but handle anyway
        const body = await initial.json().catch(() => ({}));
        update({
          phase: "answered", answer: body.answer, settlement: body.settlement,
          payer: body.payer, network: body.network, finishedAt: Date.now(),
        });
        return;
      }
      if (initial.status !== 402) {
        const body = await initial.json().catch(() => ({}));
        const errMsg =
          typeof body.error === "string"
            ? body.error
            : (typeof body.error?.message === "string" ? body.error.message : null) ??
              body.message ??
              `Server returned ${initial.status}`;
        throw new Error(String(errMsg));
      }

      // 2. Parse the 402 contract
      const paywallBody = await initial.json();
      const requirements: PaymentRequirements = paywallBody.accepts?.[0];
      if (!requirements) throw new Error("Server didn't return CasperPaymentRequirements.");
      update({ phase: "paywalled", paywall: requirements });

      // 3. Hand the requirements to the wallet's x402 firewall. Baret applies
      // the user's policy caps and returns the X-PAYMENT header value —
      // auto-approved when within caps, otherwise a popup.
      update({ phase: "signing" });
      const headerValue = await createX402PaymentHeader(adapter.payX402, requirements);

      // 4. Replay with the signed payload in X-PAYMENT
      update({ phase: "settling" });
      const settled = await fetch(
        `${SCRYBE_API_BASE}/demo/scrybe?q=${encodeURIComponent(q)}`,
        { headers: { accept: "application/json", "X-PAYMENT": headerValue } },
      );

      const body = await settled.json().catch(() => ({}));
      if (settled.status === 200) {
        update({
          phase: "answered",
          answer: body.answer ?? "(empty answer)",
          settlement: body.settlement ?? body.transaction,
          payer: body.payer,
          network: body.network ?? requirements.network,
          finishedAt: Date.now(),
        });
      } else {
        const detail =
          typeof body.detail === "string" ? body.detail : null;
        const errField =
          typeof body.error === "string"
            ? body.error
            : typeof body.error?.message === "string"
              ? body.error.message
              : null;
        throw new Error(
          String(detail ?? errField ?? `Settle failed (${settled.status})`),
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      update({ phase: "error", error: friendlyError(msg), finishedAt: Date.now() });
    } finally {
      setPending(false);
    }
  }

  // Re-run a question after an error.
  function retry(entryId: string) {
    const entry = history.find((e) => e.id === entryId);
    if (!entry || pending) return;
    void submit(entry.question);
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void submit(question);
  }

  return (
    <div className="min-h-screen text-ink-50 bg-paper">
      <Link to="/" className="fixed top-4 left-4 z-50 flex items-center gap-1.5 text-xs text-ink-50/40 hover:text-ink-50/80 transition-colors">
        <ArrowLeft size={12} /> Showcase
      </Link>

      <header className="border-b border-white/10 sticky top-0 backdrop-blur-md z-30 bg-paper/85">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center bg-ink-900">
              <Zap size={14} className="text-brand-500" />
            </div>
            <div>
              <h1 className="font-display font-bold tracking-tight">Scrybe</h1>
              <p className="text-[10px] text-ink-50/45 leading-none mt-0.5">Pay-per-question oracle</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {connected ? (
              <button
                onClick={() => void disconnect()}
                className="flex items-center gap-2 px-2.5 py-1 rounded-full text-[10px] font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-600/25"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                {shortAddress}
              </button>
            ) : (
              <button
                onClick={openWalletModal}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-medium bg-bone text-ink-50/70 border border-white/12 hover:bg-ink-900/[0.04]"
              >
                <Lock size={10} /> Connect wallet
              </button>
            )}
            <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-medium bg-brand-500/10 text-brand-300 border border-brand-500/20">
              $0.001/q
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 pt-12 pb-32">
        {history.length === 0 && (
          <motion.section initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="space-y-7">
            <div>
              <h2 className="font-display text-4xl sm:text-5xl font-black tracking-tight leading-[1.05]">
                Pay $0.001.<br />
                <span className="text-brand-500">Get an answer.</span>
              </h2>
              <p className="text-ink-50/55 mt-3 leading-relaxed max-w-xl">
                Pay-per-question oracle running the HTTP&nbsp;402 protocol on Casper testnet.
                Your wallet pays in USDC (demo) — under your caps — and answers settle on-chain.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => void submit(s)}
                  disabled={pending}
                  className="text-left px-4 py-3.5 rounded-xl text-sm transition-all disabled:opacity-50 bg-paper border border-white/10 shadow-card hover:border-brand-500/40 hover:shadow-lift"
                >
                  <span className="text-ink-50/80">{s}</span>
                </button>
              ))}
            </div>

            <HowItWorksDisclosure />
          </motion.section>
        )}

        <div className="space-y-5 mt-2">
          <AnimatePresence initial={false}>
            {history.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <ConversationEntry
                  entry={entry}
                  onRetry={() => retry(entry.id)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </main>

      <form
        onSubmit={onSubmit}
        className="fixed bottom-0 inset-x-0 border-t border-white/10 backdrop-blur-md bg-paper/92"
      >
        <div className="max-w-3xl mx-auto px-6 py-3.5 flex items-center gap-3">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder={connected ? "Ask Scrybe a question…" : "Connect a wallet first, then ask…"}
            disabled={pending}
            className="flex-1 px-4 py-3 rounded-xl bg-bone border border-white/12 text-ink-50 outline-none focus:border-brand-500/50 focus:bg-paper transition-all placeholder:text-ink-50/35 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={pending || !question.trim()}
            className="px-4 py-3 rounded-xl text-sm font-semibold disabled:opacity-30 transition-all flex items-center gap-2 text-white bg-ink-900 hover:bg-ink-800"
          >
            {connected
              ? <><Zap size={13} className="text-brand-500" /> Pay $0.001 · Ask</>
              : <><Lock size={13} /> Connect · Ask</>}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ───────── pieces ───────── */

function ConversationEntry({ entry, onRetry }: {
  entry: AnswerEntry;
  onRetry: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 justify-end">
        <p className="pt-1 rounded-2xl rounded-tr-sm bg-ink-900 text-white px-4 py-2.5 leading-relaxed max-w-[80%]">{entry.question}</p>
        <div className="w-7 h-7 rounded-full bg-ink-900/8 flex items-center justify-center text-[10px] text-ink-50/55 shrink-0">you</div>
      </div>

      {entry.phase !== "answered" && entry.phase !== "error" && (
        <ProgressStep entry={entry} />
      )}

      {entry.answer && (
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-ink-900">
            <Sparkles size={11} className="text-brand-500" />
          </div>
          <div className="flex-1">
            <p className="rounded-2xl rounded-tl-sm bg-bone text-ink-50 px-4 py-2.5 leading-relaxed">{entry.answer}</p>
            {entry.settlement && (
              <SettlementReceipt
                signature={entry.settlement}
                payer={entry.payer}
                network={entry.network}
                elapsedMs={(entry.finishedAt ?? Date.now()) - entry.startedAt}
              />
            )}
          </div>
        </div>
      )}

      {entry.phase === "error" && (
        <div className="ml-10 space-y-2">
          <div className="flex items-start gap-2 text-sm rounded-lg p-3"
               style={{ background: "rgba(232,71,10,0.08)", border: "1px solid rgba(232,71,10,0.22)" }}>
            <AlertTriangle size={14} className="mt-0.5 shrink-0" style={{ color: "#E8470A" }} />
            <span style={{ color: "#E8470A" }}>{entry.error}</span>
          </div>
          <button onClick={onRetry}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white bg-ink-900 hover:bg-ink-800">
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

function ProgressStep({ entry }: { entry: AnswerEntry }) {
  const PHASES: Array<{ key: Phase; label: string }> = [
    { key: "asking",    label: "Asking the oracle" },
    { key: "paywalled", label: "Building $0.001 USDC payment" },
    { key: "signing",   label: "Wallet signing EIP-712 payment" },
    { key: "settling",  label: "Settling on Casper" },
  ];
  const idx = PHASES.findIndex((p) => p.key === entry.phase);

  return (
    <div className="ml-10 rounded-lg p-3 space-y-1.5 bg-bone border border-white/10">
      {PHASES.map((p, i) => {
        const done = i < idx;
        const active = i === idx;
        return (
          <div key={p.key} className="flex items-center gap-2.5 text-xs">
            <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: done ? "rgba(5,150,105,0.14)" : active ? "rgba(225,20,40,0.14)" : "rgba(255,255,255,0.06)",
                  }}>
              {done ? <span className="text-[9px] text-emerald-400">✓</span>
                : active ? <Loader2 size={9} className="animate-spin" style={{ color: "#e11428" }} />
                : <span className="text-[8px] text-ink-50/35">{i + 1}</span>}
            </span>
            <span style={{
              color: active ? "rgba(255,255,255,0.92)" : done ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.35)",
              fontWeight: active ? 600 : 400,
            }}>
              {p.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function SettlementReceipt({ signature, payer, network, elapsedMs }: {
  signature: string; payer?: string; network?: string; elapsedMs: number;
}) {
  const cluster = network?.includes("casper-test") || network?.includes("testnet") ? "testnet" : "mainnet";
  const base = cluster === "testnet" ? "https://testnet.cspr.live" : "https://cspr.live";
  const explorer = `${base}/deploy/${signature}`;

  return (
    <div className="mt-3 rounded-xl p-3 text-xs flex items-start gap-2 bg-emerald-500/10 border border-emerald-600/20">
      <ShieldCheck size={14} className="text-emerald-400 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-emerald-300 font-medium mb-1">
          Paid · settled on {cluster} in {(elapsedMs / 1000).toFixed(1)}s
        </p>
        <a href={explorer} target="_blank" rel="noopener noreferrer"
           className="font-mono text-[11px] text-emerald-300/80 hover:text-emerald-800 inline-flex items-center gap-1 break-all">
          {signature.slice(0, 12)}…{signature.slice(-8)} <ExternalLink size={10} className="shrink-0" />
        </a>
        {payer && (
          <p className="text-[10px] text-ink-50/40 mt-1 font-mono break-all">
            from {payer.slice(0, 12)}…{payer.slice(-6)}
          </p>
        )}
      </div>
    </div>
  );
}

function HowItWorksDisclosure() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl bg-paper border border-white/10 shadow-card">
      <button
        onClick={() => setOpen((s) => !s)}
        className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-ink-900/[0.02] rounded-xl"
      >
        <span className="text-xs uppercase tracking-wider text-ink-50/50 font-semibold">How it works</span>
        <ChevronDown size={12} className={`text-ink-50/35 transition-transform ${open ? "" : "-rotate-90"}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          {[
            { n: "01", t: "Ask",     b: "Page requests the answer" },
            { n: "02", t: "402",     b: "Server demands USDC payment" },
            { n: "03", t: "Sign",    b: "Baret validates + signs" },
            { n: "04", t: "Settle",  b: "Facilitator settles on testnet" },
          ].map((s) => (
            <div key={s.n} className="rounded-lg p-2.5 bg-bone border border-white/8">
              <p className="text-[9px] text-brand-300 font-mono">{s.n}</p>
              <p className="text-[12px] font-bold mt-0.5 text-ink-50">{s.t}</p>
              <p className="text-[10px] text-ink-50/50 mt-0.5 leading-snug">{s.b}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function friendlyError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("insufficient") || m.includes("balance")) {
    return "Your wallet doesn't have enough testnet CEP-18 tokens. Use the faucet on the home page first, then retry.";
  }
  if (m.includes("cap") || m.includes("policy")) {
    return "This payment exceeds your Baret policy caps. Raise the x402 caps in the wallet settings, or approve the popup.";
  }
  if (m.includes("user rejected") || m.includes("rejected") || m.includes("declined")) {
    return "You declined the payment. No money moved.";
  }
  if (m.includes("not connected") || m.includes("no wallet")) {
    return "Connect a Casper wallet first, then ask.";
  }
  if (m.includes("on-chain settlement failed") || m.includes("entrypoint") || m.includes("entry_point")) {
    return `On-chain settlement error: ${msg}`;
  }
  return msg;
}
