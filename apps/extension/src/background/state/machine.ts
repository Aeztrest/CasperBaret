/**
 * Wallet state machine.
 *
 * Single source of truth. Every surface (popup, options, content script)
 * reads from here via the message router.
 */

import type { AccountInfo, CasperNetwork, WalletStateSnapshot } from "@casper-baret/ext-protocol";

export type WalletPhase =
  | "uninitialized"  // no keystore present
  | "locked"         // keystore present, session not unlocked
  | "ready"          // unlocked, idle
  | "signing"        // a sign request is in flight
  | "alert";         // drift / verify-orphan banner overlay

export interface WalletState {
  phase: WalletPhase;
  network: CasperNetwork;
  walletAddress: string | null;
  authorityAddress: string | null;
  alertsUnread: number;
  watchedAddresses: string[];
  /** All accounts in this wallet (empty until unlocked / loaded). */
  accounts: AccountInfo[];
  /** Index of the active account within `accounts`. */
  activeIndex: number;
  /** Idle timeout in ms (default 15 min). */
  idleTimeoutMs: number;
  /** Last activity timestamp; used to compute auto-lock. */
  lastActivityAt: number;
}

export const INITIAL_STATE: WalletState = {
  phase: "uninitialized",
  network: "testnet",
  walletAddress: null,
  authorityAddress: null,
  alertsUnread: 0,
  watchedAddresses: [],
  accounts: [],
  activeIndex: 0,
  idleTimeoutMs: 15 * 60 * 1000,
  lastActivityAt: Date.now(),
};

/* ────────────── Actions (the only way to mutate state) ────────────── */

export type Action =
  | { type: "wallet.created"; walletAddress: string; authorityAddress: string; accounts: AccountInfo[]; activeIndex: number }
  | { type: "wallet.unlocked"; walletAddress: string; authorityAddress: string; accounts: AccountInfo[]; activeIndex: number }
  | { type: "wallet.locked" }
  | { type: "wallet.reset" }
  | { type: "accounts.set"; accounts: AccountInfo[]; activeIndex: number; walletAddress: string; authorityAddress: string }
  | { type: "network.set"; network: CasperNetwork }
  | { type: "sign.start" }
  | { type: "sign.end" }
  | { type: "alerts.set"; count: number }
  | { type: "alerts.increment" }
  | { type: "watch.add"; pubkey: string }
  | { type: "watch.remove"; pubkey: string }
  | { type: "activity.touch" };

export function reduce(state: WalletState, action: Action): WalletState {
  switch (action.type) {
    case "wallet.created":
    case "wallet.unlocked":
      return {
        ...state,
        phase: "ready",
        walletAddress: action.walletAddress,
        authorityAddress: action.authorityAddress,
        accounts: action.accounts,
        activeIndex: action.activeIndex,
        lastActivityAt: Date.now(),
      };

    case "accounts.set":
      return {
        ...state,
        accounts: action.accounts,
        activeIndex: action.activeIndex,
        walletAddress: action.walletAddress,
        authorityAddress: action.authorityAddress,
        lastActivityAt: Date.now(),
      };

    case "wallet.locked":
      return { ...state, phase: "locked" };

    case "wallet.reset":
      return { ...INITIAL_STATE, network: state.network };

    case "network.set":
      return { ...state, network: action.network };

    case "sign.start":
      return { ...state, phase: "signing", lastActivityAt: Date.now() };

    case "sign.end":
      return { ...state, phase: "ready" };

    case "alerts.set":
      return { ...state, alertsUnread: Math.max(0, action.count) };

    case "alerts.increment":
      return { ...state, alertsUnread: state.alertsUnread + 1 };

    case "watch.add":
      return state.watchedAddresses.includes(action.pubkey)
        ? state
        : { ...state, watchedAddresses: [...state.watchedAddresses, action.pubkey] };

    case "watch.remove":
      return { ...state, watchedAddresses: state.watchedAddresses.filter((p) => p !== action.pubkey) };

    case "activity.touch":
      return { ...state, lastActivityAt: Date.now() };
  }
}

/* ────────────── Snapshot (the shape exported to surfaces) ────────────── */

export function snapshot(s: WalletState): WalletStateSnapshot {
  return {
    phase: s.phase === "uninitialized" || s.phase === "locked" || s.phase === "alert"
      ? s.phase
      : s.phase, // type already narrows correctly; explicit identity for readability
    network: s.network,
    walletAddress: s.walletAddress,
    authorityAddress: s.authorityAddress,
    alertsUnread: s.alertsUnread,
    watchedAddresses: s.watchedAddresses,
    accounts: s.accounts,
    activeIndex: s.activeIndex,
  };
}
