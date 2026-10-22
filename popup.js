const HEADLINES = {
  checking: "Checking…",
  unknown: "Could not verify",
  verified: "Code verified",
  violation: "Validation failure",
};

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const state = tab?.id
  ? await chrome.runtime.sendMessage({ type: "gcv-query", tabId: tab.id }).catch(() => null)
  : null;

const s = state ?? { status: "unknown", checked: 0, violations: [], issuedAt: null };
document.getElementById("dot").className = `dot ${s.status}`;
document.getElementById("headline").textContent = HEADLINES[s.status] ?? HEADLINES.unknown;
const bits = [];
if (s.url) bits.push(new URL(s.url).hostname);
if (s.issuedAt) bits.push(`manifest ${new Date(s.issuedAt).toISOString()}`);
bits.push(`${s.checked} files checked`);
document.getElementById("detail").textContent = bits.join(" · ");
document.getElementById("violations").innerHTML = (s.violations ?? [])
  .map((v) => `<div class="viol">✗ ${v.replace(/</g, "&lt;")}</div>`)
  .join("");
