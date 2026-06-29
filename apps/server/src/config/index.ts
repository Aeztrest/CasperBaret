/**
 * Baret server config — Casper build.
 *
 * Native unit = motes (1 CSPR = 1e9). Tokens = CEP-18 contract package hashes.
 * x402 settlement runs over a CEP-18 token via a make-software/casper-x402
 * facilitator. Defaults are sourced from `@casper-baret/casper-core` NETWORKS.
 */

import { z } from "zod";
import {
  NETWORKS,
  networkConfig,
  toX402Address,
  isContractPackageHash,
  isAccountHash,
  isX402Address,
  type CasperNetworkId,
  type CasperNetworkConfig,
} from "@casper-baret/casper-core";

const networkSchema = z.enum(["testnet", "mainnet"]);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .default("info"),

  DELTAG_API_KEYS: z.string().optional(),

  CASPER_NETWORK: networkSchema.default("testnet"),
  CASPER_RPC_URL: z.string().url().optional(),

  /** CEP-18 contract package hash (64 hex) used as the x402 settlement asset. */
  CEP18_X402_PACKAGE: z.string().optional(),

  X402_ENABLED: z.string().optional(),
  X402_DEMO_MODE: z.string().optional(),
  X402_FACILITATOR_URL: z.string().url().optional(),
  /** Comma-separated origins allowed via CORS (e.g. https://baret-casper.vercel.app). */
  CORS_ORIGINS: z.string().optional(),
  /** x402 wire addr ("00"+64hex) or bare 64hex account hash — normalized to x402. */
  X402_PAY_TO: z.string().optional(),
  /** Atomic token amount per paywalled request. */
  X402_PRICE_ATOMIC: z.string().default("10000"),
  X402_TOKEN_NAME: z.string().default("Cep18x402"),
  X402_TOKEN_VERSION: z.string().default("1"),

  /** Treasury-backed CSPR faucet (POST /demo/faucet). */
  FAUCET_ENABLED: z.string().optional(),
  /** 64-hex ed25519 private key of the funded treasury account. */
  FAUCET_PRIVATE_KEY: z.string().optional(),
  FAUCET_PRIVATE_KEY_ALGO: z.enum(["ed25519", "secp256k1"]).default("ed25519"),
  /** CSPR sent per successful claim. */
  FAUCET_AMOUNT_CSPR: z.coerce.number().positive().default(1000),
  /** Per-address (and per-IP) cooldown between claims. */
  FAUCET_COOLDOWN_SECONDS: z.coerce.number().int().nonnegative().default(120),

  /** csv of contract package hashes treated as risky. */
  RISKY_CONTRACT_PACKAGES: z.string().optional(),
  /** csv of contract package hashes treated as known-safe. */
  KNOWN_SAFE_CONTRACT_PACKAGES: z.string().optional(),

  MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),
  REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  DELTAG_RATE_LIMIT_MAX: z.coerce.number().int().nonnegative().default(200),
  DELTAG_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60_000),
  /** 1/true: trust X-Forwarded-For (reverse proxy / behind Docker). */
  DELTAG_TRUST_PROXY: z.string().optional(),
});

export type { CasperNetworkId };

export type X402Config = {
  enabled: boolean;
  /** Skip facilitator verify/settle — return a synthetic demo response. */
  demoMode: boolean;
  facilitatorUrl: string;
  /** Normalized x402 wire address ("00"+64hex). */
  payTo: string;
  /** CEP-18 contract package hash (64 hex). */
  asset: string;
  /** CAIP-2 network id, e.g. "casper:casper-test". */
  network: string;
  priceAtomic: string;
  tokenName: string;
  tokenVersion: string;
};

export type FaucetConfig = {
  enabled: boolean;
  /** 64-hex private key of the treasury account (empty when disabled). */
  privateKeyHex: string;
  algo: "ed25519" | "secp256k1";
  amountCspr: number;
  cooldownSeconds: number;
};

export type AppConfig = {
  nodeEnv: "development" | "test" | "production";
  port: number;
  logLevel: z.infer<typeof envSchema>["LOG_LEVEL"];
  apiKeys: string[];
  casper: CasperNetworkConfig;
  x402: X402Config;
  faucet: FaucetConfig;
  riskyContractPackages: Set<string>;
  knownSafeContractPackages: Set<string>;
  maxBodyBytes: number;
  requestTimeoutMs: number;
  /** 0 = rate limiting disabled */
  rateLimitMax: number;
  rateLimitWindowMs: number;
  trustProxy: boolean;
  /** Allowed CORS origins — empty means no CORS headers. */
  corsOrigins: string[];
};

function splitCsv(raw: string | undefined): Set<string> {
  if (!raw?.trim()) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function boolish(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.flatten().fieldErrors;
    throw new Error(`Invalid environment configuration: ${JSON.stringify(msg)}`);
  }
  const e = parsed.data;

  const apiKeys =
    e.DELTAG_API_KEYS?.split(",")
      .map((k) => k.trim())
      .filter(Boolean) ?? [];

  const network: CasperNetworkId = e.CASPER_NETWORK;
  const base = networkConfig(network);
  const casper: CasperNetworkConfig = {
    ...base,
    rpcUrl: e.CASPER_RPC_URL?.trim() || base.rpcUrl,
  };

  const x402Enabled = boolish(e.X402_ENABLED);

  let payTo = "";
  let asset = "";
  if (x402Enabled) {
    const rawPayTo = e.X402_PAY_TO?.trim() ?? "";
    if (!rawPayTo) {
      throw new Error("X402_PAY_TO is required when X402_ENABLED=true");
    }
    if (!isX402Address(rawPayTo) && !isAccountHash(rawPayTo)) {
      throw new Error(
        `X402_PAY_TO must be an x402 address ("00"+64hex) or 64-hex account hash: ${rawPayTo}`,
      );
    }
    payTo = toX402Address(rawPayTo);

    asset = (e.CEP18_X402_PACKAGE ?? "").trim().toLowerCase();
    if (!asset) {
      throw new Error("CEP18_X402_PACKAGE is required when X402_ENABLED=true");
    }
    if (!isContractPackageHash(asset)) {
      throw new Error(
        `CEP18_X402_PACKAGE must be a 64-hex contract package hash: ${asset}`,
      );
    }
  }

  const x402: X402Config = {
    enabled: x402Enabled,
    demoMode: boolish(e.X402_DEMO_MODE),
    facilitatorUrl: e.X402_FACILITATOR_URL?.trim() || "http://localhost:8080/facilitate",
    payTo,
    asset,
    network: casper.caip2,
    priceAtomic: e.X402_PRICE_ATOMIC,
    tokenName: e.X402_TOKEN_NAME,
    tokenVersion: e.X402_TOKEN_VERSION,
  };

  const faucetEnabled = boolish(e.FAUCET_ENABLED);
  let faucetKey = "";
  if (faucetEnabled) {
    faucetKey = (e.FAUCET_PRIVATE_KEY ?? "").trim().toLowerCase().replace(/^0x/, "");
    if (!/^[0-9a-f]{64}$/.test(faucetKey)) {
      throw new Error("FAUCET_PRIVATE_KEY must be a 64-hex private key when FAUCET_ENABLED=true");
    }
  }
  const faucet: FaucetConfig = {
    enabled: faucetEnabled,
    privateKeyHex: faucetKey,
    algo: e.FAUCET_PRIVATE_KEY_ALGO,
    amountCspr: e.FAUCET_AMOUNT_CSPR,
    cooldownSeconds: e.FAUCET_COOLDOWN_SECONDS,
  };

  const corsOrigins = e.CORS_ORIGINS
    ? e.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  return {
    nodeEnv: e.NODE_ENV,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    apiKeys,
    casper,
    x402,
    faucet,
    riskyContractPackages: splitCsv(e.RISKY_CONTRACT_PACKAGES),
    knownSafeContractPackages: splitCsv(e.KNOWN_SAFE_CONTRACT_PACKAGES),
    maxBodyBytes: e.MAX_BODY_BYTES,
    requestTimeoutMs: e.REQUEST_TIMEOUT_MS,
    rateLimitMax: e.DELTAG_RATE_LIMIT_MAX,
    rateLimitWindowMs: e.DELTAG_RATE_LIMIT_WINDOW_MS,
    trustProxy: boolish(e.DELTAG_TRUST_PROXY),
    corsOrigins,
  };
}

export { networkSchema, NETWORKS };
