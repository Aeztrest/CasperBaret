/**
 * Build an x402-Casper exact-scheme payment (EIP-712 TransferWithAuthorization
 * over CEP-18). No Soroban / auth-entry: the payer signs a typed-data digest
 * and the facilitator submits the settlement deploy.
 *
 * `buildX402Header` is the single entry point used by both the policy-driven
 * auto-approve path and the popup confirm path.
 */

import {
  createX402Payment,
  encodePaymentHeader,
  type CasperKeypair,
  type CasperPaymentRequirements,
} from "@casper-baret/casper-core";

/**
 * Sign an x402 payment with the wallet keypair and return the base64
 * `X-PAYMENT` header value the dApp must replay on the retried request.
 */
export async function buildX402Header(
  kp: CasperKeypair,
  requirements: CasperPaymentRequirements,
): Promise<string> {
  const payload = await createX402Payment(kp, requirements);
  return encodePaymentHeader(payload, requirements);
}
