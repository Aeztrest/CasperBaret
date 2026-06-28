/**
 * Full settings page (options).
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings as SettingsIcon, Network, KeyRound, AlertTriangle, ExternalLink, Trash2 } from "lucide-react";
import { useRpc, useWalletState } from "../../shared/state-context";
import { version as APP_VERSION } from "../../../package.json";

export function SettingsOpt() {
  const state = useWalletState();
  const rpc = useRpc();
  const nav = useNavigate();
  const [confirming, setConfirming] = useState(false);

  if (!state) return null;

  const onReset = async () => {
    if (!confirming) { setConfirming(true); return; }
    try {
      await rpc.call("wallet.reset", { confirmation: "I-UNDERSTAND" });
      nav("/", { replace: true });
    } catch { /* error surfaced elsewhere */ }
  };

  const explorerBase = state.network === "mainnet"
    ? "https://cspr.live"
    : "https://testnet.cspr.live";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight flex items-center gap-2">
          <SettingsIcon size={20} className="text-accent-soft" /> Settings
        </h1>
        <p className="text-text-muted text-sm mt-1">Network, security, and the danger zone.</p>
      </div>

      <Section icon={Network} title="Network">
        <Row label="Network"         value={state.network === "mainnet" ? "Casper Mainnet" : "Casper Testnet"} />
        <Row label="Wallet protocol" value="Casper Wallet Standard (open source)" />
        <Row label="Token standard"  value="CEP-18" />
      </Section>

      <Section icon={KeyRound} title="Account">
        <Row
          label="Public key"
          value={state.authorityAddress ?? "—"}
          mono
          link={state.authorityAddress ? `${explorerBase}/account/${state.authorityAddress}` : undefined}
        />
      </Section>

      <Section icon={AlertTriangle} title="Danger zone" danger>
        <p className="text-xs text-text-muted leading-relaxed mb-3">
          Reset wipes the seed phrase, keys, and history from this browser.{" "}
          <strong className="text-bad">Make sure you've backed up your secret phrase first.</strong>
        </p>
        <button onClick={onReset} className="btn-danger">
          <Trash2 size={13} /> {confirming ? "Click again to confirm reset" : "Reset wallet"}
        </button>
      </Section>

      <p className="text-[10px] text-text-faint text-center">
        Baret · v{APP_VERSION} · open source · MIT
      </p>
    </div>
  );
}

function Section({ icon: Icon, title, danger, children }: {
  icon: typeof Network; title: string; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-card p-5 space-y-3"
      style={danger
        ? { background: "rgba(248,113,113,0.04)", border: "1px solid rgba(248,113,113,0.18)" }
        : { background: "var(--bg-card)", border: "1px solid var(--line)" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon size={14} className={danger ? "text-bad" : "text-accent-soft"} />
        <h2 className={`font-bold text-sm ${danger ? "text-bad" : ""}`}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, mono, link }: { label: string; value: string; mono?: boolean; link?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-text-faint shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <span className={`text-text-muted truncate ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className="text-text-faint hover:text-text shrink-0">
            <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}
