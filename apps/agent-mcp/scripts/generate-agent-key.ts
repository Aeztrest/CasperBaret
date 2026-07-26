/** One-off: generate a fresh keypair for the demo agent's own dedicated wallet. */
import { generateKeypair, privateKeyHex } from "@casper-baret/casper-core";

async function main() {
  const kp = await generateKeypair("ed25519");
  console.log("Agent public key:", kp.publicKeyHex);
  console.log("Agent account hash:", kp.accountHashHex);
  console.log("\nAdd this to apps/agent-mcp/.env:");
  console.log(`AGENT_PRIVATE_KEY=${privateKeyHex(kp)}`);
  console.log("AGENT_PRIVATE_KEY_ALGO=ed25519");
}
main().catch((e) => { console.error(e); process.exit(1); });
