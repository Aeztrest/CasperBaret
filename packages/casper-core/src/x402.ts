/**
 * Casper x402 client — EIP-712 `TransferWithAuthorization` over CEP-18.
 *
 * Wire-compatible with the official make-software/casper-x402 facilitator:
 *  - typed data:   TransferWithAuthorization{from:address,to:address,
 *                  value:uint256,validAfter:uint256,validBefore:uint256,nonce:bytes32}
 *  - domain:       buildDomain(name, version, caip2Network, contractPackageHash)
 *                  with CASPER_DOMAIN_TYPES
 *  - signature:    65-byte Casper sig ([algo_byte]+64), hex
 *  - payload:      { signature, publicKey, authorization{from,to,value,validAfter,validBefore,nonce} }
 *  - header:       base64(JSON(PaymentPayload{x402Version,payload,accepted}))  → X-PAYMENT
 *  - facilitator:  POST {url}/verify and /settle with {x402Version,paymentPayload,paymentRequirements}
 */

import { hashTypedData, buildDomain, CASPER_DOMAIN_TYPES } from "@casper-ecosystem/casper-eip-712";
import type { CasperKeypair } from "./keys.js";
import { signEip712Digest } from "./keys.js";
import { toX402Address, stripPrefix } from "./address.js";

export const X402_VERSION = 2;
export const PAYMENT_HEADER = "X-PAYMENT";
export const PAYMENT_RESPONSE_HEADER = "X-PAYMENT-RESPONSE";

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};

export interface CasperPaymentRequirements {
  scheme: "exact";
  /** CAIP-2 chain id, e.g. "casper:casper-test". */
  network: string;
  /** CEP-18 contract package hash (64 hex). */
  asset: string;
  /** Atomic token amount (string integer). */
  amount: string;
  /** Payee account (x402 "00"+64hex or bare 64hex account hash). */
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    /** Token name for the EIP-712 domain (required to sign). */
    name?: string;
    /** Token version for the EIP-712 domain (defaults "1"). */
    version?: string;
    /** Facilitator/sponsor account that submits the settlement deploy. */
    feePayer?: string;
    sponsorBy?: string;
    description?: string;
    mimeType?: string;
    [k: string]: unknown;
  };
}

export interface ExactCasperAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface ExactCasperPayload {
  signature: string;
  publicKey: string;
  authorization: ExactCasperAuthorization;
}

export interface X402PaymentPayload {
  x402Version: number;
  payload: ExactCasperPayload;
  accepted: CasperPaymentRequirements;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
  [k: string]: unknown;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  /** Settlement deploy/transaction hash. */
  transaction?: string;
  network?: string;
  amount?: string;
  [k: string]: unknown;
}

function randomNonceHex(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Buffer.from(b).toString("hex");
}

/** Build the EIP-712 digest + authorization fields for a payment. Pure. */
export function buildTransferAuthorization(
  req: CasperPaymentRequirements,
  fromAccount: string,
  opts?: { nowSeconds?: number; nonceHex?: string },
): { digest: Uint8Array; authorization: ExactCasperAuthorization } {
  const name = req.extra.name ?? (req.extra.assetName as string | undefined);
  const version = req.extra.version ?? "1";
  if (!name) throw new Error("payment requirements missing extra.name (token name) for EIP-712 domain");

  const fromX = toX402Address(fromAccount);
  const toX = toX402Address(req.payTo);
  const assetHex = stripPrefix(req.asset).toLowerCase();
  const now = opts?.nowSeconds ?? Math.floor(Date.now() / 1000);
  const validAfter = now - 600;
  const validBefore = now + req.maxTimeoutSeconds;
  const nonceHex = opts?.nonceHex ?? randomNonceHex();

  const domain = buildDomain(name, version, req.network, "0x" + assetHex);

  const message = {
    from: "0x" + fromX,
    to: "0x" + toX,
    value: BigInt(req.amount),
    validAfter: BigInt(validAfter),
    validBefore: BigInt(validBefore),
    nonce: "0x" + nonceHex,
  };

  const digest = hashTypedData(
    domain,
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    "TransferWithAuthorization",
    message,
    { domainTypes: CASPER_DOMAIN_TYPES },
  );

  return {
    digest,
    authorization: {
      from: fromX,
      to: toX,
      value: req.amount,
      validAfter: String(validAfter),
      validBefore: String(validBefore),
      nonce: nonceHex,
    },
  };
}

/** Sign a payment with a keypair, producing the x402 ExactCasperPayload. */
export async function createX402Payment(
  kp: CasperKeypair,
  req: CasperPaymentRequirements,
  opts?: { nowSeconds?: number; nonceHex?: string },
): Promise<ExactCasperPayload> {
  const { digest, authorization } = buildTransferAuthorization(req, kp.x402Address, opts);
  const signature = await signEip712Digest(kp, digest);
  return { signature, publicKey: kp.publicKeyHex, authorization };
}

/** Encode the X-PAYMENT header value (base64 JSON). */
export function encodePaymentHeader(payload: ExactCasperPayload, accepted: CasperPaymentRequirements): string {
  const wire: X402PaymentPayload = { x402Version: X402_VERSION, payload, accepted };
  return Buffer.from(JSON.stringify(wire), "utf8").toString("base64");
}

/** Decode an X-PAYMENT header value. */
export function decodePaymentHeader(headerValue: string): X402PaymentPayload {
  const json = Buffer.from(headerValue, "base64").toString("utf8");
  return JSON.parse(json) as X402PaymentPayload;
}

/* ─────────────── facilitator HTTP client ─────────────── */

async function facilitatorPost<T>(url: string, body: unknown, fetchImpl?: typeof fetch): Promise<T> {
  const f = fetchImpl ?? globalThis.fetch;
  const res = await f(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`facilitator ${url} returned non-JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const reason = (parsed as { invalidReason?: string; errorReason?: string });
    throw new Error(
      `facilitator ${url} HTTP ${res.status}: ${reason.invalidReason ?? reason.errorReason ?? text.slice(0, 200)}`,
    );
  }
  return parsed as T;
}

export function verifyPayment(
  facilitatorUrl: string,
  payload: X402PaymentPayload,
  requirements: CasperPaymentRequirements,
  fetchImpl?: typeof fetch,
): Promise<VerifyResponse> {
  return facilitatorPost<VerifyResponse>(
    `${facilitatorUrl.replace(/\/+$/, "")}/verify`,
    { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements },
    fetchImpl,
  );
}

export function settlePayment(
  facilitatorUrl: string,
  payload: X402PaymentPayload,
  requirements: CasperPaymentRequirements,
  fetchImpl?: typeof fetch,
): Promise<SettleResponse> {
  return facilitatorPost<SettleResponse>(
    `${facilitatorUrl.replace(/\/+$/, "")}/settle`,
    { x402Version: X402_VERSION, paymentPayload: payload, paymentRequirements: requirements },
    fetchImpl,
  );
}

export async function facilitatorSupported(
  facilitatorUrl: string,
  fetchImpl?: typeof fetch,
): Promise<unknown> {
  const f = fetchImpl ?? globalThis.fetch;
  const res = await f(`${facilitatorUrl.replace(/\/+$/, "")}/supported`);
  return res.json();
}
