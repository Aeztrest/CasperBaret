/**
 * Session: holds the decrypted Casper private key while the wallet is
 * unlocked.
 *
 * The in-memory copy is the fast path for signing. It is ALSO mirrored to
 * `chrome.storage.session` (an MV3 storage area that survives service-worker
 * restarts but is wiped when the browser closes) — because Chrome routinely
 * terminates an idle MV3 service worker after ~30s, which would otherwise
 * wipe this module's plain variables and silently re-lock a wallet the user
 * never asked to lock. `restoreFromSessionStorage()` is called once at
 * service-worker startup (see `background/index.ts`) to recover the session
 * across that restart before deciding the wallet is actually locked.
 * `storage.session`'s default access level already restricts reads to
 * trusted (extension) contexts, not content scripts/pages.
 *
 * Every signing call goes through `useAuthority()` which renews the idle
 * timer. After `idleTimeoutMs` of inactivity, the session zeros the secret
 * and dispatches `wallet.locked`.
 *
 * Casper build: the secret bytes are the 32-byte ed25519 private key. We
 * re-wrap them into a `CasperKeypair` (via casper-core `keypairFromHex`) on
 * each `useAuthority()` so callers always get a fresh handle.
 */

import browser from "webextension-polyfill";
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

const SESSION_STORAGE_KEY = "baret.session.v1";

interface PersistedSession {
  entropyHex: string;
  active: ActiveAccount;
  /** Last renewal, so a restore can tell whether the idle timeout would
   * already have fired had the service worker stayed alive the whole time. */
  lastActivityAt: number;
}

// The 32-byte master entropy. Account 0 uses it directly; HD accounts derive
// children from it (see crypto/hd.ts). Service-worker memory only — mirrored
// to chrome.storage.session (see module docblock) so it survives SW restarts.
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
  void persistSession();
}

/**
 * Attempt to recover an unlocked session that predates a service-worker
 * restart. Returns true if a session was restored (caller should dispatch
 * `wallet.unlocked` accordingly) — false if there's nothing to restore, in
 * which case the wallet is genuinely locked/uninitialized.
 */
export async function restoreFromSessionStorage(): Promise<ActiveAccount | null> {
  try {
    const all = await browser.storage.session.get(SESSION_STORAGE_KEY);
    const saved = all[SESSION_STORAGE_KEY] as PersistedSession | undefined;
    if (!saved) return null;

    const idleTimeoutMs = getState().idleTimeoutMs;
    if (Date.now() - saved.lastActivityAt > idleTimeoutMs) {
      // Would have idle-timed-out had the worker stayed alive — honor that
      // instead of silently resurrecting a stale session.
      void clearPersistedSession();
      return null;
    }

    const bytes = Buffer.from(saved.entropyHex, "hex");
    if (bytes.length !== 32) return null;
    entropyBytes = new Uint8Array(bytes);
    active = saved.active;
    resetIdle();
    return active;
  } catch (err) {
    console.warn("[BARET] session restore failed:", err);
    return null;
  }
}

async function persistSession(): Promise<void> {
  if (!entropyBytes) return;
  const payload: PersistedSession = {
    entropyHex: Buffer.from(entropyBytes).toString("hex"),
    active,
    lastActivityAt: Date.now(),
  };
  try {
    await browser.storage.session.set({ [SESSION_STORAGE_KEY]: payload });
  } catch (err) {
    console.warn("[BARET] session persist failed:", err);
  }
}

async function clearPersistedSession(): Promise<void> {
  try {
    await browser.storage.session.remove(SESSION_STORAGE_KEY);
  } catch {
    /* best-effort */
  }
}

/** Switch which account subsequent signing/derivation uses. */
export function setActiveAccount(activeAccount: ActiveAccount): void {
  active = activeAccount;
  void persistSession();
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
  void persistSession(); // renew lastActivityAt so a restore doesn't treat this as idle
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
  void clearPersistedSession();
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
