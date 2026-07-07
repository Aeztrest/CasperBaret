# Baret (Casper) — Limitations

What this system does **not** guarantee, and how to interpret its results.
This describes the current Casper implementation only — see
`ARCHITECTURE.md` for how the pieces fit together.

## Pre-sign analysis

- `/v1/analyze` decodes and risk-scores a transaction **before** it's signed
  or broadcast. It does not simulate execution against live network state the
  way an RPC dry-run would; the analysis is based on decoded intent (contracts
  touched, balances implied) rather than a guaranteed post-state. Treat a
  "safe" verdict as "nothing we check for was found," not as a formal
  execution guarantee.
- Detectors only catch what they're built to catch. A genuinely novel
  contract-level attack that doesn't match any existing heuristic will not be
  flagged.

## The policy engine only enforces part of what it can express

`packages/casper-guard/src/policy.ts` declares a fairly large `GuardPolicy`
type — pre-sign rules, x402 spend caps, allowance/authorization rules, and
behavioral/monitoring rules. **Only some of these fields are actually wired
up to a check.** The rest are declared for a future version and currently
have no effect if set.

Actually enforced today:

| Field | Enforced where |
|---|---|
| `maxLossPercent` | Server (`detectors.ts`) — flags a transfer as too large relative to this cap. |
| `refuseUnlimitedAllowances` | Server (`detectors.ts`) — flags a CEP-18 approval for the max-uint sentinel. |
| `blockRiskyContracts`, `blockUnknownContractExposure` | Server (`policy-eval.ts`) — checks the touched contract package against reputation lists. |
| `blockCep18AllowanceGrants` | Server (`policy-eval.ts`) — flags any new approval at all, regardless of amount. |
| `allowWarnings` | Server (`policy-eval.ts`) — whether medium-severity findings alone block, or only high/critical ones do. |
| `x402AutoApprove` | Extension (`x402/handlers.ts`) — whether an in-cap x402 payment signs silently or needs a popup tap. |
| `maxX402PerTx` | Extension — payments over this amount are routed to a popup for an explicit one-time override rather than silently blocked or silently allowed. |
| `x402HourlyCap`, `x402DailyCap` | Extension, per merchant — rolling spend caps backed by the allowance ledger. |
| `allowedAssets`, `allowedMerchantOrigins`, `blockedMerchantOrigins`, `allowedFacilitators` | Extension — allow/deny lists checked before an x402 payment signs. |

Declared on the type but **not currently evaluated anywhere**:
`minPostTokenBalance`, `minPostAsset`, `blockAssociatedKeyChanges`,
`blockThresholdWeakening`, `requireSuccessfulSimulation`, `maxTtlSeconds`,
`maxGasMotes`, `maxPaymentMotes`, `requireFacilitatorSupportedCheck`,
`blockAmountAnomalies`, `anomalyStdDev`, `autoRevokeAfterIdleDays`,
`autoPauseOnDailyCapHit`, `maxActiveAllowances`, `driftAlerts`,
`verifyOrphanAlerts`, `noDeliveryAlerts`, `refuseInAlertState`. Setting any
of these in a policy is silently accepted and silently ignored.

## x402 signature verification

- The built-in facilitator's `/facilitate/verify` independently reconstructs
  the EIP-712 digest and requires the declared `publicKey` to hash to the
  claimed `authorization.from` — a bare "signature verifies" is not treated
  as proof of payer identity by itself.
- Two signature schemes are supported: `"raw"` (a wallet that signs the
  32-byte digest directly, like Baret's own extension) and `"casperMessage"`
  (a wallet that only exposes `signMessage(string)`, like the official
  Casper Wallet — which signs `"Casper Message:\n" + hex(digest)` as ASCII
  bytes). Both are confirmed working end to end against live testnet
  payments, including on-chain settlement (the deployed `Cep18x402` contract
  verifies both schemes itself, not just the off-chain facilitator).

## x402 settlement

- Settlement calls `transfer_with_authorization` on the deployed `Cep18x402`
  contract, passing `sig_scheme` explicitly; the contract reconstructs the
  matching message bytes before verifying, so both wallet types settle for
  real. A payer with insufficient CEP-18 balance reverts on-chain
  (`InsufficientBalance`, surfaced as a 502 from `/facilitate/settle`) rather
  than silently succeeding.
- On-chain replay protection is per `(from, nonce)`; the caller (whoever pays
  gas to submit `transfer_with_authorization`) is unrestricted by the
  contract — anyone can relay a validly-signed authorization. This is
  intentional (meta-transaction pattern: only a genuine signature from
  `from` authorizes the transfer, not who submits it) but means the payer's
  chosen `validBefore` is the only thing preventing indefinite delay before
  someone eventually relays it.

## Signing a transaction the wallet didn't build

Some wallets — the official Casper Wallet extension, notably — don't return
a fully re-serialized signed transaction from their own sign call. Instead
they return just the raw signature over the transaction's hash, and the
caller has to attach it as an approval on the original payload itself. Any
integration that assumes a wallet always hands back a complete signed
document (rather than possibly just a signature to attach) will fail
silently against that wallet — this is exactly the bug that was found and
fixed in the showcase's wallet bridge (`apps/showcase/src/wallet/standard-bridge.ts`)
during this project.

## PaymentGuard (on-chain spending-cap vault)

- `pay(merchant, amount)` may be called by the owner or the single
  owner-designated agent (`set_agent`) — not by arbitrary third parties.
  There is exactly one agent slot; delegating to a second agent overwrites
  the first (no multi-agent support yet).
- Caps are per-merchant, not per-(merchant, asset) or per-origin. A merchant
  address is trusted as a single unit once approved.
- The rolling 24h window resets are based on Casper block time
  (`get_block_time`), not wall-clock time as observed by any particular
  client — expect drift consistent with the network's own clock.

## Contracts generally

- `contracts/wasm/*.wasm` are committed binary build artifacts, not built
  from source at deploy time by any CI in this repo. If you change contract
  source, you must `cargo odra build` and re-commit the resulting `.wasm`
  files yourself, or a stale binary will be deployed.
- Contracts are tested against Odra's MockVM (`cargo odra test` /
  `cargo test` from `contracts/`), not a real Casper node — MockVM semantics
  (e.g. default block time, gas accounting) may not perfectly match testnet
  or mainnet.

## Wallet extension

- Chrome MV3 only; a Firefox build target exists (`pnpm build:firefox`) but
  hasn't been exercised as thoroughly as the Chrome build this session.
- Pre-sign analysis calls out to `apps/server`; if that server is
  unreachable, the popup surfaces this as an offline warning rather than
  silently treating the transaction as safe — check the popup's own state
  rather than assuming a specific fallback behavior.
