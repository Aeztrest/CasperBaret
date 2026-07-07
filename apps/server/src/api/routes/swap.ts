/**
 * POST /demo/swap/cspr-to-usdc — NovaSwap's real fixed-rate CSPR -> USDC(test)
 * swap.
 *
 * The client (NovaSwap) builds a plain native-transfer transaction sending
 * CSPR from the connected wallet to the treasury account, gets it signed by
 * the wallet, and posts the signed transaction JSON here. This route submits
 * it, confirms the treasury's CSPR balance actually increased (rather than
 * trusting the client's claimed amount/target — the transaction could
 * legitimately be signed but sent elsewhere), and pays out USDC(test) from
 * the treasury at a fixed rate.
 *
 * No custom "payable" contract is involved: Casper's Transaction V1 model has
 * no "attach value to a contract call" primitive without writing bespoke
 * session Wasm (the `cargo_purse` convention Odra's `#[odra(payable)]` relies
 * on) — a plain account-to-account native transfer plus a server-relayed
 * payout avoids that entirely while still moving real CSPR and real USDC.
 */

import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../../config/index.js";
import {
  keypairFromHex,
  makeRpcClient,
  explorerTxUrl,
  waitForExecutionError,
  waitForConfirmedTransfers,
  readCep18Balance,
  decodePaymentHeader,
  verifyX402Signature,
  toX402Address,
  toAccountHashHex,
  Args,
  CLValue,
  CLTypeUInt8,
  NamedArg,
  ContractCallBuilder,
  Casper,
  type CasperPaymentRequirements,
} from "@casper-baret/casper-core";

const MOTES_PER_CSPR = 1_000_000_000n;

interface SwapBody {
  signedTransaction?: unknown;
}

interface UsdcToCsprBody {
  headerValue?: string;
}

/** Encode a byte buffer as a Casper `List<U8>` CLValue (matches Rust `Bytes`/`Vec<u8>` args). */
function bytesToU8List(bytes: Buffer) {
  return CLValue.newCLList(CLTypeUInt8, Array.from(bytes).map((b) => CLValue.newCLUint8(b)));
}

export function registerSwapRoute(app: FastifyInstance, config: AppConfig): void {
  const { swap, casper, x402, faucet } = config;
  if (!swap.enabled) return;

  app.log.info(
    `CSPR->USDC swap live: POST /demo/swap/cspr-to-usdc (rate=${swap.rateAtomicUsdcPerCspr} atomic USDC per CSPR, max=${swap.maxCspr} CSPR/swap)`,
  );

  app.post<{ Body: SwapBody }>("/demo/swap/cspr-to-usdc", async (req, reply) => {
    const raw = req.body?.signedTransaction;
    if (!raw || typeof raw !== "object") {
      return reply.status(400).send({ error: "Missing signedTransaction" });
    }

    let txn: ReturnType<typeof Casper.Transaction.fromJSON>;
    try {
      txn = Casper.Transaction.fromJSON(raw);
    } catch (err) {
      return reply.status(400).send({
        error: "Malformed signedTransaction",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    if (txn.chainName !== casper.chainName) {
      return reply.status(400).send({ error: `Wrong chain — expected ${casper.chainName}` });
    }
    if (!txn.approvals || txn.approvals.length === 0) {
      return reply.status(400).send({ error: "Transaction is not signed" });
    }
    const senderPublicKey = txn.initiatorAddr?.publicKey;
    if (!senderPublicKey) {
      return reply.status(400).send({ error: "Transaction has no public-key initiator" });
    }

    try {
      const kp = await keypairFromHex(faucet.privateKeyHex, faucet.algo);
      const rpc = makeRpcClient(casper.rpcUrl);
      const treasuryAccountHash = kp.privateKey.publicKey.accountHash().toHex().toLowerCase();

      let res;
      try {
        res = await rpc.putTransaction(txn);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Casper rejects native transfers below its own protocol minimum
        // (2.5 CSPR on testnet) before execution — surface that plainly
        // instead of a bare RPC error code.
        if (/invalid transaction/i.test(message)) {
          return reply.status(400).send({
            error: `Transfer rejected by the network — send at least ${swap.minCspr} CSPR (Casper's own minimum transfer amount).`,
          });
        }
        throw err;
      }
      const csprTransactionHash = res.transactionHash?.toHex?.() ?? txn.hash.toHex();

      const { errorMessage: execError, transfers } = await waitForConfirmedTransfers(rpc, txn);
      if (execError) {
        req.log.error({ csprTransactionHash, execError }, "swap CSPR transfer failed on-chain");
        return reply.status(502).send({
          error: `CSPR transfer failed on-chain: ${execError}`,
          csprTransactionHash,
          explorerUrl: explorerTxUrl(casper, csprTransactionHash),
        });
      }

      // Trust the transaction's OWN recorded transfer effect, not a
      // before/after balance snapshot — the treasury account also pays gas
      // for facilitator settlements, faucet claims, and other swaps
      // concurrently, so a coarse delta over the (multi-second) confirmation
      // window could be thrown off by any of that unrelated activity,
      // sometimes under-crediting or missing a genuine transfer entirely.
      const toTreasury = transfers.find(
        (t) => t.toAccountHash?.toLowerCase() === treasuryAccountHash,
      );
      if (!toTreasury) {
        return reply.status(400).send({
          error: "Transaction executed, but no CSPR reached the swap treasury — check the transfer target.",
          csprTransactionHash,
          explorerUrl: explorerTxUrl(casper, csprTransactionHash),
        });
      }
      const receivedMotes = BigInt(toTreasury.amountMotes);

      const maxMotes = BigInt(Math.round(swap.maxCspr * 1e9));
      const capped = receivedMotes > maxMotes;
      const cappedMotes = capped ? maxMotes : receivedMotes;

      const usdcOut = (cappedMotes * BigInt(swap.rateAtomicUsdcPerCspr)) / MOTES_PER_CSPR;
      if (usdcOut <= 0n) {
        return reply.status(400).send({
          error: "Swap amount too small to pay out any USDC.",
          csprTransactionHash,
        });
      }

      const recipientKey = Casper.Key.newKey(
        `account-hash-${senderPublicKey.accountHash().toHex()}`,
      );
      const usdcTxn = new ContractCallBuilder()
        .from(kp.privateKey.publicKey)
        .byPackageHash(x402.asset)
        .entryPoint("transfer")
        .runtimeArgs(
          Args.fromNamedArgs([
            new NamedArg("recipient", CLValue.newCLKey(recipientKey)),
            new NamedArg("amount", CLValue.newCLUInt256(usdcOut)),
          ]),
        )
        .chainName(casper.chainName)
        .payment(5_000_000_000)
        .build();
      usdcTxn.sign(kp.privateKey);
      const usdcRes = await rpc.putTransaction(usdcTxn);
      const usdcTransactionHash = usdcRes.transactionHash?.toHex?.() ?? usdcTxn.hash.toHex();

      const usdcExecError = await waitForExecutionError(rpc, usdcTxn);
      if (usdcExecError) {
        req.log.error(
          { csprTransactionHash, usdcTransactionHash, usdcExecError },
          "swap USDC payout failed on-chain after CSPR was received",
        );
        return reply.status(502).send({
          error: `Received your CSPR, but the USDC payout failed on-chain: ${usdcExecError}. Contact support with this transaction hash.`,
          csprTransactionHash,
          usdcTransactionHash,
          explorerUrl: explorerTxUrl(casper, usdcTransactionHash),
        });
      }

      req.log.info(
        { csprTransactionHash, usdcTransactionHash, receivedMotes: receivedMotes.toString(), usdcOut: usdcOut.toString() },
        "swap settled",
      );

      return reply.send({
        success: true,
        csprTransactionHash,
        usdcTransactionHash,
        csprMotes: cappedMotes.toString(),
        usdcAtomic: usdcOut.toString(),
        explorerUrl: explorerTxUrl(casper, usdcTransactionHash),
        ...(capped && {
          note: `Only swapped up to the ${swap.maxCspr} CSPR/tx cap — the rest of your transfer was received but not exchanged.`,
        }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "swap failed");
      return reply.status(502).send({ error: `Swap failed: ${message}` });
    }
  });

  // GET /demo/swap/config — NovaSwap fetches this instead of /health because
  // ad blockers routinely block any request whose URL contains "health"
  // (a common analytics/monitoring pattern), which left the swap silently
  // falling back to the scenario demo with no visible error.
  app.get("/demo/swap/config", async (_req, reply) => {
    const kp = await keypairFromHex(faucet.privateKeyHex, faucet.algo);
    return reply.send({
      enabled: true,
      treasuryPublicKey: kp.publicKeyHex,
      asset: x402.asset,
      tokenName: x402.tokenName,
      tokenVersion: x402.tokenVersion,
      tokenDecimals: x402.tokenDecimals,
      network: casper.caip2,
      chainName: casper.chainName,
      rateAtomicUsdcPerCspr: swap.rateAtomicUsdcPerCspr,
      minCspr: swap.minCspr,
      maxCspr: swap.maxCspr,
    });
  });

  // GET /demo/swap/balance?address=<publicKeyHex|accountHash> — CSPR + USDC(test)
  // balances for the NovaSwap "You pay"/"You receive" display. Browsers can't
  // query the RPC node directly (no CORS), so this proxies both reads.
  app.get<{ Querystring: { address?: string } }>("/demo/swap/balance", async (req, reply) => {
    const address = (req.query.address ?? "").trim();
    if (!address) {
      return reply.status(400).send({ error: "Missing ?address" });
    }
    let accountHashHex: string;
    let publicKey: ReturnType<typeof Casper.PublicKey.fromHex> | null = null;
    try {
      if (/^0[12][0-9a-f]+$/i.test(address)) {
        publicKey = Casper.PublicKey.fromHex(address);
        accountHashHex = publicKey.accountHash().toHex();
      } else {
        accountHashHex = toAccountHashHex(address);
      }
    } catch (err) {
      return reply.status(400).send({
        error: "Invalid address",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    const rpc = makeRpcClient(casper.rpcUrl);
    let csprMotes = "0";
    try {
      if (publicKey) {
        const bal = await rpc.queryLatestBalance(Casper.PurseIdentifier.fromPublicKey(publicKey));
        csprMotes = bal.balance?.toString() ?? "0";
      } else {
        const bal = await rpc.queryLatestBalance(
          Casper.PurseIdentifier.fromAccountHash(new Casper.AccountHash(Casper.Hash.fromHex(accountHashHex))),
        );
        csprMotes = bal.balance?.toString() ?? "0";
      }
    } catch {
      // Account not yet on-chain (never received a transfer) — zero balance.
    }

    let usdcAtomic = "0";
    try {
      usdcAtomic = await readCep18Balance(rpc, x402.asset, accountHashHex);
    } catch {
      // Genuine read failure — report zero rather than fail the whole request.
    }

    return reply.send({ csprMotes, usdcAtomic });
  });

  // POST /demo/swap/usdc-to-cspr — the reverse direction, settled the same
  // way an x402 payment is: the payer signs an off-chain EIP-712
  // TransferWithAuthorization (no gas, works with any wallet that can sign
  // an x402 payment — unlike the CSPR->USDC direction this isn't limited to
  // Baret) sending USDC to the treasury; once that settles on-chain for
  // real, the treasury sends CSPR back at the inverse of the same fixed rate.
  app.post<{ Body: UsdcToCsprBody }>("/demo/swap/usdc-to-cspr", async (req, reply) => {
    const headerValue = req.body?.headerValue;
    if (!headerValue) {
      return reply.status(400).send({ error: "Missing headerValue" });
    }

    let wire;
    try {
      wire = decodePaymentHeader(headerValue);
    } catch (err) {
      return reply.status(400).send({
        error: "Malformed headerValue",
        detail: err instanceof Error ? err.message : String(err),
      });
    }

    const kp = await keypairFromHex(faucet.privateKeyHex, faucet.algo);

    // Build the AUTHORITATIVE requirements ourselves — never trust the
    // client's echoed `accepted` field for the EIP-712 domain (asset/name/
    // version/network), since there was no prior server-issued 402
    // challenge to pin those values against in this flow.
    const treasuryAccountHash = kp.privateKey.publicKey.accountHash().toHex();
    const requirements: CasperPaymentRequirements = {
      scheme: "exact",
      network: casper.caip2,
      asset: x402.asset,
      amount: wire.payload.authorization.value,
      payTo: toX402Address(treasuryAccountHash),
      maxTimeoutSeconds: 3600,
      extra: { name: x402.tokenName, version: x402.tokenVersion },
    };

    const check = verifyX402Signature(wire, requirements);
    if (!check.isValid) {
      return reply.status(400).send({ error: check.invalidReason ?? "Invalid payment signature" });
    }

    // verifyX402Signature only proves the signer authorized moving `value`
    // from `from` to whatever `to` they signed — it does NOT check that `to`
    // is actually us. Reject anything not addressed to the treasury.
    const auth = wire.payload.authorization;
    if (auth.to.toLowerCase() !== toX402Address(treasuryAccountHash).toLowerCase()) {
      return reply.status(400).send({ error: "Payment is not addressed to the swap treasury." });
    }

    const usdcIn = BigInt(auth.value);
    const minUsdcAtomic = (BigInt(Math.round(swap.minCspr * 1e9)) * BigInt(swap.rateAtomicUsdcPerCspr)) / MOTES_PER_CSPR;
    const maxUsdcAtomic = (BigInt(Math.round(swap.maxCspr * 1e9)) * BigInt(swap.rateAtomicUsdcPerCspr)) / MOTES_PER_CSPR;
    if (usdcIn < minUsdcAtomic) {
      return reply.status(400).send({
        error: `Minimum swap is ${(Number(minUsdcAtomic) / 10 ** x402.tokenDecimals).toFixed(2)} USDC(test).`,
      });
    }
    if (usdcIn > maxUsdcAtomic) {
      return reply.status(400).send({
        error: `Max ${(Number(maxUsdcAtomic) / 10 ** x402.tokenDecimals).toFixed(2)} USDC(test) per swap on this demo treasury.`,
      });
    }

    try {
      const rpc = makeRpcClient(casper.rpcUrl);

      const fromBytes = Buffer.from(auth.from.slice(2), "hex");
      const toBytes = Buffer.from(auth.to.slice(2), "hex");
      const nonceBytes = Buffer.from(auth.nonce, "hex");
      const publicKeyBytes = Buffer.from(wire.payload.publicKey, "hex");
      const sigBytes = Buffer.from(wire.payload.signature, "hex");

      const usdcTxn = new ContractCallBuilder()
        .from(kp.privateKey.publicKey)
        .byPackageHash(x402.asset)
        .entryPoint("transfer_with_authorization")
        .runtimeArgs(
          Args.fromNamedArgs([
            new NamedArg("from", CLValue.newCLByteArray(fromBytes)),
            new NamedArg("to", CLValue.newCLByteArray(toBytes)),
            new NamedArg("amount", CLValue.newCLUInt256(usdcIn)),
            new NamedArg("valid_after", CLValue.newCLUInt256(BigInt(auth.validAfter))),
            new NamedArg("valid_before", CLValue.newCLUInt256(BigInt(auth.validBefore))),
            new NamedArg("nonce", CLValue.newCLByteArray(nonceBytes)),
            new NamedArg("public_key", bytesToU8List(publicKeyBytes)),
            new NamedArg("signature", bytesToU8List(sigBytes)),
            new NamedArg("sig_scheme", CLValue.newCLString(wire.payload.sigScheme ?? "raw")),
          ]),
        )
        .chainName(casper.chainName)
        .payment(10_000_000_000)
        .build();
      usdcTxn.sign(kp.privateKey);

      const usdcRes = await rpc.putTransaction(usdcTxn);
      const usdcTransactionHash = usdcRes.transactionHash?.toHex?.() ?? usdcTxn.hash.toHex();

      const usdcExecError = await waitForExecutionError(rpc, usdcTxn);
      if (usdcExecError) {
        req.log.error({ usdcTransactionHash, usdcExecError }, "swap USDC collection failed on-chain");
        return reply.status(502).send({
          error: `USDC transfer failed on-chain: ${usdcExecError}`,
          usdcTransactionHash,
          explorerUrl: explorerTxUrl(casper, usdcTransactionHash),
        });
      }

      const csprOut = (usdcIn * MOTES_PER_CSPR) / BigInt(swap.rateAtomicUsdcPerCspr);

      const csprTxn = new Casper.NativeTransferBuilder()
        .from(kp.privateKey.publicKey)
        .targetAccountHash(new Casper.AccountHash(Casper.Hash.fromHex(toAccountHashHex(auth.from))))
        .chainName(casper.chainName)
        .payment(100_000_000)
        .amount(csprOut.toString())
        .build();
      csprTxn.sign(kp.privateKey);

      const csprRes = await rpc.putTransaction(csprTxn);
      const csprTransactionHash = csprRes.transactionHash?.toHex?.() ?? csprTxn.hash.toHex();

      const csprExecError = await waitForExecutionError(rpc, csprTxn);
      if (csprExecError) {
        req.log.error(
          { usdcTransactionHash, csprTransactionHash, csprExecError },
          "swap CSPR payout failed on-chain after USDC was received",
        );
        return reply.status(502).send({
          error: `Received your USDC, but the CSPR payout failed on-chain: ${csprExecError}. Contact support with this transaction hash.`,
          usdcTransactionHash,
          csprTransactionHash,
          explorerUrl: explorerTxUrl(casper, csprTransactionHash),
        });
      }

      req.log.info(
        { usdcTransactionHash, csprTransactionHash, usdcIn: usdcIn.toString(), csprOut: csprOut.toString() },
        "swap settled (usdc->cspr)",
      );

      return reply.send({
        success: true,
        usdcTransactionHash,
        csprTransactionHash,
        usdcAtomic: usdcIn.toString(),
        csprMotes: csprOut.toString(),
        explorerUrl: explorerTxUrl(casper, csprTransactionHash),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      req.log.error({ err }, "usdc->cspr swap failed");
      return reply.status(502).send({ error: `Swap failed: ${message}` });
    }
  });
}
