'use strict';
// Full test in MOCK mode: no real webhook, no real sheet, no .env, and never the real data/ or files/ folders. Run: npm test
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), http = require('http');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-test-'));
process.env.QUIET = '1';
const base = { APP_PASSWORD: 'test-pass-123', SESSION_SECRET: 'x'.repeat(40), USERS: 'Rishabh,Hemant', WEBHOOK_MODE: 'mock', SHEET_MODE: 'mock', MOCK_SHEET_FILE: path.join(tmp, 'sheet.json'), LOG_DIR: path.join(tmp, 'logs'), DATA_DIR: path.join(tmp, 'data'), FILES_DIR: path.join(tmp, 'files'), MOCK_FILES_DIR: path.join(tmp, 'files'), SEND_GAP_MS: '1', POLL_MS: '80', MOCK_DELAY_MS: '200', DELAY_HINT_SECONDS: '1', TIMEOUT_MINUTES: '0.03', SHEET_ID: 'TESTSHEET', SUPPLIER_QUALIFICATION_URL: 'https://api2.cursor.sh/automations/webhook/fake', SUPPLIER_QUALIFICATION_KEY: 'crsr_FAKEKEYFORTESTING1234567890' };
const { createApp } = require('../server');
const realData = path.join(__dirname, '..', 'data'), snapOf = (d) => { try { return fs.readdirSync(d).filter((n) => !/^(sheet_snapshot|file_wants)\.json$/.test(n)).map((n) => n + ':' + fs.statSync(path.join(d, n)).mtimeMs).join('|'); } catch (e) { return 'none'; } } /* a running live app rewrites its own snapshot every 15 s; those two are checked for test data instead */, leaked = () => { try { return fs.readdirSync(realData).some((n) => /Acme Lifts|HOLD Co|Reject land|TESTSHEET|Mock_REQ/.test(fs.readFileSync(path.join(realData, n), 'utf8'))); } catch (e) { return false; } }, realBefore = snapOf(realData);
const results = []; let failed = 0;
const ok = (name, cond, evidence) => { results.push({ name, pass: !!cond }); if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (evidence ? '  -> ' + evidence : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return null; await sleep(40); } }

async function boot(env) { const ctx = createApp({ ...base, ...env }); ctx.core.start(); const srv = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); }); ctx.url = 'http://127.0.0.1:' + srv.address().port; ctx.srv = srv; return ctx; }
function client(ctx) {
  const c = { cookie: '' };
  c.req = async (m, p, body, extra = {}) => { const r = await fetch(ctx.url + p, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(m !== 'GET' ? { 'X-Requested-With': 'mf' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined }); const sc = r.headers.get('set-cookie'); if (sc && sc.includes('mf_session=') && !sc.includes('Max-Age=0')) c.cookie = sc.split(';')[0]; let j = null; try { j = await r.json(); } catch (_) {} return { s: r.status, j, h: r.headers }; };
  c.login = (u) => c.req('POST', '/api/login', { user: u, password: 'test-pass-123' });
  c.get = (p) => c.req('GET', p); c.post = (p, b) => c.req('POST', p, b);
  c.view = async (id) => (await c.get('/api/status/' + id)).j;
  c.wait = async (id, pred, ms) => until(async () => { const v = await c.view(id); return v && pred(v) ? v : null; }, ms);
  return c;
}
const sq = (name, extra = {}) => ({ agent_code: 'supplier_qualification', inputs: { supplier_name: name, category: 'Lifts', brochure_url: 'https://example.com/b.pdf', countries_served: 'India, UAE', ...extra } });

(async () => {
  const A = await boot({}); const r = client(A), h = client(A);

  console.log('\n== 1. Login and security ==');
  ok('no cookie: API gives 401', (await r.get('/api/cases')).s === 401);
  ok('no cookie: page redirects to /login', (await r.req('GET', '/')).s === 302);
  ok('wrong password refused', (await r.req('POST', '/api/login', { user: 'Rishabh', password: 'nope' })).s === 401);
  ok('unknown user refused', (await r.req('POST', '/api/login', { user: 'Mallory', password: 'test-pass-123' })).s === 401);
  ok('login without custom header blocked (CSRF guard)', (await fetch(A.url + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status === 403);
  const lg = await r.login('Rishabh'); ok('correct login works, cookie is HttpOnly + SameSite=Strict', lg.s === 200 && /HttpOnly/.test(lg.h.get('set-cookie')) && /SameSite=Strict/.test(lg.h.get('set-cookie')));
  const forged = client(A); forged.cookie = r.cookie.slice(0, -3) + 'abc'; ok('tampered cookie refused', (await forged.get('/api/cases')).s === 401);
  ok('POST without custom header blocked when signed in', (await fetch(A.url + '/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: r.cookie }, body: '{}' })).status === 403);
  const me = (await r.get('/api/me')).j; const meTxt = JSON.stringify(me);
  ok('/api/me exposes no key or address', !/crsr_|api2\.cursor|FAKEKEY|test-pass/.test(meTxt), 'desks_connected=' + JSON.stringify(me.desks_connected).slice(0, 80));
  const lk = client(A); let last; for (let i = 0; i < 6; i++) last = await lk.req('POST', '/api/login', { user: 'Hemant', password: 'bad' });
  ok('lockout after 5 wrong tries', last.s === 429);
  await h.login('Hemant').catch(() => {});
  A.core.stop(); A.srv.close();
  // fresh instance because the lockout is per IP
  const B = await boot({}); const R = client(B), Hm = client(B); await R.login('Rishabh'); await Hm.login('Hemant');
  ok('login again after restart (separate app copy, same sheet file)', (await R.get('/api/me')).s === 200 && (await Hm.get('/api/me')).s === 200);

  console.log('\n== 2. Supplier (uploaded = onboarded) > Product Book gate ==');
  ok('validation: missing fields give plain messages', await (async () => { const x = await R.post('/api/submit', { agent_code: 'supplier_qualification', inputs: { supplier_name: '' } }); return x.s === 400 && x.j.fields.supplier_name && x.j.fields.category; })());
  ok('validation: bad link refused', (await R.post('/api/submit', sq('Zed', { brochure_url: 'ftp://x' }))).s === 400);
  const s1 = (await R.post('/api/submit', sq('Acme Lifts'))).j; ok('submit returns request_id at once', /^REQ-\d{4}/.test(s1.request_id) && /^CASE-\d{4}/.test(s1.case_id), JSON.stringify(s1));
  const v1 = await R.wait(s1.request_id, (v) => v.status === 'needs approval');
  ok('uploaded supplier is onboarded (confirmed by you), next = Product Book, no approve click needed', v1 && v1.approved && v1.chip === 'Onboarded (confirmed by you)' && v1.can.next === 'product_book', v1 && v1.chip);
  const pb = (await R.post('/api/submit', { agent_code: 'product_book', parent_request_id: s1.request_id, inputs: { supplier_name: 'Acme Lifts', products: 'Lift A', brochure_url: 'https://e.com/x' } })).j;
  const pv = await R.wait(pb.request_id, (v) => v.status === 'needs approval'); ok('Product Book runs, same case, Book LIVE, file linked', pv && pv.outcome === 'Book LIVE' && pv.case_id === s1.case_id && /\.pdf$/.test(pv.output_link));
  ok('Product Book desk got the human confirmation', (() => { const x = B.sender.sent.find((p) => p.payload.request_id === pb.request_id); return x && x.payload.uploaded_supplier_confirmed === true && x.payload.parent.outcome === 'Onboard (confirmed by human)' && x.payload.inputs.supplier_status === 'Onboard (confirmed by human)'; })());
  const ap = (await Hm.post('/api/approve', { request_id: pb.request_id, decision: 'approve' })); ok('second user (Hemant) approves the book; answer is instant', ap.s === 200 && ap.j.ms < 1500, JSON.stringify(ap.j));
  ok('approving twice refused', (await R.post('/api/approve', { request_id: pb.request_id, decision: 'approve' })).s === 409);
  ok('audit trail shows who did what for the request', await (async () => { const e = (await R.get('/api/activity/' + pb.request_id)).j.events.map((x) => x.event + ':' + x.user); return ['submitted:Rishabh', 'webhook_sent:Rishabh', 'approved:Hemant'].every((k) => e.includes(k)); })());
  ok('approval saved to the sheet in the background', !!(await until(() => JSON.parse(fs.readFileSync(base.MOCK_SHEET_FILE)).Results.some((x) => x.request_id === pb.request_id && x.approval_state === 'approved'))));
  const pbw = (await R.post('/api/submit', { agent_code: 'product_book', parent_request_id: s1.request_id, inputs: { supplier_name: 'Acme Lifts', products: 'Lift B' } })).j;
  const pww = await R.wait(pbw.request_id, (v) => v.status === 'done'); ok('Book Waiting: chip Book waiting, Approve anyway offered (human override), resubmit allowed', pww && pww.outcome === 'Book Waiting' && pww.can.approve && pww.can.override && pww.held && pww.can.resubmit, pww && pww.chip);
  const nov = await R.post('/api/approve', { request_id: pbw.request_id, decision: 'approve' }); ok('Approve on a held result asks for the override first', nov.s === 409 && nov.j.needs_override === true);
  ok('Approve anyway works and is logged as human override', (await R.post('/api/approve', { request_id: pbw.request_id, decision: 'approve', override: true })).s === 200 && (await R.get('/api/activity/' + pbw.request_id)).j.events.some((e) => e.event === 'human_override'));

  console.log('\n== 3. Hold / Drop / Reject / Resubmit ==');
  const hold = (await R.post('/api/submit', sq('HOLD Co'))).j; const hv = await R.wait(hold.request_id, (v) => v.status === 'done');
  ok('desk said Hold for an uploaded supplier: still onboarded (human confirmation wins)', hv.outcome === 'Hold' && hv.approved && hv.chip === 'Onboarded (confirmed by you)', hv.chip);
  const hpb = await R.post('/api/submit', { agent_code: 'product_book', parent_request_id: hold.request_id, inputs: { supplier_name: 'HOLD Co', products: 'y', brochure_url: 'https://e.com/b' } }); ok('Hold supplier can start Product Book', hpb.s === 200);
  ok('Product Book payload maps Hold to "Onboard (confirmed by human)" and keeps the desk outcome for reference', await until(() => { const x = B.sender.sent.find((p) => p.payload.request_id === hpb.j.request_id); return x && x.payload.parent.outcome === 'Onboard (confirmed by human)' && x.payload.parent.original_desk_outcome === 'Hold' && x.payload.human_confirmation.desk_outcome_seen === 'Hold'; }));
  const same = await R.post('/api/submit', { ...sq('HOLD Co'), case_id: hold.case_id }); ok('Resubmit with identical content flagged as duplicate', same.s === 409 && same.j.duplicate_of === hold.request_id, same.j.error);
  const re = await R.post('/api/submit', { ...sq('HOLD Co', { brochure_url: 'https://e.com/new.pdf' }), case_id: hold.case_id, parent_request_id: hold.request_id }); ok('Resubmit with new info accepted in the same case', re.s === 200 && re.j.case_id === hold.case_id);
  const drop = (await R.post('/api/submit', sq('DROP Co'))).j; const dv = await R.wait(drop.request_id, (v) => v.status === 'done'); ok('Drop: chip Closed (Drop), no next step', dv.chip === 'Closed (Drop)' && !dv.approved && !dv.can.next);
  ok('Drop cannot start Product Book', (await R.post('/api/submit', { agent_code: 'product_book', parent_request_id: drop.request_id, inputs: { supplier_name: 'x', products: 'y' } })).s === 409);
  const rej = (await R.post('/api/submit', { agent_code: 'opportunity_finder', inputs: { region: 'Reject land', number_of_accounts: '2', focus: 'R' } })).j; await R.wait(rej.request_id, (v) => v.status === 'needs approval');
  ok('Reject recorded with name', (await Hm.post('/api/approve', { request_id: rej.request_id, decision: 'reject' })).j.approval_state === 'rejected' && (await R.view(rej.request_id)).chip === 'Rejected' && (await R.get('/api/activity/' + rej.request_id)).j.events.some((e) => e.event === 'rejected' && e.user === 'Hemant'));
  ok('Rejected target list cannot go to #2', (await R.post('/api/submit', { agent_code: 'advisory_gtm', parent_request_id: rej.request_id, inputs: {} })).s === 409);
  ok('Rejected request can be resubmitted unchanged (not a duplicate)', (await R.post('/api/submit', { agent_code: 'opportunity_finder', case_id: rej.case_id, inputs: { region: 'Reject land', number_of_accounts: '2', focus: 'R' } })).s === 200);

  console.log('\n== 4. Batch onboarding ==');
  const badB = await R.post('/api/submit-batch', { agent_code: 'supplier_qualification', items: [sq('B1').inputs, { supplier_name: 'B2' }] });
  ok('Batch with one bad line: nothing sent, line number shown', badB.s === 400 && badB.j.lines['2'], JSON.stringify(badB.j.lines));
  const bt = await R.post('/api/submit-batch', { agent_code: 'supplier_qualification', case_label: 'Batch client', items: ['B1', 'B2', 'HOLD B3', 'B4'].map((n) => sq(n).inputs) });
  const ids = bt.j.results.map((x) => x.request_id); ok('Batch of 4 creates 4 separate requests in one case', bt.s === 200 && new Set(ids).size === 4 && new Set(bt.j.results.map((x) => x.case_id)).size === 1, ids.join(','));
  for (const id of ids) await R.wait(id, (v) => ['needs approval', 'done'].includes(v.status));
  ok('Each batch item has its own outcome and own approval', (await Promise.all(ids.map((i) => R.view(i)))).map((v) => v.outcome).join() === 'Onboard,Onboard,Hold,Onboard');
  const bt2 = await R.post('/api/submit-batch', { agent_code: 'supplier_qualification', items: [sq('B1').inputs, sq('New5').inputs], case_id: bt.j.case_id });
  ok('Batch with a duplicate line: duplicate not sent, others sent (partial batch reported)', bt2.j.results[0].ok === false && bt2.j.results[1].ok === true, bt2.j.results[0].error);

  console.log('\n== 5. Target list > ranking (#2 with timeline) > intro packs > deal outline ==');
  let ib; const t = (await R.post('/api/submit', { agent_code: 'opportunity_finder', case_label: 'Retail India', inputs: { region: 'India', number_of_accounts: '5', focus: 'Lifts' } })).j; const tv = await R.wait(t.request_id, (v) => v.status === 'needs approval');
  ok('Target list ready', tv.outcome === 'Target list ready' && tv.output_link);
  ok('#2 blocked before list approved', (await R.post('/api/submit', { agent_code: 'advisory_gtm', parent_request_id: t.request_id, inputs: {} })).s === 409);
  await R.post('/api/approve', { request_id: t.request_id, decision: 'approve' });
  const g = (await R.post('/api/submit', { agent_code: 'advisory_gtm', parent_request_id: t.request_id, inputs: {} })).j;
  const gr = await R.wait(g.request_id, (v) => v.status === 'running'); ok('while running, partial timeline already visible', gr && gr.sub_agent_steps.length === 1 && gr.sub_agent_steps[0].status === 'running', gr && JSON.stringify(gr.sub_agent_steps));
  const gv = await R.wait(g.request_id, (v) => v.status === 'needs approval');
  ok('#2 timeline: signals, Matching Desk, then Relationship Manager', gv.behind.items.map((s) => s.name).join('|') === 'GTM signals|GTM Execution Matching Desk|Relationship Manager', JSON.stringify(gv.behind.items.map((s) => s.name)));
  ok('#2 per-account Pursue now / Keep warm shown in summary', /Pursue now/.test(gv.summary) && /Keep warm/.test(gv.summary));
  await Hm.post('/api/approve', { request_id: g.request_id, decision: 'approve' });
  ok('#3 refuses a Keep warm account', (await R.post('/api/submit', { agent_code: 'intro_desk', parent_request_id: g.request_id, inputs: { account: 'Beta Malls' } })).s === 409);
  ok('#2 desk and its helpers got the supplier confirmation (Matching Desk, Relationship Manager)', (() => { const x = B.sender.sent.find((p) => p.payload.request_id === g.request_id); if (!x) return false; const P = x.payload; return P.sub_agent_context.pass_to_every_helper === true && P.sub_agent_context.helpers.gtm_execution_matching.supplier_outcome === 'Onboard (confirmed by human)' && P.sub_agent_context.helpers.relationship_manager.uploaded_supplier_confirmed === true && /never treat it as hold/i.test(P.sub_agent_brief) && P.inputs.supplier_status === 'Onboard (confirmed by human)'; })());
  ok('#2 timeline shows Matching Desk + Relationship Manager with their files', gv.behind.items.length === 3 && gv.behind.items.some((x) => /Matching/.test(x.name) && /GTMMatching/.test(x.output_link)));
  const gf = (await R.get('/api/gtm-files/' + g.request_id)).j; ok('#2 files found by name (ranking, matching, relationship)', gf.files.LightPass && gf.files.GTMMatching && gf.files.RelationshipMap, JSON.stringify(gf.files));
  const tb = (await R.get('/api/table/' + gf.files.LightPass)).j; ok('table viewer reads the csv', tb.rows.length === 4 && tb.csv);
  ib = await R.post('/api/submit', { agent_code: 'intro_desk', parent_request_id: g.request_id, inputs: { account: 'Acme Retail\nCentral Infra' } });
  const iids = [ib.j.request_id]; await R.wait(iids[0], (v) => v.status === 'needs approval');
  ok('Intro packs: all Pursue now accounts in ONE request', ib.s === 200 && (await R.view(iids[0])).outcome === 'Intro packs awaiting approval');
  ok('#3 never batched (one request at a time per desk)', (await R.post('/api/submit-batch', { agent_code: 'intro_desk', parent_request_id: g.request_id, items: [{ account: 'Acme Retail' }] })).s === 400);
  ok('Deal Desk blocked: intro pack not approved', (await R.post('/api/submit', { agent_code: 'deal_desk', parent_request_id: iids[0], inputs: { account: 'Acme Retail', product: 'Lifts', soft_yes_note: 'Call 14 Oct', soft_yes_confirmed: true } })).s === 409);
  await R.post('/api/approve', { request_id: iids[0], decision: 'approve' });
  const noSoft = await R.post('/api/submit', { agent_code: 'deal_desk', parent_request_id: iids[0], inputs: { account: 'Acme Retail', product: 'Lifts', soft_yes_note: 'x', soft_yes_confirmed: false } }); ok('Deal Desk refused without a human-recorded soft yes', noSoft.s === 400 && noSoft.j.fields.soft_yes_confirmed);
  const d = (await R.post('/api/submit', { agent_code: 'deal_desk', parent_request_id: iids[0], inputs: { account: 'Acme Retail', product: 'Lifts', soft_yes_note: 'Call 14 Oct, said yes in principle', soft_yes_confirmed: true } })).j; const dv2 = await R.wait(d.request_id, (v) => v.status === 'needs approval');
  ok('Deal outline awaiting human close; approve button reads "Mark closed by a human"', dv2.outcome === 'Deal outline awaiting human close' && dv2.approve_label === 'Mark closed by a human');
  const mg = (await R.get('/api/merged/' + iids[0])).s; ok('Deal outline file linked and readable', /04_DealDesk_.+\.csv$/.test(dv2.output_link) && (await R.get('/api/table/' + decodeURIComponent(dv2.output_link.split('/').pop()))).j.rows.length === 2, 'merged status ' + mg);
  ok('Deal Desk payload still carries the supplier confirmation and the case so far', (() => { const x = B.sender.sent.find((p) => p.payload.request_id === d.request_id); return x && x.payload.uploaded_supplier_confirmed && x.payload.case_context.some((c) => c.agent_code === 'intro_desk'); })());
  ok('Intro for Keep-warm/unapproved never produced a deal; case chain all in one case', [t, g, ib.j, d].every((x) => (x.case_id || '') === '' || x.case_id === t.case_id) && (await R.view(d.request_id)).case_id === t.case_id);

  console.log('\n== 6. Duplicates ==');
  const o1 = { agent_code: 'opportunity_finder', inputs: { region: 'UAE', number_of_accounts: '3', focus: 'Pumps' } };
  const d1 = (await R.post('/api/submit', o1)).j; const d2 = await R.post('/api/submit', o1); ok('double click on the same case blocked? (new case => allowed; same case => blocked)', d2.s === 200);
  const d3 = await R.post('/api/submit', { ...o1, case_id: d1.case_id }); ok('same request in same case blocked with friendly text', d3.s === 409 && /Submit anyway/.test(d3.j.error));
  ok('"Submit anyway" works', (await R.post('/api/submit', { ...o1, case_id: d1.case_id, allow_duplicate: true })).s === 200);

  console.log('\n== 7. Agent error, partial result, retry limit ==');
  const f = (await R.post('/api/submit', sq('FAILAGENT Co'))).j; const fv = await R.wait(f.request_id, (v) => v.status === 'error'); ok('Agent error shown in plain words with Retry', fv.chip === 'Problem' && fv.error_message && fv.can.retry, fv.error_message);
  const rt = await R.post('/api/retry', { request_id: f.request_id }); ok('Retry makes a NEW request linked to the old, same case', rt.s === 200 && rt.j.request_id !== f.request_id && rt.j.case_id === f.case_id);
  ok('retry link and count recorded in the log', (await R.get('/api/activity/' + f.request_id)).j.events.some((e) => e.event === 'retry'));
  ok('retry not allowed while the first attempt is still fine', (await R.post('/api/retry', { request_id: s1.request_id })).s === 409);
  const p = (await R.post('/api/submit', { agent_code: 'opportunity_finder', inputs: { region: 'PARTIAL land', number_of_accounts: '10', focus: 'X' } })).j; const pv2 = await R.wait(p.request_id, (v) => v.status === 'needs approval');
  ok('Partial result: shown as partial with explanation, still approvable', pv2.partial && /Only 3/.test(pv2.error_message) && pv2.can.approve, pv2.summary);

  console.log('\n== 8. Webhook failure ==');
  let w = (await R.post('/api/submit', sq('WEBHOOKFAIL Co'))).j; let wv = await R.wait(w.request_id, (v) => v.status === 'error');
  ok('Webhook failure: request marked Problem with friendly message, in log', wv && /did not accept|simulated/i.test(wv.error_message) && (await R.get('/api/activity/' + w.request_id)).j.events.some((e) => e.event === 'webhook_failed'), wv && wv.error_message);
  let cur = w.request_id, n = 0; for (let i = 0; i < 4; i++) { const x = await R.post('/api/retry', { request_id: cur }); if (x.s !== 200) { n = i; break; } cur = x.j.request_id; await R.wait(cur, (v) => v.status === 'error'); n = i + 1; }
  ok('Retry limit: 3 retries then stop', n === 3, 'retries allowed=' + n);

  console.log('\n== 9. Timeout (agent never answers) ==');
  const sl = (await R.post('/api/submit', sq('SLOW Co'))).j; await sleep(1300);
  const sv = await R.wait(sl.request_id, (v) => v.delayed); ok('after wait limit: "Taking longer than usual", retry offered', sv && sv.chip.startsWith('Taking longer') && sv.can.retry);
  const sv2 = await R.wait(sl.request_id, (v) => v.stuck, 4000); ok('after timeout: "No answer"', sv2 && sv2.chip === 'No answer');
  const rs = await R.post('/api/retry', { request_id: sl.request_id }); ok('retry of a stuck request: old marked as not answered, new one created', rs.s === 200 && (await R.wait(sl.request_id, (v) => v.status === 'error')).error_message.includes('No answer'));

  console.log('\n== 10. Multi-case history and two users ==');
  const all = (await R.get('/api/cases')).j; const cs = new Set(all.requests.map((x) => x.case_id)); ok('many cases listed, each request has case, user, agent', cs.size >= 6 && all.requests.every((x) => x.case_id && x.submitted_by && x.agent_code), cs.size + ' cases, ' + all.requests.length + ' requests');
  const one = (await R.get('/api/cases/' + t.case_id)).j; ok('/api/cases/:id returns the whole chain for one case in order', one.requests.map((x) => x.agent_code).join() .includes('opportunity_finder'), one.requests.map((x) => x.agent_code).join('>'));
  ok('both users see each other\'s work (same sheet)', (await Hm.get('/api/cases')).j.requests.some((x) => x.submitted_by === 'Rishabh'));
  // two separate app copies (two Macs) writing to the same sheet at the same time
  const C = await boot({ MOCK_INLINE: '0' }); const C2 = client(C); await C2.login('Hemant');
  const burst = await Promise.all([...Array(8)].map((_, i) => (i % 2 ? R : C2).post('/api/submit', { agent_code: 'opportunity_finder', inputs: { region: 'Region ' + i, number_of_accounts: '2', focus: 'F' + i } })));
  const bid = burst.map((x) => x.j.request_id); await sleep(300);
  const sheetIds = JSON.parse(fs.readFileSync(base.MOCK_SHEET_FILE)).Requests.map((x) => x.request_id);
  ok('two app copies, 8 near-simultaneous submits: every request_id unique in the sheet', new Set(sheetIds).size === sheetIds.length, `${sheetIds.length} rows, ${new Set(sheetIds).size} unique`);
  C.core.stop(); C.srv.close();

  console.log('\n== 11. Sheet unreachable ==');
  B.sheet.__setFail(true); await until(async () => (await R.get('/api/cases')).j.sheet_ok === false, 5000);
  const dn = (await R.get('/api/cases')).j; ok('UI data says sheet is down but still shows the last known cases', dn.sheet_ok === false && dn.requests.length > 5 && /unreachable/i.test(dn.sheet_error));
  const dsub = await R.post('/api/submit', sq('During Outage')); ok('submit while sheet is down: refused plainly, nothing sent', dsub.s === 503 && /nothing was sent/.test(dsub.j.error), dsub.j.error);
  const apDown = await R.post('/api/approve', { request_id: dv2.request_id, decision: 'approve' }); ok('approve while sheet is down: answered at once, kept as a pending write (nothing lost)', apDown.s === 200 && fs.existsSync(path.join(base.DATA_DIR, 'pending_writes.json')) && /approved/.test(fs.readFileSync(path.join(base.DATA_DIR, 'pending_writes.json'), 'utf8')));
  B.sheet.__setFail(false); const rec = await until(async () => (await R.get('/api/cases')).j.sheet_ok === true); ok('sheet back: app recovers by itself', !!rec);
  ok('outage and recovery are in the log', (await R.get('/api/activity?n=500')).j.events.some((e) => e.event === 'sheet_error') && (await R.get('/api/activity?n=500')).j.events.some((e) => e.event === 'sheet_recovered'));
  ok('pending approval reaches the sheet once it is back', !!(await until(() => JSON.parse(fs.readFileSync(base.MOCK_SHEET_FILE)).Results.some((x) => x.request_id === dv2.request_id && x.approval_state === 'approved'), 15000)));

  console.log('\n== 12. Nothing unseen / client-safe ==');
  fs.writeFileSync(base.MOCK_SHEET_FILE, JSON.stringify((() => { const d = JSON.parse(fs.readFileSync(base.MOCK_SHEET_FILE)); d.Results.push({ request_id: 'REQ-9999', agent_code: 'deal_desk', status: 'done' }); return d; })()));
  ok('a result nobody requested is surfaced as unexpected', await until(async () => (await R.get('/api/cases')).j.orphans.some((o) => o.request_id === 'REQ-9999')));
  const u = require('../lib/util'); const sn = u.parseSteps(JSON.stringify([{ step: 'A', outcome: 'Score 87 out of 100', status: 'done' }, { step: 'B', outcome: 'Warm path available', status: 'done', score: 5 }, { outcome: 'no name' }]));
  ok('timeline hides score-like text and ignores extra keys', sn.length === 2 && sn[0].outcome === '' && sn[1].outcome === 'Warm path available' && !('score' in sn[1]));
  ok('invalid timeline JSON does not crash, hidden', u.parseSteps('{not json').length === 0 && u.parseSteps('').length === 0);

  console.log('\n== 13. Secrets and webhook format (no real call) ==');
  const sender = require('../lib/sender'); const calls = []; const realFetch = global.fetch;
  global.fetch = async (url, opt) => { calls.push({ url, opt }); return { ok: true, status: 202 }; };
  const live = sender.create({ ...base, WEBHOOK_MODE: 'live' });
  const lr = await live.send('supplier_qualification', { request_id: 'REQ-1', inputs: {} });
  ok('live format: POST, JSON, Authorization: Bearer <key> to the desk address only', lr.ok && calls.length === 1 && calls[0].opt.method === 'POST' && calls[0].opt.headers.Authorization === 'Bearer ' + base.SUPPLIER_QUALIFICATION_KEY && calls[0].opt.headers['Content-Type'] === 'application/json' && calls[0].url === base.SUPPLIER_QUALIFICATION_URL, '(fetch was stubbed: no network used)');
  const evil = sender.create({ ...base, WEBHOOK_MODE: 'live', SUPPLIER_QUALIFICATION_URL: 'https://evil.example.com/automations/webhook/x' }); calls.length = 0;
  ok('key never sent to a non-Cursor address', (await evil.send('supplier_qualification', {})).ok === false && calls.length === 0);
  const http_ = sender.create({ ...base, WEBHOOK_MODE: 'live', SUPPLIER_QUALIFICATION_URL: 'http://api2.cursor.sh/automations/webhook/x' }); ok('http (not https) refused', (await http_.send('supplier_qualification', {})).ok === false && calls.length === 0);
  global.fetch = async () => ({ ok: false, status: 401 }); ok('401 gives a friendly "rejected the key" message without the key', /rejected the key/.test((await live.send('supplier_qualification', {})).message));
  global.fetch = async () => { throw Object.assign(new Error('boom ' + base.SUPPLIER_QUALIFICATION_KEY), { name: 'Error' }); }; const lf = await live.send('supplier_qualification', {}); ok('network error message has the key scrubbed', !lf.message.includes('FAKEKEY'), lf.message);
  global.fetch = realFetch;
  const nodesc = (await live.send('product_book', {})); ok('desk with no address/key says so, sends nothing', nodesc.ok === false && /not connected/.test(nodesc.message));
  const logTxt = fs.readFileSync(path.join(base.LOG_DIR, 'audit.jsonl'), 'utf8') + fs.readFileSync(base.MOCK_SHEET_FILE, 'utf8');
  ok('audit log and sheet file contain no key, password or secret', !/FAKEKEY|test-pass-123|crsr_/.test(logTxt), logTxt.split('\n').length + ' log lines scanned');
  ok('startup refuses a missing/short password', (() => { try { createApp({ ...base, APP_PASSWORD: 'short' }); return false; } catch (e) { return true; } })());

  const gsFile = path.join(__dirname, '..', 'apps_script', 'Code.gs');
  if (!fs.existsSync(gsFile)) console.log('\n== 14. Apps Script bridge: SKIPPED (apps_script/Code.gs is not in this copy) ==');
  else {
  console.log('\n== 14. Apps Script bridge (Code.gs run against a fake sheet) ==');
  const store = { Requests: [], Results: [] }; const props = { SECRET: 'a-long-test-secret-phrase' };
  const mkSheet = (tab) => ({ getLastColumn: () => 12, getLastRow: () => store[tab].length + 1, appendRow: (a) => store[tab].push(a),
    getRange: (r, c, nr, nc) => ({ getValues: () => r === 1 ? [Object.keys(tab === 'Requests' ? { request_id: 1 } : {}).concat([])] : store[tab].slice(r - 2, r - 2 + nr).map((x) => { const z = x.slice(); while (z.length < nc) z.push(''); return z; }), setValue: (v) => { store[tab][r - 2][c - 1] = v; } }) });
  const sheets = { Requests: mkSheet('Requests'), Results: mkSheet('Results') };
  const sandbox = { ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 1 } }, LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }, PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) }, SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (t) => sheets[t] }) } };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps_script', 'Code.gs'), 'utf8'), sandbox);
  global.fetch = async (url, opt) => { const o = sandbox.doPost({ postData: { contents: opt.body } }); return { status: 200, json: async () => JSON.parse(o.s) }; };
  const aps = require('../lib/sheet/appsscript').create({ url: 'https://script.google.com/macros/s/FAKE/exec', secret: props.SECRET });
  await aps.ping(); await aps.appendRow('Requests', { request_id: 'REQ-0001', case_id: 'CASE-0001', agent_code: 'supplier_qualification', submitted_at: 't', submitted_by: 'R', inputs_json: '{}', parent_request_id: '', status: 'queued' });
  await aps.appendRow('Results', { request_id: 'REQ-0001', agent_code: 'supplier_qualification', status: 'done', summary: '=HYPERLINK("x")' });
  const rr = await aps.readTab('Requests'); const up = await aps.updateRow('Requests', { request_id: 'REQ-0001' }, { status: 'error' }); const miss = await aps.updateRow('Requests', { request_id: 'NOPE' }, { status: 'x' });
  ok('Code.gs: append, read, update by match, missing row returns false', rr.length === 1 && rr[0].case_id === 'CASE-0001' && up === true && miss === false && (await aps.readTab('Requests'))[0].status === 'error');
  ok('Code.gs: formula-looking text is stored as text', store.Results[0][4].startsWith("'="));
  const badAps = require('../lib/sheet/appsscript').create({ url: 'https://script.google.com/macros/s/FAKE/exec', secret: 'wrong-secret-xx' });
  ok('Code.gs: wrong secret refused', await badAps.ping().then(() => false, (e) => /Wrong secret/.test(e.message)));
  ok('adapter refuses a non-Google address', (() => { try { require('../lib/sheet/appsscript').create({ url: 'https://evil.com/x', secret: 'abc' }); return false; } catch (e) { return true; } })());
  global.fetch = realFetch;
  }

  console.log('\n== 15. Static UI files served only after login ==');
  const anon = client(B); ok('app.js not served without login', (await anon.req('GET', '/app.js')).s === 302);
  const jsr = await fetch(B.url + '/app.js', { headers: { Cookie: R.cookie } }); const jst = await jsr.text(); ok('app.js served after login and has no key/password text', jsr.status === 200 && !/crsr_|APP_PASSWORD/.test(jst));

  console.log('\n== 16. Idempotency, files, archive, hung sheet ==');
  const io = { agent_code: 'opportunity_finder', idem: 'k-' + Date.now(), inputs: { region: 'Idem', number_of_accounts: '2', focus: 'I' } };
  const [i1, i2] = await Promise.all([R.post('/api/submit', io), R.post('/api/submit', io)]); ok('double click (same idem key) creates ONE request', i1.s === 200 && i2.s === 200 && i1.j.request_id === i2.j.request_id);
  ok('/files: missing file gives 404 + state header, no crash', await (async () => { const x = await R.get('/files/Nope_V1.pdf'); return x.s === 404 && x.h.get('x-file-state'); })());
  ok('/files: path tricks refused', (await R.get('/files/..%2F..%2F.env')).s >= 400 && (await R.get('/files/x.sh')).s === 400);
  ok('late file: the link starts working once the file lands (no restart)', await (async () => { const lt = (await R.post('/api/submit', { agent_code: 'opportunity_finder', inputs: { region: 'LATEFILE land', number_of_accounts: '2', focus: 'L' } })).j; const v = await R.wait(lt.request_id, (x) => x.status === 'needs approval'); const u = v.output_link; const a1 = (await R.get(u)).s; const a2 = await until(async () => (await R.get(u)).s === 200, 8000); return a1 === 404 && a2; })());
  console.log('\n== 16b. v35: late-arriving files show up by themselves (main + helper, desk paths) ==');
  { const lt = (await R.post('/api/submit', { agent_code: 'opportunity_finder', inputs: { region: 'LATEFILE BOXPATH land', number_of_accounts: '2', focus: 'L2' } })).j;
    const v = await R.wait(lt.request_id, (x) => x.status === 'needs approval');
    ok('desk workspace paths become app links (main and helper desk)', v && /^\/files\/01_OpportunityFinder_/.test(v.output_link) && v.behind.items[0] && /^\/files\/Helper_/.test(v.behind.items[0].output_link), v && v.output_link + ' / ' + (v.behind.items[0] || {}).output_link);
    ok('result lists every file it names (main + helper), not ready yet', v && v.files.length === 2 && v.files.every((f) => f.ready === false && /^\/files\//.test(f.url)) && v.file_ready === false, v && JSON.stringify(v.files.map((f) => f.name + ':' + f.ready)));
    const c0 = (await R.get('/api/cases')).j.requests.find((x) => x.request_id === lt.request_id); ok('/api/cases carries the same file list (for the Files panel)', c0 && c0.files.length === 2 && c0.file_ready === false);
    const landed = await until(async () => { const c = (await R.get('/api/cases')).j.requests.find((x) => x.request_id === lt.request_id); return c && c.file_ready === true && c.files.every((f) => f.ready && f.size > 0) ? c : null; }, 8000);
    ok('once the files land, the next poll says ready (no restart, no chat needed)', !!landed);
    ok('and the files serve 200', landed && (await R.get(landed.output_link)).s === 200 && (await R.get(landed.files[1].url)).s === 200);
    ok('archived requests are left out of the file list', await (async () => { fs.mkdirSync(base.DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(base.DATA_DIR, 'archived.json'), JSON.stringify({ cases: [], requests: [lt.request_id], hidden_children: [] })); const gone = !(await R.get('/api/cases')).j.requests.some((x) => x.request_id === lt.request_id); fs.unlinkSync(path.join(base.DATA_DIR, 'archived.json')); return gone; })()); }
  { const ft = (await R.post('/api/submit', { agent_code: 'opportunity_finder', inputs: { region: 'FREETEXT land', number_of_accounts: '2', focus: 'F' } })).j;
    const v = await R.wait(ft.request_id, (x) => x.status === 'needs approval');
    ok('free-text output_link ("Account: /workspace/..xlsx (rows for ..); ..") still becomes the file link, once', v && /^\/files\/01_OpportunityFinder_[^/]+\.csv$/.test(v.output_link) && v.files.length === 1 && v.file_ready === true, v && v.output_link + ' files=' + v.files.length);
    const pl = B.sender.sent.filter((x) => x.payload.request_id === ft.request_id).pop(); const p = pl && pl.payload;
    ok('payload: request_id is the FIRST field, and also in this_request and inputs.request_id', p && Object.keys(p)[0] === 'request_id' && p.this_request.request_id === ft.request_id && p.inputs.request_id === ft.request_id && p.this_request.write_results_row_with_request_id === ft.request_id && p.inputs.request_id_note.includes(ft.request_id));
    ok('request_id in inputs is not saved to the sheet', !JSON.parse(fs.readFileSync(base.MOCK_SHEET_FILE)).Requests.some((x) => x.request_id === ft.request_id && /request_id_note|"request_id"/.test(String(x.inputs_json || x.inputs || '')))); }
  ok('Excel tables open without python: all sheets, the real table first', await (async () => { fs.copyFileSync(path.join(__dirname, 'fixtures', 'Sample_Workbook_V1.xlsx'), path.join(base.FILES_DIR, 'Sample_Workbook_V1.xlsx')); const t = (await R.get('/api/table/Sample_Workbook_V1')).j; return t && t.source === 'xlsx' && t.sheets.length === 2 && t.sheet === 'TAL' && t.sheets[0].rows[1][1] === 'Sample & <test>' && t.rows[2][0] === 'Acme Retail' && t.rows[3][3] === 'TRUE' && /\.xlsx$/.test(t.xlsx); })());
  fs.mkdirSync(base.DATA_DIR, { recursive: true }); fs.writeFileSync(path.join(base.DATA_DIR, 'archived.json'), JSON.stringify({ cases: [s1.case_id], requests: [], hidden_children: [] }));
  ok('archived case hidden from the case list', !(await R.get('/api/cases')).j.requests.some((x) => x.case_id === s1.case_id));
  fs.unlinkSync(path.join(base.DATA_DIR, 'archived.json'));
  ok('fresh install does not invent merges (merged.json not seeded)', !fs.existsSync(path.join(base.DATA_DIR, 'merged.json')));
  ok('relationship override saved app-side only', (await R.post('/api/rel-override', { key: 'acme retail|asha rao0', value: 'Warm lead' })).s === 200 && (await R.post('/api/rel-override', { key: 'x', value: 'Bogus' })).s === 400);
  const hv2 = (await R.get('/api/health')).j; ok('/api/health gives version + code hash (footer)', hv2.ok && hv2.version && /^[0-9a-f]{8}$/.test(hv2.code), hv2.version + ' ' + hv2.code);
  const idx = await fetch(B.url + '/', { headers: { Cookie: R.cookie } }).then((x) => x.text()); ok('cache busting: index.html points at app.js/style.css with a content hash', /app\.js\?v=[0-9a-f]{10}"/.test(idx) && /style\.css\?v=[0-9a-f]{10}"/.test(idx));
  { // v36: a supplier sent with "Start a new case" never lands in an older case
    const n1 = (await R.post('/api/submit', sq('Case Iso One'))).j, n2 = (await R.post('/api/submit', sq('Case Iso Two'))).j;
    const cs = (await R.get('/api/cases')).j.requests;
    ok('v36 new-case isolation: each new supplier gets its own fresh case id', n1.case_id && n2.case_id && n1.case_id !== n2.case_id && cs.every((x) => x.case_id) && cs.filter((x) => x.case_id === n2.case_id).length === 1, n1.case_id + ' / ' + n2.case_id);
  }
  B.core.stop(); B.srv.close();
  const Hng = await boot({ SHEET_READ_LIMIT_MS: '400', POLL_MS: '100' }); const hangReal = Hng.sheet.readTab; Hng.sheet.readTab = () => new Promise(() => {});
  await until(() => Hng.core.cache.ok === false, 4000); const hs = Hng.core.cache; ok('a sheet read that never answers is cut off; the app reports it and keeps polling', hs.ok === false && /too long/.test(hs.error), hs.error);
  Hng.sheet.readTab = hangReal; ok('and recovers by itself once the sheet answers again', !!(await until(() => Hng.core.cache.ok === true, 3000)));
  Hng.core.stop(); Hng.srv.close();
  ok('the real data/ folder was not touched by the tests', snapOf(realData) === realBefore && !leaked());
  console.log(`\n${results.length - failed}/${results.length} checks passed`); fs.writeFileSync(path.join(__dirname, 'last-run.txt'), results.map((x) => (x.pass ? 'PASS ' : 'FAIL ') + x.name).join('\n') + `\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
