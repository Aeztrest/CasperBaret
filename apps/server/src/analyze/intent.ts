/**
 * Normalized transaction "intent" — the primary input the analyzer reasons
 * over. The showcase / extension send this envelope; we also best-effort
 * extract it from a raw Casper TransactionV1/Deploy JSON.
 */

export type IntentKind =
  | "cep18_transfer"
  | "cep18_approve"
  | "native_transfer"
  | "contract_call";

export interface TxIntent {
  kind: IntentKind;
  /** CEP-18 / target contract package hash (64 hex). */
  contractPackage?: string;
  entryPoint?: string;
  args?: {
    recipient?: string;
    spender?: string;
    amount?: string;
    to?: string;
  };
  /** Native CSPR amount in motes (native_transfer). */
  amountMotes?: string;
  /** Generic contract-call target package (alias of contractPackage). */
  targetPackage?: string;
}

const U256_MAX =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

/** True when an amount string is the CEP-18 U256-max "unlimited" sentinel. */
export function isUnlimitedAmount(amount: string | undefined): boolean {
  if (!amount) return false;
  try {
    return BigInt(amount) >= U256_MAX;
  } catch {
    return false;
  }
}

function asString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint") return String(v);
  return undefined;
}

/**
 * Parse the `transaction` field of an analyze request. Accepts:
 *  - a normalized intent object (already shaped), OR a JSON string of one;
 *  - a raw Casper Deploy/TransactionV1 `.toJSON()` (best-effort extraction).
 *
 * Returns null when nothing usable can be derived.
 */
export function parseIntent(transaction: unknown): TxIntent | null {
  let obj: unknown = transaction;
  if (typeof transaction === "string") {
    const trimmed = transaction.trim();
    if (!trimmed) return null;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  // Already a normalized intent envelope.
  if (typeof o.kind === "string") {
    return normalizeIntent(o);
  }

  // Best-effort raw Casper transaction extraction.
  return extractFromRaw(o);
}

function normalizeIntent(o: Record<string, unknown>): TxIntent | null {
  const kind = o.kind as IntentKind;
  if (
    kind !== "cep18_transfer" &&
    kind !== "cep18_approve" &&
    kind !== "native_transfer" &&
    kind !== "contract_call"
  ) {
    return null;
  }
  const rawArgs = (o.args ?? {}) as Record<string, unknown>;
  return {
    kind,
    contractPackage: asString(o.contractPackage),
    entryPoint: asString(o.entryPoint),
    targetPackage: asString(o.targetPackage),
    amountMotes: asString(o.amountMotes),
    args: {
      recipient: asString(rawArgs.recipient),
      spender: asString(rawArgs.spender),
      amount: asString(rawArgs.amount),
      to: asString(rawArgs.to),
    },
  };
}

/**
 * Crude extraction from a raw Casper TransactionV1/Deploy JSON. We pull an
 * entry-point name + a contract package hash + a couple of common args. This
 * is intentionally shallow — the intent envelope is the supported path.
 */
function extractFromRaw(o: Record<string, unknown>): TxIntent | null {
  const session = findFirst(o, ["session", "StoredContractByHash", "Transaction", "body"]);
  const entryPoint =
    deepString(o, ["entry_point", "entryPoint", "entry-point"]) ?? undefined;
  const pkg =
    deepString(o, [
      "package_hash",
      "contract_package_hash",
      "contractPackageHash",
      "package",
    ]) ?? undefined;
  const recipient = deepString(o, ["recipient"]) ?? undefined;
  const spender = deepString(o, ["spender"]) ?? undefined;
  const amount = deepString(o, ["amount"]) ?? undefined;

  void session;

  let kind: IntentKind = "contract_call";
  if (entryPoint === "transfer" || entryPoint === "transfer_from") {
    kind = "cep18_transfer";
  } else if (entryPoint === "approve" || entryPoint === "increase_allowance") {
    kind = "cep18_approve";
  } else if (!entryPoint && (recipient || amount)) {
    kind = "native_transfer";
  }

  if (!entryPoint && !pkg && !recipient && !amount) return null;

  return {
    kind,
    contractPackage: pkg ? stripHashPrefix(pkg) : undefined,
    targetPackage: pkg ? stripHashPrefix(pkg) : undefined,
    entryPoint,
    amountMotes: kind === "native_transfer" ? amount : undefined,
    args: { recipient, spender, amount, to: recipient },
  };
}

function stripHashPrefix(s: string): string {
  return s.replace(/^(contract-package-wasm|contract-package-|hash-|0x)/i, "");
}

/** Find the first present key (shallow). */
function findFirst(o: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in o) return o[k];
  return undefined;
}

/** Recursively search for the first string value under any of the given keys. */
function deepString(
  value: unknown,
  keys: string[],
  depth = 0,
): string | null {
  if (depth > 6 || value == null) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const r = deepString(item, keys, depth + 1);
      if (r != null) return r;
    }
    return null;
  }
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of keys) {
      const v = o[k];
      const s = asString(v);
      if (s != null) return s;
    }
    for (const v of Object.values(o)) {
      const r = deepString(v, keys, depth + 1);
      if (r != null) return r;
    }
  }
  return null;
}
