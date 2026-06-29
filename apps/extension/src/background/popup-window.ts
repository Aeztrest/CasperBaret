/**
 * Programmatic popup launcher.
 *
 * Chrome MV3 disallows `chrome.action.openPopup()` from background contexts
 * without a user gesture — so when a dApp queues a sign / connect request
 * we open the popup HTML in a small focused window instead. Phantom and
 * Freighter use the same trick.
 *
 * One window at a time: if a popup is already open we just focus it.
 */

import browser from "webextension-polyfill";

// `?popout=1` tells the popup to fill the window (viewport-fill) instead of
// rendering at the fixed 360×600 toolbar-popup size — otherwise the UI sits in
// a small box in the corner of this larger standalone window. See main.tsx.
const POPUP_URL_PATH = "src/popup/index.html?popout=1";
const POPUP_WIDTH = 380;
const POPUP_HEIGHT = 620;

let currentPopupWindowId: number | null = null;

export async function openPopupWindow(): Promise<void> {
  if (currentPopupWindowId !== null) {
    try {
      const existing = await browser.windows.get(currentPopupWindowId);
      if (existing) {
        await browser.windows.update(currentPopupWindowId, { focused: true });
        return;
      }
    } catch {
      currentPopupWindowId = null;
    }
  }

  // Prefer the native toolbar popup (Chrome 127+). It appears attached to the
  // extension icon — no new window, no tab. Falls back to windows.create when
  // openPopup is unavailable or blocked (Firefox, older Chrome).
  try {
    const action = (browser as unknown as { action?: { openPopup?: () => Promise<void> } }).action;
    if (typeof action?.openPopup === "function") {
      await action.openPopup();
      return;
    }
  } catch {
    // openPopup can throw if there is no active window or if it's not a user gesture.
  }

  try {
    const url = browser.runtime.getURL(POPUP_URL_PATH);
    const created = await browser.windows.create({
      url,
      type: "popup",
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      focused: true,
    });
    currentPopupWindowId = created.id ?? null;
  } catch (err) {
    console.warn("[BLACKTHORN] failed to open popup window:", err);
  }
}

/**
 * Close the programmatically-opened sign/connect window once its queue drains.
 * No-op if we never opened one (e.g. the request was handled from the toolbar
 * action popup, which closes itself on blur). Only ever removes the window we
 * opened, tracked via `currentPopupWindowId`.
 */
export async function closePopupWindow(): Promise<void> {
  if (currentPopupWindowId === null) return;
  const id = currentPopupWindowId;
  currentPopupWindowId = null;
  try {
    await browser.windows.remove(id);
  } catch {
    // Already closed by the user — nothing to do.
  }
}

/** Wallet locked / session reset — drop the cached id so the next sign request opens fresh. */
export function resetPopupWindow(): void {
  currentPopupWindowId = null;
}
