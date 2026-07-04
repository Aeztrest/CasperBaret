/**
 * Built-in x402 facilitator — POST /facilitate/verify and /facilitate/settle.
 *
 * Replaces the need for an external make-software/casper-x402 facilitator:
 *
 * /verify — pure cryptographic check of the EIP-712 TransferWithAuthorization
 *   signature. No network call; the digest is rebuilt from the authorization
 *   fields and verified against the declared public key.
 *
 * /settle — submits `transfer_with_authorization` on the CEP-18 contract.
 *   The server's treasury key (FAUCET_PRIVATE_KEY) pays gas (CSPR). The CEP-18
 *   contract deducts tokens from the payer's account and credits the payee.
 *   Returns the real Casper transaction hash.
 *
 * /supported — lists which assets and networks this facilitator accepts.
 */

import type { FastifyInstance } from "fastify";
import {
  verifyX402Signature,
  type X402PaymentPayload,
  type CasperPaymentRequirements,
  keypairFromHex,
  makeRpcClient,
  explorerTxUrl,
  Args,
  CLValue,
  CLTypeUInt8,
  NamedArg,
  ContractCallBuilder,
  Casper,
} from "@casper-baret/casper-core";
import type { AppConfig } from "../../config/index.js";

interface VerifyBody {
  x402Version?: number;
  paymentPayload?: X402PaymentPayload;
  paymentRequirements?: CasperPaymentRequirements;
}

interface SettleBody {
  x402Version?: number;
  paymentPayload?: X402PaymentPayload;
  paymentRequirements?: CasperPaymentRequirements;
}

/** Encode a byte buffer as a Casper `List<U8>` CLValue (matches Rust `Bytes`/`Vec<u8>` args). */
function bytesToU8List(bytes: Buffer) {
  return CLValue.newCLList(CLTypeUInt8, Array.from(bytes).map((b) => CLValue.newCLUint8(b)));
}

export function registerFacilitatorRoutes(app: FastifyInstance, config: AppConfig): void {
  if (!config.x402.enabled) return;

  // GET /facilitate/supported — let the scrybe route's facilitator check pass
  app.get("/facilitate/supported", async (_req, reply) => {
    return reply.send({
      kinds: [{ kind: "exact", asset: config.x402.asset, network: config.x402.network }],
    });
  });

  // POST /facilitate/verify — cryptographic signature check
  app.post<{ Body: VerifyBody }>("/facilitate/verify", async (req, reply) => {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      return reply.code(400).send({ isValid: false, invalidReason: "missing paymentPayload or paymentRequirements" });
    }

    const result = verifyX402Signature(paymentPayload, paymentRequirements);
    return reply.send(result);
  });

  // POST /facilitate/settle — on-chain CEP-18 transfer_with_authorization
  app.post<{ Body: SettleBody }>("/facilitate/settle", async (req, reply) => {
    const { paymentPayload, paymentRequirements } = req.body ?? {};
    if (!paymentPayload || !paymentRequirements) {
      return reply.code(400).send({ success: false, errorReason: "missing paymentPayload or paymentRequirements" });
    }

    // Re-verify before settling (idempotency guard)
    const check = verifyX402Signature(paymentPayload, paymentRequirements);
    if (!check.isValid) {
      return reply.code(400).send({ success: false, errorReason: check.invalidReason });
    }

    if (!config.faucet.enabled || !config.faucet.privateKeyHex) {
      return reply.code(503).send({
        success: false,
        errorReason: "Settlement requires FAUCET_PRIVATE_KEY — treasury key for gas payment",
      });
    }

    const auth = paymentPayload.payload.authorization;
    const assetHex = paymentRequirements.asset.toLowerCase().replace(/^0x/, "");

    try {
      const kp = await keypairFromHex(config.faucet.privateKeyHex, config.faucet.algo);
      const rpc = makeRpcClient(config.casper.rpcUrl);

      // Demo mode: submit a real CSPR self-transfer (treasury→treasury) so the
      // returned hash is genuinely on-chain and shows as succeeded in the explorer.
      // 2,500,000,000 motes = 2.5 CSPR — Casper testnet minimum transfer amount.
      if (config.x402.demoMode) {
        const demoTxn = new Casper.NativeTransferBuilder()
          .from(kp.privateKey.publicKey)
          .target(kp.privateKey.publicKey)
          .chainName(config.casper.chainName)
          .payment(100_000_000)
          .amount("2500000000")
          .build();
        demoTxn.sign(kp.privateKey);
        const demoRes = await rpc.putTransaction(demoTxn);
        const txHash = demoRes.transactionHash?.toHex?.() ?? demoTxn.hash.toHex();
        req.log.info({ txHash, payer: auth.from }, "x402 demo settlement (CSPR self-transfer)");
        return reply.send({
          success: true,
          transaction: txHash,
          network: config.casper.caip2,
          payer: auth.from,
          explorerUrl: explorerTxUrl(config.casper, txHash),
        });
      }

      // from/to in the authorization are "00"+64hex (x402 address, 33 bytes)
      // strip the leading "00" prefix to get the raw 32-byte account hash
      const fromBytes = Buffer.from(auth.from.slice(2), "hex"); // 32 bytes
      const toBytes = Buffer.from(auth.to.slice(2), "hex");     // 32 bytes
      const nonceBytes = Buffer.from(auth.nonce, "hex");         // 32 bytes
      // The contract independently derives the signer's account hash from
      // `public_key` and requires it match `from` — so the full tagged
      // public key and the full tagged (algo-byte-prefixed) signature are
      // passed through as-is, matching `PublicKey`/`Signature` bytesrepr.
      const publicKeyBytes = Buffer.from(paymentPayload.payload.publicKey, "hex");
      const sigBytes = Buffer.from(paymentPayload.payload.signature, "hex"); // 65 bytes

      const callBuilder = new ContractCallBuilder()
        .from(kp.privateKey.publicKey)
        .byPackageHash(assetHex)
        .entryPoint("transfer_with_authorization")
        .runtimeArgs(
          Args.fromNamedArgs([
            new NamedArg("from",         CLValue.newCLByteArray(fromBytes)),
            new NamedArg("to",           CLValue.newCLByteArray(toBytes)),
            new NamedArg("amount",       CLValue.newCLUInt256(BigInt(auth.value))),
            new NamedArg("valid_after",  CLValue.newCLUInt256(BigInt(auth.validAfter))),
            new NamedArg("valid_before", CLValue.newCLUInt256(BigInt(auth.validBefore))),
            new NamedArg("nonce",        CLValue.newCLByteArray(nonceBytes)),
            new NamedArg("public_key",   bytesToU8List(publicKeyBytes)),
            new NamedArg("signature",    bytesToU8List(sigBytes)),
          ]),
        )
        .chainName(config.casper.chainName)
        .payment(3_000_000_000); // 3 CSPR gas budget

      const txn = callBuilder.build();
      txn.sign(kp.privateKey);
      const res = await rpc.putTransaction(txn);
      const txHash = res.transactionHash?.toHex?.() ?? txn.hash.toHex();

      req.log.info({ txHash, payer: auth.from }, "x402 CEP-18 settled on-chain");

      return reply.send({
        success: true,
        transaction: txHash,
        network: config.casper.caip2,
        payer: auth.from,
        explorerUrl: explorerTxUrl(config.casper, txHash),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "x402 settlement failed");
      return reply.code(502).send({
        success: false,
        errorReason: `on-chain settlement failed: ${message}`,
      });
    }
  });

  app.log.info(
    `Built-in x402 facilitator live: /facilitate/{supported,verify,settle} (asset=${config.x402.asset.slice(0, 8)}…)`,
  );
}
