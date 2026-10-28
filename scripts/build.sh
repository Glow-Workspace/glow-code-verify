#!/bin/bash
# build.sh — emit the universal extension build into dist/.
#
# One artifact verifies EVERY deployment: content.js's IDENTITY_PUBS
# maps each host → that deployment's identity anchor (a map, not a
# key union — an rk-2-signed manifest on the sky47 domain is still a
# VIOLATION, and vice versa; hosts outside the map aren't injected at
# all). Hosts and anchors are generated from glow-meet's canonical
# deploy/flavors.json (GLOW_MEET_REPO overrides the sibling checkout),
# so new flavors propagate automatically.
#
# Output: dist/ — load-unpacked ready.
set -euo pipefail
EXT="$(cd "$(dirname "$0")/.." && pwd)"
MEET="$(cd "${GLOW_MEET_REPO:-$EXT/../glow-meet}" && pwd)"
FLAVORS_JSON="$MEET/deploy/flavors.json"
OUT="$EXT/dist"

[ -f "$FLAVORS_JSON" ] || { echo "no $FLAVORS_JSON — set GLOW_MEET_REPO"; exit 2; }

rm -rf "$OUT"; mkdir -p "$OUT"
for f in manifest.json content.js popup.js popup.html background.js LICENSE.md icons; do
  cp -R "$EXT/$f" "$OUT/"
done

python3 - "$OUT" "$FLAVORS_JSON" <<'EOF'
import json, re, sys
out, fj = sys.argv[1], sys.argv[2]
flavors = json.load(open(fj))["flavors"]
hosts = [f"meet-web.{f['baseDomain']}" for f in flavors.values()]
anchors = {h: f["deploymentIdentityPub"] for h, f in
           zip(hosts, flavors.values())}

# content.js — replace the single-entry source map with every flavor's.
p = f"{out}/content.js"
s = open(p).read()
map_src = "{\n" + "".join(f'    "{h}": "{p}",\n' for h, p in anchors.items()) + "  }"
s = re.sub(r"IDENTITY_PUBS = \{[^}]*\}", f"IDENTITY_PUBS = {map_src}", s, count=1)
open(p, "w").write(s)

# manifest.json — union of every flavor's host patterns.
p = f"{out}/manifest.json"
s = open(p).read()
matches = [pat for h in hosts
           for pat in (f"https://{h}/*", f"https://{h}:8443/admin/*")]
perms = [pat for h in hosts
         for pat in (f"https://{h}/*", f"https://{h}:8443/*")]
s = re.sub(r'"matches": \[[^\]]*\]', '"matches": ' + json.dumps(matches), s, count=1)
s = re.sub(r'"host_permissions": \[[^\]]*\]', '"host_permissions": ' + json.dumps(perms), s, count=1)
open(p, "w").write(s)
EOF

# Gate: every flavor's host in BOTH files' pattern sets, every flavor's
# pub in content.js — and nothing else.
python3 - "$OUT" "$FLAVORS_JSON" <<'EOF'
import json, re, sys
out, fj = sys.argv[1], sys.argv[2]
flavors = json.load(open(fj))["flavors"]
want_hosts = {f"meet-web.{f['baseDomain']}" for f in flavors.values()}
want_pubs = {f["deploymentIdentityPub"] for f in flavors.values()}
man = open(f"{out}/manifest.json").read()
con = open(f"{out}/content.js").read()
got_hosts = set(re.findall(r'meet-web\.[\w.-]+', man)) | set(re.findall(r'meet-web\.[\w.-]+', con))
got_pubs = set(re.findall(r'"([A-Za-z0-9+/]{43}=)"', con))
assert got_hosts == want_hosts, f"host set drift: {got_hosts ^ want_hosts}"
assert want_pubs <= got_pubs, f"missing pubs: {want_pubs - got_pubs}"
print(f"gate: {len(got_hosts)} hosts, {len(want_pubs)} anchors: {', '.join(sorted(got_hosts))}")
EOF
