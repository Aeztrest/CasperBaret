/**
 * Showcase demo transaction builders (Casper build).
 *
 * Each scenario builds a REAL, signable Casper Transaction V1 that calls
 * `transfer`/`approve` on the actually-deployed test-USDC CEP-18 contract
 * (the same package Scrybe's x402 flow and NovaSwap's real swap settle
 * against). Safe scenarios are harmless (zero/small transfers to a fixed
 * demo counterparty — this contract's own CannotTargetSelfUser rule forbids
 * targeting the caller, so it's never "self"); danger scenarios reproduce
 * the common CEP-18 attack primitives the firewall flags — an unlimited
 * approval to a stranger (wallet drainer) or a large transfer redirected to
 * a foreign account — as genuinely signable/sendable transactions, so
 * Baret's Sign Request popup has a real transaction to analyze and the user
 * can actually see the drain blocked (or, without protection, actually
 * happen on testnet).
 *
 * Earlier this built a hand-rolled "intent envelope" JSON that only the
 * risk analyzer understood; wallets (Baret and the official Casper Wallet
 * alike) rejected it as unparseable when the site tried to actually sign it.
 * A real Casper Transaction JSON is both analyzable (the server/extension
 * analyzer best-effort-decodes raw transactions, see
 * apps/server/src/analyze/intent.ts `extractFromRaw`) and signable.
 */

import {
  ContractCallBuilder,
  PublicKey,
  Key,
  Args,
  CLValue,
  NamedArg,
} from "casper-js-sdk";

export type ScenarioId =
  | "novaswap-safe"
  | "novaswap-danger"
  | "pixeldrop-safe"
  | "pixeldrop-danger"
  | "orbityield-safe"
  | "orbityield-warn"
  | "claimhub-safe"
  | "claimhub-danger"
  | "launchpad-safe"
  | "launchpad-danger";

// In production the showcase is on Vercel but the API server is on Render.
const API_BASE =
  (import.meta.env.VITE_SCRYBE_API as string | undefined) ??
  "https://baret-server.onrender.com";

// USDC(test) v2 CEP-18 package hash — same constant deployed in render.yaml /
// vercel.json's CEP18_X402_PACKAGE. /health normally confirms this, but ad
// blockers and privacy extensions are known to block onrender.com fetches
// (ERR_BLOCKED_BY_CLIENT) client-side, so a demo transaction shouldn't hang
// on that round-trip when the value is already a fixed, public constant.
const FALLBACK_USDC_ASSET =
  "d12df5a1cb028c56a7e1169c84fbdd3f98a23860c1029650e72f2873bfd8240d";

let cachedUsdcAsset: Promise<string> | null = null;
function getUsdcAsset(): Promise<string> {
  if (!cachedUsdcAsset) {
    cachedUsdcAsset = fetch(`${API_BASE}/health`)
      .then((r) => r.json())
      .then((body) => {
        const asset = body?.x402?.asset;
        return typeof asset === "string" && asset ? asset : FALLBACK_USDC_ASSET;
      })
      .catch(() => FALLBACK_USDC_ASSET);
  }
  return cachedUsdcAsset;
}

// CEP-18 U256-max "unlimited" sentinel — the wallet-drainer approval amount.
const U256_MAX =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

/* ───────── Account-hash placeholders (64-hex) ─────────
 * Stand-ins for counterparties that don't need to be funded/real accounts —
 * a CEP-18 transfer/approve target just needs a well-shaped account-hash.
 */
const ATTACKER_ACCOUNT =
  "abababababababababababababababababababababababababababababababab";
const UNKNOWN_POOL =
  "3333333333333333333333333333333333333333333333333333333333333333";
const UNKNOWN_LAUNCH =
  "4444444444444444444444444444444444444444444444444444444444444444";
// This CEP-18 contract's own business rule (odra-modules CannotTargetSelfUser,
// error 60003) rejects any transfer/approve that targets the caller's own
// account — every "safe" scenario needs a distinct counterparty, never "self".
const FRIENDLY_SPENDER =
  "6666666666666666666666666666666666666666666666666666666666666666";

export interface BuiltScenario {
  /** JSON-stringified real Casper Transaction V1, ready to sign + send. */
  transactionXdr: string;
  /** Short human description rendered in the result overlay. */
  label: string;
}

interface ScenarioSpec {
  entryPoint: "transfer" | "approve";
  target: string;
  amount: bigint;
  label: string;
}

const SCENARIOS: Record<ScenarioId, ScenarioSpec> = {
  "novaswap-safe": {
    entryPoint: "transfer", target: FRIENDLY_SPENDER, amount: 0n,
    label: "NovaSwap: zero-value USDC(test) transfer (safe demo)",
  },
  "novaswap-danger": {
    entryPoint: "transfer", target: ATTACKER_ACCOUNT, amount: 50_000_000_000n,
    label: "NovaSwap: 50,000 USDC(test) transfer to a stranger account (drain)",
  },
  "pixeldrop-safe": {
    entryPoint: "transfer", target: FRIENDLY_SPENDER, amount: 0n,
    label: "PixelDrop: zero-value USDC(test) transfer (mint, safe demo)",
  },
  "pixeldrop-danger": {
    entryPoint: "approve", target: ATTACKER_ACCOUNT, amount: U256_MAX,
    label: "PixelDrop: unlimited USDC(test) approve to a stranger (wallet drainer)",
  },
  "orbityield-safe": {
    entryPoint: "transfer", target: FRIENDLY_SPENDER, amount: 1_000_000n,
    label: "OrbitYield: 1 USDC(test) transfer (deposit, safe demo)",
  },
  "orbityield-warn": {
    entryPoint: "transfer", target: UNKNOWN_POOL, amount: 100_000_000n,
    label: "OrbitYield: 100 USDC(test) transfer into an unverified pool account",
  },
  "claimhub-safe": {
    entryPoint: "transfer", target: FRIENDLY_SPENDER, amount: 0n,
    label: "ClaimHub: zero-value USDC(test) transfer (claim, safe demo)",
  },
  "claimhub-danger": {
    entryPoint: "approve", target: ATTACKER_ACCOUNT, amount: U256_MAX,
    label: "ClaimHub: unlimited USDC(test) approval to an attacker (phishing claim)",
  },
  "launchpad-safe": {
    entryPoint: "transfer", target: FRIENDLY_SPENDER, amount: 5_000_000n,
    label: "LaunchPad: 5 USDC(test) contribution to a vetted token launch",
  },
  "launchpad-danger": {
    entryPoint: "approve", target: UNKNOWN_LAUNCH, amount: U256_MAX,
    label: "LaunchPad: unlimited USDC(test) approve to an unverified launch contract",
  },
};

/**
 * Build the real, signable Casper Transaction for a given scenario, as a
 * CEP-18 `transfer`/`approve` call against the deployed test-USDC contract.
 * `userPublicKey` is the connected wallet's algo-prefixed public key hex,
 * used as the transaction's initiator.
 */
export async function buildScenario(
  scenario: ScenarioId,
  userPublicKey: string,
): Promise<BuiltScenario> {
  const spec = SCENARIOS[scenario];
  const usdcAsset = await getUsdcAsset();
  const from = PublicKey.fromHex(userPublicKey);
  const targetKey = CLValue.newCLKey(
    Key.newKey(`account-hash-${spec.target}`),
  );

  const namedArgs =
    spec.entryPoint === "transfer"
      ? [
          new NamedArg("recipient", targetKey),
          new NamedArg("amount", CLValue.newCLUInt256(spec.amount)),
        ]
      : [
          new NamedArg("spender", targetKey),
          new NamedArg("amount", CLValue.newCLUInt256(spec.amount)),
        ];

  const txn = new ContractCallBuilder()
    .from(from)
    .byPackageHash(usdcAsset)
    .entryPoint(spec.entryPoint)
    .runtimeArgs(Args.fromNamedArgs(namedArgs))
    .chainName("casper-test")
    .payment(5_000_000_000)
    .build();

  return { transactionXdr: JSON.stringify(txn.toJSON()), label: spec.label };
}
