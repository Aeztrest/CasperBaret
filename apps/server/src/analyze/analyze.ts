/**
 * Casper transaction analyzer — the engine behind POST /v1/analyze.
 *
 * Pragmatic & deterministic: parses a normalized intent (primary path) or a
 * raw Casper transaction JSON (best-effort), runs the risk detectors, applies
 * the guard policy, and returns an `AnalysisResult`. No live node is required;
 * speculative_exec is optional and degrades confidence on failure.
 */

import type {
  AnalysisResult,
  EstimatedChanges,
  RiskFinding,
  GuardPolicy,
  CasperNetworkId,
  CasperPaymentRequirements,
} from "@casper-baret/casper-guard";
import { normalizePolicy } from "@casper-baret/casper-guard";
import { parseIntent } from "./intent.js";
import {
  detectContractExposure,
  detectAllowance,
  detectTransfer,
  detectX402Shape,
  type DetectorContext,
} from "./detectors.js";
import { evaluatePolicy } from "./policy-eval.js";

export const ANALYSIS_VERSION = "casper-1.0.0";

export interface AnalyzeInput {
  network: CasperNetworkId;
  /** JSON string of a Casper tx, or a normalized intent object. */
  transaction: unknown;
  userWallet: string;
  policy: GuardPolicy;
  integratorRequestId?: string;
  paymentRequirements?: CasperPaymentRequirements;
  /** Config-driven reputation sets (lowercased package hashes). */
  riskyPackages?: Set<string>;
  knownSafePackages?: Set<string>;
}

function mergeChanges(into: EstimatedChanges, from: EstimatedChanges): void {
  into.native.push(...from.native);
  into.tokens.push(...from.tokens);
  into.allowances.push(...from.allowances);
  into.accountControl.push(...from.accountControl);
}

export function analyzeTransaction(input: AnalyzeInput): AnalysisResult {
  const policy = normalizePolicy(input.policy ?? {});
  const findings: RiskFinding[] = [];
  const simulationWarnings: string[] = [];
  const changes: EstimatedChanges = {
    native: [],
    tokens: [],
    allowances: [],
    accountControl: [],
  };

  const intent = parseIntent(input.transaction);

  if (!intent) {
    findings.push({
      code: "LOW_CONFIDENCE_INCOMPLETE_DATA",
      severity: "medium",
      message:
        "Could not parse a Casper transaction intent from the request. Send a normalized intent envelope or a valid Casper transaction JSON.",
    });
    simulationWarnings.push("intent_unparsed");
  }

  const ctx: DetectorContext = {
    userWallet: input.userWallet,
    policy,
    riskyPackages: input.riskyPackages ?? new Set(),
    knownSafePackages: input.knownSafePackages ?? new Set(),
  };

  if (intent) {
    findings.push(...detectContractExposure(intent, ctx));

    const allow = detectAllowance(intent, ctx);
    findings.push(...allow.findings);
    mergeChanges(changes, allow.changes);

    const xfer = detectTransfer(intent, ctx);
    findings.push(...xfer.findings);
    mergeChanges(changes, xfer.changes);
  }

  // x402 paywall shape (independent of the tx intent).
  findings.push(...detectX402Shape(input.paymentRequirements));

  const verdict = evaluatePolicy(findings, policy);

  const confidence: "low" | "medium" | "high" = intent ? "medium" : "low";

  const result: AnalysisResult = {
    safe: verdict.safe,
    reasons: verdict.reasons,
    estimatedChanges: changes,
    riskFindings: findings,
    simulationWarnings,
    meta: {
      analysisVersion: ANALYSIS_VERSION,
      network: input.network,
      simulatedAt: new Date().toISOString(),
      confidence,
      integratorRequestId: input.integratorRequestId,
    },
  };

  return result;
}
