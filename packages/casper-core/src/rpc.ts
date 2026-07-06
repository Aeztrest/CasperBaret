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
