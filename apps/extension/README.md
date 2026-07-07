# @casper-baret/extension

The Baret wallet — a Chrome MV3 browser extension for Casper Network.

For how the analysis engine and policy rules work, see
[`docs/protocol.md`](../../docs/protocol.md). For the full technical picture
of every app and package in this repo, see [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

## What it does

Baret injects `window.baret` into every page — a Casper-wallet-compatible
provider, so any dApp that already knows how to talk to a Casper wallet picks
it up with no integration work. Before signing anything, the extension sends
the transaction to Baret's analysis engine, shows you what it actually does
in plain language, and only lets a "safe" or explicitly-overridden
transaction through.

## Screens

| Path | What's there |
|---|---|
| `src/popup/` | The toolbar popup — balance, activity, allowances, and the **Sign Request** screen that appears whenever a dApp asks for a signature. |
| `src/options/` | The full wallet view (its own tab): onboarding, policy editor, per-site permissions, x402 activity, transaction history. |
| `src/background/` | The service worker — holds wallet state, runs pre-sign analysis, talks to `apps/server`, and is the only place the decrypted key ever exists in memory. |
| `src/content/` | Per-page content script — bridges the page and the background service worker. |
| `src/inpage/` | The `window.baret` provider itself, plus the x402 interceptor that catches HTTP 402 responses. |

## Build

```sh
pnpm dev                 # dev mode, writes to dist/
pnpm build:chrome        # production build, Chrome manifest
pnpm build:firefox       # production build, Firefox manifest
pnpm build               # both, plus packaged zips for the showcase's install page
```

Load it in Chrome: `chrome://extensions` → enable Developer mode → **Load
unpacked** → select `apps/extension/dist`.

## Testing it against something real

The extension needs `apps/server` running (`pnpm dev:server`) for pre-sign
analysis to work, and the six demo dApps (`pnpm dev:showcase`) are the
fastest way to see it catch something — each one has a toggle that swaps its
normal transaction for a deliberately dangerous one.
