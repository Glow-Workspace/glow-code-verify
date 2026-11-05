/**
 * Glow Code Verify — content script (isolated world).
 *
 * Verifies the code Glow Meet actually loaded against the
 * deployment-signed release manifest (/web-manifest/manifest.json).
 * The manifest is Ed25519-signed by REALTIME_IDENTITY_KEY; its public
 * half is baked HERE — inside signed extension code — so unlike the
 * service worker's TOFU pin, this anchor never rode the channel being
 * verified.
 *
 * States reported to the background worker:
 *   checking → verified | violation | unknown (no manifest / no
 *   WebCrypto Ed25519)
 *
 * Derived conceptually from Meta's Code Verify (MIT) — the manifest
 * format is Glow's (signed JSON, not a hash tree).
 */
(() => {
  // Host → deployment-identity anchor. A map, not a key set: each host
  // accepts ONLY its own signer, so a compromise of one deployment's
  // key can't green-sign manifests on another deployment's domain.
  // Hosts absent from the map aren't injected at all (manifest.json
  // matches) — same fail-closed as before.
  const IDENTITY_PUBS = {
    "meet-web.glow-im.com": "BVs8SY77q3COnqm9zsZVNiEJ3o0pQpdoAK+GW9afEMk=",
  };
  const DEPLOYMENT_IDENTITY_PUB_B64 = IDENTITY_PUBS[location.hostname];
  if (!DEPLOYMENT_IDENTITY_PUB_B64) return; // matched host without an anchor — never verify blind
  // Two signed lanes, one deployment identity. The admin console lives
  // on the dedicated meet-admin.<base> host under /admin (legacy
  // deployments also exposed it at meet-web:8443/admin — the port check
  // keeps those working); the meeting app owns the public :443 origin.
  const ADMIN = location.hostname.startsWith("meet-admin.") || location.port === "8443";
  const BASE = ADMIN ? "/admin" : "";
  const MANIFEST_URL = `${BASE}/web-manifest/manifest.json`;
  const INDEX_PATH = `${BASE}/index.html`;
  // Freshness is per-host AND per-lane: each deployment's issuedAt is an
  // independent clock, so a shared key would false-flag cross-deployment
  // visits as rollbacks.
  const STORE_KEY = `maxIssuedAt:${location.hostname}:${ADMIN ? "admin" : "web"}`;
  const CODE_RE = /\.(m?js|wasm)$/;
  const SKIP_PATHS = new Set([
    MANIFEST_URL, `${BASE}/manifest.unsigned.json`, `${BASE}/__web-anchor-reset`,
  ]);

  /* Canonical JSON — byte-identical to
   * packages/protocol/src/web-manifest.ts and public/sw.js. */
  function canonicalJson(v) {
    if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
    if (v !== null && typeof v === "object") {
      return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(",")}}`;
    }
    return JSON.stringify(v);
  }

  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256B64(buf) {
    const d = await crypto.subtle.digest("SHA-256", buf);
    let s = "";
    const b = new Uint8Array(d);
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return "sha256-" + btoa(s);
  }

  const state = {
    status: "checking",
    checked: 0,
    checkedPaths: /** @type {string[]} */ ([]),
    violations: /** @type {string[]} */ ([]),
    issuedAt: null,
    manifestMissing: false,
  };
  let code = null; // manifest code map once verified
  let done = false;
  const pending = new Set();

  function report() {
    chrome.runtime.sendMessage({
      type: "gcv-state",
      status: state.status,
      checked: state.checked,
      checkedPaths: state.checkedPaths,
      violations: state.violations,
      issuedAt: state.issuedAt,
      url: location.href,
    }).catch(() => {});
    console.log(
      `glow-code-verify: ${state.status.toUpperCase()} — ${state.checked} files` +
        (state.violations.length ? ` | violations: ${state.violations.join(", ")}` : ""),
    );
  }

  /** Check one URL's bytes against the verified manifest code map. */
  async function checkResource(url) {
    if (done && code === null) return;
    const u = new URL(url, location.origin);
    if (u.origin !== location.origin) return;
    const path = u.pathname;
    if (SKIP_PATHS.has(path)) return;
    if (pending.has(path)) return;
    pending.add(path);
    try {
      const resp = await fetch(path, { cache: "force-cache" });
      if (!resp.ok) return; // errors carry no executable code
      const hash = await sha256B64(await resp.arrayBuffer());
      state.checked++;
      state.checkedPaths.push(path);
      if (code && code[path] !== hash) {
        state.violations.push(code[path] === undefined ? `${path} (not in manifest)` : `${path} (hash mismatch)`);
        state.status = "violation";
      }
      report();
    } catch { /* network hiccup — next observer pass retries */ }
    finally { pending.delete(path); }
  }

  function scanResourceEntries() {
    for (const e of performance.getEntriesByType("resource")) {
      const path = new URL(e.name, location.origin).pathname;
      if (CODE_RE.test(path)) void checkResource(e.name);
    }
  }

  async function verify() {
    // 1) Fetch + authenticate the signed manifest.
    let m;
    try {
      const r = await fetch(MANIFEST_URL, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      m = await r.json();
    } catch {
      state.manifestMissing = true;
      state.status = "unknown";
      report();
      return;
    }
    let ok = false;
    if (m && m.v === 1 && typeof m.issuedAt === "number" && m.code && m.sig) {
      try {
        const key = await crypto.subtle.importKey(
          "raw", b64ToBytes(DEPLOYMENT_IDENTITY_PUB_B64), "Ed25519", false, ["verify"],
        );
        const bytes = new TextEncoder().encode(canonicalJson({ v: m.v, issuedAt: m.issuedAt, code: m.code }));
        ok = await crypto.subtle.verify("Ed25519", key, b64ToBytes(m.sig), bytes);
      } catch { ok = false; }
    }
    if (!ok) {
      state.status = "violation";
      state.violations.push("manifest signature invalid");
      report();
      return;
    }
    // Freshness — reject manifest rollback. One clock per lane: the two
    // manifests are signed independently and share no ordering.
    const stored = await chrome.storage.local.get(STORE_KEY);
    if (m.issuedAt < (stored[STORE_KEY] ?? 0)) {
      state.status = "violation";
      state.violations.push(`manifest rollback (${m.issuedAt} < ${stored[STORE_KEY]})`);
      report();
      return;
    }
    await chrome.storage.local.set({ [STORE_KEY]: m.issuedAt });
    code = m.code;
    state.issuedAt = m.issuedAt;

    // 2) The document itself (SPA: any path serves index.html bytes).
    {
      const path = INDEX_PATH;
      const hash = await sha256B64(
        await (await fetch(location.href, { cache: "no-store" })).arrayBuffer(),
      );
      state.checked++;
      state.checkedPaths.push(path);
      if (code[path] !== hash) state.violations.push(`${path} (hash mismatch)`);
      if (state.violations.length) state.status = "violation";
    }

    // 3) Every code-bearing resource the page fetched.
    scanResourceEntries();
    // Late arrivals (dynamic imports, lazily-created workers).
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        const path = new URL(e.name, location.origin).pathname;
        if (CODE_RE.test(path)) void checkResource(e.name);
      }
    }).observe({ type: "resource", buffered: true });

    // Settle: wait until pending checks drain, then finalize.
    const finish = () => {
      if (pending.size) return void setTimeout(finish, 200);
      if (state.status === "checking") state.status = "verified";
      done = true;
      report();
    };
    finish();
  }

  if (document.readyState === "complete") void verify();
  else window.addEventListener("load", () => void verify(), { once: true });
})();
