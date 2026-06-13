/**
 * Casper network config + RPC client factories.
 */

import { HttpHandler, RpcClient, SpeculativeClient } from "./sdk.js";
import type { RpcClient as RpcClientT, SpeculativeClient as SpeculativeClientT } from "casper-js-sdk";

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
