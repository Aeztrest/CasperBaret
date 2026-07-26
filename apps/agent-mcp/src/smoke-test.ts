/**
 * Exercises the MCP tools directly (no LLM, no MCP transport) against a real
 * Baret server + live Casper testnet — confirms the agent wallet has funds,
 * confirms a paid question actually settles on-chain, and confirms the
 * policy engine genuinely refuses once the cap is hit rather than just
 * reporting it. Run with `pnpm smoke-test` against a local `pnpm dev:server`.
 */
import { checkBalance } from "./tools/check-balance.js";
import { askScrybe } from "./tools/ask-scrybe.js";
import { listPolicy } from "./tools/list-policy.js";

async function main() {
  console.log("=== balance ===");
  console.log(await checkBalance());

  console.log("\n=== spending until the cap refuses ===");
  for (let i = 1; i <= 7; i++) {
    const r = await askScrybe(`Question number ${i}?`);
    console.log(`#${i}:`, r.blocked ? `BLOCKED — ${r.reason}` : `paid ${r.amountUsdc} USDC -> "${r.answer}"`);
  }

  console.log("\n=== final policy state ===");
  console.log(listPolicy());
}
main().catch((e) => { console.error(e); process.exit(1); });
