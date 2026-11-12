'use strict';
const path = require('path'), crypto = require('crypto');
const express = require('express');
const { AGENTS, CODES } = require('./lib/agents');
const { safeEqual, setSecrets, scrub, clean } = require('./lib/util');
const { createAudit } = require('./lib/audit');
const { createCore, HttpError } = require('./lib/core');
const { createSheet } = require('./lib/sheet');
const sender = require('./lib/sender');

function createApp(env = process.env, overrides = {}) {
  const password = env.APP_PASSWORD || '';
  if (password.length < 8) throw new Error('APP_PASSWORD in .env must be at least 8 characters. Open .env and set one.');
  const secret = env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'); // random per start if unset: sessions end on restart
  const users = (env.USERS || 'Rishabh,Hemant').split(',').map((s) => s.trim()).filter(Boolean);
  const keys = []; for (const [k, v] of Object.entries(env)) if (/_KEY$|SECRET$|PASSWORD$/.test(k)) keys.push(v);
  setSecrets(keys);
  const audit = overrides.audit || createAudit(env.LOG_DIR || path.join(__dirname, 'logs'));
  const sheet = overrides.sheet || createSheet(env);
  const snd = sender.create(env);
  const core = createCore({ sheet, audit, sender: snd, env: { ...env, DATA_DIR: env.DATA_DIR || path.join(__dirname, 'data') }, sheetId: env.SHEET_ID, mockDelayMs: Number(env.MOCK_DELAY_MS) || 400, inlineMock: env.MOCK_INLINE !== '0' });
  const DATA_DIR = env.DATA_DIR || path.join(__dirname, 'data'), FILES_DIR = env.FILES_DIR || path.join(__dirname, 'files');
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '400kb' }));
  app.use((req, res, next) => { res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'" }); next(); });

  // ---- sessions: signed cookie, 12 hours ----
  const sign = (p) => crypto.createHmac('sha256', secret).update(p).digest('base64url');
  const issue = (u) => { const p = Buffer.from(JSON.stringify({ u, exp: Date.now() + 12 * 3600e3 })).toString('base64url'); return p + '.' + sign(p); };
  const who = (req) => {
    const m = /(?:^|;\s*)mf_session=([^;]+)/.exec(req.headers.cookie || ''); if (!m) return null;
    const [p, s] = m[1].split('.'); if (!p || !s || !safeEqual(sign(p), s)) return null;
    try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.exp > Date.now() && users.includes(o.u) ? o.u : null; } catch (_) { return null; }
  };
  const fails = new Map();
  const cookie = (v, age) => `mf_session=${v}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}`;
  app.post('/api/login', (req, res) => {
    if (req.get('x-requested-with') !== 'mf') return res.status(403).json({ error: 'Blocked.' });
    const ip = req.ip, f = fails.get(ip) || { n: 0, until: 0 };
    if (Date.now() < f.until) return res.status(429).json({ error: 'Too many wrong tries. Please wait a minute.' });
    const u = clean(req.body && req.body.user, 60), p = String((req.body && req.body.password) || '');
    if (!users.includes(u) || !safeEqual(p, password)) {
      f.n++; if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; } fails.set(ip, f);
      audit.log('login_failed', { user: u, detail: 'Wrong name or password.' });
      return res.status(401).json({ error: 'Wrong name or password.' });
    }
    fails.delete(ip); audit.log('login', { user: u, detail: 'Signed in.' });
    res.set('Set-Cookie', cookie(issue(u), 43200)).json({ user: u });
  });
  app.post('/api/logout', (req, res) => { const u = who(req); if (u) audit.log('logout', { user: u, detail: 'Signed out.' }); res.set('Set-Cookie', cookie('', 0)).json({ ok: true }); });
  const crypto2 = require('crypto');
  const codeHash = () => { try { const h = crypto2.createHash('sha1'); const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)).forEach((e) => { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (!/\.bak|\.DS_Store/.test(e.name)) h.update(fs.readFileSync(f)); }); walk(path.join(__dirname, '..', 'UI')); walk(path.join(__dirname, 'lib')); h.update(fs.readFileSync(path.join(__dirname, 'server.js'))); return h.digest('hex').slice(0, 8); } catch (e) { return 'unknown'; } };
  const appVersion = () => { try { return fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim(); } catch (e) { return 'unknown'; } };
  app.get('/api/health', (req, res) => res.json({ ok: true, version: appVersion(), code: codeHash(), timings: core.timings }));

  const pub = path.join(__dirname, '..', 'UI');
  app.get('/api/users', (req, res) => res.json({ users }));
  app.get('/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
  app.get('/style.css', (req, res) => res.sendFile(path.join(pub, 'style.css')));
  app.get('/login.js', (req, res) => res.sendFile(path.join(pub, 'login.js')));
  app.use((req, res, next) => {
    const u = who(req);
    if (!u) return req.path.startsWith('/api/') ? res.status(401).json({ error: 'Please sign in.' }) : res.redirect('/login');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-requested-with') !== 'mf') return res.status(403).json({ error: 'Blocked.' });
    req.user = u; next();
  });
  // index.html is served with ?v=<hash of the files> so browsers always load the current JS/CSS
  app.get('/', (req, res) => { try { const f = (n) => crypto2.createHash('sha1').update(fs.readFileSync(path.join(pub, n))).digest('hex').slice(0, 10); const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8').replace(/\/app\.js(\?v=[^"]*)?"/, '/app.js?v=' + f('app.js') + '"').replace(/\/style\.css(\?v=[^"]*)?"/, '/style.css?v=' + f('style.css') + '"').replace(/\/research\.js(\?v=[^"]*)?"/, '/research.js?v=' + f('research.js') + '"'); res.set('Cache-Control', 'no-store').type('html').send(html); } catch (e) { res.sendFile(path.join(pub, 'index.html')); } });
  app.get('/app.js', (req, res) => res.sendFile(path.join(pub, 'app.js')));
  app.get('/research', (req, res) => res.sendFile(path.join(pub, 'research.html')));
  app.get('/research.js', (req, res) => res.sendFile(path.join(pub, 'research.js')));

  const wrap = (fn) => async (req, res) => { try { res.json(await fn(req, res)); } catch (e) { if (e instanceof HttpError) return res.status(e.status).json({ error: e.message, ...e.extra }); audit.log('server_error', { user: req.user, detail: e.message }); res.status(500).json({ error: 'Something went wrong on this computer. Nothing was lost; please try again.' }); } };
  // Idempotency: the same client key, or an identical submit within 60 s, returns the first answer instead of creating a second request.
  const idemMap = new Map();
  const once = (keyOf, fn) => (req, res) => {
    const b = req.body || {}, now = Date.now(); for (const [k, v] of idemMap) if (v.exp && v.exp < now) idemMap.delete(k);
    const keys = []; if (b.idem) keys.push(req.user + '|i|' + String(b.idem).slice(0, 80)); if (!b.allow_duplicate) { try { keys.push(req.user + '|c|' + require('crypto').createHash('sha1').update(JSON.stringify(keyOf(b))).digest('hex')); } catch (e) {} }
    for (const k of keys) { const hit = idemMap.get(k); if (hit) { audit.log('duplicate_dropped', { user: req.user, detail: 'A second identical submit was dropped; the first answer was returned.' }); return hit.p; } }
    const ent = { p: null, exp: 0 }; ent.p = Promise.resolve().then(() => fn(req, res)).then((r) => { ent.exp = Date.now() + 60000; return r; }, (e) => { keys.forEach((k) => idemMap.delete(k)); throw e; });
    keys.forEach((k) => idemMap.set(k, ent)); return ent.p;
  };
  const hdr = () => ({ sheet_ok: core.cache.ok, sheet_error: core.cache.error, last_updated: core.cache.lastOk, ready: core.cache.ready });

  // booklets and other files the desks produce: only from ./files, signed-in users only, no folder tricks
  // Output files are made on the desk workspace (the box), not on this Mac. Missing ones are recorded as 'wanted'
  // and, if FILE_HUB_URL (+ FILE_HUB_TOKEN) is set, fetched automatically in the background (retry with back-off).
  const wantsFile = path.join(DATA_DIR, 'file_wants.json'), fetching = new Map();
  const FILE_RE = /^[A-Za-z0-9._ -]+\.(pdf|xlsx|csv|png|jpg|pptx|docx)$/i, filesDir = FILES_DIR;
  const readWants = () => { try { return JSON.parse(fs.readFileSync(wantsFile, 'utf8')) || {}; } catch (e) { return {}; } };
  const writeWants = (w) => { try { fs.mkdirSync(path.dirname(wantsFile), { recursive: true }); fs.writeFileSync(wantsFile, JSON.stringify(w, null, 1)); } catch (e) {} };
  async function pullFromHub(n) {
    const hub = String(env.FILE_HUB_URL || '').trim().replace(/\/$/, ''), tok = String(env.FILE_HUB_TOKEN || '').trim();
    if (!hub || !/^https:\/\//.test(hub)) return false;
    const names = [n]; if (/\.xlsx$/i.test(n)) names.push(n.replace(/\.xlsx$/i, '.csv'));
    let got = false;
    for (const nm of names) {
      const dest = path.join(filesDir, nm); if (fs.existsSync(dest)) { got = got || nm === n; continue; }
      try { const ac = new AbortController(), t = setTimeout(() => ac.abort(), 60000); const r = await fetch(hub + '/f/' + encodeURIComponent(nm), { headers: tok ? { Authorization: 'Bearer ' + tok } : {}, signal: ac.signal, redirect: 'error' }); clearTimeout(t);
        if (!r.ok) continue; const buf = Buffer.from(await r.arrayBuffer()); if (!buf.length) continue; const tmp = dest + '.part'; fs.mkdirSync(filesDir, { recursive: true }); fs.writeFileSync(tmp, buf); fs.renameSync(tmp, dest); got = got || nm === n; audit.log('file_fetched', { detail: 'Fetched ' + nm + ' from the file hub (' + buf.length + ' bytes).' }); } catch (e) { /* retried later */ }
    }
    return got;
  }
  function noteWant(n) {
    if (!FILE_RE.test(n) || fs.existsSync(path.join(filesDir, n))) return 'ready';
    const w = readWants(), now = Date.now(); const e = w[n] = w[n] || { first_seen: new Date().toISOString(), tries: 0, last_try: 0 };
    const hubOn = !!String(env.FILE_HUB_URL || '').trim();
    if (hubOn && !fetching.has(n) && now - e.last_try > Math.min(300000, 10000 * Math.pow(2, Math.min(e.tries, 5)))) {
      e.tries++; e.last_try = now; writeWants(w); fetching.set(n, true);
      pullFromHub(n).finally(() => { fetching.delete(n); const w2 = readWants(); if (fs.existsSync(path.join(filesDir, n))) { delete w2[n]; writeWants(w2); } });
    } else if (!w[n].noted) { w[n].noted = true; writeWants(w); audit.log('file_wanted', { detail: n + ' is not on this Mac yet.' }); }
    return fetching.has(n) ? 'fetching' : (hubOn ? 'fetching' : 'waiting');
  }
  // v35: each request lists every file it names, with ready=true once the file is in files/ (the page swaps it in by itself)
  // v37: when a newer _V<n> of a named file is in files/, show the latest; older versions are hidden from the app but stay on disk
  const latestVer = (name) => { const m = String(name).match(/^(.*_V)(\d+)(\.[A-Za-z0-9]+)$/); if (!m) return name; let best = +m[2], bn = name; try { for (const f of fs.readdirSync(filesDir)) { if (f.startsWith(m[1]) && f.endsWith(m[3])) { const v = f.slice(m[1].length, f.length - m[3].length); if (/^\d+$/.test(v) && +v > best) { best = +v; bn = f; } } } } catch (e) {} return bn; };
  const bumpVersions = (r) => { let link = r.output_link || ''; const files = (r.files || []).slice(); if (/^\/files\//.test(link)) { const n = path.basename(decodeURIComponent(link.slice(7))), ln = latestVer(n); if (ln !== n) link = '/files/' + encodeURIComponent(ln); }
    const seen = new Set(), files2 = []; for (const f of files) { const ln = latestVer(f.name); if (seen.has(ln)) continue; seen.add(ln); files2.push(ln === f.name ? f : { ...f, name: ln, url: '/files/' + encodeURIComponent(ln) }); }
    return { ...r, output_link: link, files: files2 }; };
  let withFiles = (r0) => { const r = bumpVersions(r0); const fl = (r.files || []).map((f) => { let st = null; try { st = fs.statSync(path.join(filesDir, f.name)); } catch (e) {} if (!st) { try { noteWant(f.name); } catch (e) {} } return { ...f, ready: !!st, size: st ? st.size : 0 }; }); const main = /^\/files\//.test(r.output_link || '') ? fl.find((f) => f.url === r.output_link) : null; return { ...r, files: fl, file_ready: main ? main.ready : /^\/files\//.test(r.output_link || '') ? fs.existsSync(path.join(filesDir, path.basename(decodeURIComponent(r.output_link.slice(7))))) : true }; };
  // v39: hard rule, #1 Opportunity Finder outputs must give website, headcount, LinkedIn and industry for every account; gaps are flagged in plain words
  const details = require('./lib/details'); const withFiles0 = withFiles;
  withFiles = (r0) => { const o = withFiles0(r0); let dc = null; try { dc = details.forRequest(o, filesDir); } catch (e) {} return dc ? { ...o, details_check: dc } : o; };
  app.get('/api/file-wants', (req, res) => { if (!who(req)) return res.status(401).json({ error: 'Please sign in.' }); const w = readWants(); const out = Object.keys(w).filter((n) => !fs.existsSync(path.join(filesDir, n))).map((n) => ({ name: n, first_seen: w[n].first_seen, tries: w[n].tries })); res.json({ hub: !!String(env.FILE_HUB_URL || '').trim(), missing: out }); });
  app.get('/files/:name', (req, res) => {
    if (!who(req)) return res.status(401).send('Please sign in.');
    const n = path.basename(String(req.params.name || ''));
    if (!FILE_RE.test(n)) return res.status(400).send('Not allowed.');
    const f = path.join(FILES_DIR, n);
    if (!require('fs').existsSync(f)) { const st = noteWant(n); res.set('X-File-State', st); try { const we = readWants()[n]; if (we && we.first_seen) res.set('X-File-Wait', String(Math.max(0, Math.round((Date.now() - Date.parse(we.first_seen)) / 1000)))); } catch (e) {} return res.status(404).send('File not found.'); }
    res.set({ 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'" });
    res.set('Content-Disposition', 'inline; filename="' + n + '"');
    res.sendFile(f);
  });

  const fs = require('fs'), { execFile } = require('child_process');
  // spreadsheet viewer: parsed rows from the sibling .csv (or the .xlsx via python openpyxl)
  function parseCsv(t) { const rows = []; let row = [], f = '', q = false; t = t.replace(/^\uFEFF/, ''); for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; } else f += c; } if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows.filter((r) => r.some((x) => x !== '')); }
  // #2 Advisory GTM files by naming convention: 02_AdvisoryGTM_<stem>_(LightPass|GTMMatching|RelationshipMap)_V<n>.(csv|xlsx)
  function gtmFilesFor(r) {
    const dir = FILES_DIR; let names = []; try { names = fs.readdirSync(dir); } catch (e) {}
    const RE = /^02_AdvisoryGTM_(.+)_(LightPass|GTMMatching|RelationshipMap)_V(\d+)\.(csv|xlsx)$/i, by = {};
    for (const n of names) { const m = n.match(RE); if (!m) continue; const st = by[m[1]] = by[m[1]] || { stem: m[1], kinds: {}, mt: 0 }; const k = m[2], v = +m[3]; const mt = fs.statSync(path.join(dir, n)).mtimeMs; st.mt = Math.max(st.mt, mt); if (!st.kinds[k] || st.kinds[k].v < v) st.kinds[k] = { v, base: n.replace(/\.(csv|xlsx)$/i, '') }; }
    const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    const hay = norm([r.output_link, r.summary, JSON.stringify(r.inputs || {}), JSON.stringify((r.behind && r.behind.items) || [])].join(' '));
    const list = Object.values(by); if (!list.length) return { stem: '', files: {} };
    const score = (st) => (hay.includes(norm(st.stem)) ? 1000 : 0) + norm(st.stem).split(' ').filter((t) => t.length > 2 && hay.includes(t)).length;
    list.sort((a, b) => score(b) - score(a) || b.mt - a.mt);
    const best = list[0], files = {}; for (const [k, v] of Object.entries(best.kinds)) files[k] = v.base;
    return { stem: best.stem, files };
  }
  app.get('/api/gtm-files/:rid', (req, res) => {
    if (!who(req)) return res.status(401).json({ error: 'Please sign in.' });
    const rid = String(req.params.rid || ''); const r = core.views().items.find((x) => x.request_id === rid);
    if (!r) return res.status(404).json({ error: 'Not found.' });
    res.json(gtmFilesFor(r));
  });
  app.get('/api/table/:name', (req, res) => {
    if (!who(req)) return res.status(401).json({ error: 'Please sign in.' });
    const base = path.basename(String(req.params.name || '')).replace(/\.(csv|xlsx)$/i, '');
    if (!/^[A-Za-z0-9._ -]+$/.test(base) || base.includes('..')) return res.status(400).json({ error: 'Not allowed.' });
    const dir = FILES_DIR, csv = path.join(dir, base + '.csv'), xl = path.join(dir, base + '.xlsx');
    const done = (rows, src) => res.json({ name: base, source: src, rows, csv: fs.existsSync(csv) ? '/files/' + encodeURIComponent(base + '.csv') : '', xlsx: fs.existsSync(xl) ? '/files/' + encodeURIComponent(base + '.xlsx') : '' });
    if (fs.existsSync(csv)) { try { return done(parseCsv(fs.readFileSync(csv, 'utf8')), 'csv'); } catch (e) { return res.status(500).json({ error: 'Could not read that table.' }); } }
    if (!fs.existsSync(xl)) return res.status(404).json({ error: 'File not found.' });
    // v35: read the Excel file in Node (the Macs have no openpyxl); python stays only as a fallback
    try { const X = require('./lib/xlsx'), sh = X.readWorkbook(fs.readFileSync(xl)), mi = X.mainSheet(sh); return res.json({ name: base, source: 'xlsx', rows: sh[mi].rows, sheet: sh[mi].name, sheets: sh.slice(0, 20).map((x) => ({ name: x.name, rows: x.rows.slice(0, 2000) })), main: mi, csv: fs.existsSync(csv) ? '/files/' + encodeURIComponent(base + '.csv') : '', xlsx: '/files/' + encodeURIComponent(base + '.xlsx') }); } catch (e) { /* fall back to python below */ }
    const py = 'import sys,json,openpyxl\nwb=openpyxl.load_workbook(sys.argv[1],read_only=True,data_only=True)\nws=wb.worksheets[0]\nprint(json.dumps([["" if c is None else str(c) for c in r] for r in ws.iter_rows(values_only=True)]))';
    execFile('python3', ['-c', py, xl], { maxBuffer: 20 * 1024 * 1024 }, (err, out) => { if (err) return res.status(500).json({ error: 'I could not read this Excel file here. Use Download Excel to open it.' }); try { done(JSON.parse(out).filter((r) => r.some((x) => x !== '')), 'xlsx'); } catch (e) { res.status(500).json({ error: 'Could not read that table.' }); } });
  });
  const refsDir = path.join(FILES_DIR, 'refs'); fs.mkdirSync(refsDir, { recursive: true });
  const REF_RE = /\.(pdf|png|jpe?g|gif|webp)$/i, MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
  app.get('/files/refs/:name', (req, res) => {
    const n = path.basename(String(req.params.name || '')), f = path.join(refsDir, n);
    if (!/^[A-Za-z0-9._ -]+$/.test(n) || !REF_RE.test(n)) return res.status(400).send('Not allowed.');
    if (!fs.existsSync(f)) return res.status(404).send('File not found.');
    res.set({ 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "default-src 'none'; img-src 'self'; frame-ancestors 'self'" });
    res.set('Content-Disposition', 'inline; filename="' + n + '"'); res.sendFile(f);
  });
  app.post('/api/upload', express.raw({ type: '*/*', limit: '15mb' }), wrap((req) => {
    const orig = clean(String(req.query.name || 'file'), 120); const ext = (orig.match(/\.([A-Za-z0-9]+)$/) || [])[1];
    if (!ext || !REF_RE.test('.' + ext)) throw new HttpError(400, 'Please attach a PDF or an image (png, jpg, gif, webp).');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new HttpError(400, 'That file looks empty.');
    const base = orig.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'file';
    const name = Date.now().toString(36) + '_' + base + '.' + ext.toLowerCase(); fs.writeFileSync(path.join(refsDir, name), req.body);
    audit.log('reference_attached', { user: req.user, detail: req.user + ' attached ' + orig + ' (' + Math.round(req.body.length / 1024) + ' KB).' });
    return { name: orig, file: name, url: '/files/refs/' + name, size: req.body.length, type: MIME[ext.toLowerCase()] };
  }));
  const extract = (file) => new Promise((ok) => {
    const bins = ['pdftotext', '/opt/homebrew/bin/pdftotext', '/usr/local/bin/pdftotext']; const tryOne = (i) => {
      if (i >= bins.length) return ok(''); execFile(bins[i], ['-l', '10', '-layout', file, '-'], { timeout: 15000, maxBuffer: 4e6 }, (e, out) => e ? tryOne(i + 1) : ok(String(out || '').replace(/\s+\n/g, '\n').trim().slice(0, 4000)));
    }; tryOne(0);
  });
  const prepAttachments = async (list) => {
    const out = [];
    for (const a of (Array.isArray(list) ? list.slice(0, 8) : [])) {
      const f = path.basename(String((a && a.file) || '')); const p = path.join(refsDir, f);
      if (!/^[A-Za-z0-9._-]+$/.test(f) || !REF_RE.test(f) || !fs.existsSync(p)) continue;
      const st = fs.statSync(p), isPdf = /\.pdf$/i.test(f);
      const item = { name: clean(a.name, 120) || f, url: '/files/refs/' + f, size: st.size, type: MIME[f.split('.').pop().toLowerCase()] };
      if (isPdf) { const t = await extract(p); if (t) item.text_extract = t; }
      out.push(item);
    }
    return out;
  };
  app.get('/api/conversation/:id', wrap((req) => {
    const rows = core.cache.requests || [], raw = (r) => { try { return JSON.parse(r.inputs_json || '{}'); } catch (_) { return {}; } };
    const byId = Object.fromEntries(rows.map((r) => [r.request_id, r])); let root = byId[req.params.id];
    if (!root) throw new HttpError(404, 'I cannot find that request.');
    for (let i = 0; i < 50 && raw(root)._revision_of && byId[raw(root)._revision_of]; i++) root = byId[raw(root)._revision_of];
    const chain = [root]; for (let i = 0; i < 50; i++) { const last = chain[chain.length - 1]; const nx = rows.find((r) => raw(r)._revision_of === last.request_id); if (!nx) break; chain.push(nx); }
    const msgs = [];
    chain.forEach((r) => {
      const inp = raw(r), v = core.find(r.request_id) || {};
      if (inp._revision_of) msgs.push({ from: 'you', who: r.submitted_by, at: r.submitted_at, text: inp._feedback || '', attachments: inp._attachments || [], request_id: r.request_id });
      const working = v.status === 'queued' || v.status === 'running';
      msgs.push({ from: 'desk', at: v.updated_at || r.submitted_at, request_id: r.request_id, label: v.agent_label, working, text: working ? 'Working on it…' : [v.outcome && ('Outcome: ' + v.outcome), v.summary, v.next_step && ('Next: ' + v.next_step)].filter(Boolean).join('\n').slice(0, 1200), link: v.output_link || '' });
    });
    return { root: root.request_id, latest: chain[chain.length - 1].request_id, messages: msgs };
  }));
  app.get('/api/me', wrap((req) => ({ user: req.user, users, mode: { webhook: snd.mode, sheet: sheet.mode }, desks_connected: snd.status(), agents: Object.fromEntries(CODES.map((c) => [c, { label: AGENTS[c].label, order: AGENTS[c].order, fields: AGENTS[c].fields, outcomes: AGENTS[c].outcomes, gate: AGENTS[c].gateText, parent: AGENTS[c].parent && AGENTS[c].parent.agent, next: AGENTS[c].next, batch: !!AGENTS[c].batch }])), delay_hint_seconds: Number(env.DELAY_HINT_SECONDS) || 300 })));
  // App-side merge of duplicate requests (stored in data/merged.json, never in the sheet)
  const archFile = path.join(DATA_DIR, 'archived.json');
  const readArchived = () => { try { return JSON.parse(fs.readFileSync(archFile, 'utf8')) || {}; } catch (e) { return {}; } };
  const isArchived = (r, AR) => !!AR && ((AR.cases || []).includes(r.case_id) || (AR.requests || []).includes(r.request_id) || (AR.hidden_children || []).includes(r.request_id));
  const mergedFile = path.join(DATA_DIR, 'merged.json');
  const readMerged = () => { try { return JSON.parse(fs.readFileSync(mergedFile, 'utf8')); } catch (e) { return null; } };
  const acctLines = (x) => String((x && x.inputs && x.inputs.account) || '').split(/[\n;]+/).map((a) => a.trim()).filter(Boolean);
  app.get('/api/cases', wrap(() => {
    const v = core.views(), M = readMerged() || {}, hidden = new Set(Object.values(M).flat()), AR = readArchived();
    const items = v.items.filter((r) => !hidden.has(r.request_id) && !isArchived(r, AR)).map((r) => withFiles(M[r.request_id] ? { ...r, merged_children: M[r.request_id] } : r));
    return { ...hdr(), requests: items, orphans: v.orphans };
  }));
  const relFile = path.join(DATA_DIR, 'relationship_overrides.json');
  const readRel = () => { try { return JSON.parse(fs.readFileSync(relFile, 'utf8')) || {}; } catch (e) { return {}; } };
  const REL_OK = ['Existing contact', 'Warm lead', 'New', 'Unknown', ''];
  app.post('/api/rel-override', wrap((req) => {
    const b = req.body || {}, key = clean(String(b.key || ''), 300).toLowerCase(), val = String(b.value == null ? '' : b.value);
    if (!key || !REL_OK.includes(val)) throw new HttpError(400, 'Not a valid relationship value.');
    const o = readRel(); if (val) o[key] = val; else delete o[key];
    fs.mkdirSync(path.dirname(relFile), { recursive: true }); fs.writeFileSync(relFile, JSON.stringify(o, null, 1));
    audit.log('relationship_set', { user: req.user, detail: 'Relationship for ' + key + ' set to ' + (val || 'default') + ' (app-side only).' });
    return { ok: true };
  }));
  app.get('/api/merged/:rid', (req, res) => {
    if (!who(req)) return res.status(401).json({ error: 'Please sign in.' });
    const M = readMerged() || {}, rid = String(req.params.rid || ''), all0 = core.views().items, me0 = all0.find((x) => x.request_id === rid);
    // works for every #3 request (merged or not), so the Deal Desk picker always has the contacts
    if (!me0 || (!M[rid] && me0.agent_code !== 'intro_desk')) return res.status(404).json({ error: 'Not an Introduction Desk request.' });
    const kids = M[rid] || [];
    const all = all0, ids = [rid, ...kids], reqs = ids.map((i) => all.find((x) => x.request_id === i)).filter(Boolean);
    const accounts = []; for (const r of reqs) for (const a of acctLines(r)) if (!accounts.includes(a)) accounts.push(a);
    const stat = {}; for (const r of reqs) for (const a of acctLines(r)) stat[a] = r.status;
    const dir = FILES_DIR, seen = new Set(); let header = null, rows = [], csv = '', xlsx = '';
    const pr = reqs[0], parentBusy = pr && (pr.status === 'queued' || pr.status === 'running');
    for (const r of reqs) { if (r !== pr && (parentBusy || rows.length)) continue; for (const l of String(r.output_link || '').split(/[\s,;]+/).filter(Boolean)) {
      const m = l.match(/^\/files\/([A-Za-z0-9._ %-]+)\.(csv|xlsx)$/i); if (!m) continue; const base = path.basename(decodeURIComponent(m[1])); if (seen.has(base)) continue; seen.add(base);
      const f = path.join(dir, base + '.csv'); if (!fs.existsSync(f)) continue;
      try { const t = parseCsv(fs.readFileSync(f, 'utf8')); const hi = t.findIndex((x) => x.filter((c) => String(c).trim()).length >= 4); if (hi < 0) continue; if (!header) header = t[hi]; for (const x of t.slice(hi + 1)) if (x.some((c) => String(c).trim())) rows.push(x); if (!csv) { csv = '/files/' + encodeURIComponent(base + '.csv'); if (fs.existsSync(path.join(dir, base + '.xlsx'))) xlsx = '/files/' + encodeURIComponent(base + '.xlsx'); } } catch (e) {}
    } }
    const uniq = new Set(); rows = rows.filter((x) => { const k = x.join('\u0001'); if (uniq.has(k)) return false; uniq.add(k); return true; });
    const ai = header ? header.findIndex((h) => String(h).trim().toLowerCase() === 'account') : -1;
    if (ai >= 0) for (const x of rows) { const a = String(x[ai]).trim(); if (a && !accounts.includes(a)) accounts.push(a); }
    const enrich = {}; try { const g2 = all.find((x) => x.request_id === (reqs[0] && reqs[0].parent_request_id)) || all.filter((x) => x.agent_code === 'advisory_gtm' && pr && x.case_id === pr.case_id).pop();
      const best = {}; if (g2) { const gf = gtmFilesFor(g2).files; for (const [k, base] of Object.entries(gf)) if (fs.existsSync(path.join(dir, base + '.csv'))) best[k] = { n: base + '.csv' }; }
      const tbl = (n) => { const t = parseCsv(fs.readFileSync(path.join(dir, n), 'utf8')); const hi = t.findIndex((x) => x.filter((c) => String(c).trim()).length >= 4); if (hi < 0) return []; const h = t[hi].map((c) => String(c).trim().toLowerCase()); const out = []; for (const x of t.slice(hi + 1)) { if (!x.some((c) => String(c).trim())) break; const o = {}; h.forEach((k2, i) => { o[k2] = x[i] || ''; }); out.push(o); } return out; };
      const put = (a, o) => { const k = String(a || '').trim().toLowerCase(); if (k) enrich[k] = Object.assign(enrich[k] || {}, o); };
      if (best.LightPass) for (const x of tbl(best.LightPass.n)) put(x.company, { country: x.country, segment: x.segment, decision: x.client_status, reason: x.one_line_brief });
      if (best.GTMMatching) for (const x of tbl(best.GTMMatching.n)) put(x.account, { pitched: x.product_pitched, caveat: x.open_gaps, fit_note: x.fit_note, keep: x.keep_or_drop });
      if (best.RelationshipMap) for (const x of tbl(best.RelationshipMap.n)) put(x.company, { country: x.country, worked: x.worked_with_us_before, warm: x.hypothetical_warm_signals, roles: x.decision_makers_by_role, verification: x.verification_status });
    } catch (e) {}
    res.json({ rel: readRel(), enrich, parent: rid, children: kids, header: header || [], rows, accounts: accounts.map((a) => ({ account: a, status: stat[a] || '', n: ai >= 0 ? rows.filter((x) => String(x[ai]).trim() === a).length : 0 })), csv, xlsx });
  });
  app.get('/api/cases/:id', wrap((req) => { const items = core.views().items.filter((r) => r.case_id === req.params.id); if (!items.length) throw new HttpError(404, 'I cannot find that case.'); return { ...hdr(), case_id: req.params.id, requests: items }; }));
  app.get('/api/status/:id', wrap((req) => { const r = core.find(req.params.id); if (!r) throw new HttpError(404, 'I cannot find that request.'); return { ...hdr(), ...withFiles(r) }; }));
  app.get('/api/activity', wrap((req) => { const AR = readArchived(), arC = new Set(AR.cases || []), arR = new Set([...(AR.requests || []), ...(AR.hidden_children || [])]); const cutoff = AR.archived_at || ''; return { events: audit.recent((Number(req.query.n) || 100) + 400).filter((e) => !(e.request_id && arR.has(e.request_id)) && !(e.case_id && arC.has(e.case_id)) && !(cutoff && e.ts && e.ts <= cutoff && !e.request_id && /login|logout/.test(e.event) === false && false)).slice(0, Number(req.query.n) || 100) }; }));
  app.get('/api/activity/:id', wrap((req) => ({ events: audit.forRequest(req.params.id) })));
  app.post('/api/submit', wrap(once((b) => [b.agent_code, b.case_id, b.parent_request_id, b.inputs, b.case_label], (req) => { const b = req.body || {}; return core.submitOne({ user: req.user, agent_code: b.agent_code, case_id: b.case_id, parent_request_id: b.parent_request_id, inputs: Object.assign({}, b.inputs, { case_label: b.case_label || (b.inputs || {}).case_label }), allow_duplicate: !!b.allow_duplicate }); })));
  app.post('/api/submit-batch', wrap(once((b) => [b.agent_code, b.case_id, b.parent_request_id, b.items, b.case_label], (req) => { const b = req.body || {}; return core.submitBatch({ user: req.user, agent_code: b.agent_code, case_id: b.case_id, parent_request_id: b.parent_request_id, items: (b.items || []).map((i) => Object.assign({}, i, { case_label: b.case_label })), allow_duplicate: !!b.allow_duplicate }); })));
  app.post('/api/approve', wrap((req) => core.decide({ user: req.user, request_id: (req.body || {}).request_id, decision: (req.body || {}).decision, override: (req.body || {}).override === true })));
  app.post('/api/revise', wrap(once((b) => [b.request_id, b.feedback], async (req) => core.revise({ user: req.user, request_id: (req.body || {}).request_id, feedback: (req.body || {}).feedback, attachments: await prepAttachments((req.body || {}).attachments) }))));
  app.post('/api/client-error', wrap((req) => { const b = req.body || {}; audit.log(b.where === 'timing' ? 'timing' : 'client_error', { user: req.user, request_id: clean(String(b.request_id || ''), 40), detail: b.where === 'timing' ? clean(String(b.message || ''), 300) : clean(String(b.where || ''), 80) + ': ' + clean(String(b.message || ''), 300) }); return { ok: true }; }));
  app.post('/api/retry', wrap(once((b) => [b.request_id], (req) => core.retry({ user: req.user, request_id: (req.body || {}).request_id }))));
  // v38: Contact research / Company enrichment (internal). View + edit filters, run/skip choice, free plan.
  // Approving and running (the only steps that spend credits) are done with tools/research.js after a human approval.
  const research = overrides.research || require('./lib/research').createResearch({ dataDir: DATA_DIR, filesDir: FILES_DIR, audit, env, items: () => core.views().items, provider: overrides.crProvider ? () => overrides.crProvider : undefined });
  // v40: contact research unlocks at #3 Introduction Desk after #2 Advisory GTM is approved; credit amounts never reach the browser
  const crlock = require('./lib/crlock'); const crItems = overrides.crItems || (() => core.views().items); const crState = (c) => crlock.state(crItems(), String(c || ''));
  const crLocked = (req, res, next) => { const L = crState(req.params.case); if (L.unlocked) return next(); res.status(403).json({ error: crlock.MESSAGE + '. ' + L.why, locked: true, case_id: L.case_id, step: L.step_label }); };
  const rwrap = (fn) => { const h = rwrap0(fn); return (req, res) => { const j = res.json.bind(res); res.json = (b) => j(crlock.hideCredits(b)); return h(req, res); }; };
  const rwrap0 = (fn) => async (req, res) => { try { res.json(research.neutral(await fn(req))); } catch (e) { if (e && e.status) return res.status(e.status).json(research.neutral({ error: e.message, fields: e.fields })); audit.log('server_error', { user: req.user, detail: research.neutral(scrub(String(e && e.message))) }); res.status(500).json({ error: 'Something went wrong on this computer. Nothing was lost; please try again.' }); } };
  app.get('/api/research', rwrap(() => { const cases = research.cases(); return { cases, locked: Object.fromEntries(cases.map((c) => [c, crState(c).locked])) }; }));
  app.get('/api/research/:case', (req, res, next) => { const L = crState(req.params.case); if (L.unlocked || !/^CASE-\d{1,6}$/.test(req.params.case)) return next(); res.json({ case_id: L.case_id, locked: true, unlocked: false, message: crlock.MESSAGE, why: L.why, step: L.step_label }); },
    rwrap(async (req) => ({ ...(await research.summary(req.params.case)), locked: false, unlocked: true })));
  app.post('/api/research/:case/filters', crLocked, rwrap((req) => research.saveFilters(req.params.case, (req.body || {}).filters || {}, req.user)));
  app.post('/api/research/:case/enrichment', crLocked, rwrap((req) => research.setEnrichment(req.params.case, String((req.body || {}).mode || ''), req.user)));
  app.post('/api/research/:case/plan', crLocked, rwrap((req) => research.run(req.params.case, { step: String((req.body || {}).step || 'contacts'), dryRun: true, user: req.user })));
  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  return { app, core, audit, sheet, sender: snd, users, research };
}

module.exports = { createApp };
if (require.main === module) {
  require('dotenv').config();
  let ctx; try { ctx = createApp(process.env); } catch (e) { console.error('\nCannot start: ' + e.message + '\n'); process.exit(1); }
  const port = Number(process.env.PORT) || 3000, host = process.env.HOST || '127.0.0.1';
  ctx.sheet.ping().then(() => ctx.audit.log('startup', { detail: `Sheet ok (${ctx.sheet.mode}). Webhook mode: ${ctx.sender.mode}.` })).catch((e) => ctx.audit.log('sheet_error', { detail: scrub(e.message) }));
  ctx.core.start();
  ctx.app.listen(port, host, () => console.log(`\nMettalfold backend running: http://${host === '127.0.0.1' ? 'localhost' : host}:${port}  (webhook mode: ${ctx.sender.mode}, sheet mode: ${ctx.sheet.mode})\n`));
}
