/**
 * Post-sign monitor — STUBBED.
 *
 * Drift detection is deferred: Casper's JSON-RPC has no direct
 * "transactions for account" endpoint. Once the cspr.live event store
 * or a suitable indexer is available, this is where we subscribe and
 * alert on anything the user didn't sign.
 *
 * TODO: subscribe via cspr.live API or event store once available.
 */

export function startMonitorLifecycle(): void {
  // no-op
}
