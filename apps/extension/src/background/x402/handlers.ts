/**
 * x402 review handler — runs when the inpage interceptor catches a 402
 * response (or a dApp calls `window.baret.payX402`) and asks Baret whether to
 * pay.
 *
 * Pipeline (Casper build):
 *   1. Validate CasperPaymentRequirements (scheme exact, network casper:*,
 *      asset = CEP-18 package hash, payTo account hash, amount > 0).
 *   2. Network matches the wallet's active network.
 *   3. Asset / merchant / facilitator allowlists.
 *   4. Look up / auto-create allowance for (origin, asset).
 *   5. Apply caps (per-tx, hourly, daily).
 *   6. Sign the EIP-712 TransferWithAuthorization → X-PAYMENT header.
 *      Under-cap micropayments auto-approve in the background; Strict mode
 *      surfaces a popup confirmation.
 *   7. Increment the allowance ledger.
 */

import browser from "webextension-polyfill";
import type { GuardPolicy } from "@casper-baret/casper-guard";
import { BALANCED_POLICY } from "@casper-baret/casper-guard";
import { shortAddress, type CasperPaymentRequirements } from "@casper-baret/casper-core";

import { useAuthority, isUnlocked } from "../crypto/session";
import { getSnapshot, dispatch } from "../state/store";
import {
  enqueue,
  newRequestId,
  type SignSuccess,
} from "../wallet-standard/sign-queue";
import {
  makeAllowanceId,
  readAllowance,
  recordHit,
  writeAllowance,
  type AllowanceRow,
} from "../db/allowances";
import {
  atomicToUi,
  validateRequirements,
} from "./parse";
import { buildX402Header } from "./build";
import { appendHistory } from "../db/history";

const POLICY_STORAGE_KEY = "baret.policy.v1";

interface ReviewRequest {
  origin: string;
  requestUrl?: string;
  requirements: CasperPaymentRequirements;
}

interface ApprovedDecision {
  action: "approve";
  headerValue: string;
}
interface DeclinedDecision {
  action: "decline";
  reason: string;
}
type Decision = ApprovedDecision | DeclinedDecision;

export async function x402Review(rawReq: unknown): Promise<Decision> {
  const { origin, requirements } = rawReq as ReviewRequest;

  if (!isUnlocked())
    return { action: "decline", reason: "Baret wallet is locked." };

  // 1. Spec validation.
  const v = validateRequirements(requirements);
  if (!v.ok)
    return {
      action: "decline",
      reason: `Invalid PaymentRequirements: ${v.reason}`,
    };
  const network = v.network!;

  // 2. Network match.
  const snap = getSnapshot();
  if (snap.network !== network) {
    return {
      action: "decline",
      reason: `dApp asks for ${network}; wallet on ${snap.network}.`,
    };
  }

  // 3. Policy + allowlists.
  const policy = await loadPolicy();
  if (
    policy.allowedAssets &&
    policy.allowedAssets.length > 0 &&
    !policy.allowedAssets.includes(requirements.asset)
  ) {
    return {
      action: "decline",
      reason: `Asset ${requirements.asset} not on your trusted-assets list.`,
    };
  }
  if (policy.blockedMerchantOrigins?.includes(origin)) {
    return {
      action: "decline",
      reason: `${origin} is on your blocked-merchants list.`,
    };
  }
  if (
    policy.allowedMerchantOrigins &&
    policy.allowedMerchantOrigins.length > 0 &&
    !policy.allowedMerchantOrigins.includes(origin)
  ) {
    return {
      action: "decline",
      reason: `${origin} not on your allowed-merchants list.`,
    };
  }
  const facilitator =
    (requirements.extra.sponsorBy as string | undefined) ??
    (requirements.extra.feePayer as string | undefined) ??
    "";
  if (
    policy.allowedFacilitators &&
    policy.allowedFacilitators.length > 0 &&
    facilitator &&
    !policy.allowedFacilitators.includes(facilitator)
  ) {
    return {
      action: "decline",
      reason: `Facilitator ${facilitator} not trusted.`,
    };
  }

  // 4. Allowance lookup / auto-create.
  const allowanceId = makeAllowanceId(origin, requirements.asset);
  let allowance = await readAllowance(allowanceId);
  if (!allowance) {
    allowance = await createDefaultAllowance(
      origin,
      requirements.asset,
      snap.authorityAddress ?? "",
      policy,
    );
  }
  if (allowance.status === "revoked") {
    return {
      action: "decline",
      reason: `${origin} has been revoked from your wallet.`,
    };
  }
  if (allowance.status === "paused") {
    return {
      action: "decline",
      reason: `${origin} is paused. Resume from Allowances to continue.`,
    };
  }

  // 5. Apply caps. Use the asset's own decimals when the requirements say
  // so — assuming 9 for everything (the old behavior) silently
  // under-reports any token with fewer decimals (e.g. our 6-decimal
  // USDC(test): a real 500-unit payment would compute as "0.5", sliding
  // under a 1.0 per-tx cap meant to catch exactly this).
  const decimals = typeof requirements.extra.decimals === "number" ? requirements.extra.decimals : 9;
  const amountUi = atomicToUi(requirements.amount, decimals);
  if (policy.maxX402PerTx !== undefined && amountUi > policy.maxX402PerTx) {
    return {
      action: "decline",
      reason: `Payment ${amountUi.toFixed(6)} exceeds your per-tx cap of ${policy.maxX402PerTx}.`,
    };
  }

  const HOUR = 60 * 60_000;
  const DAY = 24 * HOUR;
  const now = Date.now();
  const projHour =
    (now - allowance.spentHourTs > HOUR ? 0 : allowance.spentHour) + amountUi;
  const projDay =
    (now - allowance.spentDayTs > DAY ? 0 : allowance.spentDay) + amountUi;

  if (allowance.capPerHour > 0 && projHour > allowance.capPerHour) {
    return {
      action: "decline",
      reason: `${origin}: would exceed ${allowance.capPerHour} hourly cap (${projHour.toFixed(6)}).`,
    };
  }
  if (allowance.capPerDay > 0 && projDay > allowance.capPerDay) {
    return {
      action: "decline",
      reason: `${origin}: would exceed ${allowance.capPerDay} daily cap (${projDay.toFixed(6)}).`,
    };
  }

  // 6. Sign. Everything above already enforced the user's policy + caps + the
  // per-merchant allowance, so by default we AUTO-APPROVE in the background —
  // micropayments settle without a popup, the caps are the firewall. Set
  // `x402AutoApprove: false` (Strict) to confirm each payment.
  const payTo = shortAddress(requirements.payTo);
  let headerValue: string;
  if (policy.x402AutoApprove !== false) {
    try {
      const kp = await useAuthority();
      headerValue = await buildX402Header(kp, requirements);
    } catch (err) {
      return {
        action: "decline",
        reason: `Auto-approval failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    await appendHistory({
      type: "x402",
      signature: null,
      origin,
      summary: `Auto-paid x402 · ${amountUi.toFixed(6)} → ${payTo}`,
      decision: "allow",
      reasons: ["Within policy caps — auto-approved"],
      broadcast: false,
      createdAt: Date.now(),
    });
  } else {
    // Strict / opt-out: surface the payment in the popup; the wallet signs the
    // EIP-712 digest on approval.
    const label = `x402 payment · ${amountUi.toFixed(6)} → ${payTo}`;
    const result = await enqueueAndWait(origin, requirements, label);
    if (result.kind !== "x402Payment" || !result.headerValue) {
      return {
        action: "decline",
        reason: "Sign request did not return a signed payment.",
      };
    }
    headerValue = result.headerValue;
  }

  // 7. Increment allowance ledger (optimistic).
  await recordHit(allowanceId, amountUi);

  return { action: "approve", headerValue };
}

/* ────────────── Helpers ────────────── */

function enqueueAndWait(
  origin: string,
  requirements: CasperPaymentRequirements,
  label: string,
): Promise<SignSuccess> {
  return new Promise<SignSuccess>((resolve, reject) => {
    const requestId = newRequestId();
    enqueue({
      requestId,
      kind: "x402Payment",
      origin,
      payloadBase64: JSON.stringify(requirements),
      label,
      resolve,
      reject,
    });
    dispatch({ type: "sign.start" });
  });
}

export async function loadPolicy(): Promise<GuardPolicy> {
  const all = await browser.storage.local.get(POLICY_STORAGE_KEY);
  return (all[POLICY_STORAGE_KEY] as GuardPolicy | undefined) ?? BALANCED_POLICY;
}

export async function createDefaultAllowance(
  origin: string,
  asset: string,
  subKeyPubkey: string,
  policy: GuardPolicy,
): Promise<AllowanceRow> {
  const now = Date.now();
  const row: AllowanceRow = {
    id: makeAllowanceId(origin, asset),
    merchantOrigin: origin,
    asset,
    capPerTx: policy.maxX402PerTx ?? 1.0,
    capPerHour: policy.x402HourlyCap ?? 5.0,
    capPerDay: policy.x402DailyCap ?? 25.0,
    spentTx: 0,
    spentHour: 0,
    spentHourTs: now,
    spentDay: 0,
    spentDayTs: now,
    hits: 0,
    lastHitAt: null,
    expiresAt: null,
    status: "active",
    subKeyPubkey,
    createdAt: now,
    updatedAt: now,
  };
  await writeAllowance(row);
  return row;
}
