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
import { generateKeypair, keypairFromHex, signEip712Digest, privateKeyHex } from "./keys.js";
import {
  buildTransferAuthorization,
  createX402Payment,
  encodePaymentHeader,
  decodePaymentHeader,
  type CasperPaymentRequirements,
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
