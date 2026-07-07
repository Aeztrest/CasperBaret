# Demo video script (~2–3 minutes)

A narration-led walkthrough: the problem, the story behind what got built,
then a live demo of Baret catching a malicious transaction and paying for
an API call per-request over x402. Recorded against the local server +
showcase, or the deployed versions.

Companion reading: `README.md` (the full story), `docs/protocol.md` (how
the analysis engine works).

---

## Setup before recording

```bash
pnpm dev:server          # :8080
pnpm build:extension     # chrome://extensions → Load unpacked → apps/extension/dist
pnpm dev:showcase        # :5175
```

Have ready in tabs:
1. The showcase home (`http://localhost:5175`)
2. NovaSwap (`/novaswap`)
3. Scrybe (`/scrybe`)

Have Baret unlocked and connected to testnet before recording, with a small
CSPR + test-USDC balance already funded (use the faucet ahead of time so
you're not waiting on it live).

---

## Storyboard

### 0:00 – 0:20 · Hook

**Screen:** Any wallet's plain "Confirm transaction" screen — a contract
address, some raw bytes, a Confirm button.

> "This is what most wallets show you before you sign. A contract address,
> some numbers, a Confirm button. You're trusting that whatever you're
> about to sign does what the page told you it does. Most of the time it
> does. The time it doesn't, you don't get a second chance."

### 0:20 – 0:45 · What Baret does differently

**Screen:** Cut to the Baret popup — connected, balance visible.

> "Baret checks a transaction before it lets you sign it. It decodes what
> the transaction actually does, checks it against rules you set, and
> refuses to sign anything that crosses one — before your key ever touches
> it. For an AI agent paying on its own, that same rule set becomes a
> spending cap it can't talk its way around."

### 0:45 – 1:05 · The story in one breath

**Screen:** Quick cuts — GitHub org page or a slide with the four repo names.

> "We built the wallet first. Then realized Casper didn't have a wallet SDK
> to build it on, so we built one from scratch. Then needed real sites to
> test the wallet against, so we built six working dApps. Then realized
> our approach to x402 — machine-to-machine payments — didn't exist for
> Casper either, so we built that too. And to actually test payments, we
> deployed a USDC stablecoin for Casper Network, because there wasn't one.
> Four repos, one wallet holding them together."

### 1:05 – 1:40 · Live demo — the safe swap

**Screen:** NovaSwap. Connect Baret. Enter an amount, CSPR → USDC.

> "This is NovaSwap — a real swap, real settlement, on Casper testnet.
> I'll swap 3 CSPR for USDC."

Click **Swap**. Baret's popup re-renders into the Sign Request screen.

> "Baret simulated this before showing me the sign screen — what changes,
> what it costs, and here" — point at the claimed-outcome note — "it's even
> showing me what NovaSwap says I'll get back, clearly marked as the site's
> claim, not something Baret verified itself."

Click **Sign**. Return to NovaSwap, show the confirmed swap + updated
balance.

### 1:40 – 2:10 · Live demo — the blocked transaction

**Screen:** Toggle "Simulate malicious swap" on NovaSwap. Click Swap again.

> "Now the same site, but this transaction is built to drain the wallet
> instead of swap anything."

Baret's popup opens — **red hero, Blocked.**

> "Baret caught it: an unlimited approval to an account I've never
> interacted with. The Sign button doesn't just disable — it demands a
> second, explicit tap before it'll let a blocked transaction through at
> all. No accidental click gets past this."

Click **Decline**.

### 2:10 – 2:35 · Live demo — x402

**Screen:** Scrybe. Type a question, click **Pay & Ask**.

> "This is Scrybe — a pay-per-question API over x402. No subscription, no
> API key. Every question is a fresh, signed micro-payment."

Show the progress steps (paywalled → signing → settling → answered), then
the answer + on-chain settlement receipt.

> "Baret signed that payment in the background because it was inside the
> caps I set — no popup needed. That's the whole point: an agent can pay
> per request on its own, and the caps are what keep it honest."

### 2:35 – 2:50 · Close

**Screen:** Back to the showcase home or a slide with the four repo links.

> "One wallet, and everything it needed that didn't exist yet on Casper —
> all open source. Try it on testnet."

End card: Baret logo + `github.com/Aeztrest/CasperBaret`.

---

## Lower-thirds / on-screen text

- *"Checks before it signs — not after."* (0:20)
- *"casper-wallet-sdk · casper-network-dapps · x402-casper · casper-usdc"* (1:05)
- *"Blocked at the wallet — not the page."* (1:40)
- *"Testnet · Open source · github.com/Aeztrest/CasperBaret"* (2:50)

---

## Fallbacks

- **Faucet is slow on the day?** Fund the demo wallet well ahead of time;
  don't rely on a live faucet claim during recording.
- **Running short on time?** Cut the x402/Scrybe segment (1:40–2:10) first —
  the blocked-transaction moment is the load-bearing demo.
- **Running long?** The full script is ~150 spoken seconds; trims naturally
  to 2 minutes by dropping the "story in one breath" section and just
  saying "we had to build four other things along the way — see the
  README" instead.
