/**
 * Account sheet — opened from the TopStrip account button. Shows the active
 * account's full address with one-tap copy + QR. This is the surface that
 * fixes "I can't see or copy my address" and is the seam Faz 3 extends into a
 * multi-account switcher (an account list lands above the address block).
 */

import { useEffect, useState } from "react";
import { X, Copy, Check, QrCode } from "lucide-react";
import QRCode from "qrcode";

interface Props {
  address: string;
  network: string;
  onClose: () => void;
}

const NETWORK_LABEL: Record<string, string> = {
  testnet: "Testnet",
  mainnet: "Mainnet",
};

export function AccountSheet({ address, network, onClose }: Props) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(address, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 220,
      color: { dark: "#FFFFFF", light: "#00000000" },
    })
      .then((url) => { if (!cancelled) setQrDataUrl(url); })
      .catch(() => { /* leave null; address stays copyable */ });
    return () => { cancelled = true; };
  }, [address]);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col" style={{ background: "var(--bg)" }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: "var(--line)" }}>
        <div className="flex items-center gap-2">
          <p className="font-semibold text-sm">Account</p>
          <span className="pill pill-live">{NETWORK_LABEL[network] ?? network}</span>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-input hover:bg-black/5">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 px-5 py-6 flex flex-col items-center gap-5 overflow-y-auto">
        <div
          className="rounded-card p-4 flex items-center justify-center"
          style={{ background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)" }}
        >
          {qrDataUrl
            ? <img src={qrDataUrl} alt="Account address QR" className="w-52 h-52" />
            : <div className="w-52 h-52 flex items-center justify-center text-text-faint"><QrCode size={32} /></div>}
        </div>

        <div className="w-full">
          <p className="label">Your address</p>
          <button
            onClick={onCopy}
            className="w-full text-left p-3 rounded-input font-mono text-[11px] break-all flex items-start gap-2 group"
            style={{ background: "rgba(255,255,255,0.045)", border: "1px solid var(--line)" }}
          >
            <span className="flex-1 text-text-muted group-hover:text-text">{address}</span>
            {copied
              ? <Check size={14} className="shrink-0 text-ok mt-0.5" />
              : <Copy size={14} className="shrink-0 text-text-faint group-hover:text-text mt-0.5" />}
          </button>
          <p className="text-[10px] mt-1.5" style={{ color: copied ? "var(--ok)" : "var(--text-faint)" }}>
            {copied ? "Copied to clipboard" : "Tap the address to copy it"}
          </p>
        </div>
      </div>
    </div>
  );
}
