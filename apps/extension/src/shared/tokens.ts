/**
 * Known CEP-18 tokens the wallet surfaces as balances, per network.
 *
 * Casper testnet has no canonical USDC, so we surface the demo Cep18x402 token
 * (the same CEP-18 used for x402 settlement) under a "USDC" stablecoin label.
 * Its package hash mirrors CEP18_X402_PACKAGE in vercel.json / the server config.
 *
 * `acquire` powers the in-wallet "how to get this token" flow (Faz 2): a short
 * label + an external URL the user can open to mint/receive the asset.
 */

import type { CasperNetwork } from "@casper-baret/ext-protocol";

export interface TokenDef {
  /** Ticker shown in the token list, e.g. "USDC". */
  symbol: string;
  /** Human name, e.g. "USD Coin (demo CEP-18)". */
  name: string;
  /** 64-hex CEP-18 contract package hash. */
  packageHash: string;
  /** Atomic→display divisor exponent (Cep18x402 mints with 9 decimals). */
  decimals: number;
  kind: "stablecoin" | "token";
}

/**
 * Demo CEP-18 surfaced as USDC on testnet. Same package hash as the server's
 * CEP18_X402_PACKAGE so balances and x402 payments reference one token.
 */
export const CEP18_TOKENS: Record<CasperNetwork, TokenDef[]> = {
  testnet: [
    {
      symbol: "USDC",
      name: "USD Coin (demo CEP-18)",
      packageHash:
        "89ae0441d3ae2b1e619fbbb6cb14a58c7ad2004131e3f14b5d384007435a6231",
      decimals: 9,
      kind: "stablecoin",
    },
  ],
  mainnet: [],
};

export function tokensFor(network: CasperNetwork): TokenDef[] {
  return CEP18_TOKENS[network] ?? [];
}

/** Format a raw atomic-unit string into a human amount with `decimals` places. */
export function formatTokenAmount(raw: string, decimals: number, maxFractionDigits = 4): string {
  let big: bigint;
  try {
    big = BigInt(raw);
  } catch {
    return "0";
  }
  const base = 10n ** BigInt(decimals);
  const whole = big / base;
  const frac = big % base;
  if (frac === 0n) return whole.toString();
  // Right-pad the fractional part, then trim to maxFractionDigits and strip zeros.
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
