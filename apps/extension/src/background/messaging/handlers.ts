/**
 * RPC handlers — one per method in @casper-baret/ext-protocol's ExtRpc.
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
  toAccountHashHex,
  Casper,
} from "@casper-baret/casper-core";
import { Buffer } from "buffer";
import browser from "webextension-polyfill";
import type {
  AccountInfo,
  ExtRpcMethod,
  ExtRpcRequest,
  ExtRpcResponse,
} from "@casper-baret/ext-protocol";
import { BALANCED_POLICY, type GuardPolicy } from "@casper-baret/casper-guard";

import { dispatch, getSnapshot } from "../state/store";
import { encryptWithPassphrase, decryptWithPassphrase } from "../crypto/kdf";
import {
  isUnlocked,
  lock,
  unlockWith,
  useAuthority,
  setActiveAccount,
  derivePublicKeyHex,
} from "../crypto/session";
import {
  clearKeystore,
  hasKeystore,
  readKeystore,
  writeKeystore,
  activeAccount,
  type AccountMeta,
  type KeystoreRow,
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
// Baret's own treasury-backed faucet (apps/server POST /demo/faucet). Casper's
// public faucet is captcha-gated, so we run our own and dispense from a funded
// account. Hosted on Render (host_permissions covers it); for local dev point
// this at http://localhost:8080/demo/faucet.
const FAUCET_ENDPOINT = "https://baret-server.onrender.com/demo/faucet";
// Same treasury faucet, but dispensing the x402 CEP-18 test token (test USDC)
// instead of native CSPR.
const FAUCET_TOKEN_ENDPOINT = "https://baret-server.onrender.com/demo/faucet-token";

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
  tokens: [] as never[],
  allowances: [] as never[],
  accountControl: [] as never[],
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

  // Account 0 ("root") uses the 32-byte master entropy directly as its key —
  // identical to the pre-HD wallet, so this address is stable. HD siblings
  // (Account 2+) derive from the same entropy's mnemonic seed (crypto/hd.ts).
  const authority = await generateKeypair("ed25519");
  const entropy = new Uint8Array(Buffer.from(privateKeyHex(authority), "hex"));

  const blob = await encryptWithPassphrase(entropy, passphrase);
  const account0: AccountMeta = {
    index: 0,
    name: "Account 1",
    kind: "root",
    authorityPubkey: authority.publicKeyHex,
    smartWalletAddress: null,
  };
  const row: KeystoreRow = {
    id: "primary",
    version: 2,
    blob,
    accounts: [account0],
    activeIndex: 0,
    createdAt: Date.now(),
  };
  await writeKeystore(row);

  unlockWith(entropy, { kind: "root", index: 0 });
  entropy.fill(0);

  dispatch({ type: "network.set", network });
  // PaymentGuard not yet provisioned; surface the public key as the logical
  // wallet address so UIs render a non-null value.
  dispatch({
    type: "wallet.created",
    walletAddress: authority.publicKeyHex,
    authorityAddress: authority.publicKeyHex,
    accounts: toAccountInfos(row),
    activeIndex: 0,
  });

  return {
    walletAddress: authority.publicKeyHex,
    authorityAddress: authority.publicKeyHex,
  };
};

/** Project the keystore's account metadata into the UI-facing AccountInfo[]. */
function toAccountInfos(row: KeystoreRow): AccountInfo[] {
  return row.accounts.map((a) => ({
    index: a.index,
    name: a.name,
    address: a.smartWalletAddress ?? a.authorityPubkey,
    authorityAddress: a.authorityPubkey,
  }));
}

const unlockHandler: Handler<"wallet.unlock"> = async ({ passphrase }) => {
  const row = await readKeystore();
  if (!row) throw new Error("No wallet found on this device.");
  const entropy = await decryptWithPassphrase(row.blob, passphrase);
  if (entropy.length !== 32) {
    entropy.fill(0);
    throw new Error(
      `Keystore entropy must be 32 bytes (got ${entropy.length}); reset and recreate.`,
    );
  }
  const acct = activeAccount(row);
  unlockWith(entropy, { kind: acct.kind, index: acct.index });
  entropy.fill(0);

  await preloadActiveSubKeys(passphrase);

  const wallet = acct.smartWalletAddress ?? acct.authorityPubkey;
  dispatch({
    type: "wallet.unlocked",
    walletAddress: wallet,
    authorityAddress: acct.authorityPubkey,
    accounts: toAccountInfos(row),
    activeIndex: row.activeIndex,
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
  const address = snap.authorityAddress;
  if (!address) throw new Error("No address available — wallet not initialized.");

  // Claim from Baret's treasury-backed faucet. The server signs + sends a fixed
  // CSPR transfer and enforces the per-address cooldown; we surface its message.
  let res: Response;
  try {
    res = await fetch(FAUCET_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
  } catch {
    throw new Error("Couldn't reach the faucet server. Is it running?");
  }

  const data = (await res.json().catch(() => ({}))) as {
    transactionHash?: string;
    amountCspr?: number;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Faucet error (HTTP ${res.status}).`);
  }
  return {
    transactionHash: data.transactionHash ?? "",
    amountCspr: data.amountCspr ?? 0,
  };
};

const airdropTokenHandler: Handler<"wallet.airdropToken"> = async ({ packageHash }) => {
  if (!isUnlocked()) throw new Error("Unlock the wallet first.");
  const snap = getSnapshot();
  if (snap.network !== "testnet") {
    throw new Error("The faucet is only available on testnet.");
  }
  const address = snap.authorityAddress;
  if (!address) throw new Error("No address available — wallet not initialized.");

  let res: Response;
  try {
    res = await fetch(FAUCET_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, packageHash }),
    });
  } catch {
    throw new Error("Couldn't reach the faucet server. Is it running?");
  }

  const data = (await res.json().catch(() => ({}))) as {
    transactionHash?: string;
    amount?: number;
    symbol?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(data.error || `Faucet error (HTTP ${res.status}).`);
  }
  return {
    transactionHash: data.transactionHash ?? "",
    amount: data.amount ?? 0,
    symbol: data.symbol ?? "",
  };
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

const tokenBalanceHandler: Handler<"wallet.tokenBalance"> = async ({
  address,
}) => {
  const snap = getSnapshot();
  const target = address ?? snap.authorityAddress;
  if (!target)
    throw new Error("No address available — wallet not initialized.");

  // Resolve the owner account hash (CEP-18 `balances` is keyed by account hash).
  // Doing this here proves the address plumbing is correct end-to-end.
  try {
    if (isPublicKeyHex(target)) {
      Casper.PublicKey.fromHex(target).accountHash();
    } else {
      toAccountHashHex(target);
    }
  } catch {
    return { raw: "0", available: false };
  }

  // Best-effort: reading an Odra CEP-18 `balances` dictionary needs the live
  // contract hash (not just the package hash) plus Odra's exact item-key
  // encoding, both of which we can only confirm against the deployed token.
  // Until verified against the funded contract (Faz 2 acquire), degrade to
  // unavailable so the UI shows "—" rather than a wrong number.
  // TODO(faz2): resolve package→contract entity, query the `balances` dict,
  // and parse the CLValueUInt256 result into a decimal string.
  return { raw: "0", available: false };
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

/* ────────────── HD accounts ────────────── */

const listAccountsHandler: Handler<"wallet.listAccounts"> = async () => {
  const row = await readKeystore();
  return row ? toAccountInfos(row) : [];
};

const addAccountHandler: Handler<"wallet.addAccount"> = async ({ name } = {}) => {
  if (!isUnlocked()) throw new Error("Unlock the wallet first.");
  const row = await readKeystore();
  if (!row) throw new Error("No wallet found.");

  // Append-only: account index == array position. Next index is one past the max.
  const nextIndex = row.accounts.reduce((m, a) => Math.max(m, a.index), -1) + 1;
  const authorityPubkey = await derivePublicKeyHex({ kind: "hd", index: nextIndex });
  const label = name?.trim() || `Account ${nextIndex + 1}`;
  const meta: AccountMeta = {
    index: nextIndex,
    name: label,
    kind: "hd",
    authorityPubkey,
    smartWalletAddress: null,
  };
  const updated: KeystoreRow = {
    ...row,
    accounts: [...row.accounts, meta],
    activeIndex: nextIndex,
  };
  await writeKeystore(updated);
  setActiveAccount({ kind: "hd", index: nextIndex });

  const walletAddress = meta.smartWalletAddress ?? meta.authorityPubkey;
  dispatch({
    type: "accounts.set",
    accounts: toAccountInfos(updated),
    activeIndex: nextIndex,
    walletAddress,
    authorityAddress: authorityPubkey,
  });
  return { index: nextIndex, name: label, address: walletAddress, authorityAddress: authorityPubkey };
};

const selectAccountHandler: Handler<"wallet.selectAccount"> = async ({ index }) => {
  if (!isUnlocked()) throw new Error("Unlock the wallet first.");
  const row = await readKeystore();
  if (!row) throw new Error("No wallet found.");
  const target = row.accounts.find((a) => a.index === index);
  if (!target) throw new Error(`No account with index ${index}.`);

  const updated: KeystoreRow = { ...row, activeIndex: index };
  await writeKeystore(updated);
  setActiveAccount({ kind: target.kind, index: target.index });

  const walletAddress = target.smartWalletAddress ?? target.authorityPubkey;
  dispatch({
    type: "accounts.set",
    accounts: toAccountInfos(updated),
    activeIndex: index,
    walletAddress,
    authorityAddress: target.authorityPubkey,
  });
  return { ok: true };
};

const renameAccountHandler: Handler<"wallet.renameAccount"> = async ({ index, name }) => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Account name cannot be empty.");
  const row = await readKeystore();
  if (!row) throw new Error("No wallet found.");
  if (!row.accounts.some((a) => a.index === index))
    throw new Error(`No account with index ${index}.`);

  const updated: KeystoreRow = {
    ...row,
    accounts: row.accounts.map((a) => (a.index === index ? { ...a, name: trimmed } : a)),
  };
  await writeKeystore(updated);

  const acct = activeAccount(updated);
  dispatch({
    type: "accounts.set",
    accounts: toAccountInfos(updated),
    activeIndex: updated.activeIndex,
    walletAddress: acct.smartWalletAddress ?? acct.authorityPubkey,
    authorityAddress: acct.authorityPubkey,
  });
  return { ok: true };
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
    const result = await performSign(req.kind, req.payloadBase64, { signerPubkey: req.signerPubkey });
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

function kindLabel(kind: string): string {
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
  "wallet.airdropToken": airdropTokenHandler,
  "wallet.provisionSmartWallet": provisionSmartWalletHandler,
  "wallet.balance": balanceHandler,
  "wallet.tokenBalance": tokenBalanceHandler,
  "wallet.transferCspr": transferCsprHandler,

  "wallet.listAccounts": listAccountsHandler,
  "wallet.addAccount": addAccountHandler,
  "wallet.selectAccount": selectAccountHandler,
  "wallet.renameAccount": renameAccountHandler,

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
