/**
 * Resolves once background/index.ts's cold-start bootstrap (reading the
 * keystore, restoring any still-valid session) has finished rehydrating the
 * state store.
 *
 * Without this, a request arriving right as the service worker wakes up
 * (e.g. the popup's very first `wallet.getState` call) can race ahead of
 * `rehydrate()` and see the module's default INITIAL_STATE
 * (`phase: "uninitialized"`) even though a wallet actually exists on disk —
 * the popup then briefly shows onboarding instead of the lock screen. The
 * router awaits this before handling any request so every answer reflects
 * the real, rehydrated state.
 */

let resolveBootstrapReady!: () => void;

export const bootstrapReady = new Promise<void>((resolve) => {
  resolveBootstrapReady = resolve;
});

export function markBootstrapReady(): void {
  resolveBootstrapReady();
}
