/**
 * In-memory session: holds the decrypted Casper private key while the wallet
 * is unlocked. Service worker memory only; never persisted.
 *
 * Every signing call goes through `useAuthority()` which renews the idle
 * timer. After `idleTimeoutMs` of inactivity, the session zeros the secret
 * and dispatches `wallet.locked`.
 *
 * Casper build: the secret bytes are the 32-byte ed25519 private key. We
 * re-wrap them into a `CasperKeypair` (via casper-core `keypairFromHex`) on
 * each `useAuthority()` so callers always get a fresh handle.
 */

import { keypairFromHex, type CasperKeypair } from "@casper-baret/casper-core";
import { Buffer } from "buffer";
import { secureZero } from "./kdf";
import { deriveHdPrivateKeyHex } from "./hd";
import { dispatch, getState } from "../state/store";

/** Which account the session currently signs as. */
export interface ActiveAccount {
  kind: "root" | "hd";
  index: number;
}

// The 32-byte master entropy. Account 0 uses it directly; HD accounts derive
// children from it (see crypto/hd.ts). Service-worker memory only.
let entropyBytes: Uint8Array | null = null;
let active: ActiveAccount = { kind: "root", index: 0 };
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function isUnlocked(): boolean {
  return entropyBytes !== null;
}

export function unlockWith(bytes: Uint8Array, activeAccount?: ActiveAccount): void {
  if (bytes.length !== 32) {
    throw new Error(
      "Master entropy must be 32 bytes (Casper ed25519 seed).",
    );
  }
  entropyBytes = new Uint8Array(bytes); // own copy; caller may zero theirs
  if (activeAccount) active = activeAccount;
  resetIdle();
}

/** Switch which account subsequent signing/derivation uses. */
export function setActiveAccount(activeAccount: ActiveAccount): void {
  active = activeAccount;
}

/** The 32-byte private key hex for an account, derived from the master entropy. */
function privateKeyHexFor(acct: ActiveAccount): string {
  if (!entropyBytes) throw new Error("Wallet is locked. Unlock first.");
  return acct.kind === "root"
    ? Buffer.from(entropyBytes).toString("hex")
    : deriveHdPrivateKeyHex(entropyBytes, acct.index);
}

/**
 * Get a freshly derived Casper keypair for the active account. Renews the idle
 * timer. Async because casper-js-sdk's key import is async.
 */
export async function useAuthority(): Promise<CasperKeypair> {
  if (!entropyBytes)
    throw new Error("Wallet is locked. Unlock before signing.");
  resetIdle();
  return keypairFromHex(privateKeyHexFor(active), "ed25519");
}

/**
 * Derive the public key hex for an arbitrary account without changing the
 * active account — used when adding a new account.
 */
export async function derivePublicKeyHex(acct: ActiveAccount): Promise<string> {
  const kp = await keypairFromHex(privateKeyHexFor(acct), "ed25519");
  return kp.publicKeyHex;
}

export function lock(): void {
  if (entropyBytes) {
    secureZero(entropyBytes);
    entropyBytes = null;
  }
  active = { kind: "root", index: 0 };
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  dispatch({ type: "wallet.locked" });
}

function resetIdle(): void {
  if (idleTimer) clearTimeout(idleTimer);
  const ms = getState().idleTimeoutMs;
  idleTimer = setTimeout(() => {
    console.info("[BARET] idle timeout — locking wallet");
    lock();
  }, ms);
}
