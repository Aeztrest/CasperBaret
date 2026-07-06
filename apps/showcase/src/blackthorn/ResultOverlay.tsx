import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, ShieldX, Loader2, ExternalLink } from "lucide-react";

export type ResultState = "idle" | "awaiting" | "confirmed" | "blocked" | "error";

interface Props {
  state: ResultState;
  signature?: string | null;
  message?: string | null;
  onClose: () => void;
}

export function ResultOverlay({ state, signature, message, onClose }: Props) {
  const open = state !== "idle";
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={state !== "awaiting" ? onClose : undefined}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(255,255,255,0.45)", backdropFilter: "blur(8px)" }}
        >
          <motion.div
            initial={{ scale: 0.94, opacity: 0, y: 12 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.94, opacity: 0, y: 12 }}
            transition={{ type: "spring", stiffness: 340, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl p-7 text-center bg-ink-800 shadow-lift"
            style={{ border: "1px solid rgba(255,255,255,0.10)" }}
          >
            {state === "awaiting" && <Awaiting />}
            {state === "confirmed" && (
              <Confirmed signature={signature ?? null} message={message ?? null} onClose={onClose} />
            )}
            {state === "blocked" && <Blocked message={message ?? null} onClose={onClose} />}
            {state === "error" && <ErrorState message={message ?? null} onClose={onClose} />}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Awaiting() {
  return (
    <div className="space-y-4">
      <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(225,20,40,0.10)", border: "1px solid rgba(225,20,40,0.35)" }}>
        <Loader2 size={22} className="animate-spin text-brand-500" />
      </div>
      <div>
        <p className="text-lg font-bold text-ink-50">Approve in your Baret wallet</p>
        <p className="text-xs text-ink-300 mt-1.5 leading-relaxed">
          We've opened the wallet popup. It's simulating this transaction with Baret
          and checking your policy. Approve there to continue.
        </p>
      </div>
      <p className="text-[10px] text-ink-400">Don't see a popup? Allow popups for this site.</p>
    </div>
  );
}

function Confirmed({
  signature, message, onClose,
}: { signature: string | null; message: string | null; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(16,185,129,0.10)", border: "1px solid rgba(16,185,129,0.35)" }}>
        <ShieldCheck size={24} className="text-emerald-400" />
      </div>
      <div>
        <p className="text-lg font-bold text-emerald-400">Transaction confirmed</p>
        <p className="text-xs text-ink-300 mt-1.5">Baret approved + your wallet signed.</p>
      </div>
      {message && (
        <p className="text-[11px] text-ink-300 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
          {message}
        </p>
      )}
      {signature && (
        <a href={`https://testnet.cspr.live/deploy/${signature}`} target="_blank" rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-emerald-400 hover:text-ink-50 transition-colors font-semibold">
          View on cspr.live <ExternalLink size={11} />
        </a>
      )}
      <button onClick={onClose} className="block mx-auto text-xs text-ink-400 hover:text-ink-50 pt-2">Close</button>
    </div>
  );
}

function Blocked({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(225,20,40,0.10)", border: "1px solid rgba(225,20,40,0.40)" }}>
        <ShieldX size={24} className="text-brand-400" />
      </div>
      <div>
        <p className="text-lg font-bold text-brand-400">Blocked at the wallet</p>
        <p className="text-xs text-ink-300 mt-1.5 leading-relaxed">
          Baret's policy refused to sign this transaction. Your funds never moved.
        </p>
      </div>
      {message && (
        <p className="text-[11px] text-ink-300 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
          {message}
        </p>
      )}
      <button onClick={onClose} className="block mx-auto text-xs text-ink-400 hover:text-ink-50 pt-2">Close</button>
    </div>
  );
}

function ErrorState({ message, onClose }: { message: string | null; onClose: () => void }) {
  return (
    <div className="space-y-4">
      <div className="w-14 h-14 mx-auto rounded-2xl flex items-center justify-center"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.18)" }}>
        <ShieldX size={24} className="text-ink-300" />
      </div>
      <p className="text-lg font-bold text-ink-50">Something went wrong</p>
      {message && (
        <p className="text-[11px] text-ink-300 px-3 py-2 rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
          {message}
        </p>
      )}
      <p className="text-xs text-ink-400">Check that your wallet extension is unlocked and try again.</p>
      <button onClick={onClose} className="block mx-auto text-xs text-ink-400 hover:text-ink-50 pt-2">Close</button>
    </div>
  );
}
