// v39 patch: company-details rule for #1 outputs. Run from the app folder.
const fs = require('fs');
const rep = (f, a, b) => { const s = fs.readFileSync(f, 'utf8'); if (s.includes(b)) return console.log(f + ': already patched'); if (!s.includes(a)) throw new Error(f + ': anchor not found'); fs.writeFileSync(f, s.replace(a, b)); console.log(f + ': patched'); };
const A1 = "  app.get('/api/file-wants',";
rep('server.js', A1, "  // v39: hard rule, #1 Opportunity Finder outputs must give website, headcount, LinkedIn and industry for every account; gaps are flagged in plain words\n  const details = require('./lib/details'); const withFiles0 = withFiles;\n  withFiles = (r0) => { const o = withFiles0(r0); let dc = null; try { dc = details.forRequest(o, filesDir); } catch (e) {} return dc ? { ...o, details_check: dc } : o; };\n" + A1);
rep('server.js', '  const withFiles = (r0) => {', '  let withFiles = (r0) => {');
rep('public/app.js', "  if (r.outcome) kids.push(el('p', {}, el('b', {}, 'Outcome: '), r.outcome));", "  if (r.details_check && !r.details_check.complete) kids.push(el('div', { class: 'notice detailsflag' }, el('b', {}, 'Incomplete: '), r.details_check.message, ' Ask the desk to add them (Edit and resubmit), or add a newer version of the file.')); // v39\n  if (r.outcome) kids.push(el('p', {}, el('b', {}, 'Outcome: '), r.outcome));");
const pj = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const k of ['test', 'test:all']) if (pj.scripts[k] && !pj.scripts[k].includes('details-tests')) pj.scripts[k] = pj.scripts[k].replace('node test/research-tests.js', 'node test/research-tests.js && node test/details-tests.js');
fs.writeFileSync('package.json', JSON.stringify(pj, null, 2) + '\n'); console.log('package.json: ' + pj.scripts.test);
