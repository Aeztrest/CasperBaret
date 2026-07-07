# Baret — Architecture

This document describes the actual current system: a Casper wallet-level
firewall plus an x402 agentic-payment stack. For the plain-English version
and the story behind why each piece exists, see `README.md`. For known gaps
and non-guarantees, see `LIMITATIONS.md`.

---

## 1. What this is

Baret sits between a dApp (or an AI agent) and a Casper wallet's signature.
Every transaction is decoded, risk-scored, and policy-checked **before
signing**. For the x402 micropayment protocol, per-merchant spending caps —
enforced client-side, with a matching on-chain vault (`PaymentGuard`) for
funds an owner wants to delegate to an agent — are the actual firewall: an
agent can pay per request autonomously, but never beyond the limits the
owner set.

---

## 2. Monorepo layout

| Path | What it is |
|---|---|
| `packages/casper-core` | Casper chain primitives: keypairs (`keys.ts`), addresses (`address.ts`), units/motes (`units.ts`), an RPC client wrapper (`rpc.ts`), and the x402 EIP-712 client + verifier (`x402.ts`). Wraps `casper-js-sdk` behind a small interop shim (`sdk.ts`) because the SDK's CJS bundle doesn't play well with native ESM. |
| `packages/casper-guard` | Chain-agnostic analyze/policy types and an analyze client (`guard.ts`, `policy.ts`, `analyze.ts`). |
| `packages/ext-protocol` | The message protocol shared between the wallet extension's page-injected provider, content script, and background service worker. |
| `packages/ui` | Shared design tokens and the Baret logo component, used by the extension's popup and options page. |
| `apps/server` | Fastify server: `/v1/analyze` (pre-sign risk analysis), the x402 paywalled demo (`/demo/scrybe`), a built-in x402 facilitator (`/facilitate/{supported,verify,settle}`), a CSPR + test-token faucet, and NovaSwap's real CSPR↔USDC(test) swap settlement. |
| `apps/extension` | Chrome MV3 wallet. Injects `window.baret`; the x402 **buyer** side. |
| `apps/showcase` | Six demo dApps (`apps/showcase/src/sites/*`) each exercising a specific attack scenario, plus the `scrybe` x402 paywall demo. The same six dApps, without the attack-scenario toggles, are also published standalone at [casper-network-dapps](https://github.com/Aeztrest/casper-network-dapps). |
| `contracts` | Odra (Rust) smart contracts: `PaymentGuard` (on-chain spending-cap vault) and `Cep18x402` (CEP-18 token with an EIP-3009-style `transfer_with_authorization`). |

Two packages exist in the repo but aren't currently wired into anything —
`packages/blackthorn-adapter` and `packages/showcase-ui` were scaffolded
early on and never ended up used by `apps/showcase` or `apps/extension`.
They're candidates for removal; nothing in this document depends on them.

---

## 3. Server request lifecycle — `POST /v1/analyze`

Source: `apps/server/src/analyze/analyze.ts`, `detectors.ts`, `intent.ts`,
`policy-eval.ts`.

1. Request body validated (Zod) — transaction payload, target network, policy.
2. Transaction intent decoded (`intent.ts`) into a normalized, human-readable
   summary (what contracts/entry points are touched, what balances move).
   Handles both the modern Transaction V1 wire format and the legacy Deploy
   format some wallets still produce.
3. Risk detectors run over the decoded intent (`detectors.ts`) — large
   transfers relative to the policy's loss cap, unlimited CEP-18 approvals,
   contracts on a risky/unknown-reputation list.
4. Policy engine evaluates the findings against the caller's policy
   (`policy-eval.ts`) and returns a `safe`/`advisory`/`blocked` decision with
   plain-language reasons.

This mirrors the wallet extension's own pre-sign check: the extension calls
this same endpoint before rendering its Sign Request screen, so a third-party
integrator calling `/v1/analyze` directly gets the identical verdict.

Only a subset of the fields declared on `GuardPolicy` are actually evaluated
today — see `LIMITATIONS.md` for exactly which ones.

---

## 4. x402 payment flow

Source: `packages/casper-core/src/x402.ts`, `apps/server/src/api/routes/{scrybe,facilitator,swap}.ts`.

Baret implements the `exact` x402 scheme as `TransferWithAuthorization` — an
EIP-712-typed message (domain: `name`, `version`, `chain_name`,
`contract_package_hash`; message: `from`, `to`, `value`, `validAfter`,
`validBefore`, `nonce`) signed by the payer, wire-compatible with
[`make-software/casper-x402`](https://github.com/make-software/casper-x402).

```
1. Client requests a paywalled resource (e.g. GET /demo/scrybe) with no payment.
2. Server responds 402 with PaymentRequirements (asset, amount, payTo, domain extras).
3. Client (the Baret extension, or any wallet-standard-compatible wallet)
   builds the TransferWithAuthorization digest, signs it, and sends it back
   as the base64 X-PAYMENT header.
4. Server verifies the signature — either via an external casper-x402
   facilitator, or the built-in one at /facilitate/verify (pure crypto, no
   network call): rebuild the digest from the claimed authorization fields,
   confirm the declared public key hashes to `authorization.from`, then
   check the EIP-712 signature.
5. If verification passes, the paywalled work runs (e.g. the analyze
   pipeline). Only if THAT succeeds does the server call /facilitate/settle
   (or the external facilitator's /settle) to move tokens on-chain.
```

**Settlement** calls `transfer_with_authorization` on the deployed
`Cep18x402` contract, passing the payer's public key, the full signature,
and the authorization fields. The contract independently re-derives the
EIP-712 digest and the signer's account hash — it does not trust the
server's own `/verify` result — and moves tokens directly from payer to
payee with no prior on-chain `approve`, guarded by a replay-protection
nonce and the `validAfter`/`validBefore` window. A payer with insufficient
CEP-18 balance reverts on-chain rather than silently succeeding.

A payload can carry `sigScheme: "raw"` (a wallet that signs the 32-byte
digest directly, like Baret's own extension) or `sigScheme: "casperMessage"`
(a wallet that only exposes `signMessage(string)`, like the official Casper
Wallet — which signs `"Casper Message:\n" + hex(digest)` as ASCII bytes).
Both schemes are confirmed working end to end against live testnet payments,
including full on-chain settlement: the deployed `Cep18x402` contract's
`transfer_with_authorization` takes an explicit `sig_scheme` argument and
reconstructs the matching message bytes before verifying, rather than
assuming the raw digest.

---

## 5. On-chain contracts (Odra)

Source: `contracts/src/{payment_guard,token,eip712}.rs`.

### `Cep18x402` (`token.rs`)

A CEP-18 token (wrapping `odra_modules::cep18_token::Cep18`) plus
`transfer_with_authorization`: an EIP-3009-style meta-transfer.
`eip712.rs` reimplements the exact EIP-712 hashing
`packages/casper-core/src/x402.ts` uses off-chain (keccak256, the same
domain and struct layout) so the contract can rebuild the identical digest
and verify independently — there's a golden-vector test
(`eip712::tests::matches_the_casper_core_golden_vector`) pinning the two
implementations together. This same token is also published standalone,
with more detail on the design, at
[casper-usdc](https://github.com/Aeztrest/casper-usdc).

### `PaymentGuard` (`payment_guard.rs`)

A spending-cap vault: the owner deposits CEP-18 tokens, grants each merchant
a per-transaction cap and a rolling 24-hour cap via `set_allowance`, and
optionally delegates day-to-day `pay()` calls to an agent wallet via
`set_agent`. `pay(merchant, amount)` — callable only by the owner or the
designated agent — reverts if the merchant is unregistered, paused/revoked,
or the payment would breach either cap. This lets an agent spend
autonomously within limits the owner set once, without co-signing every
payment, while still not letting an arbitrary third party force a payout.
Also published standalone at
[casper-wallet-sdk](https://github.com/Aeztrest/casper-wallet-sdk).

Build with `cargo odra build` (from `contracts/`); output goes to
`contracts/wasm/{PaymentGuard,Cep18x402}.wasm`, which are checked into the
repo as binary build artifacts — rebuild and re-commit them after any
contract source change.

---

## 6. Wallet extension

Source: `apps/extension/src/{background,content,inpage,popup,options}`.

Chrome MV3 extension. The inpage script injects `window.baret` (a
Casper-wallet-compatible provider) into the page; the content script bridges
page ↔ background; the background service worker holds wallet state, runs
pre-sign analysis, and talks to `apps/server`. `packages/ext-protocol`
defines the typed message contract between these layers. See
`apps/extension/README.md` for the extension's actual screens and how to
load it in Chrome.

---

## 7. Showcase

`apps/showcase/src/sites/*` are demo dApps, each built to trip a specific
detector (unlimited approvals, drainer-style transfers, and similar). Each
site has a toggle that swaps its transaction for a deliberately dangerous one
— that toggle exists only here, kept for demonstrating what Baret catches;
the standalone [casper-network-dapps](https://github.com/Aeztrest/casper-network-dapps)
repo has the same six dApps without it, since those are meant to look like
ordinary, working products rather than a security demo. `sites/scrybe` is
the x402 paywall demo described in §4.

---

*If you find a reference to Solana/Stellar RPC, SPL tokens, or program IDs
anywhere in `apps/` or `packages/` source (not docs), that's a leftover from
an earlier port and should be reported/removed — the chain layer here is
Casper exclusively.*
