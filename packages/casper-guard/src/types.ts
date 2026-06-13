/**
 * Baret Casper Guard — shared analysis contract.
 *
 * This is the wire schema between the Baret analyze server (apps/server),
 * the wallet extension, and the showcase. It is SDK-free (pure types) so it
 * can be imported anywhere.
 *
 * Casper vocabulary:
 *  - native unit = **motes** (1 CSPR = 1e9 motes)
 *  - accounts    = **account-hash** (`account-hash-<64hex>`) or public-key hex
 *  - tokens      = **CEP-18** identified by a **contract package hash** (64 hex)
 *  - contracts   = **contract package hash** / **contract hash**
 *  - approvals   = CEP-18 `approve(spender, amount)` allowances
 */

export type CasperNetworkId = "testnet" | "mainnet";

export type RiskSeverity = "low" | "medium" | "high" | "critical";

export type RiskFindingCode =
  // simulation / data quality
  | "SIMULATION_FAILED"
  | "SIMULATION_ERROR"
  | "LOW_CONFIDENCE_INCOMPLETE_DATA"
  // contract exposure
  | "RISKY_CONTRACT_PACKAGE"
  | "UNKNOWN_CONTRACT_PACKAGE"
  | "KNOWN_MALICIOUS_ADDRESS"
  | "SUSPICIOUS_CONTRACT_AGE"
  // account control (Casper associated keys / action thresholds)
  | "ASSOCIATED_KEY_ADDED"
  | "ASSOCIATED_KEY_REMOVED"
  | "ACTION_THRESHOLD_CHANGED"
  | "ACCOUNT_WEIGHT_REDUCED"
  // token movement & approvals
  | "CEP18_ALLOWANCE_GRANTED"
  | "CEP18_ALLOWANCE_UNLIMITED"
  | "NATIVE_TRANSFER_TO_UNKNOWN"
  // balance thresholds
  | "POST_BALANCE_TOO_LOW"
  | "ESTIMATED_LOSS_EXCEEDS_MAX"
  | "LOSS_PERCENT_UNAVAILABLE"
  // call graph & cost
  | "DEEP_CONTRACT_CALL_NESTING"
  | "EXCESSIVE_GAS"
  | "EXCESSIVE_PAYMENT"
  // x402 paywall shape
  | "X402_SHAPE_INVALID"
  | "X402_DESTINATION_MISMATCH"
  | "X402_ASSET_MISMATCH"
  | "X402_AMOUNT_MISMATCH"
  | "X402_FACILITATOR_MISMATCH"
  | "X402_NETWORK_MISMATCH"
  | (string & {});

export interface RiskFinding {
  code: RiskFindingCode;
  severity: RiskSeverity;
  message: string;
  details?: Record<string, unknown>;
}

/** Native CSPR balance delta (motes, 9 decimals). */
export interface NativeBalanceChange {
  accountHash: string;
  preMotes: string | null;
  postMotes: string | null;
  deltaMotes: string | null;
}

/** CEP-18 token balance delta. */
export interface TokenBalanceChange {
  accountHash: string;
  /** CEP-18 contract package hash (64 hex). */
  tokenPackage: string;
  symbol: string;
  pre: string;
  post: string;
  delta: string;
  decimals: number;
}

/** CEP-18 `approve` allowance grant. */
export interface Cep18AllowanceChange {
  kind: "cep18_allowance";
  tokenPackage: string;
  owner: string;
  spender: string;
  amount: string;
  /** True when amount is the U256-max "unlimited" sentinel. */
  unlimited: boolean;
  message: string;
}

/** Casper associated-key / action-threshold change (account multisig control). */
export interface AccountControlChange {
  kind: "account_control";
  account: string;
  change:
    | "add_associated_key"
    | "remove_associated_key"
    | "update_associated_key"
    | "set_action_threshold";
  message: string;
}

export interface EstimatedChanges {
  native: NativeBalanceChange[];
  tokens: TokenBalanceChange[];
  allowances: Cep18AllowanceChange[];
  accountControl: AccountControlChange[];
}

export interface AnalysisResult {
  safe: boolean;
  reasons: string[];
  estimatedChanges: EstimatedChanges;
  riskFindings: RiskFinding[];
  simulationWarnings: string[];
  meta?: {
    analysisVersion: string;
    network: CasperNetworkId;
    simulatedAt: string;
    confidence: "low" | "medium" | "high";
    integratorRequestId?: string;
  };
  annotation?: unknown;
  suggestions?: unknown;
}

/** x402 payment requirements, Casper flavor (CAIP-2 `casper:casper-test`). */
export interface CasperPaymentRequirements {
  scheme: "exact";
  /** CAIP-2 chain id, e.g. "casper:casper-test" or "casper:casper". */
  network: string;
  /** CEP-18 contract package hash (64 hex) used for settlement. */
  asset: string;
  /** Atomic token amount (string integer). */
  amount: string;
  /** Payee account-hash ("account-hash-<64hex>" or 66-char "00"+hex). */
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    /** Facilitator/sponsor account that submits the settlement deploy. */
    sponsorBy?: string;
    feePayer?: string;
    assetName?: string;
    description?: string;
    mimeType?: string;
  };
}
