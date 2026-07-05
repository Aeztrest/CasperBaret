# Baret — Architecture

This document describes the actual current system: a Casper wallet-level
firewall plus x402 agentic-payment stack. If you're looking for the pitch,
see `README.md`; for known gaps and non-guarantees, see `LIMITATIONS.md`.

---

## 1. What this is

Baret sits between a dApp (or an AI agent) and a Casper wallet's signature.
Every transaction is decoded, risk-scored, and policy-checked **before
signing**. For the x402 micropayment protocol, per-merchant spending caps —
enforced both client-side and on-chain via the `PaymentGuard` contract — are
the actual firewall: an agent can pay per request autonomously, but never
beyond the limits the owner set.

This is a from-scratch Casper port of an earlier Solana/Stellar prototype.
Some file and folder names in this repo (`blackthorn`, `DeltaG`, `Scrybe`)
are inherited branding from that prototype and don't imply a different chain
is involved — everything under `apps/` and `packages/` talks to Casper only.

---

## 2. Monorepo layout

| Path | What it is |
|---|---|
| `packages/casper-core` | Casper chain primitives: keypairs (`keys.ts`), addresses (`address.ts`), units/motes (`units.ts`), an RPC client wrapper (`rpc.ts`), and the x402 EIP-712 client + verifier (`x402.ts`). Wraps `casper-js-sdk` behind a small interop shim (`sdk.ts`) because the SDK's CJS bundle doesn't play well with native ESM. |
| `packages/casper-guard` | Chain-agnostic analyze/policy types and an analyze client (`guard.ts`, `policy.ts`, `analyze.ts`). |
| `packages/ext-protocol` | The message protocol shared between the wallet extension's page-injected provider, content script, and background service worker. |
| `packages/blackthorn-adapter` (`@casper-baret/wallet-adapter`) | Popup-bridge wallet adapter for dApp integration. |
| `packages/ui` | Shared Baret design tokens (`tokens.css`) and brand assets. |
| `apps/server` | Fastify server: `/v1/analyze` (pre-sign risk analysis), the x402 paywalled demo (`/demo/scrybe`), a built-in x402 facilitator (`/facilitate/{supported,verify,settle}`), and a CSPR faucet. |
| `apps/extension` | Chrome MV3 wallet. Injects `window.baret`; the x402 **buyer** side. |
| `apps/showcase` | Demo dApps (`apps/showcase/src/sites/*`) exercising specific attack scenarios, plus the `scrybe` x402 paywall demo. |
| `contracts` | Odra (Rust) smart contracts: `PaymentGuard` (on-chain spending-cap vault) and `Cep18x402` (CEP-18 token with an EIP-3009-style `transfer_with_authorization`). |

---

## 3. Server request lifecycle — `POST /v1/analyze`

Source: `apps/server/src/analyze/analyze.ts`, `detectors.ts`, `intent.ts`,
`policy-eval.ts`.

1. Request body validated (Zod) — transaction payload, target network, policy.
2. Transaction intent decoded (`intent.ts`) into a normalized, human-readable
   summary (what programs/entry points are touched, what balances move).
3. Risk detectors run over the decoded intent (`detectors.ts`).
4. Policy engine evaluates the findings against the caller's policy
   (`policy-eval.ts`) and returns a `safe: true/false` decision with reasons.
5. If x402 auth is enabled for this endpoint, payment is verified (and, once
   analysis succeeds, settled) around this pipeline — see §4.

This mirrors the wallet extension's own pre-sign check: the extension can
call the same logic locally or hit this server, so a dApp integrator gets
the identical verdict either way.

---

## 4. x402 payment flow

Source: `packages/casper-core/src/x402.ts`, `apps/server/src/api/routes/{scrybe,facilitator}.ts`.

Baret implements the `exact` x402 scheme as `TransferWithAuthorization` — an
EIP-712-typed message (domain: `name`, `version`, `chain_name`,
`contract_package_hash`; message: `from`, `to`, `value`, `validAfter`,
`validBefore`, `nonce`) signed by the payer, wire-compatible with
[`make-software/casper-x402`](https://github.com/make-software/casper-x402).

```
1. Client requests a paywalled resource (e.g. GET /demo/scrybe) with no payment.
2. Server responds 402 with PaymentRequirements (asset, amount, payTo, domain extras).
3. Client (Baret extension or the showcase's inline wallet bridge) builds the
   TransferWithAuthorization digest, signs it, and sends it back as the
   base64 X-PAYMENT header.
4. Server verifies the signature — either via an external casper-x402
   facilitator, or the built-in one at /facilitate/verify (pure crypto, no
   network call): rebuild the digest from the claimed authorization fields,
   confirm the declared public key hashes to `authorization.from`, then
   check the EIP-712 signature.
5. If verification passes, the paywalled work runs (e.g. the analyze
   pipeline). Only if THAT succeeds does the server call /facilitate/settle
   (or the external facilitator's /settle) to move tokens on-chain.
```

**Settlement** (`/facilitate/settle`) has two modes:

- **Demo mode** (`X402_DEMO_MODE=true`): submits a real CSPR transfer from
  the server's treasury key to the payer (not to `payTo`, which may itself be
  the treasury) so the response has a genuine, explorer-visible transaction
  hash — but no CEP-18 tokens actually move from payer to payee. This is what
  the showcase demo runs against out of the box.
- **Real settlement**: calls `transfer_with_authorization` on the deployed
  `Cep18x402` contract, passing the payer's public key, the full signature,
  and the authorization fields. The contract independently re-derives the
  EIP-712 digest and the signer's account hash — it does not trust the
  server's own `/verify` result — and moves tokens directly from payer to
  payee with no prior on-chain `approve`, guarded by a replay-protection
  nonce and the `validAfter`/`validBefore` window.

A payload can carry `sigScheme: "raw"` (Baret's own extension, which signs
the 32-byte digest directly) or `sigScheme: "casperMessage"` (any wallet that
only exposes `signMessage(string)`, like the official Casper Wallet — which
signs `"Casper Message:\n" + hex(digest)` as ASCII bytes, confirmed against
two live payments on 2026-07-05). Both schemes verify on-chain: the deployed
`Cep18x402` v2 contract's `transfer_with_authorization` takes an explicit
`sig_scheme` argument and reconstructs the same prefixed bytes before
verifying, rather than assuming the raw digest.

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
implementations together.

### `PaymentGuard` (`payment_guard.rs`)

A spending-cap vault: the owner deposits CEP-18 tokens, grants each merchant
a per-transaction cap and a rolling 24-hour cap via `set_allowance`, and
optionally delegates day-to-day `pay()` calls to an agent wallet via
`set_agent`. `pay(merchant, amount)` — callable only by the owner or the
designated agent — reverts if the merchant is unregistered, paused/revoked,
or the payment would breach either cap. This lets an agent spend
autonomously within limits the owner set once, without co-signing every
payment, while still not letting an arbitrary third party force a payout.

Build with `cargo odra build` (from `contracts/`); output goes to
`contracts/wasm/{PaymentGuard,Cep18x402}.wasm`, which are checked into the
repo as binary build artifacts — rebuild and re-commit them after any
contract source change.

---

## 6. Wallet extension

Source: `apps/extension/src/{background,content,inpage,popup,options}`.

MV3 Chrome extension. The inpage script injects `window.baret` (a
Casper-wallet-compatible provider) into the page; the content script bridges
page ↔ background; the background service worker holds wallet state, runs
pre-sign analysis, and talks to `apps/server`. `packages/ext-protocol`
defines the typed message contract between these layers.

---

## 7. Showcase

`apps/showcase/src/sites/*` are demo dApps, each built to trip a specific
detector (unlimited approvals, drainer-style transfers, fake mints, etc.).
`sites/scrybe` is the x402 paywall demo described in §4.

---

*Casper-only. If you find a reference to Solana/Stellar RPC, SPL tokens, or
program IDs anywhere in `apps/` or `packages/` source (not docs), that's a
leftover from the port and should be reported/removed — the chain layer here
is Casper exclusively.*
