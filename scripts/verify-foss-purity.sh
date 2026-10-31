#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-3.0-or-later
# FOSS purity check for the foss flavor: a fast DEX scan for Google Play services and Firebase
# bytecode. The job `android` runs it on every foss APK it builds.
set -euo pipefail

ARTIFACT="${1:?usage: verify-foss-purity.sh <apk-or-aab>}"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

unzip -q "$ARTIFACT" -d "$TMPDIR"

PATTERNS=(
  'com/google/android/gms'
  'com/google/firebase'
  'Lcom/google/android/gms'
  'Lcom/google/firebase'
)

found=0
while IFS= read -r -d '' dex; do
  blob="$(strings "$dex" 2>/dev/null || true)"
  for pattern in "${PATTERNS[@]}"; do
    if printf '%s' "$blob" | grep -qF "$pattern"; then
      echo "FOSS purity FAIL: found '$pattern' in $(basename "$dex")"
      found=1
    fi
  done
done < <(find "$TMPDIR" -name 'classes*.dex' -print0)

if [ "$found" -ne 0 ]; then
  echo "FOSS purity check failed for $ARTIFACT"
  exit 1
fi

echo "FOSS purity OK: no GMS/Firebase references in $(basename "$ARTIFACT")"
