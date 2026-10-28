# Glow Code Verify

Browser extension that verifies the Glow Meet web app's code against
the deployment-signed release manifest, independently of the page
itself. Derived conceptually from Meta's Code Verify (MIT).

## How it works

1. `content.js` runs on `https://meet-web.glow-im.com/* (+ :8443/admin)` and fetches
   `/web-manifest/manifest.json`.
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

## Badge

| Badge | Meaning |
|---|---|
| ✓ green | all code matches the signed manifest |
| ! red   | hash mismatch / unsigned or rolled-back manifest |
| ? amber | manifest unreachable or Ed25519 unsupported |
| … gray  | checks still running |

## Build flavors

The extension is a flavor-bound client (see glow-meet's
`docs/architecture/client-build-flavors.md`): the baked identity pub +
manifest host patterns pin ONE deployment.

```bash
scripts/build.sh debug    # = vps   — meet-web.glow-im.com, rk-2 anchors
scripts/build.sh release  # = sky47 — meet-web.axitechnologies.pk, sky47-1
```

Emits `dist/<flavor>/` (load-unpacked ready). The committed source IS
the vps build — other flavors substitute from glow-meet's
`deploy/flavors.json` (set `GLOW_MEET_REPO` if it isn't the sibling
checkout). Verify an artifact with
`<glow-meet>/scripts/check-flavor.sh <flavor> --expect-domain dist/<flavor>`.

## Install (pre-store)

Download `glow-code-verify.zip`, unzip, then:

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
