/**
 * Keystore: stores the encrypted authority secret.
 * Spec: docs/extension-architecture.md §7 (keystore object store)
 *       + §8.1 (encryption).
 *
 * Persistence is double-layered:
 *  1. IndexedDB (`keystore` object store) — primary, fast random read.
 *  2. browser.storage.local (key BACKUP_KEY)  — durable mirror.
 *
 * The mirror exists because Firefox temporary add-ons sometimes wipe
 * extension IndexedDB on reload, and `storage.local` is generally more
 * resilient. On read, if IDB is empty but storage.local has a row, we
 * restore the IDB copy so subsequent reads stay hot.
 *
 * Exactly one row, id = "primary". Schema v2 (HD multi-account): the encrypted
 * `blob` holds the 32-byte master entropy; `accounts` lists every derived
 * account (index 0 = the entropy used directly, index ≥ 1 = SLIP-0010 children
 * — see crypto/hd.ts), and `activeIndex` is the selected account. Pre-HD (v1)
 * rows are migrated on read.
 */

import browser from "webextension-polyfill";
import { asPromise, tx } from "./index";
import type { EncryptedBlob } from "../crypto/kdf";

const BACKUP_KEY = "blackthorn.keystore.backup.v1";

export interface AccountMeta {
  /** 0-based account number; index 0 = root entropy, ≥1 = HD-derived. */
  index: number;
  /** User-facing label, e.g. "Account 1". */
  name: string;
  /** `root` = entropy used directly as the key; `hd` = SLIP-0010 derived. */
  kind: "root" | "hd";
  /** Authority ed25519 public key hex for this account. */
  authorityPubkey: string;
  /** Smart-wallet contract address; populated after provisioning. */
  smartWalletAddress: string | null;
}

export interface KeystoreRow {
  id: "primary";
  version: 2;
  /** Encrypted 32-byte master entropy (== the pre-HD single-key secret). */
  blob: EncryptedBlob;
  accounts: AccountMeta[];
  activeIndex: number;
  createdAt: number;
}

/** Pre-HD row shape, kept only to migrate existing wallets on read. */
interface KeystoreRowV1 {
  id: "primary";
  blob: EncryptedBlob;
  authorityPubkey: string;
  smartWalletAddress: string | null;
  createdAt: number;
}

/** The currently-selected account (falls back to account 0 if index drifts). */
export function activeAccount(row: KeystoreRow): AccountMeta {
  const acct = row.accounts[row.activeIndex] ?? row.accounts[0];
  if (!acct) throw new Error("Keystore has no accounts.");
  return acct;
}

/** Upgrade a v1 single-key row into a v2 HD row (account 0 = the existing key). */
function migrateV1(v1: KeystoreRowV1): KeystoreRow {
  return {
    id: "primary",
    version: 2,
    blob: v1.blob,
    accounts: [
      {
        index: 0,
        name: "Account 1",
        kind: "root",
        authorityPubkey: v1.authorityPubkey,
        smartWalletAddress: v1.smartWalletAddress,
      },
    ],
    activeIndex: 0,
    createdAt: v1.createdAt,
  };
}

/** Normalize whatever shape is stored into the current v2 row, migrating v1. */
function normalize(raw: KeystoreRow | KeystoreRowV1): KeystoreRow {
  if ((raw as KeystoreRow).version === 2 && Array.isArray((raw as KeystoreRow).accounts)) {
    return raw as KeystoreRow;
  }
  return migrateV1(raw as KeystoreRowV1);
}

export async function readKeystore(): Promise<KeystoreRow | null> {
  const fromIdb = await tx("keystore", "readonly", async (t) => {
    const store = t.objectStore("keystore");
    const row = await asPromise(store.get("primary"));
    return (row ?? null) as (KeystoreRow | KeystoreRowV1) | null;
  });
  if (fromIdb) {
    const normalized = normalize(fromIdb);
    // Persist the migration so the durable copy is upgraded too.
    if (normalized !== fromIdb) await writeKeystore(normalized);
    return normalized;
  }

  // IDB miss — fall back to the storage.local mirror. If we find one,
  // hydrate IDB so subsequent reads are fast and consistent.
  try {
    const all = await browser.storage.local.get(BACKUP_KEY);
    const backup = all[BACKUP_KEY] as (KeystoreRow | KeystoreRowV1) | undefined;
    if (backup && backup.id === "primary") {
      const normalized = normalize(backup);
      await writeKeystore(normalized);
      return normalized;
    }
  } catch (err) {
    console.warn("[BLACKTHORN] storage.local keystore read failed:", err);
  }
  return null;
}

export async function writeKeystore(row: KeystoreRow): Promise<void> {
  if (row.id !== "primary") throw new Error("Keystore id must be 'primary'");
  await tx("keystore", "readwrite", async (t) => {
    await asPromise(t.objectStore("keystore").put(row));
  });
  // Mirror to storage.local. Failure here must not block the write — IDB is
  // the source of truth, the mirror is best-effort.
  try {
    await browser.storage.local.set({ [BACKUP_KEY]: row });
  } catch (err) {
    console.warn("[BLACKTHORN] storage.local keystore mirror failed:", err);
  }
}

export async function clearKeystore(): Promise<void> {
  await tx("keystore", "readwrite", async (t) => {
    await asPromise(t.objectStore("keystore").clear());
  });
  try {
    await browser.storage.local.remove(BACKUP_KEY);
  } catch { /* ignore */ }
}

export async function hasKeystore(): Promise<boolean> {
  return (await readKeystore()) !== null;
}
