/**
 * Glow Code Verify — background service worker.
 * Holds per-tab verification state reported by content.js and drives
 * the action badge: ✓ verified · ! violation · ? unknown/checking.
 */
const tabState = new Map();

const BADGE = {
  checking: { text: "…", color: "#8a8f98" },
  unknown: { text: "?", color: "#b45309" },
  verified: { text: "✓", color: "#16a34a" },
  violation: { text: "!", color: "#dc2626" },
};

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "gcv-state" || !sender.tab?.id) return;
  tabState.set(sender.tab.id, msg);
  const b = BADGE[msg.status] ?? BADGE.checking;
  void chrome.action.setBadgeText({ tabId: sender.tab.id, text: b.text });
  void chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: b.color });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "gcv-query") {
    sendResponse(tabState.get(msg.tabId) ?? null);
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => tabState.delete(tabId));

/* Debug/e2e hook — read-only snapshot. */
globalThis.__gcv = tabState;
