# Policy schema

The rules Baret checks a transaction (or an x402 payment) against. One
TypeScript type, shared by the server and the wallet extension:
`packages/casper-guard/src/policy.ts`.

Every field is optional — a policy of `{}` enforces nothing. The three
built-in templates below layer rules on top of that baseline; a user can
start from one and adjust individual fields.

> **Not every field below is wired up to a real check yet.** See
> [`LIMITATIONS.md`](../LIMITATIONS.md) for the exact list of what's
> currently enforced versus declared-for-later. This document describes the
> full schema as written; treat the enforcement table in `LIMITATIONS.md` as
> the source of truth for what actually happens today.

## Pre-sign rules

| Field | Meaning |
|---|---|
| `maxLossPercent` | Block a transaction estimated to move more than this percentage of the wallet's balance. |
| `blockCep18AllowanceGrants` | Block any new CEP-18 `approve`, regardless of amount. |
| `refuseUnlimitedAllowances` | Block a CEP-18 `approve` for the max-uint ("unlimited") sentinel specifically. |
| `blockRiskyContracts` | Block a transaction touching a contract package on Baret's risky-reputation list. |
| `blockUnknownContractExposure` | Block a transaction touching any contract package not on a known-safe list. |
| `blockAssociatedKeyChanges` | Block changes to a Casper account's associated (multisig) keys. |
| `blockThresholdWeakening` | Block changes that lower an account's signing-weight thresholds. |
| `allowWarnings` | When true, medium-severity findings alone don't block — only high/critical ones do. |
| `minPostTokenBalance` / `minPostAsset` | Block a transaction that would leave a chosen token's balance below a floor. |

## x402 payment rules

| Field | Meaning |
|---|---|
| `x402AutoApprove` | When true, in-cap payments sign silently in the background — this is what makes per-request agent payments actually agentic. When false, every payment (even one under all caps) surfaces a confirmation popup. |
| `maxX402PerTx` | Cap on a single payment. A payment over this cap isn't silently rejected — it's routed to a popup for an explicit, one-time override, since a legitimate one-off payment over the usual cap is a normal thing to want. |
| `x402HourlyCap` / `x402DailyCap` | Rolling spend caps per merchant. |
| `allowedAssets` | Only pay in these CEP-18 tokens. |
| `allowedMerchantOrigins` / `blockedMerchantOrigins` | Allow- or deny-list of dApp origins. |
| `allowedFacilitators` | Only trust settlement facilitators on this list. |

## Templates

```ts
STRICT_POLICY      // maxLossPercent: 25, x402AutoApprove: false, tight caps
BALANCED_POLICY     // maxLossPercent: 50, x402AutoApprove: false, moderate caps — the default
PERMISSIVE_POLICY   // maxLossPercent: 90, x402AutoApprove: true, generous caps
```

`BALANCED_POLICY` is what a wallet falls back to if a user has no saved
policy at all (a restored wallet, for example) — see
`apps/extension/src/background/messaging/handlers.ts`. The exact field
values for each template are in `packages/casper-guard/src/policy.ts`.
