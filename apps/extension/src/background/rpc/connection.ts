/**
 * Pooled Casper RPC clients per network. Reused across handlers so we don't
 * open redundant sockets. One JSON-RPC endpoint per network.
 */

import { makeRpcClient, networkConfig, type CasperNetworkConfig } from "@casper-baret/casper-core";
import type { CasperNetwork } from "@casper-baret/ext-protocol";
import { getState } from "../state/store";

type RpcClient = ReturnType<typeof makeRpcClient>;

const rpcCache = new Map<CasperNetwork, RpcClient>();

export function getNetworkConfig(network?: CasperNetwork): CasperNetworkConfig {
  const n: CasperNetwork = network ?? getState().network;
  // ext-protocol + state use the same id union as casper-core.
  return networkConfig(n);
}

export function getRpcClient(network?: CasperNetwork): RpcClient {
  const n: CasperNetwork = network ?? getState().network;
  let client = rpcCache.get(n);
  if (!client) {
    client = makeRpcClient(getNetworkConfig(n).rpcUrl);
    rpcCache.set(n, client);
  }
  return client;
}

/** CAIP-2 network id, e.g. "casper:casper-test". */
export function getCaip2(network?: CasperNetwork): string {
  return getNetworkConfig(network).caip2;
}

/** Casper chain name used inside transactions, e.g. "casper-test". */
export function getChainName(network?: CasperNetwork): string {
  return getNetworkConfig(network).chainName;
}
