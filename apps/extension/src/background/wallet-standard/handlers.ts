/**
 * Wallet Standard handlers — the dApp-facing surface (Casper build).
 *
 * `ws.connect` / `ws.disconnect` resolve immediately (no popup) when the
 * wallet is unlocked + the origin is trusted. Sign methods enqueue a sign
 * request and wait for the popup to call `tx.sign` with an accept verdict.
 *
 * Transactions are carried as Casper transaction JSON strings (not XDR).
 * `ws.payX402` routes through the x402 firewall so the user's caps apply.
 */

import { Casper, type CasperKeypair, type CasperPaymentRequirements } from "@casper-baret/casper-core";
import { Buffer } from "buffer";
import { dispatch, getState } from "../state/store";
import { isUnlocked, useAuthority } from "../crypto/session";
import { getCaip2, getRpcClient } from "../rpc/connection";
import { buildX402Header } from "../x402/build";
import {
  enqueue,
  newRequestId,
  type SignKind,
  type SignSuccess,
} from "./sign-queue";
import { appendHistory, listHistory } from "../db/history";
import { readSitePermission, writeSitePermission } from "../db/site-permissions";
import { getSubKeypair } from "../crypto/sub-key-cache";
import { x402Review } from "../x402/handlers";
import { openPopupWindow } from "../popup-window";

export interface WsConnectReq {
  origin: string;
}
export interface WsSignTxReq {
  origin: string;
  transaction: string;
  opts?: { address?: string };
}
export interface WsSignMsgReq {
  origin: string;
  message: string;
  opts?: { address?: string };
}
export interface WsPayX402Req {
  origin: string;
  requirements: CasperPaymentRequirements;
}

export type WsHandler = (payload: unknown) => Promise<unknown>;

/* ────────────── Connect / Disconnect / Info ────────────── */

export const wsConnect: WsHandler = async (raw) => {
  const { origin } = raw as WsConnectReq;
  if (!origin) throw new Error("Origin required");
  const s = getState();
  if (s.phase === "uninitialized") {
    void openPopupWindow();
    throw new Error(
      "Baret wallet not initialized — open the wallet to set it up first.",
    );
  }
  if (s.phase === "locked") {
    // Surface the wallet so the user can unlock it, instead of failing with
    // an error the page may never show — a click "to pay/connect" should
    // always visibly do *something*, even if that something is "unlock me".
    void openPopupWindow();
    throw new Error(
      "Baret wallet is locked — open the wallet to unlock it first.",
    );
  }
  if (!s.walletAddress || !s.authorityAddress) {
    throw new Error("Wallet not ready.");
  }

  const perm = await readSitePermission(origin);
  if (perm?.status === "denied" && perm.remembered) {
    throw new Error(`Connection to ${origin} was previously denied.`);
  }
  if (!(perm?.status === "trusted" && perm.remembered)) {
    const approval = await queueConnectApproval(origin);
    if (!approval.allow) {
      if (approval.remember) {
        await writeSitePermission({
          origin,
          status: "denied",
          remembered: true,
          grantedAt: Date.now(),
        });
      }
      throw new Error("User rejected the connection.");
    }
    if (approval.remember) {
      await writeSitePermission({
        origin,
        status: "trusted",
        remembered: true,
        grantedAt: Date.now(),
      });
    }
  }

  try {
    const prior = await listHistory({ type: "dapp", origin });
    if (prior.length === 0) {
      await appendHistory({
        type: "dapp",
        signature: null,
        origin,
        summary: "Connected via Casper wallet provider",
        decision: "allow",
        reasons: [],
        broadcast: false,
        createdAt: Date.now(),
      });
    }
  } catch (err) {
    console.warn("[BARET] failed to record connect:", err);
  }

  // walletAddress holds the public-key hex; authorityAddress holds the same.
  const kp = await useAuthority();
  return {
    walletAddress: s.walletAddress,
    authorityAddress: s.authorityAddress,
    publicKey: kp.publicKeyHex,
    accountHash: kp.accountHashHex,
  };
};

function queueConnectApproval(
  origin: string,
): Promise<{ allow: boolean; remember: boolean }> {
  return new Promise((resolve) => {
    const requestId = newRequestId();
    enqueue({
      requestId,
      kind: "connect",
      origin,
      payloadBase64: "",
      label: `Connect ${origin}`,
      resolve: (out) => {
        if (out.kind !== "connect")
          return resolve({ allow: false, remember: false });
        resolve({ allow: true, remember: out.rememberOrigin });
      },
      reject: () => resolve({ allow: false, remember: false }),
    });
    dispatch({ type: "sign.start" });
  });
}

export const wsDisconnect: WsHandler = async (_raw) => {
  return { ok: true };
};

export const wsIsConnected: WsHandler = async (raw) => {
  const { origin } = raw as WsConnectReq;
  const perm = await readSitePermission(origin);
  return { connected: perm?.status === "trusted" && isUnlocked() };
};

export const wsGetAddress: WsHandler = async (_raw) => {
  const s = getState();
  if (!s.authorityAddress)
    throw new Error("Wallet not ready — no authority address.");
  const kp = await useAuthority();
  return { authorityAddress: s.authorityAddress, publicKey: kp.publicKeyHex };
};

export const wsGetNetwork: WsHandler = async (_raw) => {
  const s = getState();
  return {
    network: s.network,
    caip2: getCaip2(s.network),
  };
};

/* ────────────── x402 ────────────── */

export const wsPayX402: WsHandler = async (raw) => {
  const { origin, requirements } = raw as WsPayX402Req;
  const decision = await x402Review({ origin, requirements });
  if (decision.action !== "approve") {
    throw new Error(decision.reason);
  }
  return { headerValue: decision.headerValue };
};

/* ────────────── Sign methods — queue + popup ────────────── */

function queueAndWait(
  kind: SignKind,
  origin: string,
  payloadBase64: string,
): Promise<SignSuccess> {
  if (!isUnlocked()) {
    // Same rationale as wsConnect: surface the wallet so the user can unlock
    // it rather than silently failing a click on the page.
    void openPopupWindow();
    return Promise.reject(new Error("Baret wallet is locked."));
  }
  return new Promise<SignSuccess>((resolve, reject) => {
    const requestId = newRequestId();
    enqueue({
      requestId,
      kind,
      origin,
      payloadBase64,
      resolve,
      reject,
    });
    dispatch({ type: "sign.start" });
  });
}

export const wsSignMessage: WsHandler = async (raw) => {
  const { origin, message } = raw as WsSignMsgReq;
  const payloadBase64 = utf8ToBase64(message);
  const result = await queueAndWait("message", origin, payloadBase64);
  if (result.kind !== "message") throw new Error("Unexpected sign result kind");
  return {
    signedMessage: result.signedMessage,
    signerAddress: result.signerAddress,
  };
};

export const wsSignTransaction: WsHandler = async (raw) => {
  const { origin, transaction } = raw as WsSignTxReq;
  const result = await queueAndWait("transaction", origin, transaction);
  if (result.kind !== "transaction")
    throw new Error("Unexpected sign result kind");
  return {
    signedTransaction: result.signedTransaction,
    signerAddress: result.signerAddress,
  };
};

export const wsSignAndSendTransaction: WsHandler = async (raw) => {
  const { origin, transaction } = raw as WsSignTxReq;
  const result = await queueAndWait("transactionAndSend", origin, transaction);
  if (result.kind !== "transactionAndSend")
    throw new Error("Unexpected sign result kind");
  return {
    signedTransaction: result.signedTransaction,
    signature: result.signature,
  };
};

/* ────────────── Pure signing helpers (used by tx.sign drain handler) ────────────── */

/**
 * Signs a payload. `signerPubkey` is honored if a sub-key is in cache (Casper:
 * always null, so we fall back to the main wallet key).
 */
export async function performSign(
  kind: SignKind,
  payloadBase64: string,
  opts?: { signerPubkey?: string },
): Promise<SignSuccess> {
  const signer: CasperKeypair = opts?.signerPubkey
    ? ((await getSubKeypair(opts.signerPubkey)) ?? (await useAuthority()))
    : await useAuthority();

  if (kind === "message") {
    const message = base64ToBytes(payloadBase64);
    // 130-hex Casper signature ([algo byte] + 64-byte raw, doubled hex).
    const sig = await signer.privateKey.signAndAddAlgorithmBytes(message);
    return {
      kind: "message",
      signedMessage: Buffer.from(sig).toString("hex"),
      signerAddress: signer.publicKeyHex,
    };
  }

  if (kind === "x402Payment") {
    const requirements = JSON.parse(payloadBase64) as CasperPaymentRequirements;
    const headerValue = await buildX402Header(signer, requirements);
    return {
      kind: "x402Payment",
      headerValue,
      signerAddress: signer.publicKeyHex,
    };
  }

  // Transaction kinds: best-effort. Accept Casper transaction JSON, sign it.
  const tx = Casper.Transaction.fromJSON(JSON.parse(payloadBase64));
  tx.sign(signer.privateKey);
  const signedTransaction = JSON.stringify(tx.toJSON());

  if (kind === "transaction") {
    return {
      kind: "transaction",
      signedTransaction,
      signerAddress: signer.publicKeyHex,
    };
  }

  // transactionAndSend — submit via the active network RPC.
  const rpc = getRpcClient();
  let hash = "";
  try {
    const res = await rpc.putTransaction(tx);
    hash =
      (res as { transactionHash?: { toHex?: () => string } }).transactionHash?.toHex?.() ??
      tx.hash.toHex();
  } catch (err) {
    console.warn("[BARET] putTransaction failed:", err);
    hash = tx.hash.toHex();
  }
  return {
    kind: "transactionAndSend",
    signedTransaction,
    signature: hash,
    signerAddress: signer.publicKeyHex,
  };
}

export const wallet_standard_handlers: Record<string, WsHandler> = {
  "ws.connect": wsConnect,
  "ws.disconnect": wsDisconnect,
  "ws.isConnected": wsIsConnected,
  "ws.getAddress": wsGetAddress,
  "ws.getNetwork": wsGetNetwork,
  "ws.signMessage": wsSignMessage,
  "ws.signTransaction": wsSignTransaction,
  "ws.signAndSendTransaction": wsSignAndSendTransaction,
  "ws.payX402": wsPayX402,
  "x402.review": x402Review,
};

/* ────────────── Encoding helpers ────────────── */

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function utf8ToBase64(s: string): string {
  return Buffer.from(s, "utf8").toString("base64");
}
