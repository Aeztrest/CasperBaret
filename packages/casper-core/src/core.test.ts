import { describe, it, expect } from "vitest";
import {
  uiToAtomic,
  atomicToUi,
  formatAtomic,
  csprToMotes,
  motesToCspr,
} from "./units.js";
import {
  toX402Address,
  toAccountHashHex,
  toAccountHashKey,
  isAccountHash,
  isX402Address,
  isPublicKeyHex,
  shortAddress,
} from "./address.js";
import { generateKeypair, keypairFromHex, signEip712Digest, signRaw, privateKeyHex } from "./keys.js";
import {
  buildTransferAuthorization,
  createX402Payment,
  encodePaymentHeader,
  decodePaymentHeader,
  verifyX402Signature,
  type CasperPaymentRequirements,
  type X402PaymentPayload,
} from "./x402.js";

describe("units", () => {
  it("converts CSPR ↔ motes", () => {
    expect(csprToMotes(1)).toBe("1000000000");
    expect(csprToMotes("2.5")).toBe("2500000000");
    expect(motesToCspr("1000000000")).toBe(1);
  });
  it("round-trips token atomics with decimals", () => {
    expect(uiToAtomic("1.234567", 6)).toBe("1234567");
    expect(atomicToUi("1234567", 6)).toBeCloseTo(1.234567, 6);
  });
  it("formats without float error", () => {
    expect(formatAtomic("1234567890", 9, 4)).toBe("1.2345");
    expect(formatAtomic("-5000000000", 9, 2)).toBe("-5.00");
  });
  it("rejects garbage", () => {
    expect(() => uiToAtomic("abc")).toThrow();
  });
});

describe("address", () => {
  const acct = "a".repeat(64);
  it("derives the x402 wire address", () => {
    expect(toX402Address(acct)).toBe("00" + acct);
    expect(toX402Address("00" + acct)).toBe("00" + acct);
    expect(isX402Address("00" + acct)).toBe(true);
    expect(isX402Address(acct)).toBe(false);
  });
  it("extracts bare account hash", () => {
    expect(toAccountHashHex("00" + acct)).toBe(acct);
    expect(toAccountHashHex("account-hash-" + acct)).toBe(acct);
    expect(toAccountHashKey(acct)).toBe("account-hash-" + acct);
  });
  it("validates account/pubkey forms", () => {
    expect(isAccountHash(acct)).toBe(true);
    expect(isPublicKeyHex("01" + "b".repeat(64))).toBe(true);
    expect(isPublicKeyHex("02" + "c".repeat(66))).toBe(true);
    expect(isPublicKeyHex(acct)).toBe(false);
  });
  it("short form", () => {
    expect(shortAddress("0x" + acct)).toBe("aaaa…aaaa");
  });
});

describe("keys", () => {
  it("generates an ed25519 keypair with correct formats", async () => {
    const kp = await generateKeypair("ed25519");
    expect(kp.publicKeyHex).toMatch(/^01[0-9a-f]{64}$/i);
    expect(kp.accountHashHex).toMatch(/^[0-9a-f]{64}$/i);
    expect(kp.x402Address).toBe("00" + kp.accountHashHex);
  });
  it("signs a 32-byte digest into a 65-byte algo-prefixed hex", async () => {
    const kp = await generateKeypair("ed25519");
    const digest = new Uint8Array(32).fill(9);
    const sig = await signEip712Digest(kp, digest);
    expect(sig).toMatch(/^[0-9a-f]{130}$/i); // 65 bytes
    expect(sig.slice(0, 2)).toBe("01"); // ed25519 algo byte
  });
  it("round-trips via hex", async () => {
    const kp = await generateKeypair("ed25519");
    const hex = privateKeyHex(kp);
    const kp2 = await keypairFromHex(hex, "ed25519");
    expect(kp2.publicKeyHex).toBe(kp.publicKeyHex);
  });
});

describe("x402 EIP-712", () => {
  const req: CasperPaymentRequirements = {
    scheme: "exact",
    network: "casper:casper-test",
    asset: "f".repeat(64),
    amount: "10000",
    payTo: "00" + "b".repeat(64),
    maxTimeoutSeconds: 60,
    extra: { name: "Cep18x402", version: "1" },
  };
  const fromAccount = "00" + "a".repeat(64);
  const fixed = { nowSeconds: 1_700_000_000, nonceHex: "c".repeat(64) };

  it("produces a deterministic 32-byte digest for fixed inputs", () => {
    const a = buildTransferAuthorization(req, fromAccount, fixed);
    const b = buildTransferAuthorization(req, fromAccount, fixed);
    expect(a.digest.length).toBe(32);
    expect(Buffer.from(a.digest).toString("hex")).toBe(Buffer.from(b.digest).toString("hex"));
    expect(a.authorization).toEqual({
      from: "00" + "a".repeat(64),
      to: "00" + "b".repeat(64),
      value: "10000",
      validAfter: String(1_700_000_000 - 600),
      validBefore: String(1_700_000_000 + 60),
      nonce: "c".repeat(64),
    });
  });

  it("matches the casper-eip-712 Go reference digest (facilitator parity)", () => {
    // Golden vector cross-checked against casper-ecosystem/casper-eip-712/go
    // (HashTypedData with the same TransferWithAuthorization types + CasperDomainTypes).
    const { digest } = buildTransferAuthorization(req, fromAccount, fixed);
    expect(Buffer.from(digest).toString("hex")).toBe(
      "42acff6d170133ed7bb5c73023048a3b4ab81f55535200634e72c4e5518eb8d3",
    );
  });

  it("changes the digest when the amount changes", () => {
    const a = buildTransferAuthorization(req, fromAccount, fixed);
    const b = buildTransferAuthorization({ ...req, amount: "20000" }, fromAccount, fixed);
    expect(Buffer.from(a.digest).toString("hex")).not.toBe(Buffer.from(b.digest).toString("hex"));
  });

  it("signs into a full payload and round-trips the header", async () => {
    const kp = await generateKeypair("ed25519");
    const payload = await createX402Payment(kp, req, fixed);
    expect(payload.publicKey).toBe(kp.publicKeyHex);
    expect(payload.signature).toMatch(/^[0-9a-f]{130}$/i);
    expect(payload.authorization.from).toBe(kp.x402Address);

    const header = encodePaymentHeader(payload, req);
    const decoded = decodePaymentHeader(header);
    expect(decoded.x402Version).toBe(2);
    expect(decoded.payload.signature).toBe(payload.signature);
    expect(decoded.accepted.amount).toBe("10000");
  });

  it("requires a token name for the domain", () => {
    expect(() =>
      buildTransferAuthorization({ ...req, extra: {} }, fromAccount, fixed),
    ).toThrow(/name/);
  });
});

describe("x402 signature verification", () => {
  const req: CasperPaymentRequirements = {
    scheme: "exact",
    network: "casper:casper-test",
    asset: "f".repeat(64),
    amount: "10000",
    payTo: "00" + "b".repeat(64),
    maxTimeoutSeconds: 60,
    extra: { name: "Cep18x402", version: "1" },
  };

  it("accepts a correctly signed payment", async () => {
    const kp = await generateKeypair("ed25519");
    const payload = await createX402Payment(kp, req);
    const wire: X402PaymentPayload = { x402Version: 2, payload, accepted: req };

    const result = verifyX402Signature(wire, req);

    expect(result.isValid).toBe(true);
    if (result.isValid) expect(result.payer).toBe(kp.x402Address);
  });

  it("rejects a forged payload where the signer's key does not own the claimed from-address", async () => {
    // Attacker signs a real digest with their own key, but writes a victim's
    // account into `from` — a valid signature alone does not prove control
    // of `from` unless the verifier also checks publicKey -> account-hash(from).
    const attacker = await generateKeypair("ed25519");
    const victimFrom = "00" + "d".repeat(64);
    const { digest, authorization } = buildTransferAuthorization(req, victimFrom);
    const signature = await signEip712Digest(attacker, digest);
    const forged: X402PaymentPayload = {
      x402Version: 2,
      payload: { signature, publicKey: attacker.publicKeyHex, authorization },
      accepted: req,
    };

    const result = verifyX402Signature(forged, req);

    expect(result.isValid).toBe(false);
    if (!result.isValid) expect(result.invalidReason).toMatch(/does not match/);
  });

  it("accepts sigScheme casperMessage using the confirmed Casper Wallet format", async () => {
    // Confirmed against two live payments from the official Casper Wallet
    // (secp256k1, 2026-07-05): it signs `"Casper Message:\n" + hex(digest)`
    // as ASCII bytes — the same domain-separation convention as Ethereum's
    // personal_sign. This does NOT verify on-chain (transfer_with_authorization
    // only accepts the "raw" scheme); it only supports the off-chain/demo path.
    const kp = await generateKeypair("ed25519");
    const { digest, authorization } = buildTransferAuthorization(req, kp.x402Address);
    const digestHex = Buffer.from(digest).toString("hex");
    const message = Buffer.concat([
      Buffer.from("Casper Message:\n", "utf8"),
      Buffer.from(digestHex, "ascii"),
    ]);
    const rawSig = await signRaw(kp, message); // 64 bytes, no algo tag
    const signature = Buffer.concat([Buffer.from([0x01]), rawSig]).toString("hex"); // ed25519 tag

    const wire: X402PaymentPayload = {
      x402Version: 2,
      payload: { signature, publicKey: kp.publicKeyHex, authorization, sigScheme: "casperMessage" },
      accepted: req,
    };

    const result = verifyX402Signature(wire, req);

    expect(result.isValid).toBe(true);
    if (result.isValid) expect(result.payer).toBe(kp.x402Address);
  });

  it("rejects when authorization.from is tampered with after signing", async () => {
    const kp = await generateKeypair("ed25519");
    const payload = await createX402Payment(kp, req);
    const victimFrom = "00" + "e".repeat(64);
    const tampered: X402PaymentPayload = {
      x402Version: 2,
      payload: { ...payload, authorization: { ...payload.authorization, from: victimFrom } },
      accepted: req,
    };

    const result = verifyX402Signature(tampered, req);

    expect(result.isValid).toBe(false);
  });
});
