/** Docs index — Baret light theme. */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowUpRight, BookOpen, Shield, FileText, Zap, Layers, Globe,
  Send, ScanSearch, ShieldCheck, ShieldX,
  Wallet as WalletIcon, Puzzle, Cpu, ArrowRight as ArrowRightIcon,
} from "lucide-react";
import { BaretMark, Wordmark, LandingFooter } from "../components/LandingChrome";

const DOCS = [
  { title: "The Story",              desc: "Why this project ended up as five repos, not one, and how each piece fits together.", path: "README.md",                      icon: BookOpen },
  { title: "How the Protocol Works", desc: "The pre-sign analysis engine and policy rules, explained simply.",      path: "docs/protocol.md",               icon: Shield },
  { title: "Architecture",           desc: "The full technical picture: every app, package, and contract.",         path: "ARCHITECTURE.md",                icon: Layers },
  { title: "Limitations",            desc: "What Baret does and doesn't guarantee, and which policy rules are actually enforced today.", path: "LIMITATIONS.md",       icon: FileText },
  { title: "The Wallet Extension",   desc: "Screens, build steps, and how to load it in Chrome.",                   path: "apps/extension/README.md",       icon: Zap },
  { title: "Policy Schema",          desc: "The rules a transaction or x402 payment is checked against.",           path: "docs/policy-dsl.md",             icon: FileText },
  { title: "Brand",                  desc: "Tokens, typography, and the way Baret talks to users.",                 path: "docs/brand.md",                  icon: Globe },
  { title: "Demo Script",            desc: "The end-to-end walkthrough used for live demos.",                       path: "docs/demo-script.md",            icon: BookOpen },
];

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-paper text-ink-50">
      {/* Header */}
      <header className="fixed top-0 inset-x-0 z-50 border-b border-white/8 bg-ink-800/85 backdrop-blur-xl">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/home" className="flex items-center gap-2.5 group">
            <BaretMark />
            <Wordmark className="text-sm" />
            <span className="hidden sm:inline text-ink-400 text-xs">/ Docs</span>
          </Link>
          <Link
            to="/home"
            className="inline-flex items-center gap-1.5 text-xs text-ink-300 hover:text-ink-50 px-3 py-1.5 rounded-md hover:bg-ink-900/[0.04]"
          >
            <ArrowLeft size={12} /> Home
          </Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-32 pb-24">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}>
          <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] font-bold text-brand-400">
            <span className="w-6 h-[3px] hazard rounded-full" />
            Documentation
          </p>
          <h1 className="mt-4 font-display text-5xl md:text-6xl font-bold tracking-tight leading-[1.04]">
            How Baret<br />works, in detail.
          </h1>
          <p className="mt-6 text-ink-300 leading-relaxed max-w-2xl">
            Specs, protocols, and design notes that back every claim on the home page.
            Each entry below opens the real file in the project's <code className="font-mono text-ink-200 bg-ink-900/5 px-1.5 py-0.5 rounded">GitHub repo</code>.
          </p>
        </motion.div>

        <ProtocolDiagram />

        <div className="mt-12 grid sm:grid-cols-2 gap-3">
          {DOCS.map((d, i) => (
            <motion.a
              key={d.path}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              href={`https://github.com/Aeztrest/CasperBaret/blob/main/${d.path}`}
              target="_blank"
              rel="noreferrer"
              className="group card-hover block p-5"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-10 h-10 grid place-items-center rounded-xl bg-ink-900 text-brand-400">
                    <d.icon size={16} />
                  </span>
                  <div>
                    <p className="font-display font-bold">{d.title}</p>
                    <p className="text-[11px] font-mono text-ink-400 mt-0.5">{d.path}</p>
                  </div>
                </div>
                <ArrowUpRight size={16} className="text-ink-300 group-hover:text-brand-500 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 transition-all" />
              </div>
              <p className="mt-4 text-sm text-ink-300 leading-relaxed">{d.desc}</p>
            </motion.a>
          ))}
        </div>

        <div className="mt-16 card p-8 text-center bg-bone">
          <p className="font-display text-xl font-bold">Prefer to see it running?</p>
          <p className="mt-2 text-ink-300 max-w-md mx-auto">
            The showcase puts every layer of the wallet through its paces in your browser.
          </p>
          <Link to="/" className="btn-brand mt-6 !px-5 !py-2.5">
            Open the showcase <ArrowUpRight size={14} />
          </Link>
        </div>
      </main>

      <LandingFooter />
    </div>
  );
}

/**
 * Where Baret's check actually sits in the signing pipeline, versus a
 * normal wallet — real components, not an abstract before/after cartoon.
 */
function ProtocolDiagram() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="mt-12 card p-6 sm:p-8"
    >
      <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-ink-400 text-center">
        Where the check actually happens
      </p>

      <div className="mt-7 space-y-10">
        {/* Normal wallet flow */}
        <div>
          <p className="text-xs font-display font-bold text-ink-400 mb-3">
            A NORMAL WALLET
          </p>
          <div className="overflow-x-auto scrollbar-none -mx-1 px-1">
            <div className="flex items-center gap-1.5 min-w-max pb-1">
              <FlowNode icon={Globe} title="dApp" caption="requests a signature" tone="neutral" />
              <FlowArrow />
              <FlowNode icon={WalletIcon} title="Wallet" caption="receives the raw transaction" tone="neutral" />
              <FlowArrow label="nothing inspects it" muted />
              <FlowNode
                icon={Send}
                title="Signed & broadcast"
                caption="whatever it actually does, sight unseen"
                tone="bad"
                wide
              />
            </div>
          </div>
        </div>

        {/* Baret flow */}
        <div>
          <p className="text-xs font-display font-bold text-brand-400 mb-3">
            WITH BARET
          </p>
          <div className="overflow-x-auto scrollbar-none -mx-1 px-1">
            <div className="flex items-center gap-1.5 min-w-max pb-1">
              <FlowNode icon={Globe} title="dApp" caption="requests a signature" tone="neutral" />
              <FlowArrow />
              <FlowNode icon={Puzzle} title="window.baret" caption="inpage provider every Casper dApp already speaks to" tone="neutral" />
              <FlowArrow />
              <FlowNode icon={Cpu} title="Background worker" caption="holds the key, never signs yet" tone="neutral" />
              <FlowArrow />
              <FlowNode icon={ScanSearch} title="Analyze engine" caption="POST /v1/analyze — decodes the tx, runs your policy" tone="accent" />
              <FlowArrow />
              <div className="flex flex-col gap-1.5">
                <FlowNode icon={ShieldCheck} title="Safe" caption="signed & broadcast to Casper Network" tone="ok" compact />
                <FlowNode icon={ShieldX} title="Blocked" caption="refused — nothing broadcasts" tone="bad" compact />
              </div>
            </div>
          </div>
        </div>
      </div>

      <p className="mt-8 text-xs text-ink-400 text-center max-w-xl mx-auto leading-relaxed">
        Same dApp, same signature request, same wallet key — the only
        difference is one extra hop before signing: the analyze engine,
        which either lets the transaction through or refuses to sign it.{" "}
        <a
          href="https://github.com/Aeztrest/CasperBaret/blob/main/docs/protocol.md"
          target="_blank"
          rel="noreferrer"
          className="text-brand-400 hover:text-brand-300 font-semibold whitespace-nowrap"
        >
          Read how it works →
        </a>
      </p>
    </motion.div>
  );
}

const FLOW_TONE = {
  neutral: { bg: "bg-ink-900", text: "text-ink-300", iconText: "text-ink-400", border: "border-white/10" },
  accent:  { bg: "bg-ink-900", text: "text-brand-300", iconText: "text-brand-400", border: "border-brand-500/40" },
  ok:      { bg: "bg-emerald-500/10", text: "text-emerald-300", iconText: "text-emerald-400", border: "border-emerald-600/30" },
  bad:     { bg: "bg-brand-500/10", text: "text-brand-300", iconText: "text-brand-400", border: "border-brand-500/30" },
} as const;

function FlowNode({
  icon: Icon, title, caption, tone, wide, compact,
}: {
  icon: typeof Globe;
  title: string;
  caption: string;
  tone: keyof typeof FLOW_TONE;
  wide?: boolean;
  compact?: boolean;
}) {
  const t = FLOW_TONE[tone];
  return (
    <div
      className={`shrink-0 rounded-xl border ${t.border} ${t.bg} px-3.5 ${compact ? "py-2" : "py-3"} ${wide ? "w-52" : "w-40"}`}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={13} className={`shrink-0 ${t.iconText}`} />
        <p className={`text-xs font-bold ${t.text}`}>{title}</p>
      </div>
      <p className="mt-1 text-[10.5px] text-ink-400 leading-snug">{caption}</p>
    </div>
  );
}

function FlowArrow({ label, muted }: { label?: string; muted?: boolean }) {
  return (
    <div className="flex flex-col items-center shrink-0 px-0.5 min-w-[2.5rem]">
      {label && (
        <span className={`text-[9px] whitespace-nowrap mb-0.5 ${muted ? "text-brand-400/70 italic" : "text-ink-500"}`}>
          {label}
        </span>
      )}
      <ArrowRightIcon size={14} className={muted ? "text-brand-500/40" : "text-ink-400/40"} />
    </div>
  );
}
