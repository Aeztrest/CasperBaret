/** Install page — Baret dark theme. Guided, interactive sideload walkthrough. */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Download, Chrome, Globe2, ShieldCheck, Sparkles, Lock, Cpu, Eye,
  Check, ChevronRight, ArrowRight, MonitorSmartphone, FileArchive,
  FolderOpen, BookOpen, HardHat, Copy, ToggleRight, MousePointerClick,
  Pin, ExternalLink, RotateCcw,
} from "lucide-react";

const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const META_KEY = IS_MAC ? "⌘" : "Ctrl";
const PROGRESS_KEY = "baret-install-progress";
import { BackdropGrid, LandingHeader, LandingFooter, HazardRule } from "../components/LandingChrome";

type Browser = "chrome" | "firefox" | "other";

interface ArtefactSpec {
  label: string;
  href: string;
  file: string;
}

const ARTEFACTS: Record<Exclude<Browser, "other">, ArtefactSpec> = {
  chrome:  { label: "Baret for Chrome / Brave / Edge", href: "/blackthorn-chrome.zip",  file: "blackthorn-chrome.zip"  },
  firefox: { label: "Baret for Firefox",               href: "/blackthorn-firefox.zip", file: "blackthorn-firefox.zip" },
};

function detectBrowser(): Browser {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Chrome\/|Chromium\/|Edg\/|Brave\//.test(ua)) return "chrome";
  return "other";
}

export default function InstallPage() {
  const [browser, setBrowser] = useState<Browser>("other");
  useEffect(() => { setBrowser(detectBrowser()); }, []);

  const primaryKey = browser === "firefox" ? "firefox" : "chrome";
  const altKey     = primaryKey === "chrome" ? "firefox" : "chrome";

  const browserCopy = useMemo(() => {
    if (browser === "firefox") return "Detected Firefox — these steps are tuned for it.";
    if (browser === "chrome")  return "Detected a Chromium browser (Chrome / Brave / Edge).";
    return "Pick the build that matches your browser below.";
  }, [browser]);

  return (
    <div className="min-h-screen bg-paper text-ink-50 antialiased">
      <BackdropGrid />
      <LandingHeader cta={{ label: "Try the demo", to: "/showcase" }} />

      <main className="relative max-w-3xl mx-auto px-6 pt-36 pb-24">
        <Hero browserCopy={browserCopy} />
        <InstallGuide primaryKey={primaryKey} altKey={altKey} />
        <FeatureGrid />
        <AfterInstallCta />
      </main>

      <LandingFooter />
    </div>
  );
}

/* ─────────────────────────── hero ─────────────────────────── */

function Hero({ browserCopy }: { browserCopy: string }) {
  return (
    <section className="mb-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] uppercase tracking-[0.18em] font-bold border border-brand-500/30 bg-brand-500/10 text-brand-300"
      >
        <Download size={11} /> Install Baret
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.05 }}
        className="mt-6 font-display text-5xl sm:text-6xl lg:text-7xl font-bold tracking-[-0.03em] leading-[1.0]"
      >
        Hard hat on,
        <br />
        <span className="text-brand-500">in under a minute.</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.65, delay: 0.15 }}
        className="mt-6 text-lg text-ink-300 max-w-2xl leading-relaxed"
      >
        A Casper smart wallet with a transaction firewall. Follow the steps —
        each one ticks off as you go.
      </motion.p>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.65, delay: 0.3 }}
        className="mt-5 flex items-center gap-2 text-[12px] text-ink-400"
      >
        <MonitorSmartphone size={12} className="text-brand-500" /> {browserCopy}
      </motion.p>
    </section>
  );
}

/* ─────────────────────────── guide ─────────────────────────── */

interface StepDef {
  title: string;
  icon: typeof FileArchive;
  body: (ctx: { markDone: () => void }) => React.ReactNode;
}

function InstallGuide({
  primaryKey, altKey,
}: {
  primaryKey: Exclude<Browser, "other">;
  altKey: Exclude<Browser, "other">;
}) {
  const steps = primaryKey === "chrome"
    ? chromeSteps(ARTEFACTS.chrome, ARTEFACTS[altKey])
    : firefoxSteps(ARTEFACTS.firefox, ARTEFACTS[altKey]);

  // Restore progress synchronously from localStorage (client-only SPA).
  const [done, setDone] = useState<boolean[]>(() => {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(PROGRESS_KEY) : null;
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr) && arr.length === steps.length) return arr.map(Boolean);
    } catch { /* ignore corrupt/blocked storage */ }
    return steps.map(() => false);
  });
  useEffect(() => {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(done)); } catch { /* ignore */ }
  }, [done]);
  const reset = () => setDone(steps.map(() => false));

  const completed = done.filter(Boolean).length;
  const allDone = completed === steps.length;
  // The "current" step is the first not-yet-done one.
  const activeIndex = done.findIndex((d) => !d);

  const setStep = (i: number, value: boolean) =>
    setDone((prev) => prev.map((v, idx) => (idx === i ? value : v)));

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className="mb-16"
    >
      {/* progress header */}
      <div className="flex items-center justify-between mb-4">
        <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] font-bold text-brand-400">
          <span className="w-6 h-[3px] hazard rounded-full" />
          {steps.length} steps to live
        </p>
        <div className="flex items-center gap-3">
          {completed > 0 && (
            <button
              type="button"
              onClick={reset}
              className="inline-flex items-center gap-1 text-[11px] text-ink-400 hover:text-ink-100 transition-colors"
            >
              <RotateCcw size={11} /> Reset
            </button>
          )}
          <span className="text-[11px] font-mono text-ink-400">
            {completed}/{steps.length} done
          </span>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-white/8 overflow-hidden mb-7">
        <motion.div
          className="h-full hazard"
          initial={false}
          animate={{ width: `${(completed / steps.length) * 100}%` }}
          transition={{ type: "spring", stiffness: 200, damping: 26 }}
        />
      </div>

      {allDone && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-5 flex items-center gap-2.5 p-4 rounded-2xl border border-emerald-500/35 bg-emerald-500/10 text-emerald-300"
        >
          <ShieldCheck size={18} className="shrink-0" />
          <p className="text-sm font-semibold">
            All set — open Baret from your toolbar and create your wallet.
          </p>
        </motion.div>
      )}

      <ol className="space-y-3">
        {steps.map((step, i) => (
          <GuideStep
            key={step.title}
            n={i + 1}
            step={step}
            done={done[i]}
            active={i === activeIndex}
            onToggle={() => setStep(i, !done[i])}
            markDone={() => setStep(i, true)}
          />
        ))}
      </ol>

      <p className="mt-5 flex items-start gap-2 text-[12px] text-ink-400 leading-relaxed">
        <Sparkles size={13} className="text-brand-400 mt-0.5 shrink-0" />
        One-click install from the Chrome Web Store &amp; Firefox Add-ons is on
        the way. Until then this developer load takes ~30 seconds and is fully
        local — nothing leaves your machine.
      </p>
    </motion.section>
  );
}

function GuideStep({
  n, step, done, active, onToggle, markDone,
}: {
  n: number;
  step: StepDef;
  done: boolean;
  active: boolean;
  onToggle: () => void;
  markDone: () => void;
}) {
  const Icon = step.icon;
  return (
    <li
      className={`relative flex items-start gap-4 p-5 rounded-2xl border transition-all duration-200 ${
        done
          ? "border-white/8 bg-white/[0.02]"
          : active
            ? "border-brand-500/40 bg-brand-500/[0.04] shadow-lift"
            : "border-white/8 bg-white/[0.015]"
      }`}
    >
      {/* check / number badge — click to toggle done */}
      <button
        type="button"
        onClick={onToggle}
        title={done ? "Mark as not done" : "Mark as done"}
        className={`relative w-11 h-11 rounded-xl grid place-items-center shrink-0 transition-all ${
          done
            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/40"
            : active
              ? "bg-brand-500 text-white"
              : "bg-ink-900 text-brand-400 border border-white/10"
        }`}
      >
        {done ? <Check size={18} /> : <Icon size={18} />}
        <span className={`absolute -top-2 -right-2 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-md ${
          done ? "bg-emerald-500 text-white" : "bg-brand-500 text-white"
        }`}>
          {n}
        </span>
      </button>

      <div className="flex-1 min-w-0 pt-0.5">
        <div className="flex items-center gap-2">
          <p className={`font-display font-bold text-base tracking-tight ${done ? "text-ink-300" : "text-ink-50"}`}>
            {step.title}
          </p>
          {active && !done && (
            <span className="text-[9px] uppercase tracking-[0.18em] font-bold text-brand-300 bg-brand-500/15 px-1.5 py-0.5 rounded">
              You're here
            </span>
          )}
        </div>
        <div className={`text-sm mt-2 leading-relaxed ${done ? "text-ink-400" : "text-ink-300"}`}>
          {step.body({ markDone })}
        </div>
      </div>
    </li>
  );
}

/* ─────────────────────────── step content ─────────────────────────── */

function chromeSteps(primary: ArtefactSpec, alt: ArtefactSpec): StepDef[] {
  return [
    {
      title: "Download the build",
      icon: Download,
      body: ({ markDone }) => (
        <div>
          <p>Grab the latest packaged extension — it’s a single ZIP.</p>
          <DownloadButtons primary={primary} alt={alt} onDownload={markDone} />
        </div>
      ),
    },
    {
      title: "Unzip it",
      icon: FileArchive,
      body: () => (
        <p>
          Right-click <Code>{primary.file}</Code> → <b>Extract All</b>. Keep the
          extracted <Code>{primary.file.replace(".zip", "")}</Code> folder handy —
          you’ll point Chrome at it in the last step.
        </p>
      ),
    },
    {
      title: "Open Extensions & enable Developer mode",
      icon: ToggleRight,
      body: () => (
        <div className="space-y-2.5">
          <p>Jump to your extensions page:</p>
          <AddressBarAction url="chrome://extensions/" />
          <p className="text-[11px] text-ink-400 leading-relaxed">
            Chrome blocks sites from opening this page, so <b>Open</b> also copies it —
            if no tab appears, press <Code>{META_KEY}+L</Code> and paste.
          </p>
          <p className="flex flex-wrap items-center gap-2 pt-0.5">
            Then flip <b>Developer mode</b> on — top-right corner:
            <MockToggle />
          </p>
        </div>
      ),
    },
    {
      title: "Load unpacked & pin Baret",
      icon: FolderOpen,
      body: () => (
        <div className="space-y-2.5">
          <p className="flex flex-wrap items-center gap-1.5">
            Click <MockButton icon={MousePointerClick} label="Load unpacked" /> and
            select the extracted <Code>blackthorn-chrome</Code> folder.
          </p>
          <p className="flex flex-wrap items-center gap-1.5">
            <Pin size={13} className="text-brand-400" />
            Pin Baret from the puzzle-piece menu, then click it to create your wallet.
          </p>
        </div>
      ),
    },
  ];
}

function firefoxSteps(primary: ArtefactSpec, alt: ArtefactSpec): StepDef[] {
  return [
    {
      title: "Download the build",
      icon: Download,
      body: ({ markDone }) => (
        <div>
          <p>Grab the latest packaged extension — a single ZIP.</p>
          <DownloadButtons primary={primary} alt={alt} onDownload={markDone} />
        </div>
      ),
    },
    {
      title: "Unzip it",
      icon: FileArchive,
      body: () => (
        <p>
          Right-click <Code>{primary.file}</Code> → <b>Extract Here</b>. Note the
          folder — you’ll pick <Code>manifest.json</Code> from inside it.
        </p>
      ),
    },
    {
      title: "Open the debugging page",
      icon: ToggleRight,
      body: () => (
        <div className="space-y-2.5">
          <p>Jump to the add-on debugging page:</p>
          <AddressBarAction url="about:debugging#/runtime/this-firefox" />
          <p className="text-[11px] text-ink-400 leading-relaxed">
            Firefox blocks sites from opening this page, so <b>Open</b> also copies it —
            if no tab appears, press <Code>{META_KEY}+L</Code> and paste.
          </p>
        </div>
      ),
    },
    {
      title: "Load Temporary Add-on",
      icon: FolderOpen,
      body: () => (
        <div className="space-y-2">
          <p className="flex flex-wrap items-center gap-1.5">
            Click <MockButton icon={MousePointerClick} label="Load Temporary Add-on…" />
            and pick <Code>manifest.json</Code> inside the extracted folder.
          </p>
          <p className="text-[11px] text-ink-400">
            Firefox clears temporary add-ons on restart — just re-load it next time.
          </p>
        </div>
      ),
    },
  ];
}

/* ─────────────────────────── pieces ─────────────────────────── */

function DownloadButtons({
  primary, alt, onDownload,
}: {
  primary: ArtefactSpec;
  alt: ArtefactSpec;
  onDownload: () => void;
}) {
  const PrimaryIcon = primary.file.includes("chrome") ? Chrome : Globe2;
  const AltIcon     = alt.file.includes("chrome") ? Chrome : Globe2;
  return (
    <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2.5">
      <a
        href={primary.href}
        download
        onClick={onDownload}
        className="btn-brand !py-3 !px-5 justify-center"
      >
        <PrimaryIcon size={16} /> {primary.label}
        <Download size={15} className="ml-1" />
      </a>
      <a
        href={alt.href}
        download
        onClick={onDownload}
        className="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-[13px] font-semibold border border-white/14 text-ink-300 hover:text-ink-50 hover:border-white/30 transition-colors"
      >
        <AltIcon size={14} /> {alt.label}
      </a>
    </div>
  );
}

function MockToggle() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border border-white/12 bg-white/[0.03] text-[11px] font-semibold text-ink-200 align-middle">
      Developer mode
      <span className="relative w-7 h-4 rounded-full bg-brand-500">
        <span className="absolute top-0.5 right-0.5 w-3 h-3 rounded-full bg-white" />
      </span>
    </span>
  );
}

function MockButton({ icon: Icon, label }: { icon: typeof MousePointerClick; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-brand-500/40 bg-brand-500/10 text-[12px] font-semibold text-brand-300 align-middle whitespace-nowrap">
      <Icon size={12} /> {label}
    </span>
  );
}

/** URL chip with both Copy and a best-effort Open (browsers block chrome://
 *  and about: navigations, so Open always copies first as a safety net). */
function AddressBarAction({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const flash = () => { setCopied(true); setTimeout(() => setCopied(false), 1600); };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    flash();
  };
  const open = async () => {
    try { await navigator.clipboard.writeText(url); } catch { /* ignore */ }
    try { window.open(url, "_blank", "noopener"); } catch { /* blocked — copy is the fallback */ }
    flash();
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2 align-middle">
      <code className="font-mono text-[12px] text-ink-100 bg-white/[0.05] border border-white/10 px-2 py-1 rounded">
        {url}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold border border-white/14 text-ink-200 hover:text-ink-50 hover:border-white/30 transition-colors"
      >
        {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[12px] font-semibold border border-brand-500/40 bg-brand-500/10 text-brand-300 hover:bg-brand-500/20 transition-colors"
      >
        <ExternalLink size={12} /> Open
      </button>
    </span>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="font-mono text-[12px] text-ink-100 bg-white/[0.05] border border-white/10 px-1.5 py-0.5 rounded">
      {children}
    </code>
  );
}

/* ─────────────────────────── feature grid ─────────────────────────── */

function FeatureGrid() {
  const features = [
    { icon: Eye,  title: "Pre-sign simulation", body: "Every transaction is decoded and simulated before the popup even asks you to sign." },
    { icon: Cpu,  title: "x402 firewall",       body: "HTTP 402 payments are gated by your hourly/daily caps, anomaly checks, allowlists." },
    { icon: Lock, title: "On-chain revoke",     body: "Per-site sub-keys you can yank with one tap — the rug-pull antidote." },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      className="mb-16"
    >
      <p className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] font-bold text-brand-400 mb-6">
        <span className="w-6 h-[3px] hazard rounded-full" />
        Why this wallet
      </p>
      <div className="grid sm:grid-cols-3 gap-3">
        {features.map((f) => (
          <div key={f.title} className="card p-5">
            <span className="w-10 h-10 grid place-items-center rounded-xl bg-ink-900 text-brand-400">
              <f.icon size={16} />
            </span>
            <p className="mt-4 font-display text-base font-bold tracking-tight">{f.title}</p>
            <p className="mt-1.5 text-sm text-ink-300 leading-relaxed">{f.body}</p>
          </div>
        ))}
      </div>
    </motion.section>
  );
}

/* ─────────────────────────── after install ─────────────────────────── */

function AfterInstallCta() {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      className="relative rounded-3xl overflow-hidden bg-ink-900 text-white shadow-lift"
    >
      <HazardRule />
      <div
        aria-hidden
        className="absolute inset-0 opacity-40 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage:        "radial-gradient(ellipse at 100% 100%, transparent 30%, black 90%)",
          WebkitMaskImage:  "radial-gradient(ellipse at 100% 100%, transparent 30%, black 90%)",
        }}
      />
      <div className="relative max-w-2xl p-10 md:p-14">
        <div className="inline-flex items-center gap-2 text-[12px] text-brand-400">
          <HardHat size={14} /> After install
        </div>
        <h2 className="mt-4 font-display text-3xl md:text-5xl font-bold tracking-tight leading-[1.05]">
          Take it for a spin in the showcase.
        </h2>
        <p className="mt-5 text-white/60 leading-relaxed">
          Six fake-but-real dApps trigger six different attack patterns. Baret
          catches each one live — you see the analysis before signing.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link to="/showcase" className="btn-brand !px-5 !py-3">
            Open the showcase <ChevronRight size={14} />
          </Link>
          <Link
            to="/docs"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold border border-white/20 text-white hover:bg-ink-800/[0.06] hover:border-white/40 transition"
          >
            <BookOpen size={14} /> Read the docs <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </motion.section>
  );
}
