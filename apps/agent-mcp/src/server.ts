/**
 * Baret Agent MCP server — exposes a Casper wallet, capped by the same
 * policy vocabulary as Baret's own extension, as MCP tools any LLM agent
 * can drive. See ../LIMITATIONS.md-style note in README: this is a
 * standalone demo wallet, not the user's real Baret wallet.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { checkBalance } from "./tools/check-balance.js";
import { listPolicy } from "./tools/list-policy.js";
import { askScrybe } from "./tools/ask-scrybe.js";

const server = new McpServer({ name: "baret-agent", version: "0.1.0" });

server.registerTool(
  "check_balance",
  {
    title: "Check wallet balance",
    description: "Read this agent's own Casper testnet wallet balance (CSPR and test-USDC).",
  },
  async () => {
    const bal = await checkBalance();
    return {
      content: [{ type: "text", text: JSON.stringify(bal, null, 2) }],
    };
  },
);

server.registerTool(
  "list_policy",
  {
    title: "List spending policy",
    description:
      "Read this agent's own spending caps (per-transaction, hourly, daily — same field names Baret's wallet uses) and how much has already been spent in the current windows.",
  },
  async () => {
    return {
      content: [{ type: "text", text: JSON.stringify(listPolicy(), null, 2) }],
    };
  },
);

server.registerTool(
  "ask_scrybe",
  {
    title: "Ask Scrybe a paid question",
    description:
      "Ask Scrybe (a pay-per-question x402 API) one question. Learns the real price from the server, checks it against this agent's own spending policy BEFORE paying, and refuses (without spending anything) if it would breach the per-transaction, hourly, or daily cap. Only pays and returns an answer when the payment is within policy.",
    inputSchema: { question: z.string().min(1).max(500) },
  },
  async ({ question }) => {
    const result = await askScrybe(question);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Baret Agent MCP server running on stdio.");
}

main().catch((err) => {
  console.error("Fatal error starting Baret Agent MCP server:", err);
  process.exit(1);
});
