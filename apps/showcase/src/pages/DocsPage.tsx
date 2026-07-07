/** Docs index — Baret light theme. */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowUpRight, BookOpen, Shield, FileText, Zap, Layers, Globe,
  AlertTriangle, ScanSearch, ShieldCheck, ShieldX,
  Wallet as WalletIcon, Puzzle, Cpu,
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
 * normal wallet — two vertical step-by-step columns, real components.
 */
function ProtocolDiagram() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="mt-12 card p-6 sm:p-8"
    >
      <div className="text-center max-w-md mx-auto">
        <p className="text-[11px] uppercase tracking-[0.18em] font-bold text-ink-400">
          Where the check actually happens
        </p>
        <p className="mt-2 text-sm text-ink-300 leading-relaxed">
          Same dApp, same signature request, same wallet key. One extra step
          before signing is the entire difference.
        </p>
      </div>

      <div className="mt-8 grid md:grid-cols-2 gap-6 md:gap-0 md:divide-x md:divide-white/8">
        {/* Normal wallet flow */}
        <div className="md:pr-8">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-7 h-7 rounded-lg grid place-items-center bg-ink-900 border border-white/10">
              <WalletIcon size={13} className="text-ink-300" />
            </span>
            <p className="text-xs font-display font-bold text-ink-200 tracking-wide">A NORMAL WALLET</p>
          </div>

          <TimelineStep icon={Globe} title="A dApp asks you to sign" caption="A page you're using sends a transaction to your wallet." tone="neutral" />
          <TimelineStep icon={WalletIcon} title="Your wallet receives it" caption="The raw transaction bytes, unread." tone="neutral" />
          <TimelineStep
            icon={AlertTriangle}
            title="Signed & broadcast — as-is"
            caption="Nothing decoded it first. Whatever it does, it does."
            tone="danger"
            isLast
          />
        </div>

        {/* Baret flow */}
        <div className="md:pl-8">
          <div className="flex items-center gap-2 mb-6">
            <span className="w-7 h-7 rounded-lg grid place-items-center bg-emerald-500/10 border border-emerald-500/30">
              <Shield size={13} className="text-emerald-400" />
            </span>
            <p className="text-xs font-display font-bold text-emerald-400 tracking-wide">WITH BARET</p>
          </div>

          <TimelineStep icon={Globe} title="A dApp asks you to sign" caption="The identical request — nothing about the dApp changes." tone="neutral" />
          <TimelineStep icon={Puzzle} title="window.baret receives it" caption="The inpage provider every Casper dApp already knows how to call." tone="neutral" />
          <TimelineStep icon={Cpu} title="Background worker holds the key" caption="It doesn't sign yet — it routes the request onward first." tone="neutral" />
          <TimelineStep
            icon={ScanSearch}
            title="The analyze engine checks it"
            caption={<>Decodes the transaction and runs it against your policy — <code className="font-mono text-[11px] text-emerald-300/90">POST /v1/analyze</code>.</>}
            tone="check"
          />

          <div className="flex gap-3">
            <div className="w-8 flex justify-center shrink-0">
              <div className="w-px h-3 bg-white/10" />
            </div>
            <p className="text-[11px] text-ink-500 -mt-0.5 mb-2">then, depending on the verdict —</p>
          </div>

          <div className="flex gap-3">
            <div className="w-8 shrink-0" />
            <div className="flex-1 grid grid-cols-2 gap-2.5">
              <OutcomeCard icon={ShieldCheck} title="Safe" caption="Signed & broadcast to Casper Network" tone="ok" />
              <OutcomeCard icon={ShieldX} title="Blocked" caption="Refused — nothing ever broadcasts" tone="danger" />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-white/8 text-center">
        <a
          href="https://github.com/Aeztrest/CasperBaret/blob/main/docs/protocol.md"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-semibold"
        >
          Read how the analyze engine works <ArrowUpRight size={13} />
        </a>
      </div>
    </motion.div>
  );
}

const STEP_TONE = {
  neutral: { ring: "bg-ink-900 border-white/10", icon: "text-ink-400", line: "bg-white/10", title: "text-ink-100" },
  check:   { ring: "bg-emerald-500/10 border-emerald-500/40", icon: "text-emerald-400", line: "bg-emerald-600/30", title: "text-emerald-300" },
  danger:  { ring: "bg-brand-500/10 border-brand-500/40", icon: "text-brand-400", line: "bg-brand-500/20", title: "text-brand-300" },
} as const;

function TimelineStep({
  icon: Icon, title, caption, tone, isLast,
}: {
  icon: typeof Globe;
  title: string;
  caption: ReactNode;
  tone: keyof typeof STEP_TONE;
  isLast?: boolean;
}) {
  const t = STEP_TONE[tone];
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-8 h-8 rounded-full grid place-items-center border ${t.ring}`}>
          <Icon size={14} className={t.icon} />
        </div>
        {!isLast && <div className={`w-px flex-1 min-h-[1.25rem] my-1 ${t.line}`} />}
      </div>
      <div className={isLast ? "pb-1" : "pb-5"}>
        <p className={`text-sm font-bold leading-snug ${t.title}`}>{title}</p>
        <p className="mt-0.5 text-xs text-ink-400 leading-relaxed">{caption}</p>
      </div>
    </div>
  );
}

const OUTCOME_TONE = {
  ok:     { bg: "bg-emerald-500/10", border: "border-emerald-500/30", icon: "text-emerald-400", title: "text-emerald-300" },
  danger: { bg: "bg-brand-500/10", border: "border-brand-500/30", icon: "text-brand-400", title: "text-brand-300" },
} as const;

function OutcomeCard({
  icon: Icon, title, caption, tone,
}: { icon: typeof ShieldCheck; title: string; caption: string; tone: keyof typeof OUTCOME_TONE }) {
  const t = OUTCOME_TONE[tone];
  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} px-3 py-3`}>
      <div className="flex items-center gap-1.5">
        <Icon size={13} className={t.icon} />
        <p className={`text-xs font-bold ${t.title}`}>{title}</p>
      </div>
      <p className="mt-1 text-[11px] text-ink-400 leading-snug">{caption}</p>
    </div>
  );
}
