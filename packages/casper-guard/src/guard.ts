import { analyzeTransaction, type AnalyzeClientConfig } from "./analyze.js";
import { GuardBlockedError } from "./errors.js";
import { normalizePolicy, validatePolicy, type GuardPolicy } from "./policy.js";
import type {
  AnalysisResult,
  RiskFinding,
  CasperNetworkId,
  CasperPaymentRequirements,
} from "./types.js";

export type GuardDecision = "allow" | "block";

export interface GuardEvaluation {
  decision: GuardDecision;
  /** Inner risk findings worth surfacing to the user even when allowed. */
  advisoryFindings: RiskFinding[];
  /** Reasons the policy blocked. Empty when decision === "allow". */
  blockingReasons: string[];
  /** Full server analysis result for rendering in the wallet UI. */
  analysis: AnalysisResult;
  /** JSON-stringified Casper transaction — preserved verbatim for sign+send. */
  transaction: string;
}

export interface GuardConfig {
  analyze: AnalyzeClientConfig;
  network: CasperNetworkId;
}

export interface EvaluateRequest {
  /**
   * JSON-stringified Casper transaction (Deploy / TransactionV1) ready for
   * signing. The guard does not build it — wallet wrappers vary — its job is
   * to send the prepared transaction through Baret's analyzer and apply the
   * user's policy.
   */
  transaction: string;
  /** User's account-hash or public-key hex. */
  userWallet: string;
  policy: GuardPolicy;
  /** Optional correlation id for tracing the request through the audit log. */
  integratorRequestId?: string;
  /** Optional x402 PaymentRequirements when the tx is a paywall payment. */
  paymentRequirements?: CasperPaymentRequirements;
}

export class TransactionGuard {
  constructor(private readonly cfg: GuardConfig) {}

  /**
   * Ship the prepared transaction to Baret /v1/analyze, evaluate the response
   * against the supplied policy, and return a structured GuardEvaluation.
   * Never signs. Never submits. Never throws on policy violation — returns
   * `decision: "block"` so the caller can render a denial UI.
   */
  async evaluate(req: EvaluateRequest): Promise<GuardEvaluation> {
    validatePolicy(req.policy);

    const analysis = await analyzeTransaction(this.cfg.analyze, {
      network: this.cfg.network,
      transaction: req.transaction,
      userWallet: req.userWallet,
      policy: normalizePolicy(req.policy),
      integratorRequestId: req.integratorRequestId,
      paymentRequirements: req.paymentRequirements,
    });

    const blockingReasons = analysis.safe ? [] : analysis.reasons;
    const advisoryFindings = analysis.safe
      ? analysis.riskFindings.filter(
          (f) => f.severity === "medium" || f.severity === "low",
        )
      : [];

    return {
      decision: analysis.safe ? "allow" : "block",
      advisoryFindings,
      blockingReasons,
      analysis,
      transaction: req.transaction,
    };
  }

  /**
   * Convenience wrapper around `evaluate` that throws `GuardBlockedError` on
   * block and returns the analysis otherwise.
   */
  async prepare(req: EvaluateRequest): Promise<{
    transaction: string;
    analysis: AnalysisResult;
  }> {
    const ev = await this.evaluate(req);
    if (ev.decision === "block") {
      throw new GuardBlockedError(
        ev.blockingReasons[0] ?? "Baret policy blocked this transaction",
        ev.analysis,
        ev.blockingReasons,
      );
    }
    return { transaction: ev.transaction, analysis: ev.analysis };
  }
}
