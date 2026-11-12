'use strict';
// Runs ON THE BOX. Read-only file hub for desk outputs. Env: HUB_TOKEN (required), HUB_PORT (default 8791),
// HUB_ROOTS (comma separated folders, default /workspace/pipeline-activity,/workspace/supplier-product-book,/workspace/supplier-qualification).
// GET /f/<name> with "Authorization: Bearer <HUB_TOKEN>". Only office/pdf/image files; names are looked up, never paths.
// It listens on the box only; the Macs reach it only if you put it behind an HTTPS address and set FILE_HUB_URL / FILE_HUB_TOKEN in each app's .env.
const http = require('http'), fs = require('fs'), path = require('path');
const TOKEN = process.env.HUB_TOKEN || ''; if (!TOKEN) { console.error('HUB_TOKEN is required'); process.exit(1); }
const ROOTS = (process.env.HUB_ROOTS || '/workspace/pipeline-activity,/workspace/supplier-product-book,/workspace/supplier-qualification').split(',');
const OK = /^[A-Za-z0-9._ -]+\.(pdf|xlsx|csv|png|jpg|pptx|docx)$/i;
function find(name) { let best = null; const walk = (d, depth) => { if (depth > 4) return; let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; } for (const e of es) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f, depth + 1); } else if (e.name === name) { const m = fs.statSync(f).mtimeMs; if (!best || m > best.m) best = { f, m }; } } }; ROOTS.forEach((r) => walk(r, 0)); return best && best.f; }
http.createServer((req, res) => {
  const m = /^\/f\/([^/]+)$/.exec(req.url.split('?')[0]); const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (tok.length !== TOKEN.length || !require('crypto').timingSafeEqual(Buffer.from(tok), Buffer.from(TOKEN))) { res.writeHead(401); return res.end('no'); }
  if (!m) { res.writeHead(404); return res.end(); } const name = decodeURIComponent(m[1]); if (!OK.test(name)) { res.writeHead(400); return res.end(); }
  const f = find(name); if (!f) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(f).size }); fs.createReadStream(f).pipe(res);
}).listen(Number(process.env.HUB_PORT || 8791), '0.0.0.0', () => console.log('file hub up'));
