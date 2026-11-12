'use strict';
// v40: Contact research unlocks only when a case has reached #3 Introduction Desk
// and #2 Advisory GTM has been approved by a person (the shortlist is handed off to #3).
// Unlocking never spends anything; running still needs a separate human approval.
const ORDER = ['supplier_qualification', 'product_book', 'opportunity_finder', 'advisory_gtm', 'intro_desk', 'deal_desk'];
const INTRO = ORDER.indexOf('intro_desk');
const MESSAGE = 'Unlock in Introduction Desk first';
const LABEL = { supplier_qualification: 'Supplier Qualification', product_book: 'Product Book', opportunity_finder: '#1 Opportunity Finder', advisory_gtm: '#2 Advisory GTM', intro_desk: '#3 Introduction Desk', deal_desk: '#4 Deal Desk' };
const isApproved = (r) => !!(r && (r.approved === true || String(r.approval_state || '').toLowerCase() === 'approved'));

function state(items, caseId) {
  const c = String(caseId || '');
  const rs = (Array.isArray(items) ? items : []).filter((r) => r && r.case_id === c);
  const done = (code) => rs.some((r) => r.agent_code === code && isApproved(r));
  const cur = ORDER.findIndex((code) => !done(code));
  const atIntro = rs.some((r) => r.agent_code === 'intro_desk') && cur >= 0 && cur < INTRO;
  const step = atIntro ? 'intro_desk' : cur < 0 ? 'complete' : ORDER[cur];
  // reached #3: every step before it is done, or the shortlist has already been handed to #3 (a #3 request exists)
  const reached = cur < 0 || cur >= INTRO || rs.some((r) => r.agent_code === 'intro_desk');
  const gtm = done('advisory_gtm');
  const unlocked = !!c && reached && gtm;
  let why = '';
  if (!unlocked) why = !rs.length ? 'This case has no steps yet.' : !gtm ? '#2 Advisory GTM is not approved yet, so the shortlist is not ready.' : 'The case is at ' + (LABEL[step] || step) + ', not #3 Introduction Desk yet.';
  return { case_id: c, unlocked, locked: !unlocked, step, step_label: LABEL[step] || (cur < 0 ? 'All steps done' : step), gtm_approved: gtm, message: unlocked ? '' : MESSAGE, why };
}

// Hide credit amounts from anything a browser can see.
const DROP = new Set(['estimated_credits', 'cost_note', 'credit_cap', 'credits_used', 'credits_left', 'est', 'credits']);
function hideCredits(v) {
  if (Array.isArray(v)) return v.map(hideCredits);
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) if (!DROP.has(k)) o[k] = hideCredits(x); return o; }
  if (typeof v === 'string') return v.replace(/credit cap \(\s*[\d,]+\s*\)/gi, 'credit cap').replace(/\s*\(?\b(?:about |at most |up to |cap |max(?:imum)? )?\d[\d,]*\s*(?:of\s+\d[\d,]*\s*)?credits?\b(?:\s+(?:each|per company))?\)?/gi, '').replace(/,\s*\./g, '.').replace(/\s{2,}/g, ' ');
  return v;
}

module.exports = { state, hideCredits, MESSAGE, ORDER, isApproved };
