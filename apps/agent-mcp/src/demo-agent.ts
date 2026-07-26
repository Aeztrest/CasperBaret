/**
 * The actual "AI agent" demo: Claude, talking to the Baret Agent MCP server
 * over the real MCP protocol (spawned as a subprocess, not just imported
 * functions), autonomously deciding when to spend the agent wallet's money.
 *
 * Give it a research question. It can call check_balance, list_policy, and
 * ask_scrybe as many times as it thinks it needs to — but every ask_scrybe
 * call is checked against the wallet's own spending policy before anything
 * is paid, so if it tries to over-spend, the tool call itself comes back
 * refused. The point isn't "the agent is smart about money" — it's that it
 * doesn't have to be, because the wallet won't let it make that mistake.
 *
 * Requires ANTHROPIC_API_KEY in .env. Everything else in this package works
 * without one; only this file needs it.
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const QUESTION =
  process.argv.slice(2).join(" ") ||
  "Give me a short primer on how Casper's CEP-18 token standard works, asking as many follow-up questions as you need to.";

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set in apps/agent-mcp/.env — nothing else in this package needs it, only this demo.");
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: "npx",
    args: ["tsx", join(__dirname, "server.ts")],
    env: Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string")),
  });
  const mcp = new Client({ name: "baret-demo-agent-client", version: "0.1.0" });
  await mcp.connect(transport);

  const { tools: mcpTools } = await mcp.listTools();
  const anthropicTools: Anthropic.Tool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: (t.inputSchema ?? { type: "object", properties: {} }) as Anthropic.Tool.InputSchema,
  }));

  const anthropic = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: QUESTION }];

  console.log(`\n> ${QUESTION}\n`);

  for (let turn = 0; turn < 12; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 1024,
      system:
        "You are a research agent with your own small Casper testnet wallet. " +
        "You answer questions by paying Scrybe for answers via the ask_scrybe tool — " +
        "every call costs real (testnet) money from your wallet, capped by a spending " +
        "policy you don't control. If a call comes back blocked, don't retry it — " +
        "explain to the user what happened and summarize what you learned from the " +
        "questions that did go through.",
      messages,
      tools: anthropicTools,
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    for (const b of textBlocks) console.log(b.text);

    const toolUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0) break;

    messages.push({ role: "assistant", content: response.content });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      console.log(`  [tool] ${use.name}(${JSON.stringify(use.input)})`);
      const result = await mcp.callTool({ name: use.name, arguments: use.input as Record<string, unknown> });
      const resultText = (result.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      console.log(`  [result] ${resultText}`);
      toolResults.push({ type: "tool_result", tool_use_id: use.id, content: resultText });
    }
    messages.push({ role: "user", content: toolResults });
  }

  await mcp.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
