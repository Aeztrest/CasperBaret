import { readCep18Balance, Casper } from "@casper-baret/casper-core";
import { getAgentKeypair, getRpc, CEP18_X402_PACKAGE, X402_TOKEN_DECIMALS } from "../agent-wallet.js";

export async function checkBalance(): Promise<{ csprMotes: string; usdcAtomic: string; usdcHuman: number; accountHash: string }> {
  const kp = await getAgentKeypair();
  const rpc = getRpc();

  let csprMotes = "0";
  try {
    const bal = await rpc.queryLatestBalance(Casper.PurseIdentifier.fromPublicKey(kp.privateKey.publicKey));
    csprMotes = bal.balance?.toString() ?? "0";
  } catch {
    // Account not yet on-chain — zero balance.
  }

  const usdcAtomic = await readCep18Balance(rpc, CEP18_X402_PACKAGE, kp.accountHashHex);

  return {
    csprMotes,
    usdcAtomic,
    usdcHuman: Number(usdcAtomic) / 10 ** X402_TOKEN_DECIMALS,
    accountHash: kp.accountHashHex,
  };
}
