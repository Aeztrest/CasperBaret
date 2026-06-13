/**
 * Showcase-side analyze client (Casper build). Lets a demo site call Baret's
 * `/v1/analyze` endpoint directly — the same pipeline the extension's sign
 * popup runs, rendered on the site so visitors see what the firewall WOULD
 * say before they sign.
 *
 * Network: requests go through the showcase Vite proxy at /api/v1/analyze
 * (rewrites to localhost:8080). The server expects a `transaction` payload
 * (a normalized Casper intent JSON string or a raw Casper tx JSON), a
 * `userWallet` account-hash, and a `GuardPolicy`.
 */

import {
  BALANCED_POLICY,
  type AnalysisResult as GuardAnalysisResult,
  type RiskFinding,
  type GuardPolicy,
} from "@casper-baret/casper-guard";

export type { RiskFinding };

/** The analyze result augmented with a UI verdict + offline flag. */
export interface AnalysisResult extends GuardAnalysisResult {
  decision: "safe" | "advisory" | "block";
  offline: boolean;
}

export interface AnalyzeOptions {
  network?: "testnet" | "mainnet";
  policy?: GuardPolicy;
}

const API_KEY = "dev-key-change-me";

const EMPTY_CHANGES: GuardAnalysisResult["estimatedChanges"] = {
  native: [],
  tokens: [],
  allowances: [],
  accountControl: [],
};

/**
 * Analyze a Casper transaction intent for the pre-sign preview.
 * `transaction` is the JSON-stringified intent built by `buildScenario`.
 */
export async function analyzeTransactionForPreview(
  transaction: string,
  userWallet: string,
  opts: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  try {
    const res = await fetch("/api/v1/analyze", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        network: opts.network ?? "testnet",
        transaction,
        userWallet,
        policy: opts.policy ?? BALANCED_POLICY,
      }),
    });

    if (!res.ok) {
      return offlineResult(`Analyze server returned HTTP ${res.status}`);
    }
    const body = (await res.json()) as GuardAnalysisResult;

    const decision: AnalysisResult["decision"] = body.safe
      ? hasMediumOrHigher(body.riskFindings ?? [])
        ? "advisory"
        : "safe"
      : "block";

    return {
      ...body,
      decision,
      safe: body.safe,
      reasons: body.reasons ?? [],
      riskFindings: body.riskFindings ?? [],
      estimatedChanges: body.estimatedChanges ?? EMPTY_CHANGES,
      simulationWarnings: body.simulationWarnings ?? [],
      offline: false,
    };
  } catch (err) {
    return offlineResult(err instanceof Error ? err.message : String(err));
  }
}

function hasMediumOrHigher(findings: RiskFinding[]): boolean {
  return findings.some(
    (f) =>
      f.severity === "medium" ||
      f.severity === "high" ||
      f.severity === "critical",
  );
}

function offlineResult(reason: string): AnalysisResult {
  return {
    decision: "advisory",
    safe: false,
    reasons: [`Couldn't reach Baret: ${reason}`],
    riskFindings: [
      {
        code: "ANALYZE_UNREACHABLE",
        severity: "medium",
        message:
          "Analyze server unreachable; sign only if you trust this dApp.",
      },
    ],
    estimatedChanges: EMPTY_CHANGES,
    simulationWarnings: [],
    offline: true,
  };
}
