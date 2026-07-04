# Baret (Casper) — Limitations

What this system does **not** guarantee, and how to interpret its results.
This describes the current Casper implementation only — see
`ARCHITECTURE.md` for how the pieces fit together.

## Pre-sign analysis

- `/v1/analyze` decodes and risk-scores a transaction **before** it's signed
  or broadcast. It does not simulate execution against live network state the
  way an RPC `speculative_exec`/dry-run would; the analysis is based on
  decoded intent (programs touched, balances implied) rather than a guaranteed
  post-state. Treat a "safe" verdict as "nothing we check for was found," not
  as a formal execution guarantee.
- Detectors only catch what they're built to catch. A genuinely novel
  contract-level attack that doesn't match any existing heuristic will not be
  flagged.

## x402 signature verification

- The built-in facilitator's `/facilitate/verify` independently reconstructs
  the EIP-712 digest and requires the declared `publicKey` to hash to the
  claimed `authorization.from` — a bare "signature verifies" is not treated
  as proof of payer identity by itself.
- `sigScheme: "casperMessage"` (used by wallets that only expose
  `signMessage(string)`, e.g. the official Casper Wallet) signs
  `"Casper Message:\n" + hex(digest)` as ASCII bytes — confirmed against two
  live payments from the official Casper Wallet (secp256k1) on 2026-07-05.
  It's still bound to the same `publicKey → from` check as the "raw" scheme.
  This does not, however, verify on-chain (see below) — the prefix isn't part
  of the EIP-712 digest the contract re-derives.

## x402 settlement

- **Demo mode** (`X402_DEMO_MODE=true`, the showcase's default): `/facilitate/settle`
  submits a real on-chain CSPR transfer from the server's own treasury key to
  the payer (not to `payTo`, so it stays valid even when `payTo` is the
  treasury itself) so the response carries a genuine, explorer-visible
  transaction hash — but no CEP-18 tokens move from payer to payee. This is a
  demo affordance, not a real settlement, and isn't currently surfaced as
  such in the API response.
- **Real settlement** calls `transfer_with_authorization` on the deployed
  `Cep18x402` contract. This only accepts `sigScheme: "raw"` payloads — a
  `"casperMessage"`-scheme payment that passes the off-chain `/verify` check
  cannot currently be settled for real on-chain, because the contract has no
  notion of a message prefix; it verifies the raw EIP-712 digest directly.
- On-chain replay protection is per `(from, nonce)`; the caller (whoever pays
  gas to submit `transfer_with_authorization`) is unrestricted by the
  contract — anyone can relay a validly-signed authorization. This is
  intentional (meta-transaction pattern: only a genuine signature from
  `from` authorizes the transfer, not who submits it) but means the payer's
  chosen `validBefore` is the only thing preventing indefinite delay before
  someone eventually relays it.

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

- Chrome MV3 only; no Firefox/Safari build.
- Pre-sign analysis calls out to `apps/server`; if that server is
  unreachable, behavior depends on the extension's configured fail-open/
  fail-closed setting — check the extension's settings page rather than
  assuming either default.
