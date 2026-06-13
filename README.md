# Baret — Casper

> **The hard hat for your Casper wallet.**
> Pre-sign transaction analysis, per-site policy, rolling spend caps, and the
> first wallet-level firewall for the **x402** agentic-payment protocol —
> built for the [Casper Agentic Buildathon](https://dorahacks.io/hackathon/casper-agentic-buildathon).

Baret sits between a dApp (or an AI agent) and your signature. Every Casper
transaction is decoded, risk-scored, and policy-checked **before your keys ever
sign**. For the x402 era, the per-merchant **caps are the firewall**: an agent
can pay per request autonomously, but never beyond the limits you set.

This is the Casper port of the original Stellar build. Same product, same Baret
design — the chain layer is now Casper (casper-js-sdk, CEP-18, EIP-712 x402,
Odra contracts).

---

## Monorepo layout

| Path | What it is |
|---|---|
| `packages/casper-core` | Casper chain primitives: keypairs, RPC, units (motes), addresses, **x402 EIP-712** client (Go-parity verified). |
| `packages/casper-guard` | Shared analysis/policy types + analyze client (chain-agnostic). |
| `packages/ext-protocol` | Wallet ↔ dApp ↔ background message protocol. |
| `packages/blackthorn-adapter` (`@casper-baret/wallet-adapter`) | Popup-bridge wallet adapter. |
| `packages/ui` | Shared Baret design tokens + brand mark. |
| `apps/server` | Fastify analyze server (`/v1/analyze`) + x402 paywall (`/demo/scrybe`). |
| `apps/extension` | Chrome MV3 Baret wallet (the x402 **buyer**); injects `window.baret`. |
| `apps/showcase` | Six fake-but-real dApps demoing each attack Baret catches. |
| `contracts` | **Odra** smart contracts: `PaymentGuard` (agentic spending-cap vault) + `Cep18x402` token. |

## Architecture (Stellar → Casper)

| Concept | Casper implementation |
|---|---|
| SDK | `casper-js-sdk@5` (via `@casper-baret/casper-core` interop shim) |
| Pre-sign analysis | normalized intent decode + risk detectors (+ optional `speculative_exec`) |
| Token | **CEP-18** (contract package hash) |
| x402 signing | **EIP-712** (`@casper-ecosystem/casper-eip-712`) — `TransferWithAuthorization` |
| x402 facilitator | [`make-software/casper-x402`](https://github.com/make-software/casper-x402) (Go, `/verify` `/settle`) |
| Smart wallet | **Odra `PaymentGuard`** spending-cap vault |
| dApp provider | `window.baret` (Casper-wallet-compatible) |

---

## Quickstart (dev)

Prereqs: Node ≥ 20, pnpm 9, Rust + `cargo-odra` (`cargo install cargo-odra`, `rustup target add wasm32-unknown-unknown`), and Go (only to run the x402 facilitator).

```bash
pnpm install
pnpm build:packages          # build casper-core + casper-guard first

# 1) Analyze + x402 server  →  http://localhost:8080
pnpm dev:server

# 2) Showcase dApps          →  http://localhost:5175   (proxies /api → :8080)
pnpm dev:showcase

# 3) Wallet extension (load unpacked from apps/extension/dist)
pnpm build:extension         # → apps/extension/dist  (also writes install zips to showcase/public)
#   chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

Open the showcase, connect **Baret**, and trip a scenario — the firewall fires
before you sign. For **Scrybe** (the x402 demo) you also need a facilitator:

```bash
# x402 facilitator (live settlement) — Go service on :4022
git clone https://github.com/make-software/casper-x402 && cd casper-x402
#   configure CASPER_NETWORKS=casper:casper-test, RPCURL_CASPER_CASPER_TEST,
#   SECRET_KEY_PEM_CASPER_CASPER_TEST (a funded testnet PEM), then run on :4022
```

Point the server at it with `apps/server/.env`:
`X402_FACILITATOR_URL`, `CEP18_X402_PACKAGE` (deployed CEP-18 package hash),
`X402_PAY_TO` (merchant account hash). Without a facilitator, the x402 server
path is still fully covered by the test suite (mock facilitator).

## Tests

```bash
pnpm test                # casper-core (16) + server (6) + extension (1) vitest
pnpm test:contracts      # cargo odra test — PaymentGuard (11, MockVM, no node)
```

The x402 EIP-712 digest is **cross-checked against the Go reference**
(`casper-core` golden vector) so signatures verify on the real facilitator.

## Contracts (Odra)

```bash
cd contracts
cargo odra test          # 11 PaymentGuard tests on the MockVM
cargo odra build         # → contracts/wasm/{PaymentGuard,Cep18x402}.wasm
#   (install binaryen `wasm-opt` for size-optimized wasm; unoptimized is deployable)
```

Deploy to testnet with `casper-client` using a faucet-funded key
(<https://testnet.cspr.live/tools/faucet>). Set the resulting package hashes in
`apps/server/.env`.

## Buildathon

Track: **Agentic AI + DeFi/Payments**. The pitch: *Baret is the first Casper
wallet that puts a cap, an allowlist, and a kill-switch on an AI agent's x402
spend — enforced at signing time and on-chain via PaymentGuard.*

MIT licensed.
