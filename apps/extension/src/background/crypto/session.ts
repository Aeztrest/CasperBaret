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
import { dispatch, getState } from "../state/store";

let secretBytes: Uint8Array | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

export function isUnlocked(): boolean {
  return secretBytes !== null;
}

export function unlockWith(bytes: Uint8Array): void {
  if (bytes.length !== 32) {
    throw new Error(
      "Authority secret must be 32 bytes (Casper ed25519 private key).",
    );
  }
  secretBytes = new Uint8Array(bytes); // own copy; caller may zero theirs
  resetIdle();
}

/**
 * Get a freshly derived Casper keypair. Renews the idle timer. Async because
 * casper-js-sdk's key import is async.
 */
export async function useAuthority(): Promise<CasperKeypair> {
  if (!secretBytes)
    throw new Error("Wallet is locked. Unlock before signing.");
  resetIdle();
  return keypairFromHex(Buffer.from(secretBytes).toString("hex"), "ed25519");
}

export function lock(): void {
  if (secretBytes) {
    secureZero(secretBytes);
    secretBytes = null;
  }
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
