/**
 * POST /v1/analyze — analyze a Casper transaction against a guard policy and
 * return an AnalysisResult.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppConfig } from "../../config/index.js";
import { apiError } from "../errors.js";
import { analyzeTransaction } from "../../analyze/analyze.js";

const requirementsSchema = z
  .object({
    scheme: z.string(),
    network: z.string(),
    asset: z.string(),
    amount: z.string(),
    payTo: z.string(),
    maxTimeoutSeconds: z.number(),
    extra: z.record(z.unknown()).default({}),
  })
  .passthrough();

const bodySchema = z.object({
  network: z.enum(["testnet", "mainnet"]).default("testnet"),
  // transaction may be a JSON string OR an object (intent envelope / raw tx).
  transaction: z.union([z.string(), z.record(z.unknown())]),
  userWallet: z.string().min(1),
  policy: z.record(z.unknown()).default({}),
  integratorRequestId: z.string().optional(),
  paymentRequirements: requirementsSchema.optional(),
});

export function registerAnalyzeRoute(app: FastifyInstance, config: AppConfig) {
  app.post("/v1/analyze", async (req, reply) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send(
          apiError("BAD_REQUEST", "Invalid analyze request", {
            issues: parsed.error.flatten().fieldErrors,
          }),
        );
    }
    const b = parsed.data;

    try {
      const result = analyzeTransaction({
        network: b.network,
        transaction: b.transaction,
        userWallet: b.userWallet,
        policy: b.policy as Parameters<typeof analyzeTransaction>[0]["policy"],
        integratorRequestId: b.integratorRequestId,
        paymentRequirements:
          b.paymentRequirements as Parameters<
            typeof analyzeTransaction
          >[0]["paymentRequirements"],
        riskyPackages: config.riskyContractPackages,
        knownSafePackages: config.knownSafeContractPackages,
        knownTokenDecimals: config.x402.enabled && config.x402.asset
          ? { [config.x402.asset.toLowerCase()]: config.x402.tokenDecimals }
          : undefined,
      });
      return reply.send(result);
    } catch (err) {
      req.log.error({ err }, "analyze failed");
      return reply
        .status(500)
        .send(
          apiError(
            "INTERNAL_ERROR",
            err instanceof Error ? err.message : "analysis failed",
          ),
        );
    }
  });
}
