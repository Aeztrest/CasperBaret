/**
 * Deterministic risk detectors. Each takes the parsed intent (+ context) and
 * returns RiskFinding[] and contributes EstimatedChanges. Pure & unit-testable.
 */

import type {
  RiskFinding,
  EstimatedChanges,
  GuardPolicy,
  CasperPaymentRequirements,
} from "@casper-baret/casper-guard";
import {
  isContractPackageHash,
  isX402Address,
  isAccountHash,
  toX402Address,
} from "@casper-baret/casper-core";
import { isUnlimitedAmount, type TxIntent } from "./intent.js";

export interface DetectorContext {
  userWallet: string;
  policy: GuardPolicy;
  riskyPackages: Set<string>;
  knownSafePackages: Set<string>;
  /**
   * Package hash (lowercased, no "0x") -> CEP-18 decimals, for tokens whose
   * decimals we actually know (e.g. our own deployed test-USDC, 6 decimals).
   * CEP-18 tokens can use any decimals count, and it isn't encoded in the
   * transaction itself — an unrecognized package falls back to 9 (CSPR's
   * own decimals), which is only a guess.
   */
  knownTokenDecimals?: Record<string, number>;
}

export interface DetectorOutput {
  findings: RiskFinding[];
  changes: EstimatedChanges;
}

function emptyChanges(): EstimatedChanges {
  return { native: [], tokens: [], allowances: [], accountControl: [] };
}

function normPkg(pkg: string | undefined): string | undefined {
  if (!pkg) return undefined;
  return pkg.replace(/^0x/i, "").toLowerCase();
}

/** Contract-package reputation: risky (critical) / unknown exposure (medium). */
export function detectContractExposure(
  intent: TxIntent,
  ctx: DetectorContext,
): RiskFinding[] {
  const pkg = normPkg(intent.contractPackage ?? intent.targetPackage);
  if (!pkg) return [];

  const findings: RiskFinding[] = [];

  if (ctx.riskyPackages.has(pkg)) {
    findings.push({
      code: "RISKY_CONTRACT_PACKAGE",
      severity: "critical",
      message: `Contract package ${pkg} is flagged as risky.`,
      details: { contractPackage: pkg },
    });
    return findings; // risky dominates; no point reporting "unknown" too.
  }

  // Only flag unknown exposure when an allowlist is configured.
  if (ctx.knownSafePackages.size > 0 && !ctx.knownSafePackages.has(pkg)) {
    findings.push({
      code: "UNKNOWN_CONTRACT_PACKAGE",
      severity: "medium",
      message: `Contract package ${pkg} is not in the known-safe list.`,
      details: { contractPackage: pkg },
    });
  }
  return findings;
}

/** CEP-18 approve → allowance grant (medium) / unlimited (high). */
export function detectAllowance(
  intent: TxIntent,
  ctx: DetectorContext,
): DetectorOutput {
  const changes = emptyChanges();
  const findings: RiskFinding[] = [];
  if (intent.kind !== "cep18_approve") return { findings, changes };

  const pkg = normPkg(intent.contractPackage ?? intent.targetPackage) ?? "";
  const spender = intent.args?.spender ?? "";
  const amount = intent.args?.amount ?? "0";
  const unlimited =
    isUnlimitedAmount(amount) || ctx.policy.refuseUnlimitedAllowances === true;

  changes.allowances.push({
    kind: "cep18_allowance",
    tokenPackage: pkg,
    owner: ctx.userWallet,
    spender,
    amount,
    unlimited: isUnlimitedAmount(amount),
    message: `Grant ${isUnlimitedAmount(amount) ? "UNLIMITED" : amount} allowance to ${spender || "unknown spender"}.`,
  });

  findings.push({
    code: "CEP18_ALLOWANCE_GRANTED",
    severity: "medium",
    message: `CEP-18 approve grants spend authority to ${spender || "an unknown spender"}.`,
    details: { spender, amount, tokenPackage: pkg },
  });

  if (unlimited) {
    findings.push({
      code: "CEP18_ALLOWANCE_UNLIMITED",
      severity: "high",
      message:
        "CEP-18 approve grants an unlimited (U256-max) allowance — the spender can drain the entire balance.",
      details: { spender, amount, tokenPackage: pkg },
    });
  }

  return { findings, changes };
}

/**
 * Transfers to a counterparty other than the user, sized against
 * policy.maxLossPercent. Adds estimated changes + (when oversized) an
 * ESTIMATED_LOSS_EXCEEDS_MAX finding.
 */
export function detectTransfer(
  intent: TxIntent,
  ctx: DetectorContext,
): DetectorOutput {
  const changes = emptyChanges();
  const findings: RiskFinding[] = [];

  if (intent.kind === "native_transfer") {
    const amount = intent.amountMotes ?? intent.args?.amount ?? "0";
    const to = intent.args?.recipient ?? intent.args?.to ?? "";
    changes.native.push({
      accountHash: ctx.userWallet,
      preMotes: null,
      postMotes: null,
      deltaMotes: "-" + safeAbs(amount),
    });
    pushLossIfHuge(findings, ctx, amount, to, "native CSPR", 9);
  } else if (intent.kind === "cep18_transfer") {
    const amount = intent.args?.amount ?? "0";
    const to = intent.args?.recipient ?? intent.args?.to ?? "";
    const pkg = normPkg(intent.contractPackage ?? intent.targetPackage) ?? "";
    // CEP-18 tokens can use any decimals count, and it isn't encoded in the
    // transaction — only correct for packages we actually recognize (falls
    // back to 9, which is only a guess for anything else).
    const decimals = ctx.knownTokenDecimals?.[pkg] ?? 9;
    changes.tokens.push({
      accountHash: ctx.userWallet,
      tokenPackage: pkg,
      symbol: "CEP18",
      pre: "0",
      post: "0",
      delta: "-" + safeAbs(amount),
      decimals,
    });
    pushLossIfHuge(findings, ctx, amount, to, "CEP-18 token", decimals);
  }

  return { findings, changes };
}

function safeAbs(amount: string): string {
  try {
    const v = BigInt(amount);
    return (v < 0n ? -v : v).toString();
  } catch {
    return "0";
  }
}

function sameAccount(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    return toX402Address(a) === toX402Address(b);
  } catch {
    return a.toLowerCase() === b.toLowerCase();
  }
}

/**
 * The pragmatic "huge" heuristic: without live balances we cannot compute a
 * real loss percent, so we treat very large absolute values + an external
 * recipient as exceeding the configured maxLossPercent. The threshold scales
 * inversely with maxLossPercent (a tighter policy trips at a lower value),
 * and with the asset's own decimals (`decimals`) so a 6-decimal token isn't
 * held to a bar calibrated in 9-decimal CSPR motes — 50,000 units of a
 * 6-decimal token is a thousand times more of the token than the same raw
 * number would represent at 9 decimals.
 */
function pushLossIfHuge(
  findings: RiskFinding[],
  ctx: DetectorContext,
  amount: string,
  to: string,
  label: string,
  decimals: number,
): void {
  if (to && sameAccount(to, ctx.userWallet)) return; // self-transfer, ignore.
  const maxPct = ctx.policy.maxLossPercent;
  if (maxPct === undefined) return;

  let value: bigint;
  try {
    value = BigInt(safeAbs(amount));
  } catch {
    return;
  }

  // Reference "large" bar: 1000 whole units of the asset, scaled by policy.
  // maxLossPercent=50 → ~1000 units; =25 → ~500; =90 → ~1800.
  const bar = (1000n * 10n ** BigInt(decimals) * BigInt(Math.max(1, Math.round(maxPct)))) / 50n;
  if (value > bar) {
    findings.push({
      code: "ESTIMATED_LOSS_EXCEEDS_MAX",
      severity: "high",
      message: `Outgoing ${label} transfer to ${to || "an external account"} looks large relative to policy.maxLossPercent (${maxPct}%).`,
      details: { amount, recipient: to, maxLossPercent: maxPct },
    });
  }
}

/** Validate x402 PaymentRequirements shape. */
export function detectX402Shape(
  req: CasperPaymentRequirements | undefined,
): RiskFinding[] {
  if (!req) return [];
  const findings: RiskFinding[] = [];

  if (req.scheme !== "exact") {
    findings.push({
      code: "X402_SHAPE_INVALID",
      severity: "high",
      message: `Unsupported x402 scheme "${req.scheme}" (expected "exact").`,
    });
  }
  if (!req.network || !req.network.startsWith("casper:")) {
    findings.push({
      code: "X402_NETWORK_MISMATCH",
      severity: "high",
      message: `x402 network "${req.network}" is not a Casper CAIP-2 id.`,
    });
  }
  if (!req.asset || !isContractPackageHash(req.asset)) {
    findings.push({
      code: "X402_ASSET_MISMATCH",
      severity: "high",
      message: "x402 asset is not a valid CEP-18 contract package hash.",
    });
  }
  if (!req.payTo || !(isX402Address(req.payTo) || isAccountHash(req.payTo))) {
    findings.push({
      code: "X402_DESTINATION_MISMATCH",
      severity: "high",
      message: "x402 payTo is not a valid Casper account.",
    });
  }
  let amountOk = false;
  try {
    amountOk = BigInt(req.amount) > 0n;
  } catch {
    amountOk = false;
  }
  if (!amountOk) {
    findings.push({
      code: "X402_AMOUNT_MISMATCH",
      severity: "high",
      message: "x402 amount must be a positive atomic integer.",
    });
  }
  return findings;
}
