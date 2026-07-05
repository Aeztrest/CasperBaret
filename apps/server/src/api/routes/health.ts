/**
 * GET /health — liveness + a small config summary so operators (and the
 * showcase) can confirm which network / x402 settings the server booted with.
 */

import type { FastifyInstance, FastifyReply } from "fastify";
import type { AppConfig } from "../../config/index.js";

export function registerHealthRoutes(app: FastifyInstance, config: AppConfig) {
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
      reputation: {
        risky: config.riskyContractPackages.size,
        knownSafe: config.knownSafeContractPackages.size,
      },
    });
  });
}
