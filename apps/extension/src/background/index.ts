/**
 * Background service worker entry.
 *
 * Lifecycle: this file runs every time Chrome wakes the worker. Heavy
 * subsystems (RPC sockets, IndexedDB) are opened on-demand by their callers,
 * not here, so the cold-start path stays under 50 ms.
 */

import browser from "webextension-polyfill";
import { startRouter } from "./messaging/router";
import { dispatch, rehydrate, subscribe } from "./state/store";
import { INITIAL_STATE } from "./state/machine";
import { hasKeystore, readKeystore, activeAccount } from "./db/keystore";
import { restoreFromSessionStorage } from "./crypto/session";
import { startMonitorLifecycle } from "./rpc/monitor";
import { countUnread } from "./db/alerts";
import { openPopupWindow } from "./popup-window";
import { markBootstrapReady } from "./ready";

async function bootstrap(): Promise<void> {
  const exists = await hasKeystore();
  if (!exists) {
    rehydrate({ ...INITIAL_STATE, phase: "uninitialized" });
    return;
  }

  const row = await readKeystore();
  if (!row) {
    rehydrate({ ...INITIAL_STATE, phase: "uninitialized" });
    return;
  }

  // Smart wallet not yet provisioned → fall back to the authority address so
  // UI surfaces a non-null wallet identifier while locked.
  const acct = activeAccount(row);
  const walletAddress = acct.smartWalletAddress ?? acct.authorityPubkey;
  const accounts = row.accounts.map((a) => ({
    index: a.index,
    name: a.name,
    address: a.smartWalletAddress ?? a.authorityPubkey,
    authorityAddress: a.authorityPubkey,
  }));

  let alertsUnread = 0;
  try {
    alertsUnread = await countUnread();
  } catch {
    /* IndexedDB might not be open yet */
  }

  // The service worker was very likely just restarted by Chrome (MV3 kills
  // an idle worker after ~30s) rather than the user actually locking the
  // wallet — recover any still-valid unlocked session before defaulting to
  // "locked", or every restart looks like a fresh lock to the user.
  const restoredActive = await restoreFromSessionStorage();
  const restoredIndex = restoredActive
    ? row.accounts.findIndex((a) => a.kind === restoredActive.kind && a.index === restoredActive.index)
    : -1;

  rehydrate({
    ...INITIAL_STATE,
    phase: restoredActive && restoredIndex >= 0 ? "ready" : "locked",
    walletAddress,
    authorityAddress: acct.authorityPubkey,
    alertsUnread,
    accounts,
    activeIndex: restoredIndex >= 0 ? restoredIndex : row.activeIndex,
  });
  void dispatch;
}

browser.runtime.onInstalled.addListener(({ reason }) => {
  console.info(`[BLACKTHORN] installed (${reason})`);
});

void bootstrap()
  .catch((err) => {
    console.error("[BLACKTHORN] bootstrap failed:", err);
  })
  .finally(() => markBootstrapReady());

startRouter();
startMonitorLifecycle();

// Auto-open the popup window whenever a dApp queues a sign or connect
// request — MV3 won't open the action popup programmatically, but a small
// popup-type window works the same way Phantom and Freighter do it.
subscribe((next, prev) => {
  if (next.phase === "signing" && prev.phase !== "signing") {
    void openPopupWindow();
  }
});
