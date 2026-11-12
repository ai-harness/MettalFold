#!/bin/bash
# Keep every copy of the Mettalfold app on identical CODE. Never touches data/, files/, logs/ or .env.
#   tools/sync-code.sh status            show this copy's version and code hash
#   tools/sync-code.sh pack [out.tgz]    bundle the code (default ~/mettalfold-code-bundle.tgz)
#   tools/sync-code.sh apply bundle.tgz  install a bundle over this copy (backs up first), then restart
set -e
APP="$(cd "$(dirname "$0")/.." && pwd)"; cd "$APP"
CODE_ITEMS="public lib server.js package.json package-lock.json VERSION tools test README.md"
hash_code() { PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" node -e "const fs=require('fs'),path=require('path'),c=require('crypto'),h=c.createHash('sha1');const walk=d=>fs.readdirSync(d,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:1).forEach(e=>{const f=path.join(d,e.name);if(e.isDirectory())walk(f);else if(!/\\.bak|\\.DS_Store/.test(e.name))h.update(fs.readFileSync(f))});walk('public');walk('lib');h.update(fs.readFileSync('server.js'));console.log(h.digest('hex').slice(0,8))"; }
case "$1" in
  status) echo "version $(cat VERSION 2>/dev/null || echo unknown)  code $(hash_code)";;
  pack) OUT="${2:-$HOME/mettalfold-code-bundle.tgz}"; COPYFILE_DISABLE=1 tar --exclude='*.bak*' --exclude='.DS_Store' -czf "$OUT" $CODE_ITEMS; echo "packed $OUT ($(cat VERSION))"; ;;
  apply) B="$2"; [ -f "$B" ] || { echo "usage: apply bundle.tgz"; exit 1; }
    BK="$APP/../mettalfold-code-backup-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$BK"; tar -czf "$BK/code-before.tgz" $CODE_ITEMS 2>/dev/null || true
    tar -xzf "$B" -C "$APP"; echo "installed: $(cat VERSION) code $(hash_code)  (previous code saved in $BK)"
    (cd "$APP" && PATH="$HOME/.local/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH" npm install --omit=dev >/dev/null 2>&1 || true)
    launchctl kickstart -k "gui/$(id -u)/com.mettalfold.backend" 2>/dev/null && echo restarted || echo "restart the app manually";;
  *) echo "usage: $0 status|pack|apply";;
esac
