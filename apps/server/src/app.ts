/**
 * Baret Casper server — Fastify app wiring.
 *
 * Three routes:
 *   GET  /health        — liveness + config summary
 *   POST /v1/analyze    — Casper transaction analysis
 *   GET  /demo/scrybe   — x402 agentic paywall
 */

import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import type { AppConfig } from "./config/index.js";
import { fastifyLoggerOptions } from "./infra/logger.js";
import { apiError } from "./api/errors.js";
import { extractApiKeyFromHeader } from "./api/extract-api-key.js";
import { registerHealthRoutes } from "./api/routes/health.js";
import { registerAnalyzeRoute } from "./api/routes/analyze.js";
import { registerScrybeRoute, type ScrybeDeps } from "./api/routes/scrybe.js";
import { registerFaucetRoute } from "./api/routes/faucet.js";
import { registerFacilitatorRoutes } from "./api/routes/facilitator.js";
import { registerSwapRoute } from "./api/routes/swap.js";

export interface BuildAppOptions {
  /** Injectable x402 facilitator URL / fetch — used by tests. */
  scrybe?: ScrybeDeps;
}

export async function buildApp(config: AppConfig, opts: BuildAppOptions = {}) {
  const app = Fastify({
    logger: fastifyLoggerOptions(config),
    bodyLimit: config.maxBodyBytes,
    requestTimeout: config.requestTimeoutMs,
    genReqId: () => crypto.randomUUID(),
    trustProxy: config.trustProxy,
  });

  // CORS — allow configured origins and localhost for dev
  if (config.corsOrigins.length > 0) {
    const allowedSet = new Set(config.corsOrigins);
    app.addHook("onRequest", async (req, reply) => {
      const origin = req.headers.origin;
      const allowed =
        origin &&
        (allowedSet.has(origin) || /^https?:\/\/localhost(:\d+)?$/.test(origin));
      if (allowed) {
        reply.header("Access-Control-Allow-Origin", origin!);
        reply.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        reply.header(
          "Access-Control-Allow-Headers",
          "accept, content-type, x-payment, x-api-key, authorization",
        );
        reply.header(
          "Access-Control-Expose-Headers",
          "x-payment-required, x-payment-response",
        );
        reply.header("Access-Control-Max-Age", "86400");
      }
      if (req.method === "OPTIONS") {
        return reply.code(204).send();
      }
    });
  }

  if (config.rateLimitMax > 0) {
    await app.register(rateLimit, {
      max: config.rateLimitMax,
      timeWindow: config.rateLimitWindowMs,
      allowList: (req) => {
        const path = req.url.split("?")[0] ?? "";
        return path === "/health" || path.startsWith("/health/");
      },
    });
  }

  // Optional API-key gate on /v1/*. The x402 paywall and /health are open.
  app.addHook("onRequest", async (req, reply) => {
    if (!req.url.startsWith("/v1/")) return;
    if (config.apiKeys.length === 0) {
      if (config.nodeEnv === "production") {
        req.log.warn("DELTAG_API_KEYS empty in production");
      }
      return;
    }
    const fromHeader =
      extractApiKeyFromHeader(req.headers.authorization) ??
      (typeof req.headers["x-api-key"] === "string"
        ? req.headers["x-api-key"]
        : null);
    if (!fromHeader || !config.apiKeys.includes(fromHeader)) {
      return reply
        .status(401)
        .send(apiError("UNAUTHORIZED", "Invalid or missing API key"));
    }
  });

  registerHealthRoutes(app, config);
  registerAnalyzeRoute(app, config);
  registerFacilitatorRoutes(app, config);
  registerScrybeRoute(app, config, opts.scrybe);
  registerFaucetRoute(app, config);
  registerSwapRoute(app, config);

  return app;
}
