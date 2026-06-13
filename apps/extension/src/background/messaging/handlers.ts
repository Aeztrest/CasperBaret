/**
 * RPC handlers — one per method in @casper-baret/ext-protocol's ExtRpc (Stellar build).
 *
 * Many methods land progressively as their subsystems are built; today the
 * wallet lifecycle, balance, transfer, airdrop, sign drain, ledger, history
 * and alerts handlers are real. Anything else throws "not implemented" with
 * a clear hint so the UI surfaces the gap.
 */

import {
  generateKeypair,
  keypairFromHex,
  privateKeyHex,
  isPublicKeyHex,
  isAccountHash,
  Casper,
} from "@casper-baret/casper-core";
import { Buffer } from "buffer";
import browser from "webextension-polyfill";
import type {
  ExtRpcMethod,
  ExtRpcRequest,
  ExtRpcResponse,
} from "@casper-baret/ext-protocol";
import { BALANCED_POLICY, type GuardPolicy } from "@casper-baret/casper-guard";

import { dispatch, getSnapshot } from "../state/store";
import { encryptWithPassphrase, decryptWithPassphrase } from "../crypto/kdf";
import { isUnlocked, lock, unlockWith, useAuthority } from "../crypto/session";
import {
  clearKeystore,
  hasKeystore,
  readKeystore,
  writeKeystore,
} from "../db/keystore";
import { getRpcClient, getChainName } from "../rpc/connection";
import { provisionSmartWallet } from "../swig/provision";
import { performSign } from "../wallet-standard/handlers";
import { closePopupWindow } from "../popup-window";
import {
  peek as peekById,
  take as takeSign,
  size as signQueueSize,
  snapshot as peekSign,
} from "../wallet-standard/sign-queue";
import { analyzeTransaction } from "../blackthorn/analyze-client";
import {
  listAllowances,
  setStatus as setAllowanceStatus,
} from "../db/allowances";
import {
  appendHistory,
  getHistoryEntry,
  listHistory,
} from "../db/history";
import { countUnread, dismiss as dismissAlert, listAlerts } from "../db/alerts";
import {
  preloadActiveSubKeys,
  clearSubKeyCache,
} from "../crypto/sub-key-cache";

const POLICY_STORAGE_KEY = "baret.policy.v1";
// Casper testnet faucet is captcha-gated (no friendbot equivalent). Surface a
// link in the UI instead; the airdrop RPC is a stub.
const FAUCET_URL = "https://testnet.cspr.live/tools/faucet";

type Handler<M extends ExtRpcMethod> = (
  req: ExtRpcRequest<M>,
) => Promise<ExtRpcResponse<M>>;

const notImplemented = <M extends ExtRpcMethod>(
  method: M,
  hint: string,
): Handler<M> =>
  (async () => {
    throw new Error(`${method} not implemented yet — ${hint}`);
  }) as Handler<M>;

const EMPTY_CHANGES = {
  native: [] as never[],
  assets: [] as never[],
  trustlines: [] as never[],
  allowances: [] as never[],
};

/* ────────────── Wallet lifecycle ────────────── */

const getStateHandler: Handler<"wallet.getState"> = async () => getSnapshot();

const createHandler: Handler<"wallet.create"> = async ({
  passphrase,
  network,
}) => {
  if (await hasKeystore()) {
    throw new Error(
      "A wallet already exists. Reset it before creating another.",
    );
  }
  if (typeof passphrase !== "string" || passphrase.length < 8) {
    throw new Error("Passphrase must be at least 8 characters.");
  }

  const authority = await generateKeypair("ed25519");
  const seedBytes = new Uint8Array(Buffer.from(privateKeyHex(authority), "hex"));

  const blob = await encryptWithPassphrase(seedBytes, passphrase);
  await writeKeystore({
    id: "primary",
    blob,
    authorityPubkey: authority.publicKeyHex,
    smartWalletAddress: null,
    createdAt: Date.now(),
  });

  unlockWith(seedBytes);
  seedBytes.fill(0);

  dispatch({ type: "network.set", network });
  // PaymentGuard not yet provisioned; surface the public key as the logical
  // wallet address so UIs render a non-null value.
  dispatch({
    type: "wallet.created",
    walletAddress: authority.publicKeyHex,
    authorityAddress: authority.publicKeyHex,
  });

  return {
    walletAddress: authority.publicKeyHex,
    authorityAddress: authority.publicKeyHex,
  };
};

const unlockHandler: Handler<"wallet.unlock"> = async ({ passphrase }) => {
  const row = await readKeystore();
  if (!row) throw new Error("No wallet found on this device.");
  const secret = await decryptWithPassphrase(row.blob, passphrase);
  if (secret.length !== 32) {
    secret.fill(0);
    throw new Error(
      `Keystore seed must be 32 bytes (got ${secret.length}); reset and recreate.`,
    );
  }
  unlockWith(secret);
  secret.fill(0);

  await preloadActiveSubKeys(passphrase);

  const wallet = row.smartWalletAddress ?? row.authorityPubkey;
  dispatch({
    type: "wallet.unlocked",
    walletAddress: wallet,
    authorityAddress: row.authorityPubkey,
  });
  return { ok: true };
};

const lockHandler: Handler<"wallet.lock"> = async () => {
  clearSubKeyCache();
  lock();
  return { ok: true };
};

const resetHandler: Handler<"wallet.reset"> = async ({ confirmation }) => {
  if (confirmation !== "I-UNDERSTAND") {
    throw new Error('Reset requires the confirmation token "I-UNDERSTAND".');
  }
  lock();
  await clearKeystore();
  dispatch({ type: "wallet.reset" });
  return { ok: true };
};

const exportSecretHandler: Handler<"wallet.exportSecret"> = async ({
  passphrase,
  format,
}) => {
  const row = await readKeystore();
  if (!row) throw new Error("No wallet to export.");
  const seed = await decryptWithPassphrase(row.blob, passphrase);
  try {
    if (format === "hex") return { secret: bytesToHex(seed) };
    if (format === "base58") return { secret: bytesToBase58(seed) };
    if (format === "mnemonic") {
      // 32-byte seed → 24-word BIP39 mnemonic.
      const { entropyToMnemonic } = await import("bip39");
      const entropyHex = bytesToHex(seed);
      return { secret: entropyToMnemonic(entropyHex) };
    }
    throw new Error(`Unknown export format: ${format}`);
  } finally {
    seed.fill(0);
  }
};

const airdropHandler: Handler<"wallet.airdrop"> = async () => {
  if (!isUnlocked()) throw new Error("Unlock the wallet first.");
  const snap = getSnapshot();
  if (snap.network !== "testnet") {
    throw new Error("The faucet is only available on testnet.");
  }
  // TODO(casper): the Casper testnet faucet is captcha-gated — no programmatic
  // friendbot equivalent. Direct the user to the faucet page instead.
  throw new Error(
    `Request testnet CSPR from the Casper faucet: ${FAUCET_URL}`,
  );
};

const provisionSmartWalletHandler: Handler<
  "wallet.provisionSmartWallet"
> = async () => {
  if (!isUnlocked()) throw new Error("Unlock the wallet first.");
  return provisionSmartWallet();
};

const policyReadHandler: Handler<"policy.read"> = async () => {
  const all = await browser.storage.local.get(POLICY_STORAGE_KEY);
  const stored =
    (all[POLICY_STORAGE_KEY] as GuardPolicy | undefined) ?? BALANCED_POLICY;
  return stored;
};

const policyWriteHandler: Handler<"policy.write"> = async ({ policy }) => {
  await browser.storage.local.set({ [POLICY_STORAGE_KEY]: policy });
  return { ok: true };
};

const balanceHandler: Handler<"wallet.balance"> = async ({ address }) => {
  const snap = getSnapshot();
  const target = address ?? snap.authorityAddress;
  if (!target)
    throw new Error("No address available — wallet not initialized.");
  const rpc = getRpcClient();
  try {
    const pubKey = Casper.PublicKey.fromHex(target);
    const purse = Casper.PurseIdentifier.fromPublicKey(pubKey);
    const res = await rpc.queryLatestBalance(purse);
    const motes = res.balance?.toString() ?? "0";
    // CEP-18 token balance lookup is contract-specific; surfaced via x402
    // allowances rather than a global balance here.
    return { motes, token: null, hasToken: false };
  } catch (err) {
    if (isAccountNotFound(err))
      return { motes: "0", token: null, hasToken: false };
    console.warn("[BARET] balance query failed:", err);
    return { motes: "0", token: null, hasToken: false };
  }
};

const transferCsprHandler: Handler<"wallet.transferCspr"> = async ({
  to,
  amountCspr,
}) => {
  if (!isUnlocked()) throw new Error("Unlock the wallet first.");
  if (!Number.isFinite(amountCspr) || amountCspr <= 0) {
    throw new Error("Amount must be a positive number.");
  }
  if (!isPublicKeyHex(to) && !isAccountHash(to)) {
    throw new Error("Invalid recipient address (expected public key hex or account hash).");
  }

  const kp = await useAuthority();
  const rpc = getRpcClient();
  const motes = (BigInt(Math.round(amountCspr * 1e9))).toString();

  const builder = new Casper.NativeTransferBuilder()
    .from(kp.privateKey.publicKey)
    .chainName(getChainName())
    .payment(100_000_000) // 0.1 CSPR transfer fee budget
    .amount(motes);

  if (isPublicKeyHex(to)) {
    builder.target(Casper.PublicKey.fromHex(to));
  } else {
    builder.targetAccountHash(new Casper.AccountHash(Casper.Hash.fromHex(to)));
  }

  const tx = builder.build();
  tx.sign(kp.privateKey);
  const res = await rpc.putTransaction(tx);
  return { transactionHash: res.transactionHash?.toHex?.() ?? tx.hash.toHex() };
};

/* ────────────── Network ────────────── */

const networkSet: Handler<"network.set"> = async ({ network }) => {
  dispatch({ type: "network.set", network });
  return { ok: true };
};

/* ────────────── Allowance ledger ────────────── */

const ledgerListHandler: Handler<"ledger.list"> = async ({ filter } = {}) => {
  return listAllowances(filter);
};

const ledgerPauseHandler: Handler<"ledger.pause"> = async ({
  merchantOrigin,
}) => {
  const all = await listAllowances();
  const target = all.find((a) => a.merchantOrigin === merchantOrigin);
  if (!target) throw new Error(`No allowance found for ${merchantOrigin}`);
  await setAllowanceStatus(target.id, "paused");
  return { ok: true };
};

const ledgerUnpauseHandler: Handler<"ledger.unpause"> = async ({
  merchantOrigin,
}) => {
  const all = await listAllowances();
  const target = all.find((a) => a.merchantOrigin === merchantOrigin);
  if (!target) throw new Error(`No allowance found for ${merchantOrigin}`);
  await setAllowanceStatus(target.id, "active");
  return { ok: true };
};

const ledgerRevokeHandler: Handler<"ledger.revoke"> = async ({
  merchantOrigin,
}) => {
  // Casper has no on-chain per-merchant sub-key to remove; revoke is a local
  // allowance status change. The firewall stops all future x402 payments to
  // this merchant immediately.
  // TODO(casper): once PaymentGuard exposes per-merchant authorizations,
  // revoke them on-chain here.
  const all = await listAllowances();
  const target = all.find((a) => a.merchantOrigin === merchantOrigin);
  if (!target) throw new Error(`No allowance found for ${merchantOrigin}`);
  await setAllowanceStatus(target.id, "revoked");
  await appendHistory({
    type: "alert",
    signature: null,
    origin: merchantOrigin,
    summary: `Revoked allowance for ${merchantOrigin}`,
    decision: "block",
    reasons: ["User-initiated revoke — firewall blocks future payments"],
    broadcast: false,
    createdAt: Date.now(),
  });
  return { signRequestId: `local-${Date.now()}` };
};

/* ────────────── History + alerts ────────────── */

const historyListHandler: Handler<"history.list"> = async ({ filter } = {}) => {
  return listHistory(filter);
};

const historyDetailHandler: Handler<"history.detail"> = async ({ id }) => {
  const r = await getHistoryEntry(id);
  if (!r) throw new Error("History entry not found");
  let analysis: unknown = null;
  const json = (r as { analysisJson?: string }).analysisJson;
  if (json) {
    try {
      analysis = JSON.parse(json);
    } catch {
      /* ignore */
    }
  }
  return { ...r, analysis };
};

const alertsListHandler: Handler<"alerts.list"> = async ({
  includeDismissed,
} = {}) => {
  return listAlerts({ includeDismissed });
};

const alertsDismissHandler: Handler<"alerts.dismiss"> = async ({ id }) => {
  await dismissAlert(id);
  const remaining = await countUnread();
  dispatch({ type: "alerts.set", count: remaining });
  return { ok: true };
};

/* ────────────── Sign request drain (popup invokes after user verdict) ────────────── */

const txPeekRequestHandler: Handler<"tx.peekRequest"> = async () => peekSign();

const txAnalyzeRequestHandler: Handler<"tx.analyzeRequest"> = async ({
  requestId,
}) => {
  const req = peekById(requestId);
  if (!req)
    throw new Error(
      "Sign request not found — it may already have been processed.",
    );
  const snap = getSnapshot();
  if (!snap.authorityAddress) throw new Error("Wallet not initialized.");
  if (req.kind === "message" || req.kind === "connect" || req.kind === "x402Payment") {
    const note =
      req.kind === "connect"
        ? "Site is requesting connection. No funds move until you approve a signature."
        : req.kind === "x402Payment"
          ? "x402 micropayment — within your policy caps."
          : "Plain message — no funds move on-chain.";
    return {
      decision: "advisory" as const,
      safe: true,
      blockingReasons: [],
      advisoryReasons: [note],
      reasons: [note],
      riskFindings: [],
      estimatedChanges: EMPTY_CHANGES,
      simulationWarnings: [],
      offline: false,
    };
  }
  const policy = (await loadPolicy()) ?? {};
  return analyzeTransaction(
    {
      network: snap.network,
      transaction: req.payloadBase64,
      userWallet: snap.authorityAddress,
      policy,
    },
    { apiKey: "dev-key-change-me" },
  );
};

async function loadPolicy(): Promise<GuardPolicy | null> {
  const all = await browser.storage.local.get(POLICY_STORAGE_KEY);
  return (all[POLICY_STORAGE_KEY] as GuardPolicy | undefined) ?? null;
}

/**
 * Called after each sign/connect decision. When the queue is empty, end the
 * sign flow AND close the programmatically-opened popup window — otherwise the
 * dedicated window lingers on the Home screen after the user signs.
 */
function endSignFlowIfDrained(): void {
  if (signQueueSize() === 0) {
    dispatch({ type: "sign.end" });
    void closePopupWindow();
  }
}

const txSignHandler: Handler<"tx.sign"> = async ({
  requestId,
  accept,
  remember,
}) => {
  const req = takeSign(requestId);
  if (!req)
    throw new Error(
      "Unknown sign request — it may have already been processed.",
    );

  if (req.kind === "connect") {
    if (!accept) {
      req.reject(new Error("User rejected the connection."));
      endSignFlowIfDrained();
      return { rejection: "User declined" };
    }
    req.resolve({ kind: "connect", rememberOrigin: remember === true });
    endSignFlowIfDrained();
    return { ok: true };
  }

  if (!accept) {
    req.reject(new Error("User declined the signature."));
    endSignFlowIfDrained();
    await appendHistory({
      type: "dapp",
      signature: null,
      origin: req.origin,
      summary: `Declined ${kindLabel(req.kind)} from ${req.origin}`,
      decision: "block",
      reasons: ["User declined at sign request"],
      broadcast: false,
      createdAt: Date.now(),
    });
    return { rejection: "User declined" };
  }
  try {
    const result = await performSign(req.kind, req.payloadBase64, {
      signerPubkey: req.signerPubkey,
    });
    req.resolve(result);
    endSignFlowIfDrained();
    const signature =
      result.kind === "transactionAndSend" ? result.signature : null;
    await appendHistory({
      type: "dapp",
      signature,
      origin: req.origin,
      summary: `Signed ${kindLabel(req.kind)} for ${req.origin}`,
      decision: "allow",
      reasons: [],
      broadcast: result.kind === "transactionAndSend",
      createdAt: Date.now(),
    });
    if (result.kind === "transactionAndSend")
      return { signed: result.signedTransaction, signature: result.signature };
    if (result.kind === "transaction")
      return { signed: result.signedTransaction };
    if (result.kind === "x402Payment")
      return { signed: result.headerValue };
    if (result.kind === "message")
      return { signature: result.signedMessage };
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    req.reject(new Error(message));
    endSignFlowIfDrained();
    await appendHistory({
      type: "alert",
      signature: null,
      origin: req.origin,
      summary: `Sign failed for ${req.origin}`,
      decision: "block",
      reasons: [message],
      broadcast: false,
      createdAt: Date.now(),
    });
    throw err;
  }
};

function kindLabel(
  kind:
    | "message"
    | "transaction"
    | "transactionAndSend"
    | "x402Payment"
    | "connect",
): string {
  if (kind === "connect") return "connect";
  if (kind === "message") return "message";
  if (kind === "x402Payment") return "x402 payment";
  if (kind === "transactionAndSend") return "+broadcast tx";
  return "transaction";
}

/* ────────────── Registry ────────────── */

export const handlers: { [M in ExtRpcMethod]: Handler<M> } = {
  "wallet.getState": getStateHandler,
  "wallet.create": createHandler,
  "wallet.unlock": unlockHandler,
  "wallet.lock": lockHandler,
  "wallet.reset": resetHandler,
  "wallet.exportSecret": exportSecretHandler,
  "wallet.airdrop": airdropHandler,
  "wallet.provisionSmartWallet": provisionSmartWalletHandler,
  "wallet.balance": balanceHandler,
  "wallet.transferCspr": transferCsprHandler,

  "network.set": networkSet,

  "tx.sign": txSignHandler,
  "tx.send": notImplemented(
    "tx.send",
    "wallet-initiated send arrives with the Send page polish",
  ),
  "tx.peekRequest": txPeekRequestHandler,
  "tx.analyzeRequest": txAnalyzeRequestHandler,

  "ledger.list": ledgerListHandler,
  "ledger.revoke": ledgerRevokeHandler,
  "ledger.pause": ledgerPauseHandler,
  "ledger.unpause": ledgerUnpauseHandler,

  "policy.read": policyReadHandler,
  "policy.write": policyWriteHandler,

  "history.list": historyListHandler,
  "history.detail": historyDetailHandler,

  "alerts.list": alertsListHandler,
  "alerts.dismiss": alertsDismissHandler,
};

/* ────────────── Helpers ────────────── */

function isAccountNotFound(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /not found|does not exist|ValueNotFound|purse|account/i.test(msg);
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function bytesToBase58(b: Uint8Array): string {
  let n = 0n;
  for (const byte of b) n = (n << 8n) | BigInt(byte);
  let out = "";
  while (n > 0n) {
    const r = Number(n % 58n);
    out = BASE58_ALPHABET[r]! + out;
    n = n / 58n;
  }
  for (const byte of b) {
    if (byte === 0) out = "1" + out;
    else break;
  }
  return out;
}
