/**
 * HD account derivation for the Baret wallet (BIP-39 + SLIP-0010 ed25519).
 *
 * The wallet master is a 32-byte entropy. Account 0 uses that entropy directly
 * as its ed25519 private key — identical to the pre-HD (single-key) wallet, so
 * upgrading never changes an existing account's address. Additional accounts
 * (index ≥ 1) are SLIP-0010 ed25519 children of the BIP-39 seed derived from
 * the entropy's mnemonic, along Casper's coin type (SLIP-44 506):
 *
 *     m / 44' / 506' / 0' / 0' / accountIndex'
 *
 * SLIP-0010 ed25519 supports hardened derivation only, so every path element is
 * hardened. The derived IL (first 32 bytes) is the ed25519 private key/seed,
 * which casper-core's `keypairFromHex` consumes directly.
 */

import { entropyToMnemonic, mnemonicToSeedSync } from "bip39";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";
import { Buffer } from "buffer";

const HARDENED = 0x80000000;
// m/44'/506'/0'/0' — the account index is appended per account.
const BASE_PATH = [44, 506, 0, 0];

/** The 24-word BIP-39 mnemonic that backs up this wallet (entropy as 256-bit). */
export function entropyToMnemonicStr(entropy: Uint8Array): string {
  return entropyToMnemonic(Buffer.from(entropy).toString("hex"));
}

interface Slip10Node {
  key: Uint8Array;   // IL — 32-byte private key
  chain: Uint8Array; // IR — 32-byte chain code
}

function ser32(i: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = (i >>> 24) & 0xff;
  b[1] = (i >>> 16) & 0xff;
  b[2] = (i >>> 8) & 0xff;
  b[3] = i & 0xff;
  return b;
}

function slip10Master(seed: Uint8Array): Slip10Node {
  const I = hmac(sha512, new TextEncoder().encode("ed25519 seed"), seed);
  return { key: I.slice(0, 32), chain: I.slice(32) };
}

/** Hardened child derivation (the only kind ed25519 SLIP-0010 allows). */
function slip10CKD(node: Slip10Node, index: number): Slip10Node {
  const hardened = (index + HARDENED) >>> 0;
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(node.key, 1);
  data.set(ser32(hardened), 33);
  const I = hmac(sha512, node.chain, data);
  return { key: I.slice(0, 32), chain: I.slice(32) };
}

/**
 * Derive the 32-byte ed25519 private key (hex) for an HD account.
 * `accountIndex` must be ≥ 1 — index 0 is the root entropy itself, not derived.
 */
export function deriveHdPrivateKeyHex(entropy: Uint8Array, accountIndex: number): string {
  const seed = mnemonicToSeedSync(entropyToMnemonicStr(entropy)); // 64 bytes
  let node = slip10Master(seed);
  for (const p of BASE_PATH) node = slip10CKD(node, p);
  node = slip10CKD(node, accountIndex);
  return Buffer.from(node.key).toString("hex");
}

