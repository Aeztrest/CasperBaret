/**
 * POST /demo/swap/cspr-to-usdc — NovaSwap's real fixed-rate CSPR -> USDC(test)
 * swap.
 *
 * The client (NovaSwap) builds a plain native-transfer transaction sending
 * CSPR from the connected wallet to the treasury account, gets it signed by
 * the wallet, and posts the signed transaction JSON here. This route submits
 * it, confirms the treasury's CSPR balance actually increased (rather than
 * trusting the client's claimed amount/target — the transaction could
 * legitimately be signed but sent elsewhere), and pays out USDC(test) from
 * the treasury at a fixed rate.
 *
 * No custom "payable" contract is involved: Casper's Transaction V1 model has
 * no "attach value to a contract call" primitive without writing bespoke
 * session Wasm (the `cargo_purse` convention Odra's `#[odra(payable)]` relies
 * on) — a plain account-to-account native transfer plus a server-relayed
 * payout avoids that entirely while still moving real CSPR and real USDC.
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/index.js";
import {
  keypairFromHex,
  makeRpcClient,
  explorerTxUrl,
  waitForExecutionError,
  Args,
  CLValue,
  NamedArg,
  ContractCallBuilder,
  Casper,
} from "@casper-baret/casper-core";

const MOTES_PER_CSPR = 1_000_000_000n;

interface SwapBody {
  signedTransaction?: unknown;
}

export function registerSwapRoute(app: FastifyInstance, config: AppConfig): void {
  const { swap, casper, x402, faucet } = config;
  if (!swap.enabled) return;

  app.log.info(
    `CSPR->USDC swap live: POST /demo/swap/cspr-to-usdc (rate=${swap.rateAtomicUsdcPerCspr} atomic USDC per CSPR, max=${swap.maxCspr} CSPR/swap)`,
  );

  app.post<{ Body: SwapBody }>("/demo/swap/cspr-to-usdc", async (req, reply) => {
    const raw = req.body?.signedTransaction;
    if (!raw || typeof raw !== "object") {
      return reply.status(400).send({ error: "Missing signedTransaction" });
    }

    let txn: ReturnType<typeof Casper.Transaction.fromJSON>;
    try {
      txn = Casper.Transaction.fromJSON(raw);
    } catch (err) {
      return reply.status(400).send({
        error: "Malformed signedTransaction",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    if (txn.chainName !== casper.chainName) {
      return reply.status(400).send({ error: `Wrong chain — expected ${casper.chainName}` });
    }
    if (!txn.approvals || txn.approvals.length === 0) {
      return reply.status(400).send({ error: "Transaction is not signed" });
    }
    const senderPublicKey = txn.initiatorAddr?.publicKey;
    if (!senderPublicKey) {
      return reply.status(400).send({ error: "Transaction has no public-key initiator" });
    }

    try {
      const kp = await keypairFromHex(faucet.privateKeyHex, faucet.algo);
      const rpc = makeRpcClient(casper.rpcUrl);
      const treasuryPurse = Casper.PurseIdentifier.fromPublicKey(kp.privateKey.publicKey);

      const beforeRes = await rpc.queryLatestBalance(treasuryPurse);
      const before = BigInt(beforeRes.balance?.toString() ?? "0");

      let res;
      try {
        res = await rpc.putTransaction(txn);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Casper rejects native transfers below its own protocol minimum
        // (2.5 CSPR on testnet) before execution — surface that plainly
        // instead of a bare RPC error code.
        if (/invalid transaction/i.test(message)) {
          return reply.status(400).send({
            error: `Transfer rejected by the network — send at least ${swap.minCspr} CSPR (Casper's own minimum transfer amount).`,
          });
        }
        throw err;
      }
      const csprTransactionHash = res.transactionHash?.toHex?.() ?? txn.hash.toHex();

      const execError = await waitForExecutionError(rpc, txn);
      if (execError) {
        req.log.error({ csprTransactionHash, execError }, "swap CSPR transfer failed on-chain");
        return reply.status(502).send({
          error: `CSPR transfer failed on-chain: ${execError}`,
          csprTransactionHash,
          explorerUrl: explorerTxUrl(casper, csprTransactionHash),
        });
      }

      // Trust the OBSERVED balance change, not the claimed transaction target
      // — a validly-signed transfer could legitimately go anywhere.
      const afterRes = await rpc.queryLatestBalance(treasuryPurse);
      const after = BigInt(afterRes.balance?.toString() ?? "0");
      const receivedMotes = after - before;

      if (receivedMotes <= 0n) {
        return reply.status(400).send({
          error: "Transaction executed, but no CSPR reached the swap treasury — check the transfer target.",
          csprTransactionHash,
          explorerUrl: explorerTxUrl(casper, csprTransactionHash),
        });
      }

      const maxMotes = BigInt(Math.round(swap.maxCspr * 1e9));
      const capped = receivedMotes > maxMotes;
      const cappedMotes = capped ? maxMotes : receivedMotes;

      const usdcOut = (cappedMotes * BigInt(swap.rateAtomicUsdcPerCspr)) / MOTES_PER_CSPR;
      if (usdcOut <= 0n) {
        return reply.status(400).send({
          error: "Swap amount too small to pay out any USDC.",
          csprTransactionHash,
        });
      }

      const recipientKey = Casper.Key.newKey(
        `account-hash-${senderPublicKey.accountHash().toHex()}`,
      );
      const usdcTxn = new ContractCallBuilder()
        .from(kp.privateKey.publicKey)
        .byPackageHash(x402.asset)
        .entryPoint("transfer")
        .runtimeArgs(
          Args.fromNamedArgs([
            new NamedArg("recipient", CLValue.newCLKey(recipientKey)),
            new NamedArg("amount", CLValue.newCLUInt256(usdcOut)),
          ]),
        )
        .chainName(casper.chainName)
        .payment(5_000_000_000)
        .build();
      usdcTxn.sign(kp.privateKey);
      const usdcRes = await rpc.putTransaction(usdcTxn);
      const usdcTransactionHash = usdcRes.transactionHash?.toHex?.() ?? usdcTxn.hash.toHex();

      const usdcExecError = await waitForExecutionError(rpc, usdcTxn);
      if (usdcExecError) {
        req.log.error(
          { csprTransactionHash, usdcTransactionHash, usdcExecError },
          "swap USDC payout failed on-chain after CSPR was received",
        );
        return reply.status(502).send({
          error: `Received your CSPR, but the USDC payout failed on-chain: ${usdcExecError}. Contact support with this transaction hash.`,
          csprTransactionHash,
          usdcTransactionHash,
          explorerUrl: explorerTxUrl(casper, usdcTransactionHash),
        });
      }

      req.log.info(
        { csprTransactionHash, usdcTransactionHash, receivedMotes: receivedMotes.toString(), usdcOut: usdcOut.toString() },
        "swap settled",
      );

      return reply.send({
        success: true,
        csprTransactionHash,
        usdcTransactionHash,
        csprMotes: cappedMotes.toString(),
        usdcAtomic: usdcOut.toString(),
        explorerUrl: explorerTxUrl(casper, usdcTransactionHash),
        ...(capped && {
          note: `Only swapped up to the ${swap.maxCspr} CSPR/tx cap — the rest of your transfer was received but not exchanged.`,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "swap failed");
      return reply.status(502).send({ error: `Swap failed: ${message}` });
    }
  });
}
