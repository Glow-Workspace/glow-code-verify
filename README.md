# Glow Code Verify

Browser extension that verifies the Glow Meet web app's code against
the deployment-signed release manifest, independently of the page
itself. Derived conceptually from Meta's Code Verify (MIT).

## How it works

1. `content.js` runs on `meet-web.*` and `meet-admin.*` for every
   deployment (`glow-im.com` dev + `glow-workspace.com` prod) and fetches
   the lane's `/web-manifest/manifest.json` (`/admin/web-manifest/…` on
   admin hosts).
2. The manifest signature is verified with WebCrypto Ed25519 against
   `DEPLOYMENT_IDENTITY_PUB_B64`, baked into this (signed) extension —
   the trust anchor never rode the channel being verified.
3. `issuedAt` must be ≥ the highest previously seen (anti-rollback,
   stored in `chrome.storage.local`).
4. Every code-bearing resource the page fetched — `index.html`, all
   same-origin `.js/.mjs/.wasm` including `sw.js`, workers and dynamic
   imports (via `PerformanceObserver`) — is re-fetched, SHA-256'd and
   compared to the manifest's `code` map.
5. Result: `verified` / `violation` / `unknown` shown on the toolbar
   badge and popup.

## Coverage

Verifies the **web app** (`meet-web.*`) and **admin console**
(`meet-admin.*`) on every deployment — currently `glow-im.com` (dev)
and `glow-workspace.com` (prod).

The marketing site (`meet.*`) is deliberately **not** covered: it ships
no signed manifest and runs no session/E2EE code — its risk class is
defacement/link-swapping, which TLS + the edge already cover. (The
`/desktop/` installers it hosts need binary signing, not a code
manifest.) Decision recorded in glow-meet's
`docs/security/outstanding-findings-2026-11-03.md` §7.

## Badge

| Badge | Meaning |
|---|---|
| ✓ green | all code matches the signed manifest |
| ! red   | hash mismatch / unsigned or rolled-back manifest |
| ? amber | manifest unreachable or Ed25519 unsupported |
| … gray  | checks still running |

## Build

One universal build verifies EVERY deployment. `content.js` maps each
host → that deployment's identity anchor (a map, not a key union — a
manifest signed by the wrong deployment's key is a violation, and
foreign hosts aren't injected at all). Hosts + anchors generate from
glow-meet's `deploy/environments.json`, so a new deployment propagates
automatically.

```bash
scripts/build.sh   # → dist/ (load-unpacked ready)
```

Set `GLOW_MEET_REPO` if the glow-meet checkout isn't the sibling.

## Install (pre-store)

Download `glow-code-verify.zip` from the
[latest release](https://github.com/Glow-Workspace/glow-code-verify/releases/latest),
unzip, then:

- **Chrome/Edge**: `chrome://extensions` → Developer mode →
  *Load unpacked* → select the unzipped folder.
- **Firefox**: `about:debugging#/runtime/this-firefox` →
  *Load Temporary Add-on* → select `manifest.json`.
  (Temporary until a signed XPI is available.)

## Limitations

- Detects tampered *delivery* of listed files; a targeted MITM that
  serves clean bytes to the extension's re-fetch but bad bytes to the
  page would evade it (path-level MITMs typically don't discriminate).
- `unknown` ≠ safe — it means no manifest was reachable.
- Works alongside (not instead of) the app's service-worker
  verification, which covers users who don't install the extension.
