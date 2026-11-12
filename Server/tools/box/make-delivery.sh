#!/bin/bash
# Runs ON THE BOX. stdin: wanted file names (from tools/pending-files.sh on a Mac). Packs every one found on the box
# (plus the .csv sibling of each .xlsx) into one flat archive, default /workspace/transfer/mf-delivery.tgz, and lists it.
# Then: CopyFromBox the archive to <Mac app>/files/mf-delivery.tgz and run tools/receive-delivery.sh on that Mac.
OUT="${1:-/workspace/transfer/mf-delivery.tgz}"; D=$(mktemp -d); mkdir -p "$(dirname "$OUT")"
bash "$(dirname "$0")/find-outputs.sh" | while IFS=$'\t' read -r n p; do [ "$p" = "NOT FOUND" ] && { echo "NOT FOUND $n" >&2; continue; }; cp "$p" "$D/$n"; done
if [ -z "$(ls -A "$D")" ]; then echo "nothing to deliver"; rm -rf "$D"; exit 0; fi
tar -czf "$OUT" -C "$D" .; ls "$D"; echo "packed $OUT"; rm -rf "$D"
