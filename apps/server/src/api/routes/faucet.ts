/**
 * POST /demo/faucet — treasury-backed testnet CSPR faucet.
 *
 * Casper's public faucet is captcha-gated with no programmatic API, so for the
 * demo we run our own: a funded treasury account (FAUCET_PRIVATE_KEY) sends a
 * fixed amount of CSPR per claim. A small in-memory cooldown (per address +
 * per IP) throttles abuse.
 *
 * Note: the cooldown lives in process memory — perfect for a single long-lived
 * server, but it resets on a serverless cold start. Fine for the demo; swap in
 * a shared store (KV/Redis) if this ever runs multi-instance.
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/index.js";
import {
  keypairFromHex,
  makeRpcClient,
  isPublicKeyHex,
  isAccountHash,
  explorerTxUrl,
  waitForExecutionError,
  Args,
  CLValue,
  NamedArg,
  ContractCallBuilder,
  Casper,
} from "@casper-baret/casper-core";

interface FaucetBody {
  address?: string;
}

export function registerFaucetRoute(app: FastifyInstance, config: AppConfig) {
  const { faucet, casper, x402 } = config;
  const cooldownMs = faucet.cooldownSeconds * 1000;
  // key ("addr:…" | "ip:…") → last successful claim epoch ms.
  const lastClaim = new Map<string, number>();
  // Separate cooldown bucket so claiming CSPR doesn't block a token claim.
  const lastTokenClaim = new Map<string, number>();

  if (faucet.enabled) {
    app.log.info(
      `CSPR faucet live: POST /demo/faucet (amount=${faucet.amountCspr} CSPR, cooldown=${faucet.cooldownSeconds}s, network=${casper.caip2})`,
    );
    if (x402.enabled && x402.asset) {
      app.log.info(
        `Token faucet live: POST /demo/faucet-token (amount=${faucet.tokenAmount} of ${x402.asset.slice(0, 8)}…, cooldown=${faucet.cooldownSeconds}s)`,
      );
    }
  }

  app.post<{ Body: FaucetBody }>("/demo/faucet", async (req, reply) => {
    if (!faucet.enabled) {
      return reply.status(503).send({ error: "Faucet is disabled on this server." });
    }

    const address = (req.body?.address ?? "").trim();
    if (!isPublicKeyHex(address) && !isAccountHash(address)) {
      return reply
        .status(400)
        .send({ error: "Invalid address — expected a public key hex or account hash." });
    }

    // Cooldown gate (address + IP), checked before spending.
    const now = Date.now();
    const keys = [`addr:${address.toLowerCase()}`, `ip:${req.ip}`];
    for (const key of keys) {
      const last = lastClaim.get(key);
      if (last !== undefined && now - last < cooldownMs) {
        const retryAfterSeconds = Math.ceil((cooldownMs - (now - last)) / 1000);
        return reply.status(429).send({
          error: `Faucet cooldown — try again in ${retryAfterSeconds}s.`,
          retryAfterSeconds,
        });
      }
    }

    try {
      const kp = await keypairFromHex(faucet.privateKeyHex, faucet.algo);
      const rpc = makeRpcClient(casper.rpcUrl);
      const motes = BigInt(Math.round(faucet.amountCspr * 1e9)).toString();

      const builder = new Casper.NativeTransferBuilder()
        .from(kp.privateKey.publicKey)
        .chainName(casper.chainName)
        .payment(100_000_000) // 0.1 CSPR transfer fee budget
        .amount(motes);

      if (isPublicKeyHex(address)) {
        builder.target(Casper.PublicKey.fromHex(address));
      } else {
        builder.targetAccountHash(new Casper.AccountHash(Casper.Hash.fromHex(address)));
      }

      const txn = builder.build();
      txn.sign(kp.privateKey);
      const res = await rpc.putTransaction(txn);
      const transactionHash = res.transactionHash?.toHex?.() ?? txn.hash.toHex();

      // Only start the cooldown once the transfer actually executed — a
      // submitted-but-failed deploy shouldn't burn the user's claim.
      const execError = await waitForExecutionError(rpc, txn);
      if (execError) {
        req.log.error({ address, transactionHash, execError }, "faucet transfer failed on-chain");
        return reply.status(502).send({
          error: `Faucet transfer failed on-chain: ${execError}`,
          transactionHash,
          explorerUrl: explorerTxUrl(casper, transactionHash),
        });
      }
      for (const key of keys) lastClaim.set(key, now);

      req.log.info({ address, transactionHash }, "faucet sent CSPR");
      return reply.send({
        ok: true,
        transactionHash,
        amountCspr: faucet.amountCspr,
        explorerUrl: explorerTxUrl(casper, transactionHash),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "faucet transfer failed");
      return reply.status(502).send({ error: `Faucet transfer failed: ${message}` });
    }
  });

  // POST /demo/faucet-token — send a fixed amount of the x402 CEP-18 test
  // token (e.g. test USDC) from the treasury to the caller's account.
  app.post<{ Body: FaucetBody }>("/demo/faucet-token", async (req, reply) => {
    if (!faucet.enabled) {
      return reply.status(503).send({ error: "Faucet is disabled on this server." });
    }
    if (!x402.enabled || !x402.asset) {
      return reply.status(503).send({ error: "No x402 test token configured (CEP18_X402_PACKAGE)." });
    }

    const address = (req.body?.address ?? "").trim();
    if (!isPublicKeyHex(address) && !isAccountHash(address)) {
      return reply
        .status(400)
        .send({ error: "Invalid address — expected a public key hex or account hash." });
    }

    const now = Date.now();
    const keys = [`addr:${address.toLowerCase()}`, `ip:${req.ip}`];
    for (const key of keys) {
      const last = lastTokenClaim.get(key);
      if (last !== undefined && now - last < cooldownMs) {
        const retryAfterSeconds = Math.ceil((cooldownMs - (now - last)) / 1000);
        return reply.status(429).send({
          error: `Faucet cooldown — try again in ${retryAfterSeconds}s.`,
          retryAfterSeconds,
        });
      }
    }

    try {
      const kp = await keypairFromHex(faucet.privateKeyHex, faucet.algo);
      const rpc = makeRpcClient(casper.rpcUrl);
      const atomicAmount = (
        BigInt(Math.round(faucet.tokenAmount * 10 ** x402.tokenDecimals))
      ).toString();

      const recipientKey = isPublicKeyHex(address)
        ? Casper.Key.newKey(Casper.PublicKey.fromHex(address).accountHash().toPrefixedString())
        : Casper.Key.newKey(`account-hash-${address.replace(/^account-hash-/i, "")}`);

      const txn = new ContractCallBuilder()
        .from(kp.privateKey.publicKey)
        .byPackageHash(x402.asset)
        .entryPoint("transfer")
        .runtimeArgs(
          Args.fromNamedArgs([
            new NamedArg("recipient", CLValue.newCLKey(recipientKey)),
            new NamedArg("amount", CLValue.newCLUInt256(atomicAmount)),
          ]),
        )
        .chainName(casper.chainName)
        .payment(5_000_000_000) // 5 CSPR gas budget
        .build();

      txn.sign(kp.privateKey);
      const res = await rpc.putTransaction(txn);
      const transactionHash = res.transactionHash?.toHex?.() ?? txn.hash.toHex();

      const execError = await waitForExecutionError(rpc, txn);
      if (execError) {
        req.log.error({ address, transactionHash, execError }, "token faucet transfer failed on-chain");
        return reply.status(502).send({
          error: `Faucet transfer failed on-chain: ${execError}`,
          transactionHash,
          explorerUrl: explorerTxUrl(casper, transactionHash),
        });
      }
      for (const key of keys) lastTokenClaim.set(key, now);

      req.log.info({ address, transactionHash }, "faucet sent test token");
      return reply.send({
        ok: true,
        transactionHash,
        amount: faucet.tokenAmount,
        symbol: x402.tokenName,
        explorerUrl: explorerTxUrl(casper, transactionHash),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "token faucet transfer failed");
      return reply.status(502).send({ error: `Faucet transfer failed: ${message}` });
    }
  });
}
