/**
 * x402 PaymentRequirements validation (Casper build).
 *
 * Defends against malformed or malicious 402 responses before any signing
 * code is invoked.
 *
 * Casper-specific:
 *  - `network` is a CAIP-2 casper:* identifier ("casper:casper-test" | "casper:casper").
 *  - `asset` is a CEP-18 contract package hash (64 hex).
 *  - `payTo` is an x402 wire address ("00"+64hex) or a bare account hash.
 *  - `extra.name` (token name) is required for the EIP-712 domain.
 */

import {
  atomicToUi as coreAtomicToUi,
  isContractPackageHash,
  isX402Address,
  isAccountHash,
  networkFromCaip2,
  type CasperPaymentRequirements,
} from "@casper-baret/casper-core";
import type { CasperNetwork } from "@casper-baret/ext-protocol";

export type { CasperPaymentRequirements as PaymentRequirements };

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  network?: CasperNetwork;
}

export function validateRequirements(req: unknown): ValidationResult {
  if (!req || typeof req !== "object")
    return { ok: false, reason: "Requirements is not an object" };
  const r = req as Record<string, unknown>;

  if (r.scheme !== "exact")
    return { ok: false, reason: `Unsupported scheme: ${String(r.scheme)}` };

  if (typeof r.network !== "string")
    return { ok: false, reason: "Missing network" };
  if (!r.network.startsWith("casper:"))
    return { ok: false, reason: `Unsupported network: ${r.network}` };
  const cfg = networkFromCaip2(r.network);
  if (!cfg)
    return { ok: false, reason: `Unknown Casper network: ${r.network}` };
  const network: CasperNetwork = cfg.id;

  if (typeof r.asset !== "string")
    return { ok: false, reason: "Missing asset" };
  if (!isContractPackageHash(r.asset))
    return { ok: false, reason: "asset is not a CEP-18 contract package hash (64 hex)" };

  if (typeof r.amount !== "string")
    return { ok: false, reason: "Missing amount" };
  if (!/^\d+$/.test(r.amount))
    return { ok: false, reason: "amount must be an integer string (atomic units)" };
  if (BigInt(r.amount) <= 0n)
    return { ok: false, reason: "amount must be greater than zero" };

  if (typeof r.payTo !== "string")
    return { ok: false, reason: "Missing payTo" };
  if (!isX402Address(r.payTo) && !isAccountHash(r.payTo))
    return { ok: false, reason: "payTo is not a Casper account hash / x402 address" };

  if (
    typeof r.maxTimeoutSeconds !== "number" ||
    r.maxTimeoutSeconds <= 0 ||
    r.maxTimeoutSeconds > 600
  ) {
    return { ok: false, reason: "maxTimeoutSeconds out of range (1–600)" };
  }

  const extra = r.extra as Record<string, unknown> | undefined;
  if (!extra || typeof extra !== "object")
    return { ok: false, reason: "Missing extra" };
  const name = (extra.name ?? extra.assetName) as unknown;
  if (typeof name !== "string" || name.length === 0)
    return { ok: false, reason: "extra.name (token name) required for the EIP-712 domain" };

  return { ok: true, network };
}

/** Atomic → UI conversion for display + cap math. CEP-18 tokens default to 9 decimals. */
export function atomicToUi(amount: string, decimals = 9): number {
  return coreAtomicToUi(amount, decimals);
}
