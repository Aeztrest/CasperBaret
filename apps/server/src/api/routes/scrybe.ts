/**
 * GET /demo/scrybe?q=<question> — the x402 agentic paywall (centerpiece).
 *
 * Unpaid requests get HTTP 402 with Casper PaymentRequirements. A request
 * carrying a valid `X-PAYMENT` header is verified + settled through a
 * make-software/casper-x402 facilitator, then the answer is returned with an
 * `X-PAYMENT-RESPONSE` header.
 *
 * Wire contract matches the Go facilitator (see casper-core x402.ts).
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  decodePaymentHeader,
  verifyPayment,
  settlePayment,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  X402_VERSION,
  type CasperPaymentRequirements,
} from "@casper-baret/casper-core";
import type { AppConfig } from "../../config/index.js";

export interface ScrybeDeps {
  /** Override facilitator URL (tests). Defaults to config.x402.facilitatorUrl. */
  facilitatorUrl?: string;
  /** Injectable fetch so tests never touch the network. */
  fetchImpl?: typeof fetch;
}

interface ScrybeQuery {
  q?: string;
}

const STOCK_ANSWERS: Record<string, string> = {
  casper:
    "Casper is a PoS L1; accounts are ed25519/secp256k1, native unit is the mote (1 CSPR = 1e9), and contracts live behind a contract package hash.",
  cep18:
    "CEP-18 is Casper's fungible-token standard (ERC-20-like): transfer, approve(spender,amount), transfer_from. Tokens are identified by their contract package hash.",
  x402:
    "x402 v2 on Casper signs an EIP-712 TransferWithAuthorization over a CEP-18 token; a facilitator verifies + settles it on-chain, returning the deploy hash.",
  motes: "1 CSPR = 1,000,000,000 motes. Gas and native transfers are denominated in motes.",
  baret:
    "Baret is a transaction firewall: every signature first passes Baret's simulation + your guard policy, so drains and unlimited allowances are blocked pre-sign.",
};

function answerFor(q: string): string {
  const lower = q.toLowerCase();
  for (const [key, val] of Object.entries(STOCK_ANSWERS)) {
    if (lower.includes(key)) return val;
  }
  return `Echo (${q.length} chars): ${q.slice(0, 200)}`;
}

function base64Json(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

function pickHeader(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export function registerScrybeRoute(
  app: FastifyInstance,
  config: AppConfig,
  deps: ScrybeDeps = {},
): void {
  if (!config.x402.enabled) {
    app.log.warn("x402 disabled — /demo/scrybe paywall not registered");
    return;
  }

  const facilitatorUrl = deps.facilitatorUrl ?? config.x402.facilitatorUrl;

  function buildRequirements(q: string): CasperPaymentRequirements {
    return {
      scheme: "exact",
      network: config.x402.network,
      asset: config.x402.asset,
      amount: config.x402.priceAtomic,
      payTo: config.x402.payTo,
      maxTimeoutSeconds: 60,
      extra: {
        name: config.x402.tokenName,
        version: config.x402.tokenVersion,
        decimals: config.x402.tokenDecimals,
        description: `Scrybe answer for: ${q.slice(0, 80)}`,
        mimeType: "application/json",
      },
    };
  }

  function send402(
    reply: FastifyReply,
    requirements: CasperPaymentRequirements,
    q: string,
    error = "Payment required",
  ) {
    const body = {
      x402Version: X402_VERSION,
      error,
      resource: {
        url: `/demo/scrybe?q=${encodeURIComponent(q)}`,
        description: "Scrybe — one paywalled answer",
        mimeType: "application/json",
      },
      accepts: [requirements],
    };
    reply.code(402);
    reply.header("X-PAYMENT-REQUIRED", base64Json(body));
    return reply.send(body);
  }

  app.get<{ Querystring: ScrybeQuery }>("/demo/scrybe", async (req, reply) => {
    const q = (req.query.q ?? "").trim();
    if (!q) return reply.code(400).send({ error: "Missing ?q parameter" });
    if (q.length > 500) {
      return reply.code(400).send({ error: "Question too long (max 500 chars)" });
    }

    const requirements = buildRequirements(q);
    const headerValue = pickHeader(req, PAYMENT_HEADER);

    if (!headerValue) {
      return send402(reply, requirements, q);
    }

    // Decode the client payment payload.
    let payload;
    try {
      payload = decodePaymentHeader(headerValue);
    } catch (err) {
      return reply.code(400).send({
        error: `Malformed ${PAYMENT_HEADER} header`,
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    // Verify with the facilitator.
    const verifyRes = await verifyPayment(
      facilitatorUrl,
      payload,
      requirements,
      deps.fetchImpl,
    ).catch((err) => ({
      isValid: false as const,
      invalidReason: err instanceof Error ? err.message : String(err),
    }));

    if (!verifyRes.isValid) {
      return send402(
        reply,
        requirements,
        q,
        verifyRes.invalidReason ?? "verification_failed",
      );
    }

    // Settle on-chain via the facilitator.
    const settleRes = await settlePayment(
      facilitatorUrl,
      payload,
      requirements,
      deps.fetchImpl,
    ).catch((err) => ({
      success: false as const,
      errorReason: err instanceof Error ? err.message : String(err),
    }));

    if (!settleRes.success) {
      return reply.code(502).send({
        error: "Settlement failed at facilitator",
        detail: settleRes.errorReason,
      });
    }

    reply.header(
      PAYMENT_RESPONSE_HEADER,
      base64Json({
        success: true,
        transaction: settleRes.transaction,
        network: settleRes.network ?? requirements.network,
        payer: settleRes.payer ?? verifyRes.payer,
      }),
    );

    return reply.send({
      answer: answerFor(q),
      paid: true,
      settlement: settleRes.transaction,
      payer: settleRes.payer ?? verifyRes.payer,
    });
  });

  app.log.info(
    `x402 paywall live: GET /demo/scrybe (asset=${config.x402.asset.slice(0, 8)}…, network=${config.x402.network}, facilitator=${facilitatorUrl})`,
  );
}
