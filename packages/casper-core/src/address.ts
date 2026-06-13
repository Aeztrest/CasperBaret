/**
 * Casper address helpers.
 *
 *  - **public key hex**: algo-prefixed — "01"+64hex (ed25519) or "02"+66hex (secp256k1).
 *  - **account-hash**: 32 bytes (64 hex), often shown as "account-hash-<64hex>".
 *  - **contract package hash**: 32 bytes (64 hex).
 *  - **x402 address**: the casper-x402 wire format prefixes the account-hash
 *    with a 1-byte tag — "00"+64hex (66 hex) — to match casper-eip-712's
 *    33-byte `address` encoding (0x00 = AccountHash, 0x01 = PackageHash).
 */

const HEX64 = /^[0-9a-fA-F]{64}$/;
const HEX66 = /^[0-9a-fA-F]{66}$/;

export function stripPrefix(s: string): string {
  return s.replace(/^0x/i, "").replace(/^account-hash-/i, "").replace(/^hash-/i, "");
}

/** True for a bare 64-hex account hash (optionally `account-hash-`/`0x` prefixed). */
export function isAccountHash(s: string): boolean {
  return HEX64.test(stripPrefix(s));
}

/** True for a 64-hex contract package hash. */
export function isContractPackageHash(s: string): boolean {
  return HEX64.test(stripPrefix(s));
}

/** True for the x402 wire address: "00"+64hex (33 bytes, account-hash tagged). */
export function isX402Address(s: string): boolean {
  const h = s.replace(/^0x/i, "");
  return HEX66.test(h) && h.slice(0, 2) === "00";
}

/** Normalize any account reference to the x402 wire address ("00"+64hex). */
export function toX402Address(accountHashOrTagged: string): string {
  const h = stripPrefix(accountHashOrTagged);
  if (HEX66.test(h) && h.slice(0, 2) === "00") return h.toLowerCase();
  if (HEX64.test(h)) return ("00" + h).toLowerCase();
  throw new Error(`cannot convert to x402 address: ${accountHashOrTagged}`);
}

/** Extract the bare 64-hex account hash from any account reference. */
export function toAccountHashHex(ref: string): string {
  const h = stripPrefix(ref);
  if (HEX66.test(h) && h.slice(0, 2) === "00") return h.slice(2).toLowerCase();
  if (HEX64.test(h)) return h.toLowerCase();
  throw new Error(`not an account hash: ${ref}`);
}

/** Render as the canonical `account-hash-<64hex>` form. */
export function toAccountHashKey(ref: string): string {
  return `account-hash-${toAccountHashHex(ref)}`;
}

/** Short display form for UIs: aabb…ccdd. */
export function shortAddress(s: string, head = 4, tail = 4): string {
  const h = stripPrefix(s);
  if (h.length <= head + tail) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** True for an algo-prefixed Casper public key hex. */
export function isPublicKeyHex(s: string): boolean {
  const h = s.replace(/^0x/i, "");
  return (/^01[0-9a-fA-F]{64}$/.test(h)) || (/^02[0-9a-fA-F]{66}$/.test(h));
}
