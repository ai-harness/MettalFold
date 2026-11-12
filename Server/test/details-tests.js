'use strict';
// v39 tests: #1 Opportunity Finder company-details rule (website, headcount, LinkedIn, industry). No network, no credits.
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-det-')), FILES = path.join(tmp, 'files'); fs.mkdirSync(FILES, { recursive: true });
process.env.QUIET = '1';
const D = require('../lib/details'), { writeXlsx } = require('../lib/xlsxw');
const results = []; let failed = 0;
const ok = (name, cond, ev) => { results.push({ name, pass: !!cond }); if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (ev ? '  -> ' + ev : '')); };
const toCsv = (rows) => rows.map((r) => r.map((c) => (/[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c))).join(',')).join('\n') + '\n';
const H = ['company_name', 'company_website', 'headcount', 'industry', 'company_linkedin_url'];
const full = [H, ['Alpha DC', 'https://alpha.example/', '201-500', 'Data centres', 'https://www.linkedin.com/company/alpha'], ['Beta Cloud', 'https://beta.example/', 'About 1,000', 'Cloud', 'https://www.linkedin.com/company/beta']];
(async () => {
  console.log('\n== v39 company details rule ==');
  let c = D.checkRows(full); ok('complete list passes', c.complete && c.accounts === 2 && !c.missing.length, c.message);
  c = D.checkRows([H, ['Alpha DC', 'https://alpha.example/', '', 'Data centres', 'https://www.linkedin.com/company/alpha'], ['Beta Cloud', 'https://beta.example/', 'n/a', 'Cloud', 'https://www.linkedin.com/company/beta']]);
  ok('blank or n/a headcount is flagged in plain words', !c.complete && c.message === 'Missing company details: headcount for Alpha DC, Beta Cloud.', c.message);
  c = D.checkRows([['account', 'country', 'website', 'linkedin'], ['Gamma', 'UAE', 'https://g.example', 'https://www.linkedin.com/company/g']]);
  ok('missing columns flag every account', !c.complete && c.missing[0].fields.join() === 'headcount,industry' && c.missing_columns.join() === 'headcount,industry', c.message);
  c = D.checkRows([H, ['Delta', 'https://d.example', '50', 'Energy', 'https://example.com/delta']]);
  ok('a LinkedIn cell that is not a LinkedIn company link is flagged', !c.complete && c.missing[0].fields.join() === 'LinkedIn', c.message);
  c = D.checkRows([H, ['Eps', '', '', '', '']]);
  ok('all four named, in order', c.message === 'Missing company details: website for Eps; headcount for Eps; LinkedIn for Eps; industry for Eps.', c.message);
  c = D.checkRows([['x', 'y'], ['1', '2']]); ok('no company column: flagged, not crashed', !c.complete && /no company list/.test(c.message));
  c = D.checkRows([H, ...'ABCDEFGH'.split('').map((x) => ['Co ' + x, 'https://x.example', '', 'Energy', 'https://www.linkedin.com/company/x'])]);
  ok('long lists are shortened', /Co F and 2 more\.$/.test(c.message), c.message);
  ok('alternate headers work (Company / Website / Employees / LinkedIn URL / Industry)', D.checkRows([['Company', 'Website', 'Employees', 'LinkedIn URL', 'Industry'], ['Zeta', 'zeta.example', '10', 'https://linkedin.com/company/zeta', 'Retail']]).complete);
  fs.writeFileSync(path.join(FILES, '01_OpportunityFinder_T_TAL_V1.csv'), toCsv(full));
  ok('csv file check', D.checkFile(FILES, '01_OpportunityFinder_T_TAL_V1.xlsx').complete);
  fs.writeFileSync(path.join(FILES, '01_OpportunityFinder_X_TAL_V1.xlsx'), writeXlsx([H, ['Alpha DC', 'https://alpha.example/', '201-500', '', 'https://www.linkedin.com/company/alpha']], 'TAL'));
  c = D.checkFile(FILES, '01_OpportunityFinder_X_TAL_V1.xlsx'); ok('xlsx file check (no csv)', c && !c.complete && c.message === 'Missing company details: industry for Alpha DC.', c && c.message);
  ok('file not here yet: no flag', D.checkFile(FILES, '01_OpportunityFinder_None_TAL_V1.csv') === null);
  ok('only #1 Opportunity Finder outputs are checked', D.forRequest({ agent_code: 'advisory_gtm', output_link: '/files/01_OpportunityFinder_T_TAL_V1.csv' }, FILES) === null && D.forRequest({ agent_code: 'opportunity_finder', output_link: '/files/01_OpportunityFinder_T_TAL_V1.csv' }, FILES).complete);
  fs.writeFileSync(path.join(FILES, '01_OpportunityFinder_T_TAL_V1.csv'), [H, ['Alpha DC', '', '1', 'x', 'https://www.linkedin.com/company/a']].map((r) => r.join(',')).join('\n') + '\n'); const t = Date.now() / 1000 + 5; fs.utimesSync(path.join(FILES, '01_OpportunityFinder_T_TAL_V1.csv'), t, t);
  ok('a changed file is checked again', /website for Alpha DC/.test(D.checkFile(FILES, '01_OpportunityFinder_T_TAL_V1.csv').message));
  { const { NAME_RE } = require('../lib/providers/cr'); const has = (t) => { NAME_RE.lastIndex = 0; return NAME_RE.test(t); }; ok('no outside service name in the rule or its messages', !has(fs.readFileSync(path.join(__dirname, '..', 'lib', 'details.js'), 'utf8')) && !has(D.checkRows([H, ['Eps', '', '', '', '']]).message)); }

  // through the app: a #1 request shows the flag; a newer _V2 with all details clears it
  const base = { APP_PASSWORD: 'test-pass-123', SESSION_SECRET: 'x'.repeat(40), USERS: 'Rishabh,Hemant', WEBHOOK_MODE: 'mock', SHEET_MODE: 'mock', MOCK_SHEET_FILE: path.join(tmp, 'sheet.json'), LOG_DIR: path.join(tmp, 'logs'), DATA_DIR: path.join(tmp, 'data'), FILES_DIR: path.join(tmp, 'appfiles'), MOCK_FILES_DIR: path.join(tmp, 'appfiles'), SEND_GAP_MS: '1', POLL_MS: '80', MOCK_DELAY_MS: '100', DELAY_HINT_SECONDS: '1', TIMEOUT_MINUTES: '0.5', SHEET_ID: 'TESTSHEET' };
  const { createApp } = require('../server'); const ctx = createApp(base); ctx.core.start();
  const srv = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); }); const url = 'http://127.0.0.1:' + srv.address().port; let cookie = '';
  const req = async (m, p, b) => { const r = await fetch(url + p, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mf', ...(cookie ? { Cookie: cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc && sc.includes('mf_session=')) cookie = sc.split(';')[0]; return { s: r.status, j: await r.json().catch(() => null) }; };
  await req('POST', '/api/login', { user: 'Rishabh', password: 'test-pass-123' });
  const sub = (await req('POST', '/api/submit', { agent_code: 'opportunity_finder', inputs: { region: 'India', number_of_accounts: '2', focus: 'Det test' } })).j;
  let v = null; for (let i = 0; i < 150 && !(v && v.details_check); i++) { await new Promise((r) => setTimeout(r, 60)); v = (await req('GET', '/api/status/' + sub.request_id)).j; }
  ok('app flags a #1 output without headcount and industry', v && v.details_check && !v.details_check.complete && /^Missing company details: headcount for .+; industry for /.test(v.details_check.message), v && v.details_check && v.details_check.message);
  const listed = ((await req('GET', '/api/cases')).j.requests || []).find((x) => x.request_id === sub.request_id); ok('the case list carries the same flag', listed && listed.details_check && listed.details_check.complete === false);
  const n1 = path.basename(decodeURIComponent(v.output_link.slice(7))), n2 = n1.replace(/_V1\.(csv|xlsx)$/i, '_V2.$1');
  const rows = require('../lib/details').checkFile(base.FILES_DIR, n1); const names = (rows.missing || []).map((x) => x.account);
  fs.writeFileSync(path.join(base.FILES_DIR, n2), [H, ...names.map((a) => [a, 'https://x.example', '51-200', 'Retail', 'https://www.linkedin.com/company/x'])].map((r) => r.join(',')).join('\n') + '\n');
  v = (await req('GET', '/api/status/' + sub.request_id)).j;
  ok('a newer version with every detail clears the flag (newest file is checked)', v.output_link.endsWith(encodeURIComponent(n2)) && v.details_check.complete === true, v.details_check.message);
  ctx.core.stop(); srv.close();
  console.log(`\n${results.length - failed}/${results.length} checks passed`); fs.writeFileSync(path.join(__dirname, 'last-details-run.txt'), results.map((x) => (x.pass ? 'PASS ' : 'FAIL ') + x.name).join('\n') + `\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
