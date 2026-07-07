# How Baret's protocol works

This is the part of Baret that started everything: a check that runs *before* you sign a transaction, not after something has already gone wrong.

## The problem it solves

When a dApp asks you to sign something, a normal wallet shows you a technical summary — a contract address, some raw numbers — and two buttons: Confirm or Reject. It doesn't tell you what will actually happen to your money. Most people click Confirm, because the alternative is guessing.

Baret decodes the transaction first, works out what it actually does in plain terms — "this sends 3 CSPR to an account you've never interacted with," "this gives a contract permission to spend an unlimited amount of your USDC" — and checks that against rules you control. If something crosses a line you set, Baret refuses to sign it. You never get the chance to accidentally click through.

## The two steps

**1. Decode the transaction.**
Casper transactions are just signed bytes — nobody-readable on their own. Baret parses them into something a person can reason about: which contract is being called, what entry point, what arguments, and what that implies for your balances (CSPR moving, tokens moving, a spending allowance being granted, an account's signing keys being changed).

**2. Check it against your policy.**
A policy is a small set of rules you (or a sensible default) set once: "never let a single transaction lose more than 50% of my balance," "never let a contract I don't recognize touch my funds," "never sign an unlimited token approval." Baret runs the decoded transaction against these rules and returns one of three verdicts:

- **Safe** — nothing in the transaction crossed a rule. Sign normally.
- **Advisory** — something is worth knowing but not necessarily disqualifying (an unfamiliar transfer target, for example). You can proceed, but Baret shows you why it flagged it.
- **Blocked** — the transaction breaks a rule you set (an unlimited approval, an estimated loss over your cap, a contract on a known-risky list). Baret shows you the specific reason and requires a deliberate second tap to override it — a single accidental click can never push a blocked transaction through.

## The same engine runs in two places

The decoding-and-checking logic (`apps/server/src/analyze`) is a small backend service (`POST /v1/analyze`), and the wallet extension calls it before showing you the sign screen. Any dApp — or any other wallet — can call the same endpoint directly and get the identical verdict Baret's own users see. It isn't a black box locked inside the extension.

## What makes this matter for AI agents

An AI agent that pays for things on its own (see the x402 chapter of [the main story](../README.md)) doesn't get a "Confirm?" popup for every single payment — that would defeat the point of letting it act autonomously. Instead, the *policy* becomes the safety net: a per-payment cap, an hourly cap, a daily cap, an allowlist of merchants it's allowed to pay. The agent can act freely inside those limits and is refused the moment it tries to step outside them. This is the same policy engine described above — just applied automatically, request after request, instead of once per manual signature.

## Where the code lives

- `apps/server/src/analyze/intent.ts` — turns a raw Casper transaction into a normalized, readable description.
- `apps/server/src/analyze/detectors.ts` — the individual checks (large transfers, unlimited approvals, unknown contracts, and more).
- `apps/server/src/analyze/policy-eval.ts` — combines the checks into one `safe` / `advisory` / `blocked` verdict.
- `packages/casper-guard/src/policy.ts` — the policy rules themselves, and the three built-in templates (Strict, Balanced, Permissive) users can start from.

For the exact list of policy rules Baret currently enforces (and a few that are defined but not wired up yet), see [`LIMITATIONS.md`](../LIMITATIONS.md).
