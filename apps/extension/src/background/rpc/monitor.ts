/**
 * Post-sign monitor — STUBBED on Casper.
 *
 * The Stellar build polled Horizon for transactions touching the wallet and
 * raised drift alerts for anything Baret didn't sign. Casper's RPC has no
 * direct "transactions for account" endpoint equivalent, so drift detection
 * is deferred.
 *
 * TODO(casper): reconcile via cspr.live API or the event store once available.
 */

export function startMonitorLifecycle(): void {
  // no-op
}
