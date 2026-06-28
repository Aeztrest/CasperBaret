/**
 * EIP-1193 provider handlers for the EVM (Monad) surface.
 *
 * These are invoked via the same `bx-wallet-standard` port used for Casper,
 * but with `evm.*` method prefixes so they don't collide. The inpage
 * evm-provider.ts dispatches `evm.*` calls through the page bridge; this
 * module handles them in the background service worker.
 *
 * Supported methods: eth_requestAccounts, eth_accounts, eth_chainId,
 * wallet_switchEthereumChain, personal_sign, eth_signTypedData_v4,
 * eth_sendTransaction, eth_signTransaction.
 *
 * Read-only JSON-RPC (eth_call, eth_getBalance, …) is proxied directly
 * from the inpage script to the Monad RPC endpoint — no background hop.
 */

import { isHexString, getBytes, JsonRpcProvider } from "ethers";
import type { WsHandler } from "../wallet-standard/handlers";
import { isUnlocked, useEvmWallet } from "../crypto/session";
import { dispatch } from "../state/store";
import { readSitePermission, writeSitePermission } from "../db/site-permissions";
import { appendHistory, listHistory } from "../db/history";
import {
  enqueue,
  newRequestId,
  type SignKind,
  type SignSuccess,
} from "../wallet-standard/sign-queue";

// Monad testnet.  Update when mainnet launches.
const MONAD_RPC = "https://testnet-rpc.monad.xyz";
const MONAD_CHAIN_ID_HEX = "0x279f"; // 10143

// ── helpers ──────────────────────────────────────────────────────────────────

function ensureReady(): string {
  if (!isUnlocked()) throw new Error("Baret wallet is locked — open the wallet first.");
  const wallet = useEvmWallet();
  return wallet.address;
}

function queueConnectApproval(origin: string): Promise<{ allow: boolean; remember: boolean }> {
  return new Promise((resolve) => {
    const requestId = newRequestId();
    enqueue({
      requestId,
      kind: "connect" as SignKind,
      origin,
      payloadBase64: "",
      label: `Connect ${origin} (EVM / Monad)`,
      resolve: (out: SignSuccess) => {
        if (out.kind !== "connect") return resolve({ allow: false, remember: false });
        resolve({ allow: true, remember: out.rememberOrigin });
      },
      reject: () => resolve({ allow: false, remember: false }),
    });
    dispatch({ type: "sign.start" });
  });
}

function queueAndWait(kind: SignKind, origin: string, payloadBase64: string): Promise<SignSuccess> {
  if (!isUnlocked()) return Promise.reject(new Error("Baret wallet is locked."));
  return new Promise<SignSuccess>((resolve, reject) => {
    const requestId = newRequestId();
    enqueue({ requestId, kind, origin, payloadBase64, resolve, reject });
    dispatch({ type: "sign.start" });
  });
}

// ── handlers ─────────────────────────────────────────────────────────────────

export const evmRequestAccounts: WsHandler = async (raw) => {
  const { origin } = raw as { origin: string };
  if (!origin) throw new Error("Origin required");
  const address = ensureReady();

  const perm = await readSitePermission(origin);
  if (perm?.status === "denied" && perm.remembered) {
    throw new Error(`Connection to ${origin} was previously denied.`);
  }
  if (!(perm?.status === "trusted" && perm.remembered)) {
    const approval = await queueConnectApproval(origin);
    if (!approval.allow) {
      if (approval.remember) {
        await writeSitePermission({ origin, status: "denied", remembered: true, grantedAt: Date.now() });
      }
      throw new Error("User rejected the connection.");
    }
    if (approval.remember) {
      await writeSitePermission({ origin, status: "trusted", remembered: true, grantedAt: Date.now() });
    }
  }

  try {
    const prior = await listHistory({ type: "dapp", origin });
    if (prior.length === 0) {
      await appendHistory({
        type: "dapp",
        signature: null,
        origin,
        summary: "Connected via EIP-1193 provider (Monad)",
        decision: "allow",
        reasons: [],
        broadcast: false,
        createdAt: Date.now(),
      });
    }
  } catch { /* non-fatal */ }

  return { accounts: [address] };
};

export const evmAccounts: WsHandler = async (raw) => {
  const { origin } = raw as { origin: string };
  const perm = await readSitePermission(origin);
  if (perm?.status === "trusted" && isUnlocked()) {
    const wallet = useEvmWallet();
    return { accounts: [wallet.address] };
  }
  return { accounts: [] };
};

export const evmChainId: WsHandler = async () => {
  return { chainId: MONAD_CHAIN_ID_HEX };
};

export const evmSwitchChain: WsHandler = async (raw) => {
  const { chainId } = raw as { chainId: string };
  const numeric = Number.parseInt(chainId, 16);
  // Only Monad testnet supported for now.
  if (numeric !== 10143) {
    throw new Error(`Baret only supports Monad testnet (chain 0x279f) — got ${chainId}.`);
  }
  return { ok: true };
};

export const evmPersonalSign: WsHandler = async (raw) => {
  const { origin, message } = raw as { origin: string; message: string };
  const result = await queueAndWait("message", origin, message);
  if (result.kind !== "message") throw new Error("Unexpected sign result");
  return { signature: result.signedMessage };
};

export const evmSignTypedData: WsHandler = async (raw) => {
  const { origin, typedData } = raw as { origin: string; typedData: string };
  const result = await queueAndWait("typedData", origin, typedData);
  if (result.kind !== "typedData") throw new Error("Unexpected sign result");
  return { signature: result.signature };
};

export const evmSendTransaction: WsHandler = async (raw) => {
  const { origin, transaction } = raw as { origin: string; transaction: unknown };
  const result = await queueAndWait("evmTransactionAndSend", origin, JSON.stringify(transaction));
  if (result.kind !== "evmTransactionAndSend") throw new Error("Unexpected sign result");
  return { txHash: result.txHash };
};

export const evmSignTransaction: WsHandler = async (raw) => {
  const { origin, transaction } = raw as { origin: string; transaction: unknown };
  const result = await queueAndWait("evmTransaction", origin, JSON.stringify(transaction));
  if (result.kind !== "evmTransaction") throw new Error("Unexpected sign result");
  return { signedTransaction: result.signedTransaction };
};

// ── performEvmSign — called by the sign-drain handler in the popup ─────────

export async function performEvmSign(
  kind: SignKind,
  payloadBase64: string,
): Promise<SignSuccess> {
  const wallet = useEvmWallet();

  if (kind === "message") {
    const data = isHexString(payloadBase64) ? getBytes(payloadBase64) : payloadBase64;
    const signature = await wallet.signMessage(data);
    return { kind: "message", signedMessage: signature, signerAddress: wallet.address };
  }

  if (kind === "typedData") {
    const doc = JSON.parse(payloadBase64) as {
      domain: Record<string, unknown>;
      types: Record<string, { name: string; type: string }[]>;
      message: Record<string, unknown>;
    };
    const types = { ...doc.types };
    delete (types as Record<string, unknown>).EIP712Domain;
    const signature = await wallet.signTypedData(doc.domain, types, doc.message);
    return { kind: "typedData", signature, signerAddress: wallet.address };
  }

  const provider = new JsonRpcProvider(MONAD_RPC);
  const connected = wallet.connect(provider);
  const tx = normalizeTx(JSON.parse(payloadBase64));

  if (kind === "evmTransaction") {
    const populated = await connected.populateTransaction(tx);
    const signedTransaction = await connected.signTransaction(populated);
    return { kind: "evmTransaction", signedTransaction, signerAddress: wallet.address };
  }

  // evmTransactionAndSend
  const sent = await connected.sendTransaction(tx);
  return { kind: "evmTransactionAndSend", txHash: sent.hash, signerAddress: wallet.address };
}

function normalizeTx(t: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof t.to === "string") out.to = t.to;
  if (typeof t.from === "string") out.from = t.from;
  if (t.value != null) out.value = BigInt(t.value as string);
  if (typeof t.data === "string") out.data = t.data;
  if (typeof t.input === "string" && !out.data) out.data = t.input;
  const gas = t.gas ?? t.gasLimit;
  if (gas != null) out.gasLimit = BigInt(gas as string);
  if (t.maxFeePerGas != null) out.maxFeePerGas = BigInt(t.maxFeePerGas as string);
  if (t.maxPriorityFeePerGas != null) out.maxPriorityFeePerGas = BigInt(t.maxPriorityFeePerGas as string);
  if (t.gasPrice != null) out.gasPrice = BigInt(t.gasPrice as string);
  if (t.nonce != null) out.nonce = Number(t.nonce);
  return out;
}

export const evm_handlers: Record<string, WsHandler> = {
  "evm.requestAccounts":    evmRequestAccounts,
  "evm.accounts":           evmAccounts,
  "evm.chainId":            evmChainId,
  "evm.switchChain":        evmSwitchChain,
  "evm.personalSign":       evmPersonalSign,
  "evm.signTypedData":      evmSignTypedData,
  "evm.sendTransaction":    evmSendTransaction,
  "evm.signTransaction":    evmSignTransaction,
};
