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

/** Native CSPR logo, bundled under public/. */
export const CSPR_LOGO = "/tokens/cspr.png";

export interface TokenDef {
  /** Ticker shown in the token list, e.g. "USDC". */
  symbol: string;
  /** Human name, e.g. "USD Coin (demo CEP-18)". */
  name: string;
  /** 64-hex CEP-18 contract package hash. */
  packageHash: string;
  /** Atomic→display divisor exponent. */
  decimals: number;
  kind: "stablecoin" | "token";
  /** Root-relative path to a logo bundled under public/, e.g. "/tokens/usdc.webp". */
  logo?: string;
}

/**
 * Demo CEP-18 surfaced as USDC on testnet. Same package hash as the server's
 * CEP18_X402_PACKAGE so balances and x402 payments reference one token.
 */
export const CEP18_TOKENS: Record<CasperNetwork, TokenDef[]> = {
  testnet: [
    {
      symbol: "USDC",
      name: "USD Coin",
      // Deployed 2026-07-05 on casper-test — mirrors CEP18_X402_PACKAGE.
      packageHash:
        "ce78329749fe52382fe42061fd7afd358fb622fb46b367f5f28d13f40e0744f3",
      decimals: 6,
      kind: "stablecoin",
      logo: "/tokens/usdc.webp",
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
  // Thousands separators (browser locale) to match how CSPR amounts are rendered elsewhere.
  const wholeStr = whole.toLocaleString();
  if (frac === 0n) return wholeStr;
  // Right-pad the fractional part, then trim to maxFractionDigits and strip zeros.
  const fracStr = frac.toString().padStart(decimals, "0").slice(0, maxFractionDigits).replace(/0+$/, "");
  return fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
}
