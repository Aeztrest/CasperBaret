import { describe, it, expect } from "vitest";
import {
  generateKeypair,
  decodePaymentHeader,
  type CasperPaymentRequirements,
} from "@casper-baret/casper-core";
import { buildX402Header } from "./build";

describe("x402 buyer path (Casper)", () => {
  it("builds an X-PAYMENT header that decodes to a valid exact-scheme payload", async () => {
    const kp = await generateKeypair("ed25519");

    const asset = "a".repeat(64); // CEP-18 contract package hash (64 hex)
    const payTo = "00" + "b".repeat(64); // x402 wire address ("00" + 64 hex)

    const requirements: CasperPaymentRequirements = {
      scheme: "exact",
      network: "casper:casper-test",
      asset,
      amount: "10000",
      payTo,
      maxTimeoutSeconds: 60,
      extra: { name: "Cep18x402", version: "1" },
    };

    const headerValue = await buildX402Header(kp, requirements);
    expect(typeof headerValue).toBe("string");

    const decoded = decodePaymentHeader(headerValue);

    // Signature is a 65-byte Casper sig ([algo byte] + 64 raw) → 130 hex chars.
    expect(decoded.payload.signature).toMatch(/^[0-9a-f]{130}$/i);
    // The accepted requirements are echoed back.
    expect(decoded.accepted.amount).toBe("10000");
    // The authorization's `from` is the payer's x402 wire address.
    expect(decoded.payload.authorization.from).toBe(kp.x402Address);
  });
});
