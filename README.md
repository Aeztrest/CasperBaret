# Baret

**A wallet that checks a transaction before it lets you sign it — built for Casper Network.**

Baret sits between a dApp (or an AI agent) and your signature. Before your keys ever touch a transaction, Baret decodes what it actually does, checks it against rules you set, and refuses to sign anything that looks like it will drain your wallet. For AI agents making payments on their own, Baret enforces a spending cap that the agent cannot talk its way around.

This repository is the wallet itself, its backend, and its on-chain contracts. It also tells the story of everything else we had to build along the way — because when we started, most of it didn't exist yet for Casper.

---

## How this project actually happened

We didn't set out to build five things. We set out to build one — a wallet that protects people before they sign. Everything else got built because Casper didn't have it yet, and we couldn't test what we were building without it.

### 1. First, the protocol

The core idea is simple: **look at a transaction before it's signed, not after it fails.** Most wallets show you a wall of raw numbers and a "Confirm" button. Baret decodes the transaction, works out what would actually happen to your balances and permissions, checks that against a policy you control, and only then lets you sign — or refuses to, with a plain-English reason.

For AI agents that pay per request (see the x402 chapter below), this becomes a spending cap enforced at the wallet level: the agent can pay autonomously, but never past the limit its owner set.

→ **[How the protocol works](docs/protocol.md)** — the analysis engine and the policy rules, explained simply.

### 2. Then we needed a wallet to test it on — so we built one

A policy engine is useless without a wallet to enforce it in. We looked for an existing Casper wallet SDK to build on top of. There wasn't one — nothing that let us intercept a signature, run our own checks, and decide whether to let it through.

So we built a Casper smart-wallet SDK from scratch: a spending-cap vault contract (`PaymentGuard`) plus the wallet-side plumbing to connect to it, in its own repository so anyone building on Casper can use it independently of Baret.

→ **[casper-wallet-sdk](https://github.com/Aeztrest/casper-wallet-sdk)** — the smart-wallet vault, on its own.

### 3. Then we needed real sites to test the wallet on — so we built six

A wallet only proves itself against real dApps: connect, sign, see what happens. We looked for existing Casper demo sites we could point the wallet at and try to break. There weren't any that fit — so we built six small, real, working dApps ourselves: a token swap, an NFT mint, a staking page, an airdrop claim, a token launchpad, and a pay-per-question API. Each one does a genuine on-chain action; none of them are screenshots.

→ **[casper-network-dapps](https://github.com/Aeztrest/casper-network-dapps)** — six independent Casper dApps, each in its own folder.

### 4. Then we realized our x402 approach was something nobody else had built for Casper

[x402](https://github.com/coinbase/x402) is Coinbase's protocol for machine-to-machine payments: an HTTP 402 response, a signed authorization, no login, no subscription. Casper had no x402 implementation at all. We built one — and along the way realized the interesting part isn't the payment protocol itself, it's what happens *after* the wallet signs: without a spending cap sitting between the agent and the signature, x402 lets an agent re-sign as many times as it wants with nothing stopping it. Wiring x402 through Baret's policy engine (chapter 1) is what actually makes autonomous payments safe.

→ **[x402-casper](https://github.com/Aeztrest/x402-casper)** — x402 for Casper Network, as a standalone TypeScript library.

### 5. Then we needed a USDC to actually test payments with — so we deployed one

x402 payments need a stable, widely-recognized token to move. Casper Network didn't have a USDC deployment. We built and deployed a CEP-18 stablecoin with the `transfer_with_authorization` extension x402 needs (the same signed-authorization pattern as Ethereum's EIP-3009), so a payment can be authorized off-chain with one signature and settled on-chain by anyone holding that signature — no prior approval transaction required.

→ **[casper-usdc](https://github.com/Aeztrest/casper-usdc)** — the CEP-18 token + EIP-712 signing library.

---

## What's actually in this repository

Everything above except the wallet itself now lives in its own repository, so each piece can be used independently. What's left here is Baret proper:

| Path | What it is |
|---|---|
| `apps/extension` | The Baret wallet — a Chrome extension. Injects `window.baret` into every page, so any Casper dApp picks it up automatically. |
| `apps/server` | The backend: the pre-sign analysis API (`/v1/analyze`), a built-in x402 facilitator, and the demo endpoints the showcase dApps use (faucet, swap settlement, paywall). |
| `apps/showcase` | The same six demo dApps described above, kept here too as Baret's own integration test bed (with an extra "simulate an attack" toggle on each one, for demoing what Baret catches). |
| `contracts` | The Odra (Rust) smart contracts: `PaymentGuard` (the spending-cap vault) and `Cep18x402` (the USDC-style token). |
| `packages/casper-core` | Shared Casper primitives: keypairs, RPC, units, x402 signing — used by both the server and the extension. |
| `packages/casper-guard` | The policy engine's types and evaluator — chain-agnostic, shared by the server and the wallet. |
| `packages/ext-protocol` | The typed message contract between the extension's popup, background service, and the page it's injected into. |
| `packages/ui` | Shared design tokens and the Baret logo component. |

→ **[apps/extension/README.md](apps/extension/README.md)** — how the wallet itself is built, its screens, and how to load it in Chrome.

---

## Running it locally

You'll need Node 20+, pnpm 9, and (only if you want to build the contracts) Rust with `cargo-odra`.

```bash
pnpm install
pnpm build:packages          # builds casper-core + casper-guard first

# 1. Backend — analysis API + x402 facilitator + demo endpoints
pnpm dev:server               # http://localhost:8080

# 2. The six demo dApps
pnpm dev:showcase             # http://localhost:5175 (proxies /api to :8080)

# 3. The wallet extension
pnpm build:extension          # → apps/extension/dist
#   chrome://extensions → Developer mode → Load unpacked → apps/extension/dist
```

Open the showcase, connect the Baret wallet, and try a swap or a claim — the wallet's own popup shows you what the transaction does before you sign it.

`apps/server/.env` needs a funded testnet key (`FAUCET_PRIVATE_KEY`) and the deployed token's package hash (`CEP18_X402_PACKAGE`) for the demo endpoints and x402 facilitator to work — see `apps/server/.env.example`.

## Tests

```bash
pnpm test              # casper-core + server + extension (vitest)
pnpm test:contracts    # PaymentGuard + Cep18x402 (cargo odra test, no live node needed)
```

The x402 signing logic is checked against a reference vector shared with the on-chain contract, so a signature built by this code is guaranteed to verify on-chain too.

## Contracts

```bash
cd contracts
cargo odra test          # PaymentGuard + Cep18x402 tests, no node required
cargo odra build          # → contracts/wasm/{PaymentGuard,Cep18x402}.wasm
```

Deploy the built `.wasm` with `casper-client` using a testnet-funded key, then point `apps/server/.env` at the resulting package hashes.

## Built for the Casper Agentic Buildathon

Track: Agentic AI + DeFi/Payments. The short version: Baret is a Casper wallet that puts a real cap, a real allowlist, and a real kill switch on an AI agent's spending — enforced both when it signs and on-chain, so "the agent has permission" never means "the agent has unlimited permission."

MIT licensed.
