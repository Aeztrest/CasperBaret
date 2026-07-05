/**
 * GET /health — liveness + a small config summary so operators (and the
 * showcase) can confirm which network / x402 settings the server booted with.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "../../config/index.js";
import { keypairFromHex } from "@casper-baret/casper-core";

export function registerHealthRoutes(app: FastifyInstance, config: AppConfig) {
  // Resolved once at boot, not per-request — the treasury key never changes
  // at runtime, and NovaSwap needs its public key as the swap's send-to target.
  const treasuryPublicKeyHex: Promise<string | undefined> = config.swap.enabled
    ? keypairFromHex(config.faucet.privateKeyHex, config.faucet.algo).then((kp) => kp.publicKeyHex)
    : Promise.resolve(undefined);

  app.get("/health", async (_req, reply: FastifyReply) => {
    return reply.send({
      status: "ok",
      service: "baret-casper-server",
      version: "0.1.0",
      network: {
        id: config.casper.id,
        chainName: config.casper.chainName,
        caip2: config.casper.caip2,
        rpcUrl: config.casper.rpcUrl,
      },
      x402: {
        enabled: config.x402.enabled,
        facilitatorUrl: config.x402.enabled
          ? config.x402.facilitatorUrl
          : undefined,
        asset: config.x402.enabled ? config.x402.asset : undefined,
        priceAtomic: config.x402.enabled ? config.x402.priceAtomic : undefined,
        feeAtomic: config.x402.enabled ? config.x402.feeAtomic : undefined,
        gasSurchargeAtomic: config.x402.enabled ? config.x402.gasSurchargeAtomic : undefined,
        tokenDecimals: config.x402.enabled ? config.x402.tokenDecimals : undefined,
        tokenName: config.x402.enabled ? config.x402.tokenName : undefined,
      },
      swap: {
        enabled: config.swap.enabled,
        treasuryPublicKey: config.swap.enabled ? await treasuryPublicKeyHex : undefined,
        rateAtomicUsdcPerCspr: config.swap.enabled ? config.swap.rateAtomicUsdcPerCspr : undefined,
        maxCspr: config.swap.enabled ? config.swap.maxCspr : undefined,
        minCspr: config.swap.enabled ? config.swap.minCspr : undefined,
      },
      reputation: {
        risky: config.riskyContractPackages.size,
        knownSafe: config.knownSafeContractPackages.size,
      },
    });
  });
}
