# Baret — Brand Identity

> What the wallet looks, sounds, and feels like — at every surface.

This document is binding for every UI surface we ship: extension popup, options
page, showcase sites, marketing pages, README, demo video. The values here
mirror `packages/ui/src/tokens.css`; if the two ever disagree, `tokens.css`
is what's actually shipping — update this file to match, don't assume this
file is current.

---

## 1. Position

**One-line:** *The wallet that watches what happens after you sign — for Casper Network.*

**Three words:** Calm. Technical. Candid.

We are not "100x SAFE." We are not a billboard. We are a knowledgeable friend
who read the contract before you signed it, will tell you what they saw in
plain English, and will keep an eye on it after you walked away.

---

## 2. Name & wordmark

**Baret** — capitalized, single word. The mark is implemented as an inline
SVG component, never a raster: `packages/ui/src/brand/Mark.tsx` is the single
source of truth.

### Wordmark spec

- Wordmark: Inter Display (or Inter Tight) at 700 weight, tracking -1%.
- Lockup: glyph + 12-px gap + wordmark. Never separate the glyph from the
  wordmark in formal placements (header, splash, share cards). The glyph
  alone is allowed as an extension toolbar icon and favicon.
- Minimum size: 88 px wide for full lockup; 24 px square for glyph-only.
- Clear space: 0.5× cap-height on every side.

---

## 3. Color system

### 3.1 Foundational palette

A single brand accent does the heavy lifting. Three semantic accents
communicate state. Everything else is greyscale on a near-black canvas.

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0A0A0C` | App canvas. |
| `--bg-elevated` / `--bg-card` / `--bg-modal` | `#16171A` | Panels, cards, modals — one flat surface tone; depth comes from borders and shadow, not extra lightness steps. |
| `--line` | `rgba(255,255,255,0.10)` | All 1-px dividers and card borders. |
| `--line-strong` | `rgba(255,255,255,0.20)` | Active state borders, focus rings. |
| `--text` | `#F4F4F5` | Primary text. |
| `--text-muted` | `rgba(255,255,255,0.62)` | Secondary text, descriptions. |
| `--text-faint` | `rgba(255,255,255,0.42)` | Tertiary text, captions. |
| `--text-ghost` | `rgba(255,255,255,0.26)` | Placeholder, disabled. |

### 3.2 Brand accent — Casper red

| Token | Hex | Use |
|---|---|---|
| `--accent` | `#E11428` | Primary CTA fill, active nav, brand dot. |
| `--accent-soft` | `#F01B30` | Accent text, icons on dark surfaces. |
| `--accent-dim` | `rgba(225,20,40,0.14)` | Hover backgrounds, accent halos. |
| `--accent-glow` | `rgba(225,20,40,0.30)` | Outer glow behind hero numbers / shield. |

Red matches Casper Network's own brand color — the wallet reads as *of this
network*, not as a third-party overlay borrowing a different chain's palette.

### 3.3 Semantic accents

Used **only** to communicate state. Never as decoration.

| Intent | Token | Hex | Used for |
|---|---|---|---|
| Safe / approved | `--ok` | `#34D399` | Green dots, "Signed," confirmed states, allowance under cap. |
| Caution / advisory | `--warn` | `#FBBF24` | Amber pills, simulation warnings, expiry-soon banners. |
| Block / drift | `--bad` | `#F87171` | Red pills, blocked txs, alert badges, cap exceeded. |
| Live / pulsing | `--live` | `#38BDF8` | "Watching" indicator, real-time activity ticker. |

Every state colour has a 14% alpha background variant (`--ok-dim`,
`--warn-dim`, `--bad-dim`, `--live-dim`) for filled banners.

### 3.4 Anti-rules

- **No multi-colour gradients.** Single-colour glow halos only.
- **No saturated reds for non-critical UI.** `--bad` is reserved for
  actually-blocked or actually-drifting state, never for routine "delete"
  buttons or unsigned actions.
- **No success-green CTAs.** Primary action is always the accent red; green
  is reserved for confirmation chrome.

---

## 4. Typography

### 4.1 Type families

- **Display + UI body:** *Inter* (sans-serif, geometric-humanist).
- **Numerical / mono:** *JetBrains Mono* (monospace, programmer-grade).
- **Headings:** *Space Grotesk*.

### 4.2 Type scale

Tabular figures everywhere a number can change.

| Token | Size | Line | Use |
|---|---|---|---|
| `--display-2xl` | 56 / 1.04 | Marketing hero. |
| `--display-xl` | 44 / 1.10 | Hero numbers — balance, allocation. |
| `--display-l` | 32 / 1.12 | Page titles. |
| `--display-m` | 24 / 1.20 | Card titles. |
| `--text-l` | 16 / 1.50 | Body. |
| `--text-m` | 14 / 1.50 | Default UI text. |
| `--text-s` | 12 / 1.45 | Captions, table cells. |
| `--text-xs` | 11 / 1.40 | Uppercase labels (always paired with `text-faint`). |
| `--mono-l` | 14 / 1.40 | Addresses, signatures, JSON. |
| `--mono-m` | 12 / 1.40 | Inline addresses, hashes. |

**Rule:** the one most-important number on every page is rendered with
`--display-xl`. If a page has two equally-important numbers, that's a
hierarchy problem — redesign the page.

---

## 5. Spacing & radius

Geometric rhythm based on a 4-px base unit: `4 — 8 — 12 — 16 — 24 — 32 — 48 — 64 — 96`.

| Token | Px | Use |
|---|---|---|
| `--r-pill` | 999 | Pills, status chips, segmented controls. |
| `--r-input` | 10 | Form inputs, small toggles. |
| `--r-card` | 16 | Cards. |
| `--r-modal` | 20 | Modals, sheets, the popup itself. |
| `--r-window` | 24 | Full-screen onboarding windows, splash. |

Never use 8 or 12 for cards; 16 is Baret's card radius and mixing radii on
one screen breaks the system.

---

## 6. Motion

Calm. Never showboaty. Animations exist to communicate state changes the eye
might miss, not to entertain.

| Pattern | Duration | Curve |
|---|---|---|
| Surface fade in | 180 ms | `ease-out` |
| Surface scale in | 220 ms | spring(stiffness 340, damping 28) |
| Number count-up (hero numbers only) | 600–800 ms | `cubic-bezier(0.22, 1, 0.36, 1)` |
| Live pulse | 1600 ms loop | sinusoidal opacity 0.4 → 1 → 0.4 |
| Modal enter | 240 ms | spring + 8-px y-offset |

**Anti-rules:** no bouncing, no overshoot beyond 1.02× scale, no looping
motion outside the live-pulse indicator and spinners, no marquee text.
`prefers-reduced-motion` disables count-ups and live pulses (instant value
swaps instead).

---

## 7. Iconography

- **Library:** [Lucide](https://lucide.dev) via `lucide-react`.
- **Stroke:** 1.5 px.
- **Sizes:** 11 / 13 / 16 / 20 / 24. Use 13 for inline-with-text.
- **Color:** icons inherit `currentColor`. A status icon uses the matching
  semantic accent explicitly.

Recurring icons: `Shield` / `ShieldCheck` / `ShieldX` (Baret status),
`Wallet`, `Send` / `Download`, `Activity`, `Zap` (connect / quick action),
`Lock` / `Unlock`, `Eye` / `EyeOff`, `Globe` (dApp origin), `AlertTriangle`,
`ChevronRight` / `ChevronDown`.

---

## 8. Voice & tone

### Microcopy rules

| Don't | Do |
|---|---|
| "Error: insufficient balance" | "Not enough USDC. You need 0.4 more." |
| "Transaction signed" | "Sent. Confirmed on-chain." |
| "Wallet not connected" | "Connect your wallet to continue." |
| "Are you sure?" | "Sign this transfer of 3 CSPR?" |
| "Approve unlimited" | "Allow this dApp to spend up to 10 USDC. Cap can be lowered any time." |
| "WARNING ⚠️" | (a single amber dot + plain sentence) |

### Tone by surface

| Surface | Voice |
|---|---|
| Empty states | Reassuring + actionable. Never apologetic. |
| Confirmation banners | Plain past-tense statement. No emojis. |
| Error / blocked | Neutral, never accusatory. State the rule that was hit, the user's option. |
| Onboarding | Walk-them-through. Every screen has a one-sentence hook + one CTA. |
| Settings / advanced | Technical is OK, but every option has a one-line plain explainer beneath. |

### Words we avoid

`Demo`, `test`, `experiment`, `hackathon`, `🚀`, `revolutionary`,
`disruptive`, `seamless`, `unlock`, `empower`. None of these belong in a
security wallet's copy — the one exception is this repository's own
documentation, where being upfront about what's a demo and what's real
production behavior matters more than staying in brand voice.

---

## 9. Component primitives

```
.btn               base — flex, gap-2, rounded-r-input, font-semibold
.btn-primary       bg-accent, text-white, hover:brightness 1.08
.btn-ghost         bg-transparent, border line, text-muted
.btn-soft          bg-accent-dim, text-accent-soft, no border
.btn-danger        bg-bad-dim, text-bad, no border

.input             bg-white-3%, border line, focus:border-accent

.card              bg-card, border line, rounded-r-card, p-6
.card-hero         card + accent glow halo behind it
.card-elev         card with bg-modal (one notch lighter)

.pill              h-5, px-2, rounded-pill, text-xs, font-bold
                   variants: .pill-ok / .pill-warn / .pill-bad / .pill-live

.dot               w-1.5 h-1.5 rounded-full
.dot-live          dot + live-pulse animation
```

---

## 10. Layout patterns

### 10.1 Wallet popup (extension)

360 × 600. Top strip (identity + balance), hero balance with quick-action
chips, an alert banner when relevant, then the last few activity rows, with
a bottom tab bar (Home · Activity · Allowances · Settings).

### 10.2 Sign Request screen

When the wallet is invoked to sign, the popup re-renders into a full-bleed
Sign Request surface — no nav, no balance, no chrome:

```
┌──────────────────────────┐
│ origin + appName chip    │
│ Action verb              │  e.g. "Sign transaction"
├──────────────────────────┤
│ Hero finding (one-liner) │  Safe / Advisory / Blocked
│ What changes (rows)      │  +/- balance rows
│ Findings (rows)          │  collapsible
├──────────────────────────┤
│   Decline    Sign        │  primary disabled/replaced with a
│                          │  confirm-again step if blocked
└──────────────────────────┘
```

All other wallet UI is hidden during sign. Returning to wallet UI requires
the request to resolve or be cancelled.

### 10.3 Showcase site

Single-accent dark canvas, one focused card, monospace digits for amounts.
The Baret moment is always delivered through the **wallet's own popup**, not
a showcase-page modal — the site looks the same whether or not Baret is
installed, because the protection lives in the wallet, not the page.

---

## 11. Accessibility

Non-negotiable baseline:

- **Contrast:** every text token meets WCAG AA on the surface it lives on.
- **Focus rings:** 2-px solid accent with 2-px offset on every interactive
  element. Never removed.
- **Keyboard:** every action reachable via Tab / Enter / Space. Modals trap
  focus, Esc dismisses.
- **Reduce-motion:** all motion above 300 ms respects
  `prefers-reduced-motion`. The Sign screen in particular degrades to
  instant value swaps.
- **Hit targets:** ≥ 32 × 32 px.
- **Screen reader:** every status icon has a paired `aria-label`.

---

## 12. Implementation home

Tokens live in `packages/ui/src/tokens.css` and are imported by every app
that ships UI. The brand glyph lives in `packages/ui/src/brand/Mark.tsx`.

When in doubt: the single sentence at the top of this file — *Calm.
Technical. Candid.* — outranks any specific rule below it.
