'use strict';
// Headless browser test of the whole flow, Supplier -> Product Book -> #1 -> #2 -> #3 -> #4 -> workflow complete.
// Runs a private test copy of the app: mock desks, mock sheet, temp data/files folders. It never reads .env, never calls a
// real desk, never touches the real sheet, data/ or files/. Needs playwright-core (npm i --no-save playwright-core) and a
// Chromium (npx playwright-core install chromium). Run: node test/e2e.js   (set PW_MODULE to a playwright-core path if needed)
const fs = require('fs'), os = require('os'), path = require('path');
let pw; try { pw = require(process.env.PW_MODULE || 'playwright-core'); } catch (e) { console.log('SKIP e2e: playwright-core is not installed (npm i --no-save playwright-core).'); process.exit(0); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-e2e-'));
process.env.QUIET = '1';
const env = { APP_PASSWORD: 'e2e-pass-123', SESSION_SECRET: 'y'.repeat(40), USERS: 'Rishabh,Hemant', WEBHOOK_MODE: 'mock', SHEET_MODE: 'mock', MOCK_SHEET_FILE: path.join(tmp, 'sheet.json'), LOG_DIR: path.join(tmp, 'logs'), DATA_DIR: path.join(tmp, 'data'), FILES_DIR: path.join(tmp, 'files'), MOCK_FILES_DIR: path.join(tmp, 'files'), POLL_MS: '300', MOCK_DELAY_MS: '300', SEND_GAP_MS: '1', SHEET_ID: 'E2E' };
const { createApp } = require('../server');
const results = []; let failed = 0;
const ok = (name, cond, ev) => { results.push({ name, pass: !!cond }); if (!cond) failed++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (ev ? '  -> ' + ev : '')); };
const sheetRows = () => JSON.parse(fs.readFileSync(env.MOCK_SHEET_FILE, 'utf8'));
(async () => {
  const ctx = createApp(env); ctx.core.start(); const srv = await new Promise((r) => { const s = ctx.app.listen(0, '127.0.0.1', () => r(s)); }); const url = 'http://127.0.0.1:' + srv.address().port;
  const browser = await pw.chromium.launch(); const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  page.on('dialog', (d) => { errs.push('native dialog: ' + d.message()); d.dismiss(); }); // no alert() boxes anywhere
  const shot = (n) => page.screenshot({ path: path.join(tmp, n + '.png'), fullPage: false }).catch(() => {});
  const T = (ms) => ({ timeout: ms || 15000 });
  const yes = async (label) => { await page.locator('.modal button', { hasText: label }).click(T(5000)); };
  const detail = page.locator('#detail');
  const waitChip = async (txt, ms) => { await detail.locator('.chip', { hasText: txt }).first().waitFor(T(ms || 20000)); };
  try {
    console.log('== Sign in ==');
    await page.goto(url + '/'); ok('signed-out visit goes to the sign-in page', /\/login$/.test(page.url()));
    await page.selectOption('#u', 'Rishabh'); await page.fill('#p', 'wrong'); await page.click('#f button'); await page.locator('#e', { hasText: 'Wrong' }).waitFor(T(5000)); ok('wrong password shows a plain message', true);
    await page.fill('#p', env.APP_PASSWORD); await page.click('#f button'); await page.waitForURL(url + '/', T(8000));
    await page.locator('#ver', { hasText: 'Mettalfold app' }).waitFor(T(8000)); ok('version footer shows version and code', /Mettalfold app .+ · code [0-9a-f]{8}/.test(await page.textContent('#ver')), await page.textContent('#ver'));
    const html = await page.content(); ok('cache busting: assets loaded with content hash', /app\.js\?v=[0-9a-f]{10}/.test(html));

    console.log('== Supplier ==');
    const form = page.locator('#form');
    await form.locator('button[type=submit]').click(); await page.locator('[data-e=supplier_name]', { hasText: 'Please fill in' }).waitFor(T(5000)); ok('empty submit: field errors shown, nothing sent', !fs.existsSync(env.MOCK_SHEET_FILE) || sheetRows().Requests.length === 0);
    await form.locator('[name=supplier_name]').fill('E2E Batteries'); await form.locator('[name=category]').fill('Battery storage'); await form.locator('[name=brochure_url]').fill('https://example.com/b.pdf'); await form.locator('[name=countries_served]').fill('India, UAE'); await form.locator('[name=case_label]').fill('E2E client');
    const sb = form.locator('button[type=submit]'); const t0 = Date.now();
    await Promise.all([sb.click(), sb.click({ force: true }).catch(() => {}), sb.click({ force: true }).catch(() => {})]);
    await page.locator('#recv, #detail').first().waitFor(T(3000)); ok('instant feedback after Submit (under 1 s)', Date.now() - t0 < 1500, (Date.now() - t0) + ' ms');
    await waitChip('Onboarded (confirmed by you)'); ok('triple click made ONE supplier request', sheetRows().Requests.filter((r) => r.agent_code === 'supplier_qualification').length === 1);
    ok('detail shows breadcrumb with Cases link', await detail.locator('.crumbs a', { hasText: 'Cases' }).count() === 1);
    ok('global stepper shows the case and stage 1 done', await page.locator('#gstep .st.done').count() >= 1);
    await shot('01-supplier');
    await detail.locator('button', { hasText: 'Next step: go to Product Book Creator' }).click(T(8000));
    ok('Next step opens the Product Book form, pre-filled', (await form.locator('[name=supplier_name]').inputValue()) === 'E2E Batteries' && (await page.locator('#desks button.on').textContent()) === 'Product Book Creator');

    console.log('== Product Book ==');
    await form.locator('[name=products]').fill('Rack battery 100 kWh'); await form.locator('button[type=submit]').click();
    await waitChip('Needs your approval', 25000);
    await detail.locator('iframe').waitFor(T(10000)); ok('booklet PDF shows inside the app', (await detail.locator('iframe').getAttribute('src')).endsWith('.pdf'));
    const pbSent = ctx.sender.sent.filter((x) => x.code === 'product_book').pop(); ok('Product Book desk was told the supplier is onboarded (confirmed by human)', pbSent && pbSent.payload.parent.outcome === 'Onboard (confirmed by human)');
    ok('Reject and Ask for changes always offered next to Approve', await detail.locator('button.bad', { hasText: 'Reject' }).count() === 1 && await detail.locator('.revise textarea').count() === 1);
    await shot('02-book');
    let tA = Date.now(); await detail.locator('button.good', { hasText: 'Approve booklet' }).click(); await yes('Yes, approve');
    await page.locator('#desks button.on', { hasText: '#1 Opportunity Finder' }).waitFor(T(4000)); const navMs = Date.now() - tA;
    ok('Approve moves to the #1 form by itself, fast', navMs < 3000, navMs + ' ms');
    ok('#1 form pre-filled (focus from the book)', /E2E Batteries/.test(await form.locator('[name=focus]').inputValue()));

    console.log('== #1 Opportunity Finder ==');
    await form.locator('button[type=submit]').click(); await waitChip('Needs your approval', 25000);
    await detail.locator('table.sheet').waitFor(T(10000)); ok('target list shows as a table with downloads', await detail.locator('.tblbar a', { hasText: 'Download CSV' }).count() >= 1);
    tA = Date.now(); await detail.locator('button.good', { hasText: 'Approve target list' }).click(); await yes('Yes, approve'); await page.locator('#desks button.on', { hasText: '#2 Advisory GTM' }).waitFor(T(4000)); ok('Approve moves to the #2 form', Date.now() - tA < 3000, (Date.now() - tA) + ' ms');

    console.log('== #2 Advisory GTM ==');
    await form.locator('button[type=submit]').click(); await waitChip('Needs your approval', 25000);
    await detail.locator('.bcard').nth(2).waitFor(T(10000)); const cards = await detail.locator('.bcard .bhead b').allTextContents();
    ok('Behind the scenes: signals, Matching Desk, Relationship Manager', cards.some((c) => /Matching/.test(c)) && cards.some((c) => /Relationship/.test(c)), cards.join(' | '));
    await detail.locator('.bcard button', { hasText: 'Open view' }).first().click(); await detail.locator('.bcard table.sheet').first().waitFor(T(8000)); ok('helper file opens inside the app', true);
    const gtmSent = ctx.sender.sent.filter((x) => x.code === 'advisory_gtm').pop().payload;
    ok('#2 helpers get the human supplier confirmation (not Hold)', gtmSent.sub_agent_context.helpers.gtm_execution_matching.supplier_outcome === 'Onboard (confirmed by human)' && gtmSent.sub_agent_context.helpers.relationship_manager.supplier_outcome === 'Onboard (confirmed by human)' && gtmSent.case_context.find((c) => c.agent_code === 'supplier_qualification').outcome === 'Onboard (confirmed by human)');
    await shot('03-gtm');
    await detail.locator('button.good', { hasText: 'Confirm Pursue now accounts' }).click(); await yes('Yes, approve'); await page.locator('#desks button.on', { hasText: '#3 Introduction Desk' }).waitFor(T(4000));
    ok('#3 form pre-filled with only the Pursue now accounts', (await form.locator('[name=account]').inputValue()) === 'Acme Retail\nCentral Infra', JSON.stringify(await form.locator('[name=account]').inputValue()));

    console.log('== #3 Introduction Desk ==');
    await form.locator('button[type=submit]').click(); await waitChip('Needs your approval', 25000);
    await detail.locator('h3', { hasText: 'Lead view' }).waitFor(T(12000)); ok('#3 lead view with prospects', await detail.locator('table.sheet tbody tr').count() >= 4);
    ok('relationship chips shown (derived from the #2 relationship map)', await detail.locator('.vchip', { hasText: 'Existing contact' }).count() >= 1);
    await detail.locator('select.relsel').first().selectOption('Warm lead'); await page.waitForTimeout(400); ok('relationship can be set by hand (saved app-side)', fs.existsSync(path.join(env.DATA_DIR, 'relationship_overrides.json')));
    const noOverflow = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    ok('#3 page does not overflow sideways', await noOverflow());
    await shot('04-intro');
    await detail.locator('button.good', { hasText: 'Approve this intro pack' }).click(); await yes('Yes, approve');
    await page.locator('#dealscreen h3', { hasText: 'Pick contacts' }).waitFor(T(6000)); ok('Approve #3 opens the Deal Desk contact picker', true);

    console.log('== #4 Deal Desk ==');
    const ds = page.locator('#dealscreen'); const ticked = await ds.locator('.cpick input[type=checkbox]:checked').count();
    ok('a suggested pair is pre-ticked (one per account)', ticked === 2, ticked + ' ticked');
    ok('review table lists the picked contacts', await ds.locator('.review tbody tr').count() === 2);
    await ds.locator('.cpick input[type=checkbox]').first().uncheck(); ok('unticking updates the review at once', await ds.locator('.review tbody tr').count() === 1);
    await ds.locator('.cpick select').nth(1).selectOption('Booked').catch(() => {});
    ok('Deal Desk screen does not overflow sideways', await noOverflow());
    await shot('05-dealpick');
    await ds.locator('button.big', { hasText: 'Start Deal Desk' }).click(); await yes('Yes, send');
    await waitChip('Needs your approval', 25000);
    const dealSent = ctx.sender.sent.filter((x) => x.code === 'deal_desk').pop().payload;
    ok('Deal Desk product comes from this case (not a hard-coded one)', /Mock Product|E2E Batteries/.test(dealSent.inputs.product) && !/Wetown/.test(dealSent.inputs.product), dealSent.inputs.product);
    await detail.locator('.ocard').first().waitFor(T(10000)); ok('deal outline cards shown', await detail.locator('.ocard').count() === 1);
    await detail.locator('button.good', { hasText: 'Mark closed by a human' }).click(); await yes('Yes, approve');
    await page.locator('#dealscreen h2', { hasText: 'Workflow complete' }).waitFor(T(6000)); ok('workflow-complete screen after the last approval', true);
    await shot('06-complete');
    ok('all six stages done in the stepper', await page.locator('#dealscreen .stepper .st.done').count() === 6);
    await page.locator('#dealscreen button', { hasText: 'Back to cases' }).click();

    console.log('== Stepper, breadcrumb, versions, reject, late file, held, update banner ==');
    await page.locator('#gstep .st', { hasText: 'Opportunity Finder' }).click(); await detail.locator('h2', { hasText: '#1 Opportunity Finder' }).waitFor(T(5000)); ok('clickable stepper opens that stage', true);
    await detail.locator('.crumbs .back a').click(); await detail.locator('h2', { hasText: 'Product Book Creator' }).waitFor(T(5000)); ok('breadcrumb "Previous stage" works', true);
    await detail.locator('.revise textarea').fill('Darker blue cover please'); await detail.locator('.revise button', { hasText: 'Send changes' }).click();
    await detail.locator('.actions b', { hasText: 'Versions' }).waitFor(T(20000)); ok('Ask for changes makes v2 and shows versions', await detail.locator('.actions button', { hasText: 'v2' }).count() === 1);
    const pbSent2 = ctx.sender.sent.filter((x) => x.code === 'product_book').pop().payload; ok('revision reaches the desk with feedback + confirmation', pbSent2.revision && /Darker blue/.test(pbSent2.revision.feedback) && pbSent2.uploaded_supplier_confirmed === true);
    // new case: #1 reject
    await page.locator('#desks button', { hasText: '#1 Opportunity Finder' }).click(); await form.locator('[name=region]').fill('LATEFILE BOXPATH land'); await form.locator('[name=number_of_accounts]').fill('3'); await form.locator('[name=focus]').fill('Late files'); await form.locator('button[type=submit]').click();
    await waitChip('Needs your approval', 25000); const note = await detail.locator('p.filenote').count();
    const cfWait = await detail.locator('.casefiles .cfrow.wait').count(), tLate = Date.now();
    await detail.locator('.casefiles .cfrow:not(.wait) a', { hasText: 'Download' }).nth(1).waitFor(T(15000)); const lateMs = Date.now() - tLate;
    ok('v35 Files panel: main + helper file shown as on its way, then Open/Download appear by themselves', cfWait === 2 && await detail.locator('.casefiles .cfrow.wait').count() === 0 && await detail.locator('.casefiles a', { hasText: 'Open' }).count() >= 2, 'waiting first=' + cfWait + ', ready after ' + lateMs + ' ms');
    await detail.locator('.casefiles').scrollIntoViewIfNeeded().catch(() => {}); await shot('08-files');
    ok('v35 Files panel download links point at app files', (await detail.locator('.casefiles a[download]').first().getAttribute('href')).startsWith('/files/'));
    await detail.locator('.bcard button', { hasText: 'Open view' }).first().waitFor(T(8000)); ok('v35 helper desk file (desk workspace path) opens inside the app once it lands', true);
    await detail.locator('table.sheet').waitFor(T(20000)); ok('late file: grey note first, then the table appears by itself (no waiting box)', note === 1 && await detail.locator('.filenote').count() === 0 && await page.locator('text=Waiting for the file').count() === 0, 'note first=' + note);
    await detail.locator('button.bad', { hasText: 'Reject' }).click(); await yes('Yes, reject'); await page.locator('.toast', { hasText: 'Rejected' }).waitFor(T(5000));
    ok('Reject reopens the form filled in from that result', (await form.locator('[name=region]').inputValue()) === 'LATEFILE BOXPATH land');
    // held book -> Approve anyway
    const sqid = sheetRows().Requests.find((r) => r.agent_code === 'supplier_qualification').request_id;
    await page.locator('#desks button', { hasText: 'Product Book Creator' }).click(); await form.locator('[name=parent_request_id]').selectOption(sqid); await form.locator('[name=supplier_name]').fill('E2E Batteries'); await form.locator('[name=products]').fill('No brochure item'); await form.locator('[name=brochure_url]').fill(''); await form.locator('button[type=submit]').click();
    await waitChip('Book waiting', 25000); ok('held result still offers Approve anyway', await detail.locator('button.good', { hasText: 'Approve anyway' }).count() === 1);
    await detail.locator('button.good', { hasText: 'Approve anyway' }).click(); await yes('Yes, approve anyway'); await page.locator('#desks button.on', { hasText: '#1 Opportunity Finder' }).waitFor(T(4000)); ok('Approve anyway moves on to the next stage', true);
    // error toast: duplicate submit
    await page.locator('#desks button', { hasText: 'Supplier Qualification' }).click(); const fm = page.locator('#form');
    await fm.locator('[name=case_id]').selectOption({ index: 1 }); await fm.locator('[name=supplier_name]').fill('E2E Batteries'); await fm.locator('[name=category]').fill('Battery storage'); await fm.locator('[name=brochure_url]').fill('https://example.com/b.pdf'); await fm.locator('[name=countries_served]').fill('India, UAE'); await fm.locator('button[type=submit]').click();
    await page.locator('.toast.err').waitFor(T(6000)); ok('duplicate submit: red error toast + "Submit anyway" + "Open" buttons', await page.locator('#formerr button', { hasText: 'Submit anyway' }).count() === 1 && await page.locator('#formerr button', { hasText: 'Open REQ-' }).count() === 1);
    console.log('== v36 one case at a time ==');
    const oldCase = sheetRows().Requests.find((r) => r.agent_code === 'supplier_qualification').case_id;
    await page.locator('#newcase').click(); await page.locator('#caseempty').waitFor(T(5000));
    ok('v36 Start a new case: stepper back to stage 1, nothing done', await page.locator('#gstep .st.done').count() === 0 && await page.locator('#gstep .st').first().evaluate((x) => x.classList.contains('now')), await page.textContent('#gstep .gcase'));
    ok('v36 Start a new case: right side empty (no old rows, banner or files)', await page.locator('#cases .row').count() === 0 && await page.locator('.wfbanner').count() === 0 && await page.locator('.casefiles').count() === 0 && !(await detail.isVisible()));
    { const dbg = [await page.locator('#desks button.on').textContent(), await form.locator('[name=supplier_name]').inputValue(), await form.locator('[name=case_label]').inputValue(), await form.locator('[name=case_id]').inputValue()]; ok('v36 Start a new case: Supplier form is empty, nothing pre-filled from the old case', /^Supplier Qualification/.test(dbg[0]) && dbg.slice(1).every((x) => x === ''), JSON.stringify(dbg)); }
    await form.locator('[name=supplier_name]').fill('Isolation Co'); await form.locator('[name=category]').fill('Cooling'); await form.locator('[name=brochure_url]').fill('https://example.com/iso.pdf'); await form.locator('[name=countries_served]').fill('India'); await form.locator('[name=case_label]').fill('Test'); await form.locator('button[type=submit]').click();
    await waitChip('Onboarded (confirmed by you)');
    const newCase = sheetRows().Requests.find((r) => r.inputs_json ? /Isolation Co/.test(r.inputs_json) : /Isolation Co/.test(JSON.stringify(r))).case_id;
    await page.waitForTimeout(800);
    const caseH = await page.locator('#cases .case h3').allTextContents();
    ok('v36 new case: list shows ONLY the new case', newCase !== oldCase && caseH.length === 1 && caseH[0].startsWith(newCase), caseH.join(' | '));
    ok('v36 new case: top stepper shows the new case at stage 1 done only', (await page.textContent('#gstep .gcase')).includes(newCase) && await page.locator('#gstep .st.done').count() === 1);
    ok('v36 case menu lists the old case under Past cases', await page.locator('#casepick optgroup[label="Past cases"] option[value="' + oldCase + '"]').count() === 1);
    await page.reload(); await page.locator('#casepick').waitFor(T(8000)); await page.waitForTimeout(800);
    ok('v36 selected case survives a refresh (URL + saved choice)', (await page.inputValue('#casepick')) === newCase && page.url().endsWith('#case=' + newCase) && (await page.locator('#cases .case h3').allTextContents()).length === 1);
    await page.selectOption('#casepick', oldCase); await page.locator('#cases .case h3', { hasText: oldCase }).waitFor(T(5000));
    ok('v36 switch to a past case: only that case, with a "past case" note', (await page.locator('#cases .case h3').allTextContents()).length === 1 && await page.locator('.pastnote').count() === 1 && (await page.textContent('#gstep .gcase')).includes(oldCase));
    await page.locator('#cases .row:not(.dealrow)').first().click(); await detail.locator('.casefiles').waitFor(T(8000));
    ok('v36 past case: results and its Files panel open', (await detail.locator('.casefiles summary').textContent()).includes(oldCase));
    await page.locator('.pastnote a').click(); await page.locator('#cases .case h3', { hasText: newCase }).waitFor(T(5000));
    ok('v36 Back to the active case returns to the new case', (await page.inputValue('#casepick')) === newCase && await page.locator('.pastnote').count() === 0);
    ok('v36 activity log labels case ids', /CASE-\d{4}/.test(await page.textContent('#feed')));
    await shot('09-cases');
    // update banner (simulated new code)
    await page.route('**/api/health', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, version: 'v99', code: 'ffffffff' }) }));
    await page.evaluate(() => checkVersion()); await page.locator('#upd', { hasText: 'new version' }).waitFor(T(5000)); ok('open tab offers "Refresh now" when a new version is installed', true);
    await page.unroute('**/api/health');
    // fast clicking between requests never shows the wrong one
    const rows = page.locator('#cases .row:not(.dealrow)'); const n = await rows.count(); for (let i = 0; i < Math.min(n, 6); i++) await rows.nth(i).click(); await page.waitForTimeout(1500);
    const selTxt = await page.locator('#cases .row.sel').first().textContent().catch(() => ''); const head = await detail.locator('h2').first().textContent();
    ok('rapid clicks: the detail shows the last request clicked', !!selTxt && selTxt.includes(head.split(' · ').pop()), head);
    await page.setViewportSize({ width: 820, height: 900 }); await page.waitForTimeout(400); ok('narrow window (820 px): no sideways overflow', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)); await shot('07-narrow');
    ok('no page errors and no alert() boxes during the whole run', errs.length === 0, errs.slice(0, 3).join(' | '));
    ok('no real data touched: only temp folders used', fs.existsSync(path.join(env.DATA_DIR)) && !fs.existsSync(path.join(__dirname, '..', 'data', 'mock-sheet.json')));
  } catch (e) { failed++; console.log('FAIL e2e crashed: ' + e.message.split('\n')[0]); console.log('page errors: ' + errs.join(' | ')); await shot('crash'); }
  await browser.close(); ctx.core.stop(); srv.close();
  console.log(`\n${results.length - failed}/${results.length} e2e checks passed (screenshots in ${tmp})`);
  fs.writeFileSync(path.join(__dirname, 'last-e2e.txt'), results.map((x) => (x.pass ? 'PASS ' : 'FAIL ') + x.name).join('\n') + `\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed ? 1 : 0);
})();
