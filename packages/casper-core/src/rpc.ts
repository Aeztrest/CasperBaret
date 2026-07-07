/**
 * Casper network config + RPC client factories.
 */

import Casper, { HttpHandler, RpcClient, SpeculativeClient } from "./sdk.js";
import type {
  RpcClient as RpcClientT,
  SpeculativeClient as SpeculativeClientT,
  Transaction,
} from "casper-js-sdk";

export type CasperNetworkId = "testnet" | "mainnet";

export interface CasperNetworkConfig {
  id: CasperNetworkId;
  /** Casper chain name used inside transactions, e.g. "casper-test". */
  chainName: string;
  /** CAIP-2 network id used by x402, e.g. "casper:casper-test". */
  caip2: string;
  rpcUrl: string;
  explorerBase: string;
}

export const NETWORKS: Record<CasperNetworkId, CasperNetworkConfig> = {
  testnet: {
    id: "testnet",
    chainName: "casper-test",
    caip2: "casper:casper-test",
    rpcUrl: "https://node.testnet.casper.network/rpc",
    explorerBase: "https://testnet.cspr.live",
  },
  mainnet: {
    id: "mainnet",
    chainName: "casper",
    caip2: "casper:casper",
    rpcUrl: "https://node.mainnet.casper.network/rpc",
    explorerBase: "https://cspr.live",
  },
};

export function networkConfig(id: CasperNetworkId): CasperNetworkConfig {
  return NETWORKS[id];
}

/** CAIP-2 id → network config (for x402 requirements). */
export function networkFromCaip2(caip2: string): CasperNetworkConfig | undefined {
  return Object.values(NETWORKS).find((n) => n.caip2 === caip2);
}

export function makeRpcClient(rpcUrl: string): RpcClientT {
  return new RpcClient(new HttpHandler(rpcUrl));
}

/**
 * Speculative-exec client (dry-run a transaction without committing). Note
 * that `speculative_exec` is disabled on most public RPC nodes; callers must
 * handle an unavailable endpoint gracefully.
 */
export function makeSpeculativeClient(speculativeUrl: string): SpeculativeClientT {
  return new SpeculativeClient(new HttpHandler(speculativeUrl));
}

export function explorerTxUrl(cfg: CasperNetworkConfig, deployOrTxHash: string): string {
  return `${cfg.explorerBase}/deploy/${deployOrTxHash}`;
}

export function explorerAccountUrl(cfg: CasperNetworkConfig, publicKeyHex: string): string {
  return `${cfg.explorerBase}/account/${publicKeyHex}`;
}

/**
 * Submitting a transaction only proves the node accepted it for inclusion —
 * NOT that it executed successfully. Wait for the block execution result and
 * return its error (if any) instead of trusting a successful `putTransaction`
 * call. Returns `null` when execution succeeded.
 */
export async function waitForExecutionError(
  rpc: RpcClientT,
  txn: Transaction,
  timeoutMs = 60_000,
): Promise<string | null> {
  try {
    const confirmed = await rpc.waitForTransaction(txn, timeoutMs);
    return confirmed.executionInfo?.executionResult?.errorMessage ?? null;
  } catch (err) {
    // Timed out or the node lost track of it — we genuinely don't know the
    // outcome; treat as unconfirmed rather than silently claiming success.
    return `could not confirm execution: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export interface ConfirmedTransfer {
  /** Bare 64-hex account hash the transfer moved funds to, if known. */
  toAccountHash: string | null;
  amountMotes: string;
}

/**
 * Like `waitForExecutionError`, but also returns the transaction's own
 * recorded native-transfer effects. A native transfer's execution result
 * lists exactly which purses moved how much — reading that directly is far
 * more reliable than snapshotting an account's balance before/after when
 * that account is also used for unrelated concurrent activity (e.g. a
 * treasury that pays gas for many other transactions at the same time):
 * a before/after delta can be thrown off by anything else touching the
 * same balance in that window, silently under- or over-crediting.
 *
 * `Casper.Transaction` is a unified wrapper here: `Transaction.fromJSON`
 * happily parses a legacy Deploy JSON too (some wallets sign whatever
 * they're handed as a Deploy internally), exposing `.originDeployV1` in
 * that case — `.chainName`/`.approvals`/`.initiatorAddr`/`putTransaction`
 * all already work transparently either way. The one thing that doesn't:
 * `rpc.waitForTransaction`/`getTransactionByTransactionHash` always queries
 * by a Version1-tagged hash, so a Deploy-origin transaction's *own* hash
 * (tagged Deploy) is never found — confirmed live, this returns
 * "NoSuchTransaction" (-32014) even once the deploy has genuinely executed,
 * while a raw `info_get_deploy` JSON-RPC call for the same hash resolves
 * fine with full execution + transfer detail. `rpcUrl` is needed to poll
 * that endpoint directly for the Deploy-origin case.
 */
export async function waitForConfirmedTransfers(
  rpc: RpcClientT,
  rpcUrl: string,
  txn: Transaction,
  timeoutMs = 60_000,
): Promise<{ errorMessage: string | null; transfers: ConfirmedTransfer[] }> {
  // `originDeployV1` is declared `private` in the SDK's own types (it's
  // real at runtime — TS's `private` isn't enforced there), so there's no
  // public-API way to check this other than reaching past the type.
  const isDeployOrigin = !!(txn as unknown as { originDeployV1?: unknown }).originDeployV1;
  if (isDeployOrigin) {
    return waitForConfirmedDeployTransfers(rpcUrl, txn.hash.toHex(), timeoutMs);
  }
  try {
    const confirmed = await rpc.waitForTransaction(txn, timeoutMs);
    const errorMessage = confirmed.executionInfo?.executionResult?.errorMessage ?? null;
    const rawTransfers = confirmed.executionInfo?.executionResult?.transfers ?? [];
    const transfers: ConfirmedTransfer[] = rawTransfers.map((t) => ({
      toAccountHash: t.to?.toHex?.() ?? null,
      amountMotes: t.amount?.toString?.() ?? "0",
    }));
    return { errorMessage, transfers };
  } catch (err) {
    return {
      errorMessage: `could not confirm execution: ${err instanceof Error ? err.message : String(err)}`,
      transfers: [],
    };
  }
}

async function waitForConfirmedDeployTransfers(
  rpcUrl: string,
  deployHashHex: string,
  timeoutMs: number,
): Promise<{ errorMessage: string | null; transfers: ConfirmedTransfer[] }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const body = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "info_get_deploy",
          params: { deploy_hash: deployHashHex },
        }),
      }).then((r) => r.json());
      const execResult = body?.result?.execution_info?.execution_result;
      if (execResult) {
        const v2 = execResult.Version2 ?? execResult;
        const errorMessage: string | null = v2.error_message ?? null;
        const rawTransfers: unknown[] = Array.isArray(v2.transfers) ? v2.transfers : [];
        const transfers: ConfirmedTransfer[] = rawTransfers.map((raw) => {
          const t = (raw as { Version2?: Record<string, unknown>; Version1?: Record<string, unknown> }).Version2
            ?? (raw as { Version1?: Record<string, unknown> }).Version1
            ?? (raw as Record<string, unknown>);
          const to = typeof t.to === "string" ? t.to.replace(/^account-hash-/, "") : null;
          return { toAccountHash: to, amountMotes: typeof t.amount === "string" ? t.amount : "0" };
        });
        return { errorMessage, transfers };
      }
    } catch {
      // Transient RPC hiccup — keep polling until the deadline.
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return {
    errorMessage: "could not confirm execution: timed out waiting for deploy",
    transfers: [],
  };
}

// packageHash -> live "hash-<contractHash>" key, so repeated balance reads
// don't re-resolve the package's active contract version every time.
const contractKeyCache = new Map<string, string>();

async function resolveContractKey(
  rpc: RpcClientT,
  stateRootHash: string,
  packageHash: string,
): Promise<string> {
  const cached = contractKeyCache.get(packageHash);
  if (cached) return cached;

  const res = await rpc.queryGlobalStateByStateHash(stateRootHash, `hash-${packageHash}`, []);
  const versions = res.storedValue.contractPackage?.versions ?? [];
  const version = versions[versions.length - 1];
  if (!version) throw new Error(`No active contract version for package ${packageHash}`);
  const key = `hash-${version.contractHash.hash.toHex()}`;
  contractKeyCache.set(packageHash, key);
  return key;
}

function isDictionaryValueNotFound(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /not found|ValueNotFound/i.test(message);
}

/**
 * Reads a CEP-18 token balance from its `balances` dictionary. Odra's
 * base64-encoded dictionary key is `0x00` (the `Address::Account` tag) plus
 * the 32-byte account hash. A dictionary miss means a real zero balance
 * (the account never held this token) — only a genuine query failure
 * (bad package hash, RPC unreachable) throws.
 */
export async function readCep18Balance(
  rpc: RpcClientT,
  packageHash: string,
  accountHashHex: string,
): Promise<string> {
  const dictionaryItemKey = Buffer.concat([
    Buffer.from([0x00]),
    Buffer.from(accountHashHex, "hex"),
  ]).toString("base64");

  const { stateRootHash } = await rpc.getStateRootHashLatest();
  const contractKey = await resolveContractKey(rpc, stateRootHash.toHex(), packageHash);

  try {
    const result = await rpc.getDictionaryItemByIdentifier(
      stateRootHash.toHex(),
      new Casper.ParamDictionaryIdentifier(
        undefined,
        new Casper.ParamDictionaryIdentifierContractNamedKey(contractKey, "balances", dictionaryItemKey),
      ),
    );
    return result.storedValue.clValue?.ui256?.toString() ?? "0";
  } catch (err) {
    if (isDictionaryValueNotFound(err)) return "0";
    throw err;
  }
}
