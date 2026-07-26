/**
 * One-off: fund the demo agent's wallet with test-USDC from the project
 * treasury (apps/server/.env FAUCET_PRIVATE_KEY), so it has real x402
 * spending money. The agent never submits its own transactions (Baret's
 * facilitator settles on its behalf), so it doesn't need CSPR for gas.
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  keypairFromHex,
  makeRpcClient,
  waitForExecutionError,
  Args,
  CLValue,
  NamedArg,
  ContractCallBuilder,
  Casper,
} from "@casper-baret/casper-core";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read the treasury key straight out of apps/server/.env — never copied into
// this package's own .env.
function readServerEnvVar(name: string): string {
  const envPath = join(__dirname, "../../server/.env");
  const text = readFileSync(envPath, "utf8");
  const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
  if (!line) throw new Error(`${name} not found in apps/server/.env`);
  return line.slice(name.length + 1).trim();
}

const AGENT_ACCOUNT_HASH = "8330082e992d11fd210bb204dc1a176e49c62f04e0d77db0ac981517a3512ac2";
const CEP18_X402_PACKAGE = "d12df5a1cb028c56a7e1169c84fbdd3f98a23860c1029650e72f2873bfd8240d";
const FUND_ATOMIC = "2000000"; // 2 USDC (6 decimals) — ~100 Scrybe questions worth

async function main() {
  const treasuryKeyHex = readServerEnvVar("FAUCET_PRIVATE_KEY");
  const kp = await keypairFromHex(treasuryKeyHex, "ed25519");
  const rpc = makeRpcClient("https://node.testnet.casper.network/rpc");

  const recipientKey = CLValue.newCLKey(Casper.Key.newKey(`account-hash-${AGENT_ACCOUNT_HASH}`));

  const txn = new ContractCallBuilder()
    .from(kp.privateKey.publicKey)
    .byPackageHash(CEP18_X402_PACKAGE)
    .entryPoint("transfer")
    .runtimeArgs(Args.fromNamedArgs([
      new NamedArg("recipient", recipientKey),
      new NamedArg("amount", CLValue.newCLUInt256(FUND_ATOMIC)),
    ]))
    .chainName("casper-test")
    .payment(5_000_000_000)
    .build();

  txn.sign(kp.privateKey);
  const res = await rpc.putTransaction(txn);
  const transactionHash = res.transactionHash?.toHex?.() ?? txn.hash.toHex();
  console.log("submitted:", transactionHash);

  const execError = await waitForExecutionError(rpc, txn, 90_000);
  if (execError) {
    console.error("FAILED on-chain:", execError);
    process.exit(1);
  }
  console.log(`SUCCESS — sent ${Number(FUND_ATOMIC) / 1e6} USDC(test) to the agent wallet.`);
}
main().catch((e) => { console.error(e); process.exit(1); });
