/**
 * x402-Casper payment client (showcase side).
 *
 * Casper x402 is EIP-712 `TransferWithAuthorization` over a CEP-18 token —
 * no trustlines, no auth-entry juggling. The flow is:
 *   1. GET the resource; the merchant answers HTTP 402 with
 *      `{ x402Version, accepts: [CasperPaymentRequirements] }`.
 *   2. Hand `accepts[0]` to `window.baret.payX402(req)`. The wallet runs its
 *      x402 firewall (policy caps, anomaly checks) and returns an X-PAYMENT
 *      header value — auto-approved for micropayments under caps, otherwise a
 *      popup.
 *   3. Retry the GET with `X-PAYMENT: <headerValue>`; the merchant verifies +
 *      settles through the facilitator and returns the answer.
 *
 * The payment itself never touches this page — the wallet builds, signs and
 * encodes it. We only pass requirements in and replay the header out.
 */

import type { CasperPaymentRequirements } from "@casper-baret/casper-core";

export type { CasperPaymentRequirements };

/** Re-export under the historic name the Scrybe page imports. */
export type PaymentRequirements = CasperPaymentRequirements;

/**
 * Ask the wallet to authorize an x402 payment for `requirements` and return
 * the X-PAYMENT header value to replay on the retried request.
 */
export async function createX402PaymentHeader(
  payX402: (requirements: unknown) => Promise<{ headerValue: string }>,
  requirements: CasperPaymentRequirements,
): Promise<string> {
  const { headerValue } = await payX402(requirements);
  if (!headerValue) {
    throw new Error("Wallet did not return an X-PAYMENT header value.");
  }
  return headerValue;
}
