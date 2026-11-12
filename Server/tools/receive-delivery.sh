#!/bin/bash
# Runs ON A MAC. Unpacks files/mf-delivery.tgz (made by tools/box/make-delivery.sh) into files/, only allowed file types, no folders.
APP="$(cd "$(dirname "$0")/.." && pwd)"; cd "$APP/files" || exit 1; A="${1:-mf-delivery.tgz}"; [ -f "$A" ] || { [ -f "$HOME/$A" ] && mv "$HOME/$A" .; }; [ -f "$A" ] || { echo "no archive"; exit 1; }
T=$(mktemp -d); tar -xzf "$A" -C "$T" && for f in "$T"/*; do b=$(basename "$f"); [[ "$b" =~ ^[A-Za-z0-9._\ -]+\.(pdf|xlsx|csv|png|jpg|pptx|docx)$ ]] && mv -f "$f" "./$b" && echo "delivered $b"; done; rm -rf "$T" "$A"
