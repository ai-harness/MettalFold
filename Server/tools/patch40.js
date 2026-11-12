'use strict';
// v40 patch: Contact research is locked until the case reaches #3 Introduction Desk with #2 Advisory GTM approved.
// Run from the app folder: node tools/patch40.js   (back up first as .bak40)
const fs = require('fs'), path = require('path');
const root = process.argv[2] || path.join(__dirname, '..');
const F = (p) => path.join(root, p);
function edit(file, pairs) {
  let s = fs.readFileSync(F(file), 'utf8');
  for (const [a, b, tag] of pairs) {
    if (tag && s.includes(tag)) continue;
    const n = s.split(a).length - 1; if (n !== 1) throw new Error(file + ': anchor found ' + n + ' times: ' + a.slice(0, 80));
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(F(file), s); console.log('patched', file);
}

// ---------- server.js ----------
edit('server.js', [
  ["  const rwrap = (fn) => async (req, res) => {",
   "  // v40: contact research unlocks at #3 Introduction Desk after #2 Advisory GTM is approved; credit amounts never reach the browser\n" +
   "  const crlock = require('./lib/crlock'); const crItems = overrides.crItems || (() => core.views().items); const crState = (c) => crlock.state(crItems(), String(c || ''));\n" +
   "  const crLocked = (req, res, next) => { const L = crState(req.params.case); if (L.unlocked) return next(); res.status(403).json({ error: crlock.MESSAGE + '. ' + L.why, locked: true, case_id: L.case_id, step: L.step_label }); };\n" +
   "  const rwrap = (fn) => { const h = rwrap0(fn); return (req, res) => { const j = res.json.bind(res); res.json = (b) => j(crlock.hideCredits(b)); return h(req, res); }; };\n" +
   "  const rwrap0 = (fn) => async (req, res) => {", 'lib/crlock'],
  ["  app.get('/api/research', rwrap(() => ({ cases: research.cases() })));",
   "  app.get('/api/research', rwrap(() => { const cases = research.cases(); return { cases, locked: Object.fromEntries(cases.map((c) => [c, crState(c).locked])) }; }));"],
  ["  app.get('/api/research/:case', rwrap((req) => research.summary(req.params.case)));",
   "  app.get('/api/research/:case', (req, res, next) => { const L = crState(req.params.case); if (L.unlocked || !/^CASE-\\d{1,6}$/.test(req.params.case)) return next(); res.json({ case_id: L.case_id, locked: true, unlocked: false, message: crlock.MESSAGE, why: L.why, step: L.step_label }); },\n" +
   "    rwrap(async (req) => ({ ...(await research.summary(req.params.case)), locked: false, unlocked: true })));"],
  ["  app.post('/api/research/:case/filters', rwrap(", "  app.post('/api/research/:case/filters', crLocked, rwrap("],
  ["  app.post('/api/research/:case/enrichment', rwrap(", "  app.post('/api/research/:case/enrichment', crLocked, rwrap("],
  ["  app.post('/api/research/:case/plan', rwrap(", "  app.post('/api/research/:case/plan', crLocked, rwrap("],
]);
// rwrap is used before rwrap0 is defined only inside a closure called later, so order is fine; but keep it tidy: move definition order check
{ const s = fs.readFileSync(F('server.js'), 'utf8'); if (!/const rwrap0 = /.test(s)) throw new Error('rwrap0 missing'); }

// ---------- public/app.js ----------
edit('public/app.js', [
  ["function curCase() {",
   "// v40: contact research opens only at #3 Introduction Desk, after #2 Advisory GTM is approved (same rule as the server)\n" +
   "const CR_LOCK = 'Unlock in Introduction Desk first';\n" +
   "function crOpen(caseId) {\n" +
   "  if (!caseId || caseId === NEWC) return false; const rs = data.requests.filter((r) => r.case_id === caseId);\n" +
   "  if (!rs.some((r) => r.agent_code === 'advisory_gtm' && r.approved)) return false;\n" +
   "  const cur = ORDER.map((c) => stageState(c, caseId)).findIndex((x) => x !== 'done');\n" +
   "  return rs.some((r) => r.agent_code === 'intro_desk') || cur < 0 || cur >= ORDER.indexOf('intro_desk');\n" +
   "}\n" +
   "function crLink(cc) {\n" +
   "  if (crOpen(cc)) return el('a', { class: 'btn sec', id: 'crlink', href: '/research#' + encodeURIComponent(cc), target: '_blank', rel: 'noopener', style: 'text-decoration:none;padding:6px 12px;background:#e3e8ee;color:#1c2733', title: 'Find contacts in the shortlisted accounts for this case' }, 'Contact research');\n" +
   "  return el('span', { class: 'crwrap' }, el('span', { class: 'btn sec crlocked', id: 'crlink', role: 'link', 'aria-disabled': 'true', tabindex: '0', 'aria-describedby': 'crtip' }, 'Contact research'), el('span', { class: 'crtip', id: 'crtip', role: 'tooltip' }, CR_LOCK));\n" +
   "}\n" +
   "function curCase() {", 'const CR_LOCK'],
  ["function stepper(caseId, allDone) {",
   "function stepper(caseId, allDone) {\n" +
   "  const s = stepper0(caseId, allDone); if (!crOpen(caseId)) return s;\n" +
   "  const i = ORDER.indexOf('intro_desk'), pill = el('a', { class: 'st crstep', href: '/research#' + encodeURIComponent(caseId), target: '_blank', rel: 'noopener', title: 'Now is the time to find contacts in the shortlisted accounts' }, el('span', { class: 'dot' }, '↗'), el('span', { class: 'lbl' }, 'Contact research'));\n" +
   "  s.insertBefore(pill, s.children[i + 1] || null); return s;\n" +
   "}\n" +
   "function stepper0(caseId, allDone) {", 'function stepper0('],
  ["].join('|'); if (bar.dataset.key === key) return; bar.dataset.key = key;", "].join('|') + '|cr' + crOpen(cc); if (bar.dataset.key === key) return; bar.dataset.key = key;"],
  ["cc ? el('a', { class: 'btn sec', id: 'crlink', href: '/research#' + encodeURIComponent(cc), target: '_blank', style: 'text-decoration:none;padding:6px 12px;background:#e3e8ee;color:#1c2733', title: 'Check and edit contact research filters for this case' }, 'Contact research') : null,",
   "cc ? crLink(cc) : null,"],
  ["...j.accounts.map((a) => el('option', { value: a.account }, a.account + (a.n ? ' · ' + a.n : ' · in progress'))));",
   "...j.accounts.map((a) => el('option', { value: a.account }, a.account + (a.n ? ' · ' + a.n : ' · in progress'))), crOpen(r.case_id) ? el('option', { value: '__cr' }, '↗ Contact research for these accounts') : null);"],
  ["    sel.onchange = draw; draw();",
   "    sel.onchange = () => { if (sel.value === '__cr') { window.open('/research#' + encodeURIComponent(r.case_id), '_blank', 'noopener'); sel.value = M.filter || ''; return; } draw(); }; draw();"],
]);

// ---------- public/style.css ----------
{ const p = F('public/style.css'); let s = fs.readFileSync(p, 'utf8'); if (!s.includes('.crwrap')) { s += "\n/* v40: locked Contact research link with a small note under it */\n.crwrap{position:relative;display:inline-block}.crlocked{padding:6px 12px;background:#eef1f4!important;color:#9aa5b1!important;cursor:not-allowed;user-select:none;border-radius:6px}\n.crtip{display:none;position:absolute;top:calc(100% + 4px);left:0;background:#1c2733;color:#fff;font-size:12px;line-height:1.3;padding:4px 8px;border-radius:4px;white-space:nowrap;z-index:30;pointer-events:none}\n.crwrap:hover .crtip,.crwrap:focus-within .crtip{display:block}\n.stepper .st.crstep{text-decoration:none;border-style:dashed}\n"; fs.writeFileSync(p, s); console.log('patched public/style.css'); } }

// ---------- research tests: the fixture case is at #3, and credit amounts are no longer sent ----------
edit('test/research-tests.js', [
  ["createApp(env, { research: R })", "createApp(env, { research: R, crItems: () => [...items(), { request_id: 'REQ-0199', case_id: 'CASE-0101', agent_code: 'intro_desk', approval_state: '' }] })", 'crItems'],
  ["pl.j.dry_run === true && pl.j.credits_used === 0", "pl.j.dry_run === true && !('credits_used' in pl.j) && !/\\d\\s*credits?\\b/i.test(pl.t)"],
]);

// ---------- package.json ----------
{ const p = F('package.json'); const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (!j.scripts.test.includes('crlock-tests')) { j.scripts.test += ' && node test/crlock-tests.js'; fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n'); console.log('patched package.json'); } }
fs.writeFileSync(F('VERSION'), 'v40\n'); console.log('VERSION v40');
