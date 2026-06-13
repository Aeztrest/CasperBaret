/**
 * Sub-key cache — NO-OP on Casper.
 *
 * The Stellar build used per-merchant ed25519 sub-keys that acted as scoped
 * signers on a Soroban smart-wallet contract. Casper has no equivalent smart-
 * wallet sub-signer layer wired yet (PaymentGuard caps live on-chain instead),
 * so this module is reduced to no-ops to keep the unlock/lock lifecycle and
 * the (Stellar-era) callers compiling.
 *
 * TODO(casper): if per-merchant scoped keys are reintroduced, back them with a
 * PaymentGuard authorization instead of a contract sub-signer.
 */

import type { CasperKeypair } from "@casper-baret/casper-core";

export function rememberPassphrase(_passphrase: string): void {
  /* no-op */
}

export function clearSubKeyCache(): void {
  /* no-op */
}

export async function preloadActiveSubKeys(_passphrase: string): Promise<void> {
  /* no-op — Casper has no sub-key store to preload. */
}

export async function getSubKeypair(_pubkey: string): Promise<CasperKeypair | null> {
  return null;
}

export function putSubKey(_pubkey: string, _keypair: CasperKeypair): void {
  /* no-op */
}

export function evictSubKey(_pubkey: string): void {
  /* no-op */
}
