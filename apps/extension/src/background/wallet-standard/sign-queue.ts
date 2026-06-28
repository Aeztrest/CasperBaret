/**
 * Pending sign-request queue. Lives in the service worker between a dApp
 * request (arrives via the content script) and `tx.sign` (the popup UI's
 * verdict from the user).
 *
 * Casper build: transactions are carried as Casper tx JSON strings, messages
 * as raw bytes (base64), and x402 payments as the serialized
 * CasperPaymentRequirements (JSON).
 */

export type SignKind =
  | "message"
  | "transaction"
  | "transactionAndSend"
  | "x402Payment"
  | "connect"
  // EVM (Monad) kinds
  | "typedData"
  | "evmTransaction"
  | "evmTransactionAndSend";

export interface SignRequest {
  requestId: string;
  kind: SignKind;
  origin: string;
  /**
   * Base64/JSON payload depending on `kind`:
   *  - transaction / transactionAndSend: Casper transaction JSON string.
   *  - message: base64 raw bytes.
   *  - x402Payment: JSON CasperPaymentRequirements.
   */
  payloadBase64: string;
  /**
   * When set, signs with this sub-key (Stellar-era; no-op on Casper since the
   * sub-key cache always returns null and we fall back to the main key).
   */
  signerPubkey?: string;
  /** Free-form display label rendered in the popup. */
  label?: string;
  resolve: (out: SignSuccess) => void;
  reject: (err: Error) => void;
}

export type SignSuccess =
  | { kind: "transaction"; signedTransaction: string; signerAddress: string }
  | {
      kind: "transactionAndSend";
      signedTransaction: string;
      /** Casper deploy/tx hash (hex). */
      signature: string;
      signerAddress: string;
    }
  | {
      /** x402 payment: the encoded X-PAYMENT header value. */
      kind: "x402Payment";
      headerValue: string;
      signerAddress: string;
    }
  | { kind: "message"; signedMessage: string; signerAddress: string }
  | { kind: "connect"; rememberOrigin: boolean }
  // EVM (Monad) results
  | { kind: "typedData"; signature: string; signerAddress: string }
  | { kind: "evmTransaction"; signedTransaction: string; signerAddress: string }
  | { kind: "evmTransactionAndSend"; txHash: string; signerAddress: string };

const queue = new Map<string, SignRequest>();

export function enqueue(req: SignRequest): void {
  queue.set(req.requestId, req);
}

export function take(requestId: string): SignRequest | undefined {
  const r = queue.get(requestId);
  if (r) queue.delete(requestId);
  return r;
}

export function peek(requestId: string): SignRequest | undefined {
  return queue.get(requestId);
}

export function size(): number {
  return queue.size;
}

export function snapshot(): {
  requestId: string;
  kind: SignKind;
  origin: string;
  payloadBase64: string;
  label?: string;
  signerPubkey?: string;
} | null {
  const first = queue.values().next();
  if (first.done) return null;
  const r = first.value;
  return {
    requestId: r.requestId,
    kind: r.kind,
    origin: r.origin,
    payloadBase64: r.payloadBase64,
    label: r.label,
    signerPubkey: r.signerPubkey,
  };
}

export function newRequestId(): string {
  let s = "";
  for (let i = 0; i < 8; i++)
    s += ((Math.random() * 65536) | 0).toString(16).padStart(4, "0");
  return s;
}
