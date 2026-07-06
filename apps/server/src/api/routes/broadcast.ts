/**
 * POST /demo/broadcast — relay an already-signed Casper transaction to the
 * network on the browser's behalf.
 *
 * Casper's public RPC nodes don't send CORS headers, so a showcase page can't
 * call them directly from the browser (the preflight fails with no
 * Access-Control-Allow-Origin). The showcase's demo scenarios (mint/stake/
 * claim/launch, NovaSwap's scenario-demo pair) sign client-side and need
 * somewhere same-origin-ish to submit the result — this just forwards the
 * already-signed transaction to `casper.rpcUrl` and reports the outcome. It
 * holds no funds and signs nothing itself, unlike /demo/swap or /demo/faucet.
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/index.js";
import {
  makeRpcClient,
  explorerTxUrl,
  waitForExecutionError,
  Casper,
} from "@casper-baret/casper-core";

interface BroadcastBody {
  signedTransaction?: unknown;
}

export function registerBroadcastRoute(app: FastifyInstance, config: AppConfig): void {
  const { casper } = config;
  const rpc = makeRpcClient(casper.rpcUrl);

  app.post<{ Body: BroadcastBody }>("/demo/broadcast", async (req, reply) => {
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

    try {
      const res = await rpc.putTransaction(txn);
      const transactionHash = res.transactionHash?.toHex?.() ?? txn.hash.toHex();

      const execError = await waitForExecutionError(rpc, txn);
      if (execError) {
        return reply.status(502).send({
          error: `Transaction failed on-chain: ${execError}`,
          transactionHash,
          explorerUrl: explorerTxUrl(casper, transactionHash),
        });
      }

      return reply.send({
        success: true,
        transactionHash,
        explorerUrl: explorerTxUrl(casper, transactionHash),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "broadcast failed");
      return reply.status(502).send({ error: `Broadcast failed: ${message}` });
    }
  });
}
