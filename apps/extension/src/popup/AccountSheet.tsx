/**
 * Account sheet / switcher — opened from the TopStrip account button.
 *
 * Lists every HD account (tap to switch), lets you add or rename accounts, and
 * shows the active account's full address with one-tap copy + QR. Self-contained
 * via the wallet context, so it works in the popup and (wrapped in a modal) in
 * the options page. Accounts derive from one seed — see background/crypto/hd.ts.
 */

import { useEffect, useState } from "react";
import { X, Copy, Check, Plus, Pencil, Loader2 } from "lucide-react";
import QRCode from "qrcode";
import { useRpc, useWalletState } from "../shared/state-context";

const NETWORK_LABEL: Record<string, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
};

function shortAddr(s: string): string {
  return s.length <= 12 ? s : `${s.slice(0, 6)}…${s.slice(-6)}`;
}

export function AccountSheet({ onClose }: { onClose: () => void }) {
  const state = useWalletState();
  const rpc = useRpc();

  const accounts = state?.accounts ?? [];
  const activeIndex = state?.activeIndex ?? 0;
  const active = accounts.find((a) => a.index === activeIndex) ?? accounts[0];
  const network = state?.network ?? "testnet";

  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const activeAddress = active?.address ?? "";

  useEffect(() => {
    if (!activeAddress) return;
    let cancelled = false;
    QRCode.toDataURL(activeAddress, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 200,
      color: { dark: "#FFFFFF", light: "#00000000" },
    })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { /* address stays copyable */ });
    return () => { cancelled = true; };
  }, [activeAddress]);

  const switchTo = async (index: number) => {
    if (index === activeIndex || busy) return;
    setBusy(true);
    try { await rpc.call("wallet.selectAccount", { index }); }
    catch { /* surfaced by state staying put */ }
    finally { setBusy(false); }
  };

  const addAccount = async () => {
    if (busy) return;
    setBusy(true);
    try { await rpc.call("wallet.addAccount", {}); }
    catch { /* ignore */ }
    finally { setBusy(false); }
  };

  const startRename = (index: number, current: string) => {
    setRenaming(index);
    setDraftName(current);
  };

  const commitRename = async (index: number) => {
    const name = draftName.trim();
    setRenaming(null);
    if (!name) return;
    try { await rpc.call("wallet.renameAccount", { index, name }); }
    catch { /* ignore */ }
  };

  const copyActive = async () => {
    if (!activeAddress) return;
    try {
      await navigator.clipboard.writeText(activeAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* ignore */ }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ background: "var(--bg)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm">Accounts</p>
          <span className="pill pill-live">{NETWORK_LABEL[network] ?? network}</span>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-input hover:bg-black/5">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
        {/* Account list */}
        <div className="flex flex-col gap-1.5">
          {accounts.map((a) => {
            const isActive = a.index === activeIndex;
            return (
              <div
                key={a.index}
                className="flex items-center gap-2 rounded-input p-2"
                style={{
                  background: isActive ? "var(--accent-dim)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${isActive ? "rgba(225,20,40,0.4)" : "var(--line)"}`,
                }}
              >
                <button
                  onClick={() => switchTo(a.index)}
                  disabled={busy}
                  className="flex items-center gap-2.5 flex-1 min-w-0 text-left disabled:opacity-60"
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{ background: "var(--accent-dim)", color: "var(--accent-soft)" }}
                  >
                    {a.index + 1}
                  </div>
                  <div className="min-w-0">
                    {renaming === a.index ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => commitRename(a.index)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRename(a.index); if (e.key === "Escape") setRenaming(null); }}
                        onClick={(e) => e.stopPropagation()}
                        className="input !py-1 !px-2 text-xs"
                      />
                    ) : (
                      <p className="text-sm font-semibold leading-tight truncate">{a.name}</p>
                    )}
                    <p className="text-[10px] font-mono text-text-faint leading-tight">{shortAddr(a.address)}</p>
                  </div>
                </button>
                {isActive && <Check size={14} className="text-accent-soft shrink-0" />}
                <button
                  onClick={() => startRename(a.index, a.name)}
                  aria-label="Rename"
                  className="p-1.5 rounded-input text-text-faint hover:text-text hover:bg-black/10 shrink-0"
                >
                  <Pencil size={12} />
                </button>
              </div>
            );
          })}

          <button
            onClick={addAccount}
            disabled={busy}
            className="flex items-center justify-center gap-1.5 mt-1 py-2 rounded-input text-xs font-semibold
                       text-text-muted hover:text-text disabled:opacity-50"
            style={{ border: "1px dashed var(--line-strong)" }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
            Add account
          </button>
        </div>

        {/* Active account address + QR */}
        {activeAddress && (
          <div className="flex flex-col items-center gap-4 pt-1">
            <div
              className="rounded-card p-3 flex items-center justify-center"
              style={{ background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)" }}
            >
              {qrDataUrl
                ? <img src={qrDataUrl} alt="Account address QR" className="w-44 h-44" />
                : <div className="w-44 h-44" />}
            </div>

            <div className="w-full">
              <p className="label">{active?.name ?? "Address"}</p>
              <button
                onClick={copyActive}
                className="w-full text-left p-3 rounded-input font-mono text-[11px] break-all flex items-start gap-2 group"
                style={{ background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)" }}
              >
                <span className="flex-1 text-text-muted group-hover:text-text">{activeAddress}</span>
                {copied
                  ? <Check size={14} className="shrink-0 text-ok mt-0.5" />
                  : <Copy size={14} className="shrink-0 text-text-faint group-hover:text-text mt-0.5" />}
              </button>
              <p className="text-[10px] mt-1.5" style={{ color: copied ? "var(--ok)" : "var(--text-faint)" }}>
                {copied ? "Copied to clipboard" : "Tap the address to copy it"}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
