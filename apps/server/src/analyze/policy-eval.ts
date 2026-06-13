/**
 * Policy evaluation — turns risk findings + policy into a safe/blocked verdict
 * plus human-readable reasons. Deterministic.
 */

import type { RiskFinding, GuardPolicy } from "@casper-baret/casper-guard";

export interface PolicyVerdict {
  safe: boolean;
  reasons: string[];
}

/**
 * A finding is *blocking* when:
 *  - severity is critical/high (always blocks), OR
 *  - severity is medium/low and policy.allowWarnings is not true, OR
 *  - a specific policy toggle escalates it to blocking.
 */
export function evaluatePolicy(
  findings: RiskFinding[],
  policy: GuardPolicy,
): PolicyVerdict {
  const reasons: string[] = [];

  for (const f of findings) {
    if (isBlocking(f, policy)) {
      reasons.push(`[${f.code}] ${f.message}`);
    }
  }

  return { safe: reasons.length === 0, reasons };
}

function isBlocking(f: RiskFinding, policy: GuardPolicy): boolean {
  // Severity baseline.
  if (f.severity === "critical" || f.severity === "high") {
    // Risky contracts gate behind blockRiskyContracts when explicitly false.
    if (f.code === "RISKY_CONTRACT_PACKAGE" && policy.blockRiskyContracts === false) {
      return false;
    }
    return true;
  }

  // Per-code policy escalations for medium/low findings.
  switch (f.code) {
    case "UNKNOWN_CONTRACT_PACKAGE":
      if (policy.blockUnknownContractExposure) return true;
      break;
    case "CEP18_ALLOWANCE_GRANTED":
      if (policy.blockCep18AllowanceGrants) return true;
      break;
    default:
      break;
  }

  // Remaining medium/low: block unless warnings are allowed.
  return policy.allowWarnings !== true;
}
