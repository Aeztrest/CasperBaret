import { keypairFromHex, makeRpcClient, type CasperKeypair } from "@casper-baret/casper-core";

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

let cachedKeypair: Promise<CasperKeypair> | null = null;

export function getAgentKeypair(): Promise<CasperKeypair> {
  if (!cachedKeypair) {
    cachedKeypair = keypairFromHex(
      env("AGENT_PRIVATE_KEY"),
      (process.env.AGENT_PRIVATE_KEY_ALGO as "ed25519" | "secp256k1") || "ed25519",
    );
  }
  return cachedKeypair;
}

export function getRpc() {
  return makeRpcClient(process.env.CASPER_RPC_URL || "https://node.testnet.casper.network/rpc");
}

export const CEP18_X402_PACKAGE = env("CEP18_X402_PACKAGE");
export const X402_TOKEN_DECIMALS = Number(process.env.X402_TOKEN_DECIMALS || 6);
export const SCRYBE_API_BASE = process.env.SCRYBE_API_BASE || "http://localhost:8080";
