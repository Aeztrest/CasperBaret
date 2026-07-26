/**
 * The agent's spending policy — same field vocabulary as
 * `packages/casper-guard`'s GuardPolicy (maxX402PerTx / x402HourlyCap /
 * x402DailyCap), the exact caps Baret's own wallet enforces for a human
 * user. Deliberately tight here so a short demo run actually hits the cap:
 * five Scrybe questions at 0.02 USDC each fit the daily cap, a sixth does
 * not.
 *
 * This is a standalone in-process tracker (this agent doesn't run inside
 * the Baret extension), not a call into the extension's own IndexedDB
 * ledger — but it enforces the identical rule shape, so "the agent got
 * capped" here means the same thing it would mean inside the real wallet.
 */

import type { GuardPolicy } from "@casper-baret/casper-guard";

export const AGENT_POLICY: Pick<GuardPolicy, "maxX402PerTx" | "x402HourlyCap" | "x402DailyCap"> = {
  maxX402PerTx: 0.05, // USDC — a single question can never cost more than this
  x402HourlyCap: 0.1, // USDC — five questions per rolling hour
  x402DailyCap: 0.1, // USDC — same limit for the demo's short lifetime
};

interface SpendRecord {
  amountUsdc: number;
  atMs: number;
}

const spendLog: SpendRecord[] = [];

function within(windowMs: number, nowMs: number): number {
  return spendLog
    .filter((r) => nowMs - r.atMs < windowMs)
    .reduce((sum, r) => sum + r.amountUsdc, 0);
}

export interface PolicyCheck {
  allowed: boolean;
  reason?: string;
  spentHourUsdc: number;
  spentDayUsdc: number;
}

/** Would spending `amountUsdc` right now breach any cap? Does not record it. */
export function checkPolicy(amountUsdc: number): PolicyCheck {
  const now = Date.now();
  const spentHour = within(60 * 60 * 1000, now);
  const spentDay = within(24 * 60 * 60 * 1000, now);

  if (AGENT_POLICY.maxX402PerTx !== undefined && amountUsdc > AGENT_POLICY.maxX402PerTx) {
    return {
      allowed: false,
      reason: `${amountUsdc} USDC exceeds the per-transaction cap of ${AGENT_POLICY.maxX402PerTx} USDC`,
      spentHourUsdc: spentHour,
      spentDayUsdc: spentDay,
    };
  }
  if (AGENT_POLICY.x402HourlyCap !== undefined && spentHour + amountUsdc > AGENT_POLICY.x402HourlyCap) {
    return {
      allowed: false,
      reason: `Would bring the hourly total to ${(spentHour + amountUsdc).toFixed(4)} USDC, over the ${AGENT_POLICY.x402HourlyCap} USDC hourly cap`,
      spentHourUsdc: spentHour,
      spentDayUsdc: spentDay,
    };
  }
  if (AGENT_POLICY.x402DailyCap !== undefined && spentDay + amountUsdc > AGENT_POLICY.x402DailyCap) {
    return {
      allowed: false,
      reason: `Would bring the daily total to ${(spentDay + amountUsdc).toFixed(4)} USDC, over the ${AGENT_POLICY.x402DailyCap} USDC daily cap`,
      spentHourUsdc: spentHour,
      spentDayUsdc: spentDay,
    };
  }
  return { allowed: true, spentHourUsdc: spentHour, spentDayUsdc: spentDay };
}

/** Record a payment that actually went through. */
export function recordSpend(amountUsdc: number): void {
  spendLog.push({ amountUsdc, atMs: Date.now() });
}
