/**
 * x402 fetch interceptor (page MAIN world, Casper build).
 *
 * Patches `window.fetch` to detect HTTP 402 responses carrying x402
 * `PaymentRequirements`. When detected, posts the requirements to the
 * background via the page bridge; on approval, retries the original fetch
 * with the `X-PAYMENT` header populated. dApps that don't speak x402 are
 * unaffected — non-402 responses pass through untouched.
 *
 * Casper requirements carry `network: casper:*`, a CEP-18 package-hash
 * `asset`, an account-hash `payTo`, and `extra.name` (token name).
 */

import { callPageBridge } from "./page-bridge";

const PAYMENT_HEADER = "X-PAYMENT";

interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: {
    name?: string;
    feePayer?: string;
    sponsorBy?: string;
    [k: string]: unknown;
  };
}

interface ReviewDecision {
  action: "approve" | "decline";
  headerValue?: string;
  reason?: string;
}

let installed = false;

export function installX402Interceptor(): void {
  if (installed) return;
  installed = true;

  const origFetch = window.fetch.bind(window);

  window.fetch = async function blackthornFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ) {
    const res = await origFetch(input as RequestInfo, init);
    if (res.status !== 402) return res;

    // If the page manages x402 payments itself (e.g. the Baret showcase calling
    // window.baret.payX402 explicitly), skip auto-interception so the page's
    // own flow runs instead of the interceptor firing with Baret's keys.
    if ((window as unknown as { __baretX402Managed?: boolean }).__baretX402Managed) return res;

    const requirements = await parseRequirements(res);
    if (!requirements) return res; // Non-x402 402 — bubble up.

    const requestUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    try {
      const decision = await callPageBridge<ReviewDecision>("x402.review", {
        origin: window.location.origin,
        requestUrl,
        requirements,
      });

      if (decision.action !== "approve" || !decision.headerValue) {
        return res;
      }

      const newInit: RequestInit = init ? { ...init } : {};
      const headers = new Headers(newInit.headers ?? {});
      headers.set(PAYMENT_HEADER, decision.headerValue);
      newInit.headers = headers;
      return await origFetch(input as RequestInfo, newInit);
    } catch (err) {
      console.error("[BARET x402] interceptor error:", err);
      return res;
    }
  };

  console.info("[BARET] x402 interceptor live (Casper)");
}

async function parseRequirements(
  res: Response,
): Promise<PaymentRequirements | null> {
  const headerValue =
    res.headers.get("x-payment-required") ?? res.headers.get("PAYMENT-REQUIRED");
  if (headerValue) {
    const parsed = tryParseJson(safeAtob(headerValue) ?? headerValue);
    const reqs = extractRequirements(parsed);
    if (reqs) return reqs;
  }

  const ct = res.headers.get("Content-Type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const cloned = res.clone();
      const body = await cloned.json();
      const reqs = extractRequirements(body);
      if (reqs) return reqs;
    } catch {
      /* not JSON, ignore */
    }
  }
  return null;
}

function extractRequirements(body: unknown): PaymentRequirements | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  if (
    typeof b.scheme === "string" &&
    typeof b.network === "string" &&
    typeof b.asset === "string" &&
    typeof b.amount === "string" &&
    typeof b.payTo === "string" &&
    b.extra
  ) {
    return b as unknown as PaymentRequirements;
  }
  if (Array.isArray(b.accepts) && b.accepts.length > 0) {
    return extractRequirements(b.accepts[0]);
  }
  if (b.accepted) return extractRequirements(b.accepted);

  return null;
}

function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function safeAtob(s: string): string | null {
  try {
    return atob(s);
  } catch {
    return null;
  }
}
