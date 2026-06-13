/**
 * Baret guard policy DSL — Casper build, v1.
 *
 * The server-side schema (apps/server/src/domain/policy.ts) carries the
 * pre-sign subset; client-only rules (allowance windows, behavioral alerts,
 * x402 rolling caps) live exclusively in the wallet.
 *
 * Units: native amounts are **motes** (1 CSPR = 1e9 motes). Assets are
 * CEP-18 contract package hashes. Accounts are account-hashes.
 */

export interface GuardPolicy {
  /* ───── 1.1 Pre-sign rules (server + client both evaluate) ───── */

  /** Reject if estimated CSPR loss exceeds this fraction of the wallet's pre-balance. 0–100. */
  maxLossPercent?: number;

  /** Reject if post-tx balance of the configured token falls below this UI amount. */
  minPostTokenBalance?: number;

  /** CEP-18 package hash the min-balance rule applies to. Defaults to the demo x402 token. */
  minPostAsset?: string;

  /** Reject when a CEP-18 `approve` appears in the simulation. */
  blockCep18AllowanceGrants?: boolean;

  /** Reject when a tx touches a contract package flagged in Baret's reputation DB. */
  blockRiskyContracts?: boolean;

  /** Reject when a tx touches any contract package not in the known-safe list. */
  blockUnknownContractExposure?: boolean;

  /** Reject ops that add/remove/update associated keys (Casper account multisig). */
  blockAssociatedKeyChanges?: boolean;

  /** Reject ops that weaken action thresholds or reduce the signer's weight below threshold. */
  blockThresholdWeakening?: boolean;

  /** If true, medium-severity advisories alone do not block. Critical/high still do. */
  allowWarnings?: boolean;

  /** When true (default), speculative execution must succeed for safe=true. */
  requireSuccessfulSimulation?: boolean;

  /* ───── 1.2 x402 protocol rules (client-only) ───── */

  /**
   * Auto-approve x402 payments in the background when they pass every policy
   * check and sit within the per-tx / hourly / daily caps — no popup. This is
   * the agentic-payments flow: the caps ARE the firewall, so micropayments
   * settle without interrupting the user. When false, every x402 payment
   * surfaces a popup for explicit confirmation. Payments that exceed a cap or
   * fail a policy check are never auto-approved regardless of this flag.
   */
  x402AutoApprove?: boolean;

  /** Maximum token value of a single x402 payment. */
  maxX402PerTx?: number;

  /** Rolling 1-hour cap of cumulative x402 spend, per (merchant, asset). */
  x402HourlyCap?: number;

  /** Rolling 24-hour cap. */
  x402DailyCap?: number;

  /** Allowlist of facilitator/sponsor accounts (extra.sponsorBy). When set, refuses unknown facilitators. */
  allowedFacilitators?: string[];

  /** Allowlist of CEP-18 package hashes. When set, refuses payments in other assets. */
  allowedAssets?: string[];

  /** Allowlist of merchant origins. When set, refuses unknown origins. */
  allowedMerchantOrigins?: string[];

  /** Denylist of merchant origins. Always refused even when allowlist is empty. */
  blockedMerchantOrigins?: string[];

  /** Refuse x402 payments whose deploy TTL is more than this many seconds. */
  maxTtlSeconds?: number;

  /** Refuse payments whose speculative gas cost exceeds this mote value. */
  maxGasMotes?: number;

  /** Refuse payments whose payment (gas) amount exceeds this mote value (catches wallet auto-bumps). */
  maxPaymentMotes?: number;

  /** Cross-check the named sponsor against the facilitator's /supported endpoint. */
  requireFacilitatorSupportedCheck?: boolean;

  /** Block x402 payments whose `amount` deviates more than `anomalyStdDev`× from the merchant's running mean. */
  blockAmountAnomalies?: boolean;

  /** Multiplier for anomaly detection. Default 4. */
  anomalyStdDev?: number;

  /* ───── 1.3 Allowance / authorization rules (client-only) ───── */

  /** Auto-revoke a merchant's PaymentGuard allowance after this many idle days. 0 = never. */
  autoRevokeAfterIdleDays?: number;

  /** Auto-pause an allowance when it hits 100% of dailyCap. */
  autoPauseOnDailyCapHit?: boolean;

  /** Maximum number of active merchant allowances at once. 0 = no limit. */
  maxActiveAllowances?: number;

  /** Refuse CEP-18 `approve` for the U256-max sentinel — always cap. */
  refuseUnlimitedAllowances?: boolean;

  /* ───── 1.4 Behavioral / monitoring rules (client-only) ───── */

  /** Trigger drift alerts when an outgoing tx wasn't signed via Baret. */
  driftAlerts?: boolean;

  /** Trigger verify-orphan alerts (verify but no settle). */
  verifyOrphanAlerts?: boolean;

  /** Trigger settle-no-delivery alerts. */
  noDeliveryAlerts?: boolean;

  /** Refuse signatures while any merchant in the request is in `alert` state. */
  refuseInAlertState?: boolean;
}

/* ────── Templates ────── */

export const STRICT_POLICY: GuardPolicy = {
  maxLossPercent: 25,
  blockCep18AllowanceGrants: true,
  blockRiskyContracts: true,
  blockUnknownContractExposure: true,
  blockAssociatedKeyChanges: true,
  blockThresholdWeakening: true,
  allowWarnings: false,
  requireSuccessfulSimulation: true,
  // x402 — Strict surfaces every payment for explicit confirmation.
  x402AutoApprove: false,
  maxX402PerTx: 0.10,
  x402HourlyCap: 1.00,
  x402DailyCap: 5.00,
  maxTtlSeconds: 60,
  maxGasMotes: 5_000_000_000, // 5 CSPR
  maxPaymentMotes: 3_000_000_000, // 3 CSPR
  requireFacilitatorSupportedCheck: true,
  blockAmountAnomalies: true,
  anomalyStdDev: 3,
  autoRevokeAfterIdleDays: 30,
  autoPauseOnDailyCapHit: true,
  maxActiveAllowances: 12,
  refuseUnlimitedAllowances: true,
  driftAlerts: true,
  verifyOrphanAlerts: true,
  noDeliveryAlerts: true,
  refuseInAlertState: true,
};

export const BALANCED_POLICY: GuardPolicy = {
  maxLossPercent: 50,
  blockCep18AllowanceGrants: true,
  blockRiskyContracts: true,
  blockUnknownContractExposure: false,
  blockAssociatedKeyChanges: true,
  blockThresholdWeakening: true,
  allowWarnings: true,
  requireSuccessfulSimulation: true,
  // x402 — Balanced auto-approves micropayments under caps (no popup).
  x402AutoApprove: true,
  maxX402PerTx: 1.00,
  x402HourlyCap: 5.00,
  x402DailyCap: 25.00,
  maxTtlSeconds: 120,
  maxGasMotes: 10_000_000_000, // 10 CSPR
  maxPaymentMotes: 5_000_000_000, // 5 CSPR
  requireFacilitatorSupportedCheck: true,
  blockAmountAnomalies: true,
  anomalyStdDev: 4,
  autoRevokeAfterIdleDays: 90,
  autoPauseOnDailyCapHit: false,
  refuseUnlimitedAllowances: true,
  driftAlerts: true,
  verifyOrphanAlerts: true,
  noDeliveryAlerts: true,
  refuseInAlertState: false,
};

export const PERMISSIVE_POLICY: GuardPolicy = {
  maxLossPercent: 90,
  blockRiskyContracts: true,
  blockThresholdWeakening: true,
  requireSuccessfulSimulation: true,
  allowWarnings: true,
  x402AutoApprove: true,
  maxX402PerTx: 10.00,
  x402HourlyCap: 50.00,
  x402DailyCap: 250.00,
  blockAmountAnomalies: false,
  refuseUnlimitedAllowances: false,
  driftAlerts: true,
};

export type PolicyTemplateId = "strict" | "balanced" | "permissive" | "custom";

export interface PolicyTemplate {
  id: PolicyTemplateId;
  name: string;
  description: string;
  policy: GuardPolicy;
}

export const POLICY_TEMPLATES: PolicyTemplate[] = [
  {
    id: "strict",
    name: "Strict",
    description:
      "Block any suspicious activity. Tight x402 caps. Best for cautious users.",
    policy: STRICT_POLICY,
  },
  {
    id: "balanced",
    name: "Balanced",
    description:
      "Production default. Blocks drains and unauthorized allowances; permits unknown contracts.",
    policy: BALANCED_POLICY,
  },
  {
    id: "permissive",
    name: "Permissive",
    description: "Only blocks fatal outcomes. Generous caps. For power users.",
    policy: PERMISSIVE_POLICY,
  },
];

const NUM = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

export function validatePolicy(p: GuardPolicy): void {
  if (p.maxLossPercent !== undefined) {
    if (!NUM(p.maxLossPercent) || p.maxLossPercent < 0 || p.maxLossPercent > 100) {
      throw new Error("maxLossPercent must be a number between 0 and 100");
    }
  }
  if (p.minPostTokenBalance !== undefined) {
    if (!NUM(p.minPostTokenBalance) || p.minPostTokenBalance < 0) {
      throw new Error("minPostTokenBalance must be a non-negative number");
    }
  }
  if (p.minPostAsset !== undefined && typeof p.minPostAsset !== "string") {
    throw new Error("minPostAsset must be a CEP-18 package hash string");
  }
  if (p.maxX402PerTx !== undefined && (!NUM(p.maxX402PerTx) || p.maxX402PerTx < 0)) {
    throw new Error("maxX402PerTx must be a non-negative number");
  }
  if (p.x402HourlyCap !== undefined && (!NUM(p.x402HourlyCap) || p.x402HourlyCap < 0)) {
    throw new Error("x402HourlyCap must be a non-negative number");
  }
  if (p.x402DailyCap !== undefined && (!NUM(p.x402DailyCap) || p.x402DailyCap < 0)) {
    throw new Error("x402DailyCap must be a non-negative number");
  }
  if (p.maxTtlSeconds !== undefined && (!NUM(p.maxTtlSeconds) || p.maxTtlSeconds <= 0)) {
    throw new Error("maxTtlSeconds must be positive");
  }
  if (p.maxGasMotes !== undefined && (!NUM(p.maxGasMotes) || p.maxGasMotes < 0)) {
    throw new Error("maxGasMotes must be non-negative");
  }
  if (p.maxPaymentMotes !== undefined && (!NUM(p.maxPaymentMotes) || p.maxPaymentMotes < 0)) {
    throw new Error("maxPaymentMotes must be non-negative");
  }
  if (p.anomalyStdDev !== undefined && (!NUM(p.anomalyStdDev) || p.anomalyStdDev <= 0)) {
    throw new Error("anomalyStdDev must be positive");
  }
}

export function normalizePolicy(p: GuardPolicy): GuardPolicy {
  const out: GuardPolicy = {};
  for (const [k, v] of Object.entries(p)) {
    if (v !== undefined) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}
