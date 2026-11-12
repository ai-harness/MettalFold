'use strict';
// v38 tests: Contact research approval gate, filters, credit cap, Pursue-now-only, white-label. Mock only: no network, no credits.
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-cr-'));
process.env.QUIET = '1';
const DATA = path.join(tmp, 'data'), FILES = path.join(tmp, 'files'), LOGS = path.join(tmp, 'logs'); fs.mkdirSync(FILES, { recursive: true });
const { createResearch } = require('../lib/research'); const { createMockProvider } = require('../lib/providers/cr_mock'); const { createAudit } = require('../lib/audit');
const { writeXlsx } = require('../lib/xlsxw');
const results = []; let failed = 0;
const ok = (name, cond, ev) => { results.push({ name, pass: !!cond }); if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (ev ? '  -> ' + ev : '')); };
const VENDOR = /snov/i;
const throwsStatus = (fn, st) => { try { fn(); return false; } catch (e) { return e.status === st; } };
const rejects = async (p, st) => { try { await p; return false; } catch (e) { return e.status === st; } };

// fixture case: #1 target list (csv), #2 ranking workbook (Pursue / Nurture sheets) + summary
fs.writeFileSync(path.join(FILES, '01_OpportunityFinder_TestCo_Storage_IN3_TAL_V1.csv'), 'geography,country,industry,company_name,company_website,notes\nIndia,India,Data centres,Alpha Data Centres,https://www.alpha-dc.example/,x\nIndia,India,Data centres,Beta Cloud,https://beta-cloud.example/,x\nUAE,UAE,Data centres,Gamma Hosting,https://gamma.example/,x\n');
fs.writeFileSync(path.join(FILES, '02_AdvisoryGTM_TestCo_Storage_IN3_LightPass_V1.xlsx'), Buffer.concat([writeXlsx([['company', 'segment', 'country'], ['Alpha Data Centres', 'DC', 'India']], 'Strong_Pursue')]));
// a routed-accounts table like the real LightPass "Skip_or_Routed" sheet: the reason column decides, "None skipped" is not an account
fs.writeFileSync(path.join(FILES, '02_AdvisoryGTM_Routed_Storage_IN2_LightPass_V1.csv'), 'company,country,reason,influencer_path\nNone skipped,,All stay in. Routed accounts are kept.,\nAlpha Data Centres,India,Pursue now; warm path per Relationship Manager,consultant_route\nGamma Hosting,UAE,Keep warm; warm path per Relationship Manager,EPC_route\n');
let gtmApproved = 'approved';
const items = () => [
  { request_id: 'REQ-0101', case_id: 'CASE-0101', agent_code: 'opportunity_finder', inputs: { region: 'India, Middle East', number_of_accounts: 3 }, summary: 'Found 3.', approval_state: 'approved', output_link: '/files/01_OpportunityFinder_TestCo_Storage_IN3_TAL_V1.xlsx' },
  { request_id: 'REQ-0102', case_id: 'CASE-0101', agent_code: 'advisory_gtm', inputs: {}, summary: 'Walkthrough. Case CASE-0101. Alpha Data Centres: Pursue now. It is building. Beta Cloud: Pursue now. Growing fast. Gamma Hosting: Keep warm. Supply not confirmed.', approval_state: gtmApproved, output_link: '/files/02_AdvisoryGTM_TestCo_Storage_IN3_LightPass_V1.xlsx' },
  { request_id: 'REQ-0103', case_id: 'CASE-0102', agent_code: 'opportunity_finder', inputs: { region: 'India', number_of_accounts: 10 }, summary: '', approval_state: 'approved', output_link: '/files/01_OpportunityFinder_TestCo_Storage_IN3_TAL_V1.csv' },
  { request_id: 'REQ-0105', case_id: 'CASE-0103', agent_code: 'opportunity_finder', inputs: { region: 'India' }, summary: '', approval_state: 'approved', output_link: '/files/01_OpportunityFinder_TestCo_Storage_IN3_TAL_V1.csv' },
  { request_id: 'REQ-0104', case_id: 'CASE-0103', agent_code: 'advisory_gtm', inputs: {}, summary: '', approval_state: 'approved', output_link: '/files/02_AdvisoryGTM_Routed_Storage_IN2_LightPass_V1.xlsx' }
];
const audit = createAudit(LOGS);
const mock = createMockProvider({ titles: ['Chief Technology Officer', 'HR Manager', 'Vice President Energy', 'Head Electrical and MEP', 'Talent Acquisition Lead', 'Snov.io Partner Manager', 'Director Critical Facilities', 'Sales Executive'] });
let prov = mock;
const R = createResearch({ dataDir: DATA, filesDir: FILES, audit, env: { CR_MAX_CAP: '50' }, items, provider: () => prov });

(async () => {
  console.log('\n== v38 Contact research: Pursue now only ==');
  const s0 = R.summary('CASE-0101');
  ok('only Pursue now accounts are planned for contacts', JSON.stringify(s0.contacts.run_on) === JSON.stringify(['Alpha Data Centres', 'Beta Cloud']), JSON.stringify(s0.contacts.run_on));
  const r3 = R.summary('CASE-0103').contacts;
  ok('routed-accounts table: reason column decides, filler rows ignored', JSON.stringify(r3.run_on) === JSON.stringify(['Alpha Data Centres']) && r3.not_shortlisted.length === 1 && r3.not_shortlisted[0].account === 'Gamma Hosting', JSON.stringify([r3.run_on, r3.not_shortlisted.map((x) => x.account)]));
  ok('Keep warm account is listed as not shortlisted, never searched', s0.contacts.not_shortlisted.some((x) => x.account === 'Gamma Hosting' && /Not shortlisted/.test(x.note)) && !s0.contacts.run_on.includes('Gamma Hosting'));
  ok('domains come from the #1 target list', s0.filters.domains['Alpha Data Centres'] === 'alpha-dc.example' && s0.contacts.accounts[0].domain === 'alpha-dc.example');
  ok('estimate = company lookup + list pages + contacts per company', s0.contacts.estimated_credits === 2 * (1 + 1 + 10), String(s0.contacts.estimated_credits));
  ok('default filters stored per case and viewable', s0.filters.job_titles.length > 5 && s0.filters.locations.includes('Middle East') && /^[0-9a-f]{12}$/.test(s0.filters_hash));

  console.log('\n== Approval gate ==');
  ok('run without approval is refused (409) and calls nothing', await rejects(R.run('CASE-0101', { step: 'contacts', provider: mock }), 409) && mock.calls.length === 0);
  ok('approve needs approved_by', throwsStatus(() => R.approve('CASE-0101', { step: 'contacts', credit_cap: 3 }), 400));
  ok('approve needs a whole-number cap within the limit', throwsStatus(() => R.approve('CASE-0101', { step: 'contacts', approved_by: 'Rishabh', credit_cap: 0 }), 400) && throwsStatus(() => R.approve('CASE-0101', { step: 'contacts', approved_by: 'Rishabh', credit_cap: 999 }), 400));
  ok('approve refuses a Keep warm account', throwsStatus(() => R.approve('CASE-0101', { step: 'contacts', approved_by: 'Rishabh', credit_cap: 5, accounts: ['Gamma Hosting'] }), 400));
  gtmApproved = ''; ok('approve refused while #2 is not approved by a human', throwsStatus(() => R.approve('CASE-0101', { step: 'contacts', approved_by: 'Rishabh', credit_cap: 3 }), 400)); gtmApproved = 'approved';
  const dry = await R.run('CASE-0101', { step: 'contacts', dryRun: true }); ok('dry run (plan) spends 0 and calls nothing', dry.dry_run && dry.credits_used === 0 && mock.calls.length === 0);

  console.log('\n== Filters: view, edit, validate ==');
  ok('bad website refused with a field message', (() => { try { R.saveFilters('CASE-0101', { domains: 'Alpha Data Centres | not a site' }, 'Hemant'); return false; } catch (e) { return e.status === 400 && e.fields && e.fields.domains; } })());
  ok('more than 15 contacts per company refused', throwsStatus(() => R.saveFilters('CASE-0101', { max_prospects_per_company: 16 }, 'Hemant'), 400));
  const a1 = R.approve('CASE-0101', { step: 'contacts', approved_by: 'Rishabh', credit_cap: 3, accounts: ['Alpha Data Centres'], max_per_company: 1, ref: 'test chat' });
  ok('approval record has who, cap, time, accounts, filters id', a1.approved_by === 'Rishabh' && a1.credit_cap === 3 && a1.approved_at && a1.filters_hash && a1.accounts.join() === 'Alpha Data Centres' && a1.estimated_credits === 3, JSON.stringify({ est: a1.estimated_credits }));
  const s1 = R.saveFilters('CASE-0101', { job_titles: ['Energy', 'Electrical', 'Critical Facilities'] }, 'Hemant');
  ok('editing filters saves them and cancels the old approval', s1.filters.job_titles.length === 3 && s1.approvals.find((x) => x.id === a1.id).status === 'stale' && s1.filters_updated_by === 'Hemant');
  ok('run after a filter change is refused, nothing called', await rejects(R.run('CASE-0101', { step: 'contacts', provider: mock }), 409) && mock.calls.length === 0);

  console.log('\n== Approved run: credit cap and single use ==');
  prov = { ...createMockProvider(), connected: false };
  const a2 = R.approve('CASE-0101', { step: 'contacts', approved_by: 'Rishabh', credit_cap: 3, accounts: ['Alpha Data Centres'], max_per_company: 1 });
  ok('not connected: run refused and the approval stays open', await rejects(R.run('CASE-0101', { step: 'contacts' }), 409) && R.summary('CASE-0101').approvals.find((x) => x.id === a2.id).status === 'approved');
  prov = mock; const bal0 = await mock.balance();
  const r1 = await R.run('CASE-0101', { step: 'contacts', user: 'test' });
  const bal1 = await mock.balance();
  ok('approved run: one company, one contact, credits within cap (3)', r1.status === 'done' && r1.people_found === 1 && r1.credits_used <= 3 && bal0 - bal1 === r1.credits_used, r1.status + ' used=' + r1.credits_used + ' real=' + (bal0 - bal1));
  ok('only the approved Pursue now domain was touched', mock.calls.every((c) => c[0] === 'email' ? /alpha-dc/.test(c[1]) : c[1] === 'alpha-dc.example'), JSON.stringify(mock.calls.map((c) => c[0] + ':' + c[1])));
  ok('excluded titles (HR, Talent) are never picked', !JSON.stringify(r1.people_preview).match(/HR Manager|Talent/));
  ok('approval is single use: a second run is refused', await rejects(R.run('CASE-0101', { step: 'contacts' }), 409));
  const n0 = mock.calls.length;
  R.approve('CASE-0101', { step: 'contacts', approved_by: 'Rishabh', credit_cap: 2, accounts: ['Beta Cloud'], max_per_company: 3 });
  const r2 = await R.run('CASE-0101', { step: 'contacts' });
  ok('meter stops at the cap before going over', r2.status === 'stopped at cap' && r2.credits_used <= 2 && mock.calls.slice(n0).filter((c) => c[0] === 'email').length === 0, r2.status + ' ' + r2.credits_used);

  console.log('\n== Company enrichment: run / skip ==');
  const e0 = R.summary('CASE-0101').enrichment; ok('auto = skip when web research already found enough companies', e0.mode === 'auto' && e0.resolved === 'skip' && e0.estimated_credits === 0);
  const e2 = R.summary('CASE-0102').enrichment; ok('auto = run when fewer companies were found than asked', e2.resolved === 'run' && e2.estimated_credits > 0);
  ok('skip: approval for enrichment refused', throwsStatus(() => R.approve('CASE-0101', { step: 'enrichment', approved_by: 'Rishabh', credit_cap: 3 }), 400));
  const e1 = R.setEnrichment('CASE-0101', 'run', 'Rishabh').enrichment;
  ok('run: only companies still missing data, inside the location filter', e1.resolved === 'run' && !e1.run_on.includes('Alpha Data Centres') && e1.run_on.includes('Gamma Hosting'), JSON.stringify(e1.run_on));
  R.approve('CASE-0101', { step: 'enrichment', approved_by: 'Rishabh', credit_cap: 5 }); const re = await R.run('CASE-0101', { step: 'enrichment' });
  ok('enrichment run within cap writes a Company enrichment file', re.status === 'done' && re.credits_used <= 5 && re.outputs.some((n) => /^01_OpportunityFinder_TestCo_Storage_IN3_CompanyEnrichment_V\d+\.xlsx$/.test(n)), JSON.stringify(re.outputs));

  console.log('\n== White-label ==');
  const outs = fs.readdirSync(FILES).filter((n) => /ContactResearch|CompanyEnrichment/.test(n));
  ok('output files exist with neutral names (csv + xlsx)', outs.some((n) => /^03_IntroDesk_.+_ContactResearch_V1\.csv$/.test(n)) && outs.some((n) => /\.xlsx$/.test(n)) && outs.every((n) => !VENDOR.test(n)), outs.join(','));
  const text = outs.map((n) => /\.csv$/.test(n) ? fs.readFileSync(path.join(FILES, n), 'utf8') : JSON.stringify(require('../lib/xlsx').readWorkbook(fs.readFileSync(path.join(FILES, n))))).join('\n');
  ok('output contents and headers never name the provider', !VENDOR.test(text) && /found_by/.test(text) && /Contact research/.test(text));
  ok('state file and audit log never name the provider', !VENDOR.test(fs.readFileSync(path.join(DATA, 'contact_research', 'CASE-0101.json'), 'utf8')) && !VENDOR.test(fs.readFileSync(path.join(LOGS, 'audit.jsonl'), 'utf8')));
  ok('error text from the provider is neutralised', R.neutral('Snov.io answered 500 at https://api.snov.io/v2/x') === 'contact research answered 500 at [link hidden]');

  console.log('\n== HTTP: endpoints and served assets ==');
  const { createApp } = require('../server');
  const env = { APP_PASSWORD: 'test-pass-123', SESSION_SECRET: 'x'.repeat(40), USERS: 'Rishabh,Hemant', WEBHOOK_MODE: 'mock', SHEET_MODE: 'mock', MOCK_SHEET_FILE: path.join(tmp, 'sheet.json'), LOG_DIR: LOGS, DATA_DIR: DATA, FILES_DIR: FILES };
  const ctx = createApp(env, { research: R, crItems: () => [...items(), { request_id: 'REQ-0199', case_id: 'CASE-0101', agent_code: 'intro_desk', approval_state: '' }] }); const srv = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); }); const url = 'http://127.0.0.1:' + srv.address().port;
  let cookie = ''; const req = async (m, p, body, hdr = true) => { const r = await fetch(url + p, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(m !== 'GET' && hdr ? { 'X-Requested-With': 'mf' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, t, j, h: r.headers }; };
  ok('research API needs sign-in', (await req('GET', '/api/research/CASE-0101')).s === 401 && (await req('GET', '/research')).s === 302);
  const lg = await req('POST', '/api/login', { user: 'Rishabh', password: 'test-pass-123' }); cookie = (lg.h.get('set-cookie') || '').split(';')[0];
  const g = await req('GET', '/api/research/CASE-0101'); ok('GET /api/research/:case shows filters, plan and approvals', g.s === 200 && g.j.filters && g.j.contacts && Array.isArray(g.j.approvals));
  ok('POST filters without the app header is blocked', (await req('POST', '/api/research/CASE-0101/filters', { filters: {} }, false)).s === 403);
  const pf = await req('POST', '/api/research/CASE-0101/filters', { filters: { seniority: ['Head', 'Director', 'VP'] } }); ok('POST filters saves and answers at once', pf.s === 200 && pf.j.filters.seniority.length === 3);
  ok('bad case id refused', (await req('GET', '/api/research/..%2Fetc')).s === 400 || (await req('GET', '/api/research/..%2Fetc')).s === 404);
  ok('no approve or run endpoint in the app (approval comes from chat only)', (await req('POST', '/api/research/CASE-0101/run', { step: 'contacts' })).s === 404 && (await req('POST', '/api/research/CASE-0101/approve', {})).s === 404);
  const pl = await req('POST', '/api/research/CASE-0101/plan', { step: 'contacts' }); ok('plan endpoint is free (dry run)', pl.s === 200 && pl.j.dry_run === true && !('credits_used' in pl.j) && !/\d\s*credits?\b/i.test(pl.t));
  const assets = ['/', '/app.js', '/style.css', '/research', '/research.js']; let leak = [];
  for (const a of assets) { const r = await req('GET', a); if (r.s !== 200) leak.push(a + ':' + r.s); else if (VENDOR.test(r.t)) leak.push(a); }
  cookie = ''; for (const a of ['/login', '/login.js']) { const r = await req('GET', a); if (VENDOR.test(r.t)) leak.push(a); }
  ok('served pages and scripts never name the provider', !leak.length, leak.join(',') || assets.length + 2 + ' assets clean');
  const pubDir = path.join(__dirname, '..', '..', 'UI'); const pubLeak = fs.readdirSync(pubDir).filter((n) => !/\.bak/.test(n) && fs.statSync(path.join(pubDir, n)).isFile() && VENDOR.test(fs.readFileSync(path.join(pubDir, n), 'latin1')));
  ok('public/ folder (front-end files) has no provider name', !pubLeak.length, pubLeak.join(','));
  ok('API answers never name the provider', !VENDOR.test(g.t) && !VENDOR.test(pf.t) && !VENDOR.test(pl.t));
  const libLeak = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (/\.js$/.test(e.name) && !/\.bak/.test(e.name) && VENDOR.test(fs.readFileSync(f, 'utf8'))) libLeak.push(path.relative(path.join(__dirname, '..'), f)); } }; walk(path.join(__dirname, '..', 'lib'));
  ok('provider name lives only in the server-side adapter', libLeak.length === 1 && libLeak[0] === path.join('lib', 'providers', 'cr.js'), libLeak.join(','));
  srv.close(); ctx.core.stop && ctx.core.stop();
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  fs.writeFileSync(path.join(__dirname, 'last-research-run.txt'), results.map((x) => (x.pass ? 'PASS ' : 'FAIL ') + x.name).join('\n') + `\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
