# @casper-baret/agent-mcp

An MCP server that exposes a Casper wallet — balance, spending policy, and
an x402 payment tool — so any MCP-compatible AI agent (Claude, or any other
MCP client) can autonomously pay for things, capped by rules it can't
override. Plus a small demo agent that actually drives it with Claude.

This is a **separate, dedicated demo wallet** — not a user's real Baret
wallet, not connected to the extension. It exists to prove one thing: the
same "policy caps an agent's x402 spending" idea Baret's wallet extension
enforces for a human, working identically when the thing calling the shots
is an LLM instead.

## Why this exists

Baret's whole premise is a spending policy that sits between a signature and
whatever's asking for one — normally a human clicking through a dApp. This
package puts an AI agent in that same seat instead: the agent can check its
own balance, see its own caps, and pay Scrybe (the project's pay-per-question
x402 demo) for as many questions as it wants — right up until a payment
would cross a cap, at which point the tool call itself comes back refused,
before anything is spent. The agent doesn't have to be careful with money;
the wallet won't let it make that mistake.

## Tools

| Tool | What it does |
|---|---|
| `check_balance` | CSPR + test-USDC balance of the agent's own wallet. |
| `list_policy` | Current caps (`maxX402PerTx`, `x402HourlyCap`, `x402DailyCap` — the same field names Baret's own policy engine uses) and how much has already been spent in each window. |
| `ask_scrybe` | Asks Scrybe one question. Learns the real price from the paywall response, checks it against the policy **before** paying anything, and only signs + sends an x402 payment if it's within cap. |

## Running it

```bash
pnpm install                    # from the repo root
cd apps/agent-mcp
cp .env.example .env
pnpm generate-key               # prints a fresh keypair — paste AGENT_PRIVATE_KEY into .env
# fund that address with a little CSPR + test-USDC from the project's faucet
```

Verify the tools work on their own, no LLM involved:

```bash
pnpm smoke-test                 # needs a Baret server running (pnpm dev:server from the repo root)
```

Run the MCP server standalone (e.g. to point Claude Desktop or another MCP
client at it):

```bash
pnpm start
```

Run the actual autonomous-agent demo (needs `ANTHROPIC_API_KEY` in `.env`):

```bash
pnpm demo-agent "your research question here"
```

This spawns the MCP server as a subprocess, connects to it over the real
MCP protocol (not just importing the functions directly), hands Claude the
three tools, and lets it decide on its own how many questions to ask —
stopping cleanly the moment a payment would exceed the wallet's policy.
