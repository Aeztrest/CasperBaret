/**
 * Sub-key cache — no-op stubs. Per-merchant scoped sub-keys are not yet
 * wired on Casper; PaymentGuard caps live on-chain instead.
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
