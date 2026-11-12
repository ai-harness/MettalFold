'use strict';
// Fake desk for testing without real agents. Writes Results rows the way a real desk would.
// Trigger words inside the inputs: HOLD, DROP, FAILAGENT (agent error), SLOW (never answers), PARTIAL (partial result), WEBHOOKFAIL (send fails).
const now = () => new Date().toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fs = require('fs'), path = require('path');
// Optional: with MOCK_FILES_DIR set, the fake desks also write output files (csv / pdf) the way the real desks do,
// so every viewer in the app can be tested. LATEFILE in the inputs writes the file 3 s after the result (file arrives late).
const csv = (rows) => rows.map((r) => r.map((c) => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c)).join(',')).join('\n') + '\n';
const PDF = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n';
function filesFor(req) {
  const stem = 'Mock_' + req.request_id.replace(/[^A-Za-z0-9-]/g, ''), A = ['Acme Retail', 'Beta Malls', 'Central Infra'];
  switch (req.agent_code) {
    case 'product_book': return { link: '10_SupplierProductBook_' + stem + '_Booklet_V1.pdf', files: { ['10_SupplierProductBook_' + stem + '_Booklet_V1.pdf']: PDF } };
    case 'opportunity_finder': return { link: '01_OpportunityFinder_' + stem + '_TAL_V1.csv', files: { ['01_OpportunityFinder_' + stem + '_TAL_V1.csv']: csv([['account', 'country', 'website', 'linkedin', 'source_url'], ...A.map((a) => [a, 'India', 'https://example.com', 'https://www.linkedin.com/company/x', 'https://example.com/src'])]) } };
    case 'advisory_gtm': return { link: '02_AdvisoryGTM_' + stem + '_LightPass_V1.csv', files: {
      ['02_AdvisoryGTM_' + stem + '_LightPass_V1.csv']: csv([['company', 'country', 'segment', 'client_status', 's4_timing', 'one_line_brief'], ['Acme Retail', 'India', 'Retail', 'Pursue now', 'Q1', 'Expanding'], ['Beta Malls', 'India', 'Malls', 'Keep warm', 'Q3', 'Budget later'], ['Central Infra', 'India', 'Infra', 'Pursue now', 'Q1', 'Warm path']]),
      ['02_AdvisoryGTM_' + stem + '_GTMMatching_V1.csv']: csv([['account', 'supplier', 'product_pitched', 'keep_or_drop', 'fit_note', 'open_gaps'], ...A.map((a) => [a, 'Mock Supplier', 'Mock Product', 'keep', 'Good fit', 'none'])]),
      ['02_AdvisoryGTM_' + stem + '_RelationshipMap_V1.csv']: csv([['company', 'country', 'worked_with_us_before', 'hypothetical_warm_signals', 'decision_makers_by_role', 'verification_status'], ['Acme Retail', 'India', 'yes', 'Board link', 'CEO', 'verified'], ['Beta Malls', 'India', 'no', '', 'COO', 'unverified'], ['Central Infra', 'India', 'unknown', '', 'CTO', 'unverified']]) } };
    case 'intro_desk': { const acc = String((req.inputs && req.inputs.account) || 'Acme Retail').split(/[\n;]+/).map((x) => x.trim()).filter(Boolean);
      return { link: '03_IntroDesk_' + stem + '_Prospects_V1.csv', files: { ['03_IntroDesk_' + stem + '_Prospects_V1.csv']: csv([['account', 'prospect_name', 'title_role', 'linkedin_url', 'email', 'email_verification', 'found_status', 'supplier', 'product_book_used', 'supplier_fit', 'status'], ...acc.flatMap((a, i) => [[a, 'Asha Rao' + i, 'Director Projects', 'https://www.linkedin.com/in/x' + i, 'asha' + i + '@example.com', 'verified', 'found', 'Mock Supplier', 'Mock Book', 'strong', 'nominated'], [a, 'Vikram Shah' + i, 'Head Procurement', '', '', 'unverified', 'found', 'Mock Supplier', 'Mock Book', 'good', 'nominated']])]) } }; }
    case 'deal_desk': return { link: '04_DealDesk_' + stem + '_Outline_V1.csv', files: { ['04_DealDesk_' + stem + '_Outline_V1.csv']: csv([['account', 'contact', 'supplier', 'product', 'ladder_rung_draft', 'why_this_deal', 'paper_path', 'open_questions', 'human_next_steps', 'outline_status'], ['Acme Retail', 'Asha Rao0', 'Mock Supplier', 'Mock Product', 'pilot', 'Expanding', 'PO', 'Volumes?', 'Human calls', 'draft']]) } };
    default: return null;
  }
}
function writeFiles(dir, f) { if (!dir || !f) return; fs.mkdirSync(dir, { recursive: true }); for (const [n, body] of Object.entries(f.files)) fs.writeFileSync(path.join(dir, n), body); }
async function put(sheet, row) {
  const ok = await sheet.updateRow('Results', { request_id: row.request_id }, row);
  if (!ok) await sheet.appendRow('Results', row);
}
function finalRow(req) {
  const t = JSON.stringify(req.inputs || {}).toUpperCase();
  const base = { request_id: req.request_id, agent_code: req.agent_code, needs_approval: 'yes', approval_state: 'pending', error_message: '', sub_agent_steps: '[]', output_link: '', updated_at: now() };
  const n = (req.inputs && req.inputs.number_of_accounts) || 5;
  switch (req.agent_code) {
    case 'supplier_qualification':
      if (t.includes('DROP')) return { ...base, status: 'done', outcome: 'Drop', summary: 'Does not meet the category and standards bar.', next_step: 'No further action.', needs_approval: 'no', approval_state: '' };
      if (t.includes('HOLD')) return { ...base, status: 'done', outcome: 'Hold', summary: 'Missing items: brochure, standards certificates.', next_step: 'Resubmit with the missing items.', needs_approval: 'no', approval_state: '' };
      return { ...base, status: 'needs approval', outcome: 'Onboard', summary: 'Strong fit for the category and regions.', next_step: 'Human confirms Onboard.' };
    case 'product_book':
      if (!(req.inputs && req.inputs.brochure_url)) return { ...base, status: 'done', outcome: 'Book Waiting', summary: 'Still needed: brochure link, product specifications.', next_step: 'Resubmit when the items arrive.', needs_approval: 'no', approval_state: '' };
      return { ...base, status: 'needs approval', outcome: 'Book LIVE', summary: 'Booklet drafted.', next_step: 'Human reviews the booklet.', output_link: 'https://example.com/booklet' };
    case 'opportunity_finder':
      if (t.includes('PARTIAL')) return { ...base, status: 'needs approval', outcome: 'Target list ready', summary: `Found 3 of ${n} accounts.`, next_step: 'Human approves the list, or resubmit for the rest.', error_message: 'Only 3 of the requested accounts had public sources.', output_link: 'https://example.com/targets' };
      return { ...base, status: 'needs approval', outcome: 'Target list ready', summary: `${n} accounts found with sources.`, next_step: 'Human approves the list.', output_link: 'https://example.com/targets' };
    case 'advisory_gtm':
      return { ...base, status: 'needs approval', outcome: 'Pursue now / Keep warm (per account)', summary: 'Acme Retail: Pursue now. Active expansion.\nBeta Malls: Keep warm. Budget cycle later.\nCentral Infra: Pursue now. Warm path available.', next_step: 'Human confirms the Pursue now accounts.',
        sub_agent_steps: JSON.stringify([{ step: 'GTM Execution Matching Desk (above #2)', outcome: '4 supplier pairs found', status: 'done' }, { step: 'Relationship Manager (below #2)', outcome: 'Warm path available', status: 'done' }]) };
    case 'intro_desk':
      return { ...base, status: 'needs approval', outcome: 'Intro packs awaiting approval', summary: `Intro pack ready for ${(req.inputs && req.inputs.account) || 'the account'}. Awaiting human approval.`, next_step: 'Human approves the pack. Nothing is sent by the agent.', output_link: 'https://example.com/intro-pack' };
    case 'deal_desk':
      return { ...base, status: 'needs approval', outcome: 'Deal outline awaiting human close', summary: 'Deal outline prepared.', next_step: 'Human closes the deal.', output_link: 'https://example.com/deal-outline' };
    default: return { ...base, status: 'error', outcome: '', summary: '', error_message: 'Unknown desk.' };
  }
}
async function handle(sheet, req, delayMs = 400, opts = {}) {
  const t = JSON.stringify(req.inputs || {}).toUpperCase();
  if (t.includes('SLOW')) return; // never answers: tests the timeout path
  await sleep(delayMs);
  const steps = req.agent_code === 'advisory_gtm' ? [{ step: 'GTM Execution Matching Desk (above #2)', outcome: 'Matching in progress', status: 'running' }] : [];
  await put(sheet, { request_id: req.request_id, agent_code: req.agent_code, status: 'running', outcome: '', summary: '', next_step: '', needs_approval: 'no', approval_state: '', output_link: '', error_message: '', updated_at: now(), sub_agent_steps: JSON.stringify(steps) });
  await sleep(delayMs);
  if (t.includes('FAILAGENT')) return put(sheet, { request_id: req.request_id, agent_code: req.agent_code, status: 'error', outcome: '', summary: '', next_step: 'Try again.', needs_approval: 'no', approval_state: '', output_link: '', error_message: 'The desk could not finish this request.', updated_at: now(), sub_agent_steps: '[]' });
  const row = finalRow(req), dir = opts.filesDir || process.env.MOCK_FILES_DIR || '';
  const f = dir && row.status !== 'error' && !(req.agent_code === 'product_book' && row.outcome === 'Book Waiting') ? filesFor(req) : null;
  if (f) { row.output_link = f.link; if (req.agent_code === 'advisory_gtm') row.sub_agent_steps = JSON.stringify([{ name: 'GTM signals', status: 'done', summary: 'Signals found' }, { name: 'GTM Execution Matching Desk', status: 'done', summary: '3 supplier pairs', output_link: '/files/' + Object.keys(f.files)[1] }, { name: 'Relationship Manager', status: 'done', summary: 'Warm path for Acme Retail', output_link: '/files/' + Object.keys(f.files)[2] }]);
    // BOXPATH: links come back as desk-workspace paths (like the real desks), plus one helper desk file
    if (t.includes('BOXPATH')) { const hn = 'Helper_' + f.link.replace(/\.[a-z]+$/i, '') + '_Notes.csv'; f.files[hn] = 'item,value\nnote,helper file\n'; row.output_link = '/workspace/pipeline-activity/deliverables/' + f.link; row.sub_agent_steps = JSON.stringify([{ name: 'Helper desk', status: 'done', summary: 'Helper notes', output_link: '/workspace/helper-desk/' + hn }]); }
    if (t.includes('FREETEXT')) row.output_link = 'Acme Retail: /workspace/pipeline-activity/deliverables/' + f.link + ' (rows for Acme); Beta Malls: /workspace/pipeline-activity/deliverables/' + f.link + ' (rows for Beta)';
    if (t.includes('LATEFILE')) setTimeout(() => { try { writeFiles(dir, f); } catch (_) {} }, 3000); else writeFiles(dir, f); }
  await put(sheet, row);
}
module.exports = { handle, finalRow };
