import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  generateKeypair,
  createX402Payment,
  encodePaymentHeader,
  decodePaymentHeader,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  type CasperKeypair,
  type CasperPaymentRequirements,
} from "@casper-baret/casper-core";
import { buildApp } from "../../app.js";
import { loadConfig, type AppConfig } from "../../config/index.js";

const SETTLE_DEPLOY = "deploy-hash-xyz";

/** Mock facilitator: /verify → valid, /settle → success(deploy-hash-xyz). */
function mockFacilitatorFetch(): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = init?.body ? JSON.parse(init.body as string) : {};
    const payer: string | undefined =
      body?.paymentPayload?.payload?.authorization?.from;

    if (url.endsWith("/verify")) {
      return jsonResponse({ isValid: true, payer });
    }
    if (url.endsWith("/settle")) {
      return jsonResponse({
        success: true,
        transaction: SETTLE_DEPLOY,
        payer,
        network: "casper:casper-test",
      });
    }
    return jsonResponse({ error: "unknown endpoint" }, 404);
  }) as typeof fetch;
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function testConfig(): AppConfig {
  return loadConfig({
    NODE_ENV: "test",
    CASPER_NETWORK: "testnet",
    X402_ENABLED: "true",
    X402_FACILITATOR_URL: "http://localhost:4022",
    CEP18_X402_PACKAGE: "a".repeat(64),
    X402_PAY_TO: "b".repeat(64),
    X402_PRICE_ATOMIC: "10000",
    X402_TOKEN_NAME: "Cep18x402",
    DELTAG_API_KEYS: "",
    DELTAG_RATE_LIMIT_MAX: "0",
  });
}

describe("GET /demo/scrybe (x402 paywall)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let kp: CasperKeypair;

  beforeAll(async () => {
    kp = await generateKeypair("ed25519");
    app = await buildApp(testConfig(), {
      scrybe: { fetchImpl: mockFacilitatorFetch() },
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 402 with Casper PaymentRequirements when unpaid", async () => {
    const res = await app.inject({ method: "GET", url: "/demo/scrybe?q=hi" });
    expect(res.statusCode).toBe(402);
    const body = res.json();
    expect(body.x402Version).toBe(2);
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts[0].scheme).toBe("exact");
    expect(body.accepts[0].network).toBe("casper:casper-test");
    expect(res.headers["x-payment-required"]).toBeTruthy();
  });

  it("returns 200 + paid answer on a valid X-PAYMENT header", async () => {
    // 1. Get the requirements from the 402 response.
    const unpaid = await app.inject({ method: "GET", url: "/demo/scrybe?q=hi" });
    const requirements: CasperPaymentRequirements =
      unpaid.json().accepts[0];

    // 2. Build a real X-PAYMENT header against those requirements.
    const payload = await createX402Payment(kp, requirements);
    const header = encodePaymentHeader(payload, requirements);

    // sanity: the header round-trips and references our keypair.
    const decoded = decodePaymentHeader(header);
    expect(decoded.payload.authorization.from).toBe(kp.x402Address);

    // 3. Send it.
    const paid = await app.inject({
      method: "GET",
      url: "/demo/scrybe?q=hi",
      headers: { [PAYMENT_HEADER.toLowerCase()]: header },
    });

    expect(paid.statusCode).toBe(200);
    const body = paid.json();
    expect(body.paid).toBe(true);
    expect(body.settlement).toBe(SETTLE_DEPLOY);
    expect(body.payer).toBe(kp.x402Address);
    expect(typeof body.answer).toBe("string");
    expect(paid.headers[PAYMENT_RESPONSE_HEADER.toLowerCase()]).toBeTruthy();
  });
});
