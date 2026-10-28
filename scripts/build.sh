#!/bin/bash
# build.sh <vps|sky47> — emit a flavored extension build into dist/<flavor>/.
#
# The extension is a flavor-bound client (docs/architecture/
# client-build-flavors.md): its baked DEPLOYMENT_IDENTITY_PUB_B64 and
# manifest host patterns pin exactly one deployment — an rk-2 build on
# axitechnologies.pk would report sky47-1-signed manifests as
# VIOLATIONS, and a sky47-1 build on glow-im.com would do the reverse.
#
# The committed source IS the vps build (same committed-default
# convention as DeploymentFlavor.generated.swift / deployment.ts):
# `build.sh vps` copies verbatim; other flavors substitute that
# flavor's base domain + identity pub read from glow-meet's canonical
# deploy/flavors.json (GLOW_MEET_REPO overrides the sibling checkout).
#
# Output: dist/<flavor>/ — load-unpacked ready. Gate the result with
#   <glow-meet>/scripts/check-flavor.sh <flavor> --expect-domain dist/<flavor>
set -euo pipefail
FLAVOR="${1:?usage: build.sh <vps|sky47|debug|release>}"
# debug/release aliases — same pairing as Android's build types:
# debug ↔ vps, release ↔ sky47 (docs/architecture/client-build-flavors.md).
case "$FLAVOR" in
  debug)   FLAVOR=vps ;;
  release) FLAVOR=sky47 ;;
esac
EXT="$(cd "$(dirname "$0")/.." && pwd)"
MEET="$(cd "${GLOW_MEET_REPO:-$EXT/../glow-meet}" && pwd)"
FLAVORS_JSON="$MEET/deploy/flavors.json"
OUT="$EXT/dist/$FLAVOR"

[ -f "$FLAVORS_JSON" ] || { echo "no $FLAVORS_JSON — set GLOW_MEET_REPO"; exit 2; }
read_f() { python3 -c "import json;print(json.load(open('$FLAVORS_JSON'))$1)"; }
BASE="$(read_f "['flavors']['$FLAVOR']['baseDomain']")" || exit 1
PUB="$(read_f "['flavors']['$FLAVOR']['deploymentIdentityPub']")" || exit 1
KEYID="$(read_f "['flavors']['$FLAVOR']['keyId']")" || exit 1

rm -rf "$OUT"; mkdir -p "$OUT"
for f in manifest.json content.js popup.js popup.html background.js LICENSE.md icons; do
  cp -R "$EXT/$f" "$OUT/"
done

# Source literals are the vps flavor — substitute only for others.
if [ "$FLAVOR" != "vps" ]; then
  python3 - "$OUT" "$BASE" "$PUB" <<'EOF'
import sys
out, base, pub = sys.argv[1], sys.argv[2], sys.argv[3]
for name, subs in {
    "manifest.json": [("meet-web.glow-im.com", f"meet-web.{base}")],
    "content.js": [("BVs8SY77q3COnqm9zsZVNiEJ3o0pQpdoAK+GW9afEMk=", pub)],
}.items():
    p = f"{out}/{name}"
    s = open(p).read()
    for a, b in subs:
        s = s.replace(a, b)
    open(p, "w").write(s)
EOF
fi

echo "build: dist/$FLAVOR — $BASE ($KEYID)"
