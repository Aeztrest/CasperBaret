/**
 * Showcase demo transaction builders (Casper build).
 *
 * Each scenario produces a normalized Casper **intent** envelope the Baret
 * analyze server understands. Safe scenarios are benign contract calls or
 * small self/native transfers; danger scenarios reach for the common Casper
 * attack primitives the firewall flags — unlimited CEP-18 approvals
 * (wallet drainers), large CEP-18 / native transfers redirected to a foreign
 * account, and calls into unverified / risky contract packages.
 *
 * The intent envelope (see apps/server/src/analyze/intent.ts):
 *   {
 *     kind: "cep18_transfer" | "cep18_approve" | "native_transfer" | "contract_call",
 *     contractPackage?: <64hex>, targetPackage?: <64hex>,
 *     entryPoint?: string,
 *     args?: { recipient?, spender?, amount?, to? },
 *     amountMotes?: <string>
 *   }
 *
 * The returned `transactionXdr` field carries the JSON-stringified intent (the
 * field name is kept for caller compatibility — callers read `.transactionXdr`
 * and forward it to the analyzer + wallet as the `transaction` payload).
 */

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

// 1 CSPR = 1e9 motes. CEP-18 demo tokens here also use 9 decimals.
const MOTES_PER_CSPR = 1_000_000_000n;
function cspr(n: number | bigint): string {
  return (BigInt(n) * MOTES_PER_CSPR).toString();
}

// CEP-18 U256-max "unlimited" sentinel — the wallet-drainer approval amount.
const U256_MAX =
  "115792089237316195423570985008687907853269984665640564039457584007913129639935";

/* ───────── Contract package hashes (64-hex placeholders) ─────────
 *
 * `KNOWN_SAFE_*` mirrors a package the server may carry in
 * KNOWN_SAFE_CONTRACT_PACKAGES; `RISKY_DRAINER` mirrors a package in
 * RISKY_CONTRACT_PACKAGES. Danger scenarios stay self-consistent even with an
 * empty server reputation set because they ALSO trip allowance / oversized-
 * transfer detectors that always fire under BALANCED_POLICY.
 */
const KNOWN_SAFE_DEX =
  "1111111111111111111111111111111111111111111111111111111111111111";
const KNOWN_SAFE_MINT =
  "2222222222222222222222222222222222222222222222222222222222222222";
const RISKY_DRAINER =
  "deaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeaddeadd";
const UNKNOWN_POOL =
  "3333333333333333333333333333333333333333333333333333333333333333";
const UNKNOWN_LAUNCH =
  "4444444444444444444444444444444444444444444444444444444444444444";
const CLAIM_PACKAGE =
  "5555555555555555555555555555555555555555555555555555555555555555";

// A foreign attacker account-hash (drain destination).
const ATTACKER_ACCOUNT =
  "abababababababababababababababababababababababababababababababab";
// A friendly spender for benign-ish flows.
const FRIENDLY_SPENDER =
  "6666666666666666666666666666666666666666666666666666666666666666";

interface TxIntentEnvelope {
  kind: "cep18_transfer" | "cep18_approve" | "native_transfer" | "contract_call";
  contractPackage?: string;
  targetPackage?: string;
  entryPoint?: string;
  args?: { recipient?: string; spender?: string; amount?: string; to?: string };
  amountMotes?: string;
}

export interface BuiltScenario {
  /** JSON-stringified normalized Casper intent (passed to analyzer + wallet). */
  transactionXdr: string;
  /** Short human description rendered in the RiskPreview hero. */
  label: string;
}

/**
 * Build the candidate intent for a given scenario. `userWallet` is the
 * connected account-hash; it anchors self-transfers and approval owners.
 */
export async function buildScenario(
  scenario: ScenarioId,
  userWallet: string,
): Promise<BuiltScenario> {
  switch (scenario) {
    case "novaswap-safe":
      return finish(
        {
          kind: "contract_call",
          contractPackage: KNOWN_SAFE_DEX,
          targetPackage: KNOWN_SAFE_DEX,
          entryPoint: "swap_exact_in",
          args: { recipient: userWallet, amount: cspr(0) },
        },
        "NovaSwap: swap via a verified, known-safe router",
      );

    case "novaswap-danger":
      // CEP-18 transfer of a large balance redirected to an attacker account,
      // through a risky/unknown package → drain pattern (ESTIMATED_LOSS + risky).
      return finish(
        {
          kind: "cep18_transfer",
          contractPackage: RISKY_DRAINER,
          targetPackage: RISKY_DRAINER,
          entryPoint: "transfer",
          args: { recipient: ATTACKER_ACCOUNT, to: ATTACKER_ACCOUNT, amount: cspr(50_000) },
        },
        "NovaSwap: CEP-18 transfer of your balance to a stranger account (drain)",
      );

    case "pixeldrop-safe":
      // A normal mint contract call (benign, known-safe package).
      return finish(
        {
          kind: "contract_call",
          contractPackage: KNOWN_SAFE_MINT,
          targetPackage: KNOWN_SAFE_MINT,
          entryPoint: "mint",
          args: { recipient: userWallet },
        },
        "PixelDrop: mint call to the verified collection contract",
      );

    case "pixeldrop-danger":
      // Mint flow that smuggles in an UNLIMITED CEP-18 approval → drainer.
      return finish(
        {
          kind: "cep18_approve",
          contractPackage: RISKY_DRAINER,
          targetPackage: RISKY_DRAINER,
          entryPoint: "approve",
          args: { spender: ATTACKER_ACCOUNT, amount: U256_MAX },
        },
        "PixelDrop: unlimited CEP-18 approve to a stranger (wallet drainer)",
      );

    case "orbityield-safe":
      // Deposit into a verified staking pool (small, self-anchored).
      return finish(
        {
          kind: "contract_call",
          contractPackage: KNOWN_SAFE_DEX,
          targetPackage: KNOWN_SAFE_DEX,
          entryPoint: "deposit",
          args: { recipient: userWallet, amount: cspr(1) },
        },
        "OrbitYield: deposit 1 CSPR into a verified pool",
      );

    case "orbityield-warn":
      // Deposit into an UNVERIFIED pool package → trust trap (unknown exposure).
      return finish(
        {
          kind: "contract_call",
          contractPackage: UNKNOWN_POOL,
          targetPackage: UNKNOWN_POOL,
          entryPoint: "deposit",
          args: { recipient: userWallet, amount: cspr(100) },
        },
        "OrbitYield: deposit into an unverified pool contract (trust trap)",
      );

    case "claimhub-safe":
      // Benign airdrop claim from a claim contract.
      return finish(
        {
          kind: "contract_call",
          contractPackage: CLAIM_PACKAGE,
          targetPackage: CLAIM_PACKAGE,
          entryPoint: "claim",
          args: { recipient: userWallet },
        },
        "ClaimHub: claim your airdrop allocation",
      );

    case "claimhub-danger":
      // Unlimited CEP-18 approve to a phishing spender — classic claim phish.
      return finish(
        {
          kind: "cep18_approve",
          contractPackage: RISKY_DRAINER,
          targetPackage: RISKY_DRAINER,
          entryPoint: "approve",
          args: { spender: ATTACKER_ACCOUNT, amount: U256_MAX },
        },
        "ClaimHub: unlimited token approval to an attacker (phishing claim)",
      );

    case "launchpad-safe":
      // Contribute to a vetted launch — known-safe package, modest CEP-18 spend.
      return finish(
        {
          kind: "contract_call",
          contractPackage: KNOWN_SAFE_DEX,
          targetPackage: KNOWN_SAFE_DEX,
          entryPoint: "contribute",
          args: { spender: FRIENDLY_SPENDER, amount: cspr(5) },
        },
        "LaunchPad: contribute to a vetted, verified token launch",
      );

    case "launchpad-danger":
      // Contribute via an unverified launch package that takes an unlimited
      // approval → rug-pull launchpad.
      return finish(
        {
          kind: "cep18_approve",
          contractPackage: UNKNOWN_LAUNCH,
          targetPackage: UNKNOWN_LAUNCH,
          entryPoint: "approve",
          args: { spender: UNKNOWN_LAUNCH, amount: U256_MAX },
        },
        "LaunchPad: unlimited CEP-18 approve to an unverified launch contract",
      );
  }
}

function finish(intent: TxIntentEnvelope, label: string): BuiltScenario {
  return { transactionXdr: JSON.stringify(intent), label };
}
