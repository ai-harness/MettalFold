'use strict';
const fs = require('fs'), path = require('path');
const { scrub } = require('./util');
// Every step is written to logs/audit.jsonl and kept in memory so the UI can show it.
function createAudit(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'audit.jsonl');
  const mem = [];
  function log(event, o = {}) {
    const e = { ts: new Date().toISOString(), event, user: o.user || '', request_id: o.request_id || '', case_id: o.case_id || '', detail: scrub(o.detail || '') };
    mem.push(e); if (mem.length > 2000) mem.shift();
    try { fs.appendFileSync(file, JSON.stringify(e) + '\n'); } catch (_) { /* disk problems must not stop the app */ }
    if (!process.env.QUIET) console.log(`[${e.ts}] ${e.event} ${e.request_id} ${e.detail}`.trim());
    return e;
  }
  const forRequest = (id) => mem.filter((e) => e.request_id === id);
  const recent = (n = 100) => mem.slice(-n).reverse();
  return { log, forRequest, recent, file };
}
module.exports = { createAudit };
