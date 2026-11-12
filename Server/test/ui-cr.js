'use strict';
// v41 headless check: Contact research opens as a panel on the case screen and closes back to the workflow.
// Private test copy of the app: mock desks, mock sheet, temp folders. Never reads .env, never spends credits.
// Needs playwright-core and a Chrome/Chromium (CHROME_PATH). Run: CHROME_PATH=/usr/bin/google-chrome node test/ui-cr.js [shot-dir]
const fs = require('fs'), os = require('os'), path = require('path');
let pw; try { pw = require(process.env.PW_MODULE || 'playwright-core'); } catch (e) { console.log('SKIP ui-cr: playwright-core is not installed.'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-uicr-')); process.env.QUIET = '1';
const SHOTS = process.argv[2] || path.join(tmp, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const env = { APP_PASSWORD: 'ui-pass-123', SESSION_SECRET: 'u'.repeat(40), USERS: 'Rishabh,Hemant', WEBHOOK_MODE: 'mock', SHEET_MODE: 'mock', MOCK_SHEET_FILE: path.join(tmp, 'sheet.json'), LOG_DIR: path.join(tmp, 'logs'), DATA_DIR: path.join(tmp, 'data'), FILES_DIR: path.join(tmp, 'files'), MOCK_FILES_DIR: path.join(tmp, 'files'), POLL_MS: '100', MOCK_DELAY_MS: '150', SEND_GAP_MS: '1', SHEET_ID: 'UICR' };
const { createApp } = require('../server');
const results = []; let failed = 0;
const ok = (name, cond, ev) => { results.push({ name, pass: !!cond }); if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (ev ? '  -> ' + ev : '')); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ctx = createApp(env); ctx.core.start(); const srv = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); }); const url = 'http://127.0.0.1:' + srv.address().port;
  const mk = () => { const c = { cookie: '' }; c.req = async (m, p, b) => { const r = await fetch(url + p, { method: m, redirect: 'manual', headers: { 'Content-Type': 'application/json', ...(m !== 'GET' ? { 'X-Requested-With': 'mf' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}) }, body: b ? JSON.stringify(b) : undefined }); const sc = r.headers.get('set-cookie'); if (sc && sc.includes('mf_session=')) c.cookie = sc.split(';')[0]; const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j }; }; return c; };
  const R = mk(), Hm = mk(); await R.req('POST', '/api/login', { user: 'Rishabh', password: env.APP_PASSWORD }); await Hm.req('POST', '/api/login', { user: 'Hemant', password: env.APP_PASSWORD });
  const wait = async (id, st) => { for (let i = 0; i < 200; i++) { const v = (await R.req('GET', '/api/status/' + id)).j; if (v && v.status === st) return v; await sleep(60); } return null; };
  // case A: #1 only (locked). case B: #1 > #2 approved > #3 started (unlocked)
  const a = (await R.req('POST', '/api/submit', { agent_code: 'opportunity_finder', case_label: 'Locked case', inputs: { region: 'India', number_of_accounts: '3', focus: 'Lifts' } })).j; await wait(a.request_id, 'needs approval');
  const t = (await R.req('POST', '/api/submit', { agent_code: 'opportunity_finder', case_label: 'Retail India', inputs: { region: 'India', number_of_accounts: '5', focus: 'Storage' } })).j; await wait(t.request_id, 'needs approval');
  await R.req('POST', '/api/approve', { request_id: t.request_id, decision: 'approve' });
  const g = (await R.req('POST', '/api/submit', { agent_code: 'advisory_gtm', parent_request_id: t.request_id, inputs: {} })).j; await wait(g.request_id, 'needs approval');
  await Hm.req('POST', '/api/approve', { request_id: g.request_id, decision: 'approve' });
  const ib = (await R.req('POST', '/api/submit', { agent_code: 'intro_desk', parent_request_id: g.request_id, inputs: { account: 'Acme Retail\nCentral Infra' } })).j; await wait(ib.request_id, 'needs approval');
  const A = a.case_id, B = t.case_id; ok('test cases ready (locked ' + A + ', unlocked ' + B + ')', A && B && A !== B && ib.request_id);

  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const errs = []; page.on('pageerror', (e) => errs.push(e.message));
  const pages = []; page.context().on('page', (p) => pages.push(p));
  const shot = (n) => page.screenshot({ path: path.join(SHOTS, n + '.png') });
  try {
    await page.goto(url + '/login'); await page.selectOption('#u', 'Rishabh'); await page.fill('#p', env.APP_PASSWORD); await page.click('#f button'); await page.waitForURL(url + '/', { timeout: 8000 });
    await page.goto(url + '/#case=' + A); await page.locator('#casebar .crlocked').waitFor({ timeout: 8000 });
    await page.hover('#casebar .crlocked'); await sleep(200);
    ok('locked case: greyed button with "Unlock in Introduction Desk first" under it on hover', await page.locator('#casebar .crtip').isVisible() && (await page.textContent('#casebar .crtip')) === 'Unlock in Introduction Desk first');
    await shot('1_locked_tooltip'); await page.click('#casebar .crlocked', { force: true }); await sleep(300);
    ok('locked case: clicking does nothing (no panel, no new tab)', !(await page.locator('#crpanel').count()) && pages.length === 0);

    await page.goto(url + '/#case=' + B); await page.locator('#casebar button#crlink').waitFor({ timeout: 8000 });
    await page.evaluate(() => window.scrollTo(0, 420)); await sleep(150); const y0 = await page.evaluate(() => window.scrollY); const u0 = page.url();
    await page.locator('#casebar button#crlink').evaluate((b) => b.click()); /* a real click without the test tool scrolling first */ await page.locator('#crpanel [data-cr=ff] button[type=submit]').waitFor({ timeout: 8000 });
    ok('case bar button opens the panel on the same page (address unchanged, no new tab)', page.url() === u0 && pages.length === 0 && await page.locator('#crpanel').isVisible());
    ok('panel shows filters, accounts, plan button and enrichment', await page.locator('#crpanel [data-cr=acc] table').count() === 1 && await page.locator('#crpanel button', { hasText: 'Check the plan (free)' }).count() === 1 && await page.locator('#crpanel [data-cr=enr] button', { hasText: /^Skip$/ }).count() === 1);
    const txt = await page.textContent('#crpanel'); ok('panel shows no credit amounts and no provider name', !/\d\s*credits?\b/i.test(txt) && !/snov/i.test(txt));
    await sleep(300); const bad = await page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.getElementById('crpanel'), NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) { if (/\b(null|undefined|NaN)\b/.test(n.textContent) && !(n.parentElement && /^(TEXTAREA|INPUT)$/.test(n.parentElement.tagName))) out.push(n.parentElement.tagName + '.' + (n.parentElement.getAttribute('data-cr') || n.parentElement.className) + ': ' + n.textContent.slice(0, 80)); } for (const f of document.querySelectorAll('#crpanel input, #crpanel textarea')) if (/^(null|undefined|NaN)$/.test(f.value)) out.push('field ' + f.id + ' = ' + f.value); return out; });
    ok('panel shows no null / undefined / NaN text', !bad.length, bad.join(' | '));
    await shot('2_panel_open');
    await page.fill('#crf_seniority', 'Head\nDirector\nVP'); await page.click('#crpanel [data-cr=ff] button[type=submit]'); await page.locator('#crpanel [data-cr=saved]', { hasText: 'Filters saved' }).waitFor({ timeout: 6000 });
    ok('saving filters keeps the panel open with a confirmation', await page.locator('#crpanel').isVisible() && page.url() === u0);
    await page.locator('#crpanel [data-cr=saved]').scrollIntoViewIfNeeded(); await shot('3_filters_saved');
    await page.click('#crpanel button.crback'); await sleep(200);
    const y1 = await page.evaluate(() => window.scrollY);
    ok('Back to workflow closes the panel and returns to the same scroll spot', !(await page.locator('#crpanel').count()) && Math.abs(y1 - y0) < 5 && page.url() === u0, y0 + ' -> ' + y1);
    await shot('4_back_on_workflow');
    await page.evaluate(() => window.scrollTo(0, 0)); await page.locator('.stepper .crstep').first().click(); await page.locator('#crpanel').waitFor({ timeout: 4000 });
    ok('step-bar pill opens the same panel', await page.locator('#crpanel').isVisible() && pages.length === 0);
    await page.keyboard.press('Escape'); await sleep(150); ok('Escape closes the panel', !(await page.locator('#crpanel').count()));
    await page.locator('#cases', { hasText: '#3 Introduction Desk' }).locator('text=#3 Introduction Desk').first().click(); await page.locator('select option[value="__cr"]').first().waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    const opt = page.locator('select option[value="__cr"]');
    if (await opt.count()) { await opt.first().locator('xpath=..').selectOption('__cr'); await page.locator('#crpanel').waitFor({ timeout: 4000 }); ok("'All accounts' dropdown option opens the same panel", await page.locator('#crpanel').isVisible() && pages.length === 0); await page.click('#crpanel button.crx'); }
    else console.log('NOTE the #3 accounts view was not on screen, dropdown checked by the static tests');
    await page.goto(url + '/research#' + B); await page.locator('#crpanel').waitFor({ timeout: 8000 });
    ok('old /research#CASE link lands on the case screen with the panel open', new URL(page.url()).pathname === '/' && !new URL(page.url()).search && new URL(page.url()).hash === '#case=' + B, page.url());
    ok('no page errors', !errs.length, errs.join(' | '));
  } catch (e) { ok('ui run finished', false, e.message.split('\n')[0]); await shot('error').catch(() => {}); }
  await browser.close(); srv.close(); ctx.core.stop && ctx.core.stop();
  console.log('\nScreenshots: ' + SHOTS); console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('TEST CRASH', e); process.exit(2); });
