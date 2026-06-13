/**
 * Unit conversions. Casper native unit is the **mote**: 1 CSPR = 1e9 motes.
 * CEP-18 tokens carry their own `decimals`.
 */

export const MOTES_PER_CSPR = 1_000_000_000n;

/** Convert a CSPR (or token UI) decimal amount to atomic units (string integer). */
export function uiToAtomic(amount: number | string, decimals = 9): string {
  const s = typeof amount === "number" ? amount.toString() : amount.trim();
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") {
    throw new Error(`invalid amount: ${amount}`);
  }
  const [whole, frac = ""] = s.split(".");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const atomic = BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  return atomic.toString();
}

/** Convert atomic units (string/bigint) to a UI decimal number. */
export function atomicToUi(atomic: string | bigint, decimals = 9): number {
  const v = typeof atomic === "bigint" ? atomic : BigInt(atomic);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const num = Number(whole) + Number(frac) / Number(base);
  return negative ? -num : num;
}

/** Format atomic units as a fixed-precision string (no float error). */
export function formatAtomic(atomic: string | bigint, decimals = 9, displayDecimals = 4): string {
  const v = typeof atomic === "bigint" ? atomic : BigInt(atomic);
  const negative = v < 0n;
  const abs = negative ? -v : v;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, displayDecimals);
  return `${negative ? "-" : ""}${whole.toString()}${displayDecimals > 0 ? "." + frac : ""}`;
}

export const csprToMotes = (cspr: number | string): string => uiToAtomic(cspr, 9);
export const motesToCspr = (motes: string | bigint): number => atomicToUi(motes, 9);
