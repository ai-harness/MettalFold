'use strict';
// v41 patch: Contact research opens as a panel inside the case screen (no new page, no new tab). Needs v40.
// Run from the app folder after copying public/research.js, public/research.html, test/crpanel-tests.js: node tools/patch41.js
const fs = require('fs'), path = require('path');
const root = process.argv[2] || path.join(__dirname, '..');
const F = (p) => path.join(root, p);
function edit(file, pairs) {
  let s = fs.readFileSync(F(file), 'utf8');
  for (const [a, b, tag] of pairs) {
    if (tag && s.includes(tag)) continue;
    const n = s.split(a).length - 1; if (n !== 1) throw new Error(file + ': anchor found ' + n + ' times: ' + a.slice(0, 90));
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(F(file), s); console.log('patched', file);
}
if (!fs.readFileSync(F('server.js'), 'utf8').includes('lib/crlock')) throw new Error('v40 is not installed here; apply v40 first');

// ---------- public/app.js ----------
edit('public/app.js', [
  ["function crLink(cc) {\n  if (crOpen(cc)) return el('a', { class: 'btn sec', id: 'crlink', href: '/research#' + encodeURIComponent(cc), target: '_blank', rel: 'noopener', style: 'text-decoration:none;padding:6px 12px;background:#e3e8ee;color:#1c2733', title: 'Find contacts in the shortlisted accounts for this case' }, 'Contact research');",
   "// v41: contact research opens as a panel on this screen; ?cr=CASE (old /research links) opens it after loading\n" +
   "var crPending = (() => { try { const q = new URLSearchParams(location.search).get('cr'); if (q) history.replaceState(null, '', location.pathname + location.hash); return q || ''; } catch (e) { return ''; } })();\n" +
   "function openCR(c) { if (!c) return; if (!window.CR) { toast('Contact research did not load. Please reload the page.', 'err'); return; } window.CR.open(c, { toast }); }\n" +
   "function crLink(cc) {\n  if (crOpen(cc)) return el('button', { type: 'button', class: 'btn sec', id: 'crlink', style: 'padding:6px 12px;background:#e3e8ee;color:#1c2733', title: 'Find contacts in the shortlisted accounts for this case (opens here)', onclick: () => openCR(cc) }, 'Contact research');", 'function openCR('],
  ["pill = el('a', { class: 'st crstep', href: '/research#' + encodeURIComponent(caseId), target: '_blank', rel: 'noopener', title: 'Now is the time to find contacts in the shortlisted accounts' },",
   "pill = el('div', { class: 'st crstep', role: 'button', tabindex: '0', title: 'Now is the time to find contacts in the shortlisted accounts (opens here)', onclick: () => openCR(caseId), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCR(caseId); } } },"],
  ["window.open('/research#' + encodeURIComponent(r.case_id), '_blank', 'noopener'); sel.value = M.filter || ''; return;",
   "sel.value = M.filter || ''; openCR(r.case_id); return;"],
  ["runBanners(b); renderCases(); renderGStep(); checkApprovals(); renderDetail(); renderForm(true);\n}",
   "runBanners(b); renderCases(); renderGStep(); checkApprovals(); renderDetail(); renderForm(true);\n  if (crPending && data.requests.length) { const c = crPending; crPending = ''; if (caseSel !== c && caseIds().includes(c)) switchCase(c); openCR(c); }\n}", 'const c = crPending;'],
]);

// ---------- index.html + server.js: load the panel script with the same cache busting as app.js ----------
edit('public/index.html', [["<script src=\"/app.js?v=", "<script src=\"/research.js?v=1\"></script><script src=\"/app.js?v=", '/research.js?v=']]);
edit('server.js', [[".replace(/\\/style\\.css(\\?v=[^\"]*)?\"/, '/style.css?v=' + f('style.css') + '\"')",
  ".replace(/\\/style\\.css(\\?v=[^\"]*)?\"/, '/style.css?v=' + f('style.css') + '\"').replace(/\\/research\\.js(\\?v=[^\"]*)?\"/, '/research.js?v=' + f('research.js') + '\"')", "research\\.js(\\?v="]]);

// ---------- public/style.css ----------
{ const p = F('public/style.css'); let s = fs.readFileSync(p, 'utf8'); if (!s.includes('.crdrawer')) { s += "\n/* v41: contact research panel on the case screen */\n" +
  ".crshade{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:60}\n" +
  ".crdrawer{position:fixed;top:0;right:0;bottom:0;width:min(1120px,96vw);background:#f4f6f9;box-shadow:-8px 0 24px rgba(0,0,0,.18);z-index:61;overflow:auto;padding:0 16px 24px}\n" +
  ".crdrawer .crhead{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;background:#f4f6f9;padding:12px 0;border-bottom:1px solid #dde3ea;margin-bottom:12px}\n" +
  ".crdrawer .crhead h2{margin:0;font-size:18px}.crdrawer .crsp{flex:1}.crdrawer .crx{padding:4px 10px}\n" +
  ".crdrawer .crgrid{display:grid;grid-template-columns:400px 1fr;gap:12px}.crdrawer .crgrid>section{min-width:0}\n" +
  ".crdrawer .crsaved{color:#1e7a3c;font-weight:600;margin:8px 0 0}\n" +
  "@media (max-width:900px){.crdrawer .crgrid{grid-template-columns:1fr}}\n" +
  "body.cropen{overflow:hidden}\n.stepper .st.crstep{cursor:pointer}\n"; fs.writeFileSync(p, s); console.log('patched public/style.css'); } }

// ---------- tests ----------
edit('test/crlock-tests.js', [["/'\\/research#' \\+ encodeURIComponent\\(r\\.case_id\\)/.test(app)", "/openCR\\(r\\.case_id\\)/.test(app)", 'openCR\\(r']]);
{ const p = F('package.json'); const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (!j.scripts.test.includes('crpanel-tests')) { j.scripts.test += ' && node test/crpanel-tests.js'; fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n'); console.log('patched package.json'); } }
fs.writeFileSync(F('VERSION'), 'v41\n'); console.log('VERSION v41');
