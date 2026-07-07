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

      <HeroDiagram />

      <main className="max-w-5xl mx-auto px-6 pb-24">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-ink-300 leading-relaxed max-w-2xl"
        >
          Every entry below is a real file in the project's{" "}
          <code className="font-mono text-ink-200 bg-ink-900/5 px-1.5 py-0.5 rounded">GitHub repo</code> —
          specs and design notes that back every claim on the home page.
        </motion.p>

        <div className="mt-8 grid sm:grid-cols-2 gap-3">
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
 * The docs page's hero: the headline IS the diagram. Where Baret's check
 * actually sits in the signing pipeline, versus a normal wallet.
 */
function HeroDiagram() {
  return (
    <section className="relative overflow-hidden pt-28 sm:pt-32 pb-16 sm:pb-20">
      {/* ambient glow, full-bleed */}
      <div className="pointer-events-none absolute -top-32 left-1/2 -translate-x-1/2 w-[900px] h-[420px] rounded-full bg-emerald-500/[0.08] blur-[110px]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-paper" />

      <div className="relative max-w-5xl mx-auto px-6">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center max-w-2xl mx-auto"
        >
          <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] font-bold text-emerald-400">
            <span className="w-6 h-[3px] bg-emerald-500 rounded-full" />
            Documentation · the one thing that's different
          </p>
          <h1 className="mt-5 font-display text-4xl sm:text-5xl md:text-[56px] font-bold tracking-tight leading-[1.05]">
            Where the check<br />actually happens.
          </h1>
          <p className="mt-5 text-ink-300 leading-relaxed max-w-lg mx-auto">
            Same dApp, same signature request, same wallet key. Everything
            hinges on one extra hop before the key ever gets used.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="relative mt-14 grid md:grid-cols-2 gap-5"
        >
          {/* Normal wallet flow */}
          <div className="rounded-2xl border border-brand-900/40 bg-gradient-to-b from-brand-500/[0.06] to-transparent p-5 sm:p-6 flex flex-col h-full">
            <div className="flex items-center gap-2.5 mb-7">
              <span className="w-9 h-9 rounded-xl grid place-items-center bg-ink-950 border border-white/10">
                <WalletIcon size={15} className="text-ink-300" />
              </span>
              <p className="text-[13px] font-display font-bold text-ink-300 tracking-wide">A NORMAL WALLET</p>
            </div>

            <div className="flex-1 flex flex-col justify-center">
              <TimelineStep icon={Globe} title="A dApp asks you to sign" caption="A page you're using sends a transaction to your wallet." tone="neutral" />
              <TimelineStep icon={WalletIcon} title="Your wallet receives it" caption="The raw transaction bytes — nothing reads them first." tone="neutral" isLast />

              <StepDivider label="no check exists in between" tone="danger" />

              <OutcomeCard
                icon={AlertTriangle}
                title="Signed & broadcast, as-is"
                caption="Whatever the transaction actually does, it does — the wallet had no way to warn you."
                tone="danger"
                full
              />
            </div>
          </div>

          {/* Baret flow */}
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/[0.07] to-transparent p-5 sm:p-6">
            <div className="flex items-center gap-2.5 mb-7">
              <span className="w-9 h-9 rounded-xl grid place-items-center bg-emerald-500/10 border border-emerald-500/30">
                <Shield size={15} className="text-emerald-400" />
              </span>
              <p className="text-[13px] font-display font-bold text-emerald-400 tracking-wide">WITH BARET</p>
            </div>

            <TimelineStep icon={Globe} title="A dApp asks you to sign" caption="The identical request — nothing about the dApp changes." tone="neutral" />
            <TimelineStep icon={Puzzle} title="window.baret receives it" caption="The inpage provider every Casper dApp already knows how to call." tone="neutral" />
            <TimelineStep icon={Cpu} title="Background worker holds the key" caption="It doesn't sign yet — it routes the request onward first." tone="neutral" isLast />

            <StepDivider label="then Baret steps in —" tone="ok" />

            <TimelineStep
              icon={ScanSearch}
              title="The analyze engine checks it"
              caption={<>Decodes the transaction and runs it against your policy — <code className="font-mono text-[11px] text-emerald-300/90">POST /v1/analyze</code>.</>}
              tone="check"
              glow
              isLast
            />

            <StepDivider label="depending on the verdict —" tone="ok" />

            <div className="grid grid-cols-2 gap-2.5">
              <OutcomeCard icon={ShieldCheck} title="Safe" caption="Signed & broadcast to Casper Network" tone="ok" />
              <OutcomeCard icon={ShieldX} title="Blocked" caption="Refused — nothing ever broadcasts" tone="danger" />
            </div>
          </div>
        </motion.div>

        <div className="relative mt-8 text-center">
          <a
            href="https://github.com/Aeztrest/CasperBaret/blob/main/docs/protocol.md"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 font-semibold"
          >
            Read how the analyze engine works <ArrowUpRight size={13} />
          </a>
        </div>
      </div>
    </section>
  );
}

const STEP_TONE = {
  neutral: { ring: "bg-ink-950 border-white/12", icon: "text-ink-300", line: "bg-white/12", title: "text-ink-50" },
  check:   { ring: "bg-emerald-500/15 border-emerald-400/60", icon: "text-emerald-300", line: "bg-emerald-500/40", title: "text-emerald-300" },
  danger:  { ring: "bg-brand-500/15 border-brand-500/50", icon: "text-brand-300", line: "bg-brand-500/30", title: "text-brand-300" },
} as const;

function TimelineStep({
  icon: Icon, title, caption, tone, isLast, glow,
}: {
  icon: typeof Globe;
  title: string;
  caption: ReactNode;
  tone: keyof typeof STEP_TONE;
  isLast?: boolean;
  glow?: boolean;
}) {
  const t = STEP_TONE[tone];
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center shrink-0">
        <div className={`relative w-10 h-10 rounded-full grid place-items-center border ${t.ring}`}>
          {glow && <div className="absolute inset-0 rounded-full bg-emerald-400/40 blur-md -z-10" />}
          <Icon size={16} className={t.icon} strokeWidth={2} />
        </div>
        {!isLast && <div className={`w-0.5 flex-1 min-h-[1.5rem] my-1.5 rounded-full ${t.line}`} />}
      </div>
      <div className={isLast ? "pb-0.5 pt-1" : "pb-6 pt-1"}>
        <p className={`text-[15px] font-bold leading-snug ${t.title}`}>{title}</p>
        <p className="mt-1 text-[13px] text-ink-400 leading-relaxed max-w-[26ch]">{caption}</p>
      </div>
    </div>
  );
}

function StepDivider({ label, tone }: { label: string; tone: "ok" | "danger" }) {
  return (
    <div className="flex items-center gap-3 my-1 pl-1">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tone === "ok" ? "bg-emerald-500" : "bg-brand-500"}`} />
      <p className={`text-[11px] font-semibold tracking-wide ${tone === "ok" ? "text-emerald-400/90" : "text-brand-400/90"}`}>
        {label}
      </p>
      <span className={`h-px flex-1 ${tone === "ok" ? "bg-emerald-500/20" : "bg-brand-500/20"}`} />
    </div>
  );
}

const OUTCOME_TONE = {
  ok:     { bg: "bg-emerald-500/10", border: "border-emerald-500/40", icon: "text-emerald-300", title: "text-emerald-300" },
  danger: { bg: "bg-brand-500/10", border: "border-brand-500/40", icon: "text-brand-300", title: "text-brand-300" },
} as const;

function OutcomeCard({
  icon: Icon, title, caption, tone, full,
}: { icon: typeof ShieldCheck; title: string; caption: string; tone: keyof typeof OUTCOME_TONE; full?: boolean }) {
  const t = OUTCOME_TONE[tone];
  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} ${full ? "px-4 py-4" : "px-3.5 py-3.5"}`}>
      <div className="flex items-center gap-2">
        <Icon size={15} className={t.icon} />
        <p className={`text-[13px] font-bold ${t.title}`}>{title}</p>
      </div>
      <p className="mt-1.5 text-[12px] text-ink-400 leading-relaxed">{caption}</p>
    </div>
  );
}
