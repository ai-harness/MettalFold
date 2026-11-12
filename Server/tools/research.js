#!/usr/bin/env node
'use strict';
// v38: internal command for Contact research / Company enrichment. The ONLY way to approve or run a step that spends credits.
//   node tools/research.js pending  CASE-0003 [--step contacts|enrichment]
//   node tools/research.js approve  CASE-0003 --step contacts --by Rishabh --cap 3 [--accounts "Acct A;Acct B"] [--max-per-company 1] [--ref "chat t320u"]
//   node tools/research.js run      CASE-0003 --step contacts [--dry-run]
//   node tools/research.js revoke   CASE-0003 --id APR-0003-001
// Approve only after a human approved in chat. Run refuses without a matching approval and stops at the credit cap.
const path = require('path'), fs = require('fs');
const root = path.join(__dirname, '..');
try { require(path.join(root, 'node_modules', 'dotenv')).config({ path: path.join(root, '.env') }); } catch (e) {}
const { createAudit } = require('../lib/audit'); const { setSecrets } = require('../lib/util');
const { createResearch } = require('../lib/research');
const args = process.argv.slice(2), cmd = args[0], caseId = args[1];
const opt = (k) => { const i = args.indexOf('--' + k); return i > 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null; };
const flag = (k) => args.includes('--' + k);
const keys = []; for (const [k, v] of Object.entries(process.env)) if (/_KEY$|SECRET$|PASSWORD$/.test(k)) keys.push(v); setSecrets(keys);
const DATA = process.env.DATA_DIR || path.join(root, 'data'), FILES = process.env.FILES_DIR || path.join(root, 'files');
const R = createResearch({ dataDir: DATA, filesDir: FILES, audit: createAudit(process.env.LOG_DIR || path.join(root, 'logs')), env: process.env, provider: flag('mock') ? (() => { const m = require('../lib/providers/cr_mock').createMockProvider(); return () => m; })() : undefined });
const out = (x) => console.log(JSON.stringify(x, null, 1));
(async () => {
  if (!cmd || !caseId) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 9).join('\n')); process.exit(1); }
  const step = opt('step') || 'contacts';
  if (cmd === 'pending') {
    const s = R.summary(caseId), p = step === 'enrichment' ? s.enrichment : s.contacts;
    out({ case_id: s.case_id, step: p.label, connected_here: s.connected, run_on: p.run_on, estimated_max_credits: p.estimated_credits, cost: p.cost_note, accounts: p.accounts || p.companies, not_shortlisted: p.not_shortlisted, blockers: p.blockers,
      filters: s.filters, filters_id: s.filters_hash, open_approvals: s.approvals.filter((a) => a.status === 'approved') });
  } else if (cmd === 'approve') {
    out(R.approve(caseId, { step, approved_by: opt('by'), credit_cap: Number(opt('cap')), accounts: opt('accounts') ? opt('accounts').split(';') : null, max_per_company: opt('max-per-company') != null ? Number(opt('max-per-company')) : null, ref: opt('ref') || '', recorded_by: 'Grok Bot' }));
  } else if (cmd === 'run') {
    out(await R.run(caseId, { step, dryRun: flag('dry-run'), user: opt('by') || 'Grok Bot' }));
  } else if (cmd === 'revoke') {
    out(R.revoke(caseId, opt('id'), opt('by') || 'Grok Bot'));
  } else { console.error('Unknown command.'); process.exit(1); }
})().catch((e) => { console.error('Stopped: ' + e.message); process.exit(e.status === 409 || e.status === 400 ? 3 : 2); });
