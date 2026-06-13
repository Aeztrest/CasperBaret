import { describe, it, expect } from "vitest";
import { analyzeTransaction } from "./analyze.js";
import { BALANCED_POLICY, STRICT_POLICY } from "@casper-baret/casper-guard";

const USER = "a".repeat(64);
const SAFE_PKG = "1".repeat(64);
const RISKY_PKG = "9".repeat(64);
const SPENDER = "b".repeat(64);
const U256_MAX =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

describe("analyzeTransaction", () => {
  it("marks a plain cep18_transfer safe", () => {
    const res = analyzeTransaction({
      network: "testnet",
      userWallet: USER,
      policy: BALANCED_POLICY,
      knownSafePackages: new Set([SAFE_PKG]),
      transaction: {
        kind: "cep18_transfer",
        contractPackage: SAFE_PKG,
        entryPoint: "transfer",
        args: { recipient: "c".repeat(64), amount: "1000" },
      },
    });
    expect(res.safe).toBe(true);
    expect(res.reasons).toHaveLength(0);
    expect(res.estimatedChanges.tokens).toHaveLength(1);
  });

  it("blocks an unlimited cep18_approve with CEP18_ALLOWANCE_UNLIMITED", () => {
    const res = analyzeTransaction({
      network: "testnet",
      userWallet: USER,
      policy: BALANCED_POLICY,
      transaction: {
        kind: "cep18_approve",
        contractPackage: SAFE_PKG,
        entryPoint: "approve",
        args: { spender: SPENDER, amount: U256_MAX },
      },
    });
    expect(res.safe).toBe(false);
    const codes = res.riskFindings.map((f) => f.code);
    expect(codes).toContain("CEP18_ALLOWANCE_UNLIMITED");
    expect(res.estimatedChanges.allowances[0]?.unlimited).toBe(true);
    expect(res.reasons.some((r) => r.includes("CEP18_ALLOWANCE_UNLIMITED"))).toBe(
      true,
    );
  });

  it("blocks a transfer to a risky contract package", () => {
    const res = analyzeTransaction({
      network: "testnet",
      userWallet: USER,
      policy: STRICT_POLICY,
      riskyPackages: new Set([RISKY_PKG]),
      transaction: {
        kind: "cep18_transfer",
        contractPackage: RISKY_PKG,
        entryPoint: "transfer",
        args: { recipient: "c".repeat(64), amount: "1000" },
      },
    });
    expect(res.safe).toBe(false);
    expect(res.riskFindings.map((f) => f.code)).toContain(
      "RISKY_CONTRACT_PACKAGE",
    );
  });

  it("accepts a JSON string intent envelope", () => {
    const res = analyzeTransaction({
      network: "testnet",
      userWallet: USER,
      policy: BALANCED_POLICY,
      knownSafePackages: new Set([SAFE_PKG]),
      transaction: JSON.stringify({
        kind: "cep18_transfer",
        contractPackage: SAFE_PKG,
        entryPoint: "transfer",
        args: { recipient: "c".repeat(64), amount: "1000" },
      }),
    });
    expect(res.safe).toBe(true);
    expect(res.meta?.confidence).toBe("medium");
  });
});
