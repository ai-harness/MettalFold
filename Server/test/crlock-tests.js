'use strict';
// v40 tests: Contact research stays locked until #3 Introduction Desk, after #2 Advisory GTM is approved. Mock only: no network, no credits.
const fs = require('fs'), os = require('os'), path = require('path');
process.env.QUIET = '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-crl-'));
const DATA = path.join(tmp, 'data'), FILES = path.join(tmp, 'files'), LOGS = path.join(tmp, 'logs'); fs.mkdirSync(FILES, { recursive: true });
const L = require('../lib/crlock');
const results = []; let failed = 0;
const ok = (name, cond, ev) => { results.push({ name, pass: !!cond }); if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (ev ? '  -> ' + ev : '')); };
const r = (id, c, code, st, extra) => ({ request_id: id, case_id: c, agent_code: code, approval_state: st || '', approved: st === 'approved', inputs: {}, summary: '', ...(extra || {}) });

(async () => {
  console.log('== lock rule ==');
  ok('a case with no steps is locked', L.state([], 'CASE-0001').locked);
  ok('locked before #3: only #1 approved', (() => { const s = L.state([r('A', 'C1', 'opportunity_finder', 'approved')], 'C1'); return s.locked && /#2 Advisory GTM/.test(s.why) && s.message === 'Unlock in Introduction Desk first'; })());
  ok('locked before #3: #2 waiting for approval', L.state([r('A', 'C1', 'opportunity_finder', 'approved'), r('B', 'C1', 'advisory_gtm', '')], 'C1').locked);
  ok('locked before #3: #2 rejected', L.state([r('A', 'C1', 'opportunity_finder', 'approved'), r('B', 'C1', 'advisory_gtm', 'rejected')], 'C1').locked);
  const early = ['supplier_qualification', 'product_book', 'opportunity_finder'].map((c, i) => r('E' + i, 'C2', c, 'approved'));
  ok('locked before #3: earlier steps done, #2 still open', L.state([...early, r('G', 'C2', 'advisory_gtm', '')], 'C2').locked);
  ok('unlocked after #2 approved handoff (current step is #3 Introduction Desk)', (() => { const s = L.state([...early, r('G', 'C2', 'advisory_gtm', 'approved')], 'C2'); return s.unlocked && s.step === 'intro_desk' && !s.message; })());
  ok('unlocked after #2 approved handoff (#3 request already started)', L.state([r('A', 'C3', 'opportunity_finder', 'approved'), r('B', 'C3', 'advisory_gtm', 'approved'), r('C', 'C3', 'intro_desk', '')], 'C3').unlocked);
  ok('approval read from the sheet column too (approval_state only)', L.state([{ case_id: 'C4', agent_code: 'advisory_gtm', approval_state: 'Approved' }, { case_id: 'C4', agent_code: 'intro_desk', approval_state: '' }], 'C4').unlocked);
  ok('stays unlocked once the case moves on to #4 Deal Desk', L.state([...early, r('G', 'C2', 'advisory_gtm', 'approved'), r('I', 'C2', 'intro_desk', 'approved'), r('D', 'C2', 'deal_desk', '')], 'C2').unlocked);
  ok('one case unlocking does not unlock another', L.state([r('B', 'C3', 'advisory_gtm', 'approved'), r('C', 'C3', 'intro_desk', '')], 'C9').locked);
  const hid = L.hideCredits({ estimated_credits: 9, credit_cap: 5, credits_used: 0, note: 'Run on 3, about 12 credits (1 credit per company).', x: [{ est: 2, a: 'Stopped at the credit cap (5).' }] });
  ok('credit amounts are removed from browser answers', !('estimated_credits' in hid) && !('credit_cap' in hid) && !('est' in hid.x[0]) && !/\d\s*credits?/i.test(JSON.stringify(hid)), JSON.stringify(hid));

  console.log('\n== HTTP: locked and unlocked cases ==');
  fs.writeFileSync(path.join(FILES, '01_OpportunityFinder_T_S_IN2_TAL_V1.csv'), 'geography,country,industry,company_name,company_website,notes\nIndia,India,Data centres,Alpha DC,https://alpha.example,x\nIndia,India,Data centres,Beta DC,https://beta.example,y\n');
  const OF = '/files/01_OpportunityFinder_T_S_IN2_TAL_V1.csv';
  const ITEMS = [
    r('REQ-0201', 'CASE-0201', 'opportunity_finder', 'approved', { inputs: { region: 'India' }, output_link: OF }),
    r('REQ-0202', 'CASE-0202', 'opportunity_finder', 'approved', { inputs: { region: 'India' }, output_link: OF }),
    r('REQ-0203', 'CASE-0202', 'advisory_gtm', 'approved', { summary: 'Alpha DC: Pursue now. Beta DC: Pursue now.' }),
    r('REQ-0204', 'CASE-0202', 'intro_desk', '')
  ];
  const { createResearch } = require('../lib/research'); const { createMockProvider } = require('../lib/providers/cr_mock'); const { createAudit } = require('../lib/audit');
  const audit = createAudit(LOGS); const prov = createMockProvider({});
  const R = createResearch({ dataDir: DATA, filesDir: FILES, audit, env: {}, items: () => ITEMS, provider: () => prov });
  const { createApp } = require('../server');
  const env = { APP_PASSWORD: 'test-pass-123', SESSION_SECRET: 'y'.repeat(40), USERS: 'Rishabh,Hemant', WEBHOOK_MODE: 'mock', SHEET_MODE: 'mock', MOCK_SHEET_FILE: path.join(tmp, 'sheet.json'), LOG_DIR: LOGS, DATA_DIR: DATA, FILES_DIR: FILES };
  const ctx = createApp(env, { research: R, crItems: () => ITEMS }); const srv = await new Promise((res) => { const s = ctx.app.listen(0, '127.0.0.1', () => res(s)); }); const url = 'http://127.0.0.1:' + srv.address().port;
  let cookie = ''; const req = async (m, p, body) => { const x = await fetch(url + p, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(m !== 'GET' ? { 'X-Requested-With': 'mf' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await x.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { s: x.status, t, j, h: x.headers }; };
  const lg = await req('POST', '/api/login', { user: 'Rishabh', password: 'test-pass-123' }); cookie = (lg.h.get('set-cookie') || '').split(';')[0];
  const gl = await req('GET', '/api/research/CASE-0201');
  ok('GET a locked case says locked and shows no filters or plan', gl.s === 200 && gl.j.locked === true && !gl.j.filters && !gl.j.contacts && /Unlock in Introduction Desk first/.test(gl.j.message), gl.t.slice(0, 160));
  const w = [['filters', { filters: { seniority: ['Head'] } }], ['enrichment', { mode: 'skip' }], ['plan', { step: 'contacts' }]];
  const outs = []; for (const [p, b] of w) outs.push(await req('POST', '/api/research/CASE-0201/' + p, b));
  ok('locked case: filters, enrichment and plan are refused (403, locked)', outs.every((o) => o.s === 403 && o.j.locked === true && /Unlock in Introduction Desk first/.test(o.j.error)), outs.map((o) => o.s).join(','));
  ok('locked case: nothing was saved', !fs.existsSync(path.join(DATA, 'contact_research', 'CASE-0201.json')));
  const list = await req('GET', '/api/research');
  ok('case list shows which cases are locked', list.s === 200 && list.j.locked && list.j.locked['CASE-0201'] === true && list.j.locked['CASE-0202'] === false, JSON.stringify(list.j && list.j.locked));
  const gu = await req('GET', '/api/research/CASE-0202');
  ok('unlocked after #2 approved handoff: GET shows filters and accounts', gu.s === 200 && gu.j.locked === false && gu.j.filters && gu.j.contacts && Array.isArray(gu.j.contacts.accounts));
  ok('unlocked answers carry no credit amounts', !/estimated_credits|credit_cap|credits_used|"est"/.test(gu.t) && !/\d\s*credits?\b/i.test(gu.t));
  const pu = await req('POST', '/api/research/CASE-0202/plan', { step: 'contacts' });
  ok('unlocked: plan check works and stays a free dry run', pu.s === 200 && pu.j.dry_run === true && !/\d\s*credits?\b/i.test(pu.t), String(pu.s));
  const fu = await req('POST', '/api/research/CASE-0202/filters', { filters: { seniority: ['Head', 'Director'] } });
  ok('unlocked: filters can be saved', fu.s === 200 && fu.j.filters.seniority.length === 2);
  ok('unlocking spent nothing (no runs, no approvals)', (gu.j.runs || []).length === 0 && (gu.j.approvals || []).length === 0);
  srv.close(); ctx.core.stop && ctx.core.stop();

  console.log('\n== front end ==');
  const pub = path.join(__dirname, '..', '..', 'UI'); const app = fs.readFileSync(path.join(pub, 'app.js'), 'utf8'), css = fs.readFileSync(path.join(pub, 'style.css'), 'utf8'), rjs = fs.readFileSync(path.join(pub, 'research.js'), 'utf8');
  ok('case bar: locked link is not a link and has the note under it', /CR_LOCK = 'Unlock in Introduction Desk first'/.test(app) && /crlocked/.test(app) && /'aria-disabled': 'true'/.test(app) && /\.crwrap:hover \.crtip/.test(css) && /\.crtip\{[^}]*top:calc\(100%/.test(css));
  ok('once unlocked: Contact research appears in the steps and in the Introduction Desk dropdown', /class: 'st crstep'/.test(app) && /value: '__cr'/.test(app) && /openCR\(r\.case_id\)/.test(app));
  const src = (app.match(/function crOpen\(caseId\) \{[\s\S]*?\n\}\n/) || [''])[0];
  const client = (reqs, c) => new Function('data', 'ORDER', 'NEWC', 'stageState', src + '; return crOpen(' + JSON.stringify(c) + ');')({ requests: reqs }, L.ORDER, '__new__', (code, cid) => { const rs = reqs.filter((x) => x.case_id === cid && x.agent_code === code); return !rs.length ? 'wait' : rs.some((x) => x.approved) ? 'done' : 'now'; });
  const scen = [[[r('A', 'C1', 'opportunity_finder', 'approved')], 'C1'], [[r('A', 'C1', 'opportunity_finder', 'approved'), r('B', 'C1', 'advisory_gtm', '')], 'C1'], [[...early, r('G', 'C2', 'advisory_gtm', 'approved')], 'C2'], [ITEMS, 'CASE-0202'], [ITEMS, 'CASE-0201'], [[], '']];
  ok('browser and server use the same unlock rule', !!src && scen.every(([it, c]) => client(it, c) === L.state(it, c).unlocked), scen.map(([it, c]) => client(it, c)).join(','));
  ok('front end shows no credit amounts', !/estimated_credits|credit_cap|credits_used|\.est\b|credits\)|Max credits|1 credit each/.test(rjs + app));

  const live = path.join(__dirname, '..', 'data', 'sheet_snapshot.json');
  if (fs.existsSync(live) && !process.env.NO_LIVE) {
    const { itemsFromSnapshot } = require('../lib/research'); const s = L.state(itemsFromSnapshot(path.join(__dirname, '..', 'data')), 'CASE-0003');
    console.log('\n== this computer ==\nCASE-0003: ' + (s.unlocked ? 'unlocked' : 'locked (' + s.why + ')') + ' · current step ' + s.step_label);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  fs.writeFileSync(path.join(__dirname, 'last-crlock-run.txt'), results.map((x) => (x.pass ? 'PASS ' : 'FAIL ') + x.name).join('\n') + `\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
