import {
  createX402Payment,
  encodePaymentHeader,
  type CasperPaymentRequirements,
} from "@casper-baret/casper-core";
import { getAgentKeypair, SCRYBE_API_BASE } from "../agent-wallet.js";
import { checkPolicy, recordSpend } from "../policy.js";

export interface AskScrybeResult {
  paid: boolean;
  blocked: boolean;
  reason?: string;
  question: string;
  answer?: string;
  amountUsdc?: number;
  settlement?: string;
}

interface X402RequiredBody {
  x402Version: number;
  accepts: CasperPaymentRequirements[];
}

/**
 * Ask Scrybe one paid question, autonomously — this is the tool an LLM
 * calls without a human in the loop. It:
 *  1. Hits the paywalled endpoint to learn the real price (never assumes it).
 *  2. Checks that price against the agent's own spending policy BEFORE
 *     paying anything — if it would breach a cap, refuses and returns why,
 *     the same way Baret's wallet would refuse an over-cap payment.
 *  3. Only then signs and sends the x402 payment.
 */
export async function askScrybe(question: string): Promise<AskScrybeResult> {
  const url = `${SCRYBE_API_BASE}/demo/scrybe?q=${encodeURIComponent(question)}`;

  const first = await fetch(url);
  if (first.status !== 402) {
    if (first.ok) {
      // Already paid somehow, or paywall disabled — just return it.
      const body = (await first.json()) as { answer?: string };
      return { paid: false, blocked: false, question, answer: body.answer };
    }
    throw new Error(`Unexpected response from Scrybe: ${first.status} ${await first.text()}`);
  }

  const required = (await first.json()) as X402RequiredBody;
  const requirements = required.accepts[0];
  if (!requirements) throw new Error("Scrybe returned 402 with no payment requirements");

  const decimals = Number(requirements.extra.decimals ?? 6);
  const amountUsdc = Number(requirements.amount) / 10 ** decimals;

  const policyCheck = checkPolicy(amountUsdc);
  if (!policyCheck.allowed) {
    return {
      paid: false,
      blocked: true,
      reason: policyCheck.reason,
      question,
      amountUsdc,
    };
  }

  const kp = await getAgentKeypair();
  const payload = await createX402Payment(kp, requirements);
  const headerValue = encodePaymentHeader(payload, requirements);

  const paid = await fetch(url, { headers: { "X-PAYMENT": headerValue } });
  if (!paid.ok) {
    throw new Error(`Payment sent but Scrybe rejected it: ${paid.status} ${await paid.text()}`);
  }

  recordSpend(amountUsdc);

  const body = (await paid.json()) as { answer: string; settlement?: string };

  return {
    paid: true,
    blocked: false,
    question,
    answer: body.answer,
    amountUsdc,
    settlement: body.settlement,
  };
}
