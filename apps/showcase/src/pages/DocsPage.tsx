/** Docs index — Baret light theme. */

import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowLeft, ArrowUpRight, BookOpen, Shield, FileText, Zap, Layers, Globe,
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
