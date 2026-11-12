'use strict';
// Six desks, exactly as in the Integration Spec V2 / SubAgentSpecs V3. Sub-agents have no entry here on purpose.
const AGENTS = {
  supplier_qualification: {
    label: 'Supplier Qualification & Onboarding', order: 1, env: 'SUPPLIER_QUALIFICATION',
    outcomes: ['Onboard', 'Hold', 'Drop'],
    approvalOutcomes: ['Onboard'],
    approveLabel: 'Confirm Onboard', gateText: 'Suppliers you upload are already confirmed by you, so they go straight to Product Book Creator.',
    parent: null, next: 'product_book', batch: true,
    fields: [
      { key: 'supplier_name', label: 'Supplier name', required: true, max: 200 },
      { key: 'category', label: 'Category', required: true, max: 200 },
      { key: 'brochure_url', label: 'Brochure link (leave blank if none: the desk will list it as missing)', type: 'url', max: 1000 },
      { key: 'countries_served', label: 'Countries served (comma separated)', required: true, max: 500 }
    ]
  },
  product_book: {
    label: 'Product Book Creator', order: 2, env: 'PRODUCT_BOOK',
    outcomes: ['Book LIVE', 'Book Waiting'],
    approvalOutcomes: ['Book LIVE'],
    approveLabel: 'Approve booklet', gateText: 'A human reviews the booklet before it is shared with a client.',
    parent: { agent: 'supplier_qualification', outcome: 'Onboard' }, next: null,
    fields: [
      { key: 'supplier_name', label: 'Onboarded supplier', required: true, max: 200 },
      { key: 'products', label: 'Products', required: true, type: 'textarea', max: 2000 },
      { key: 'brochure_url', label: 'Brochure link', type: 'url', max: 1000 }
    ]
  },
  opportunity_finder: {
    label: '#1 Opportunity Finder', order: 3, env: 'OPPORTUNITY_FINDER',
    outcomes: ['Target list ready'], approvalOutcomes: null,
    approveLabel: 'Approve target list', gateText: 'A human approves the list before #2 runs.',
    parent: null, next: 'advisory_gtm',
    fields: [
      { key: 'region', label: 'Region', required: true, max: 200 },
      { key: 'number_of_accounts', label: 'Number of accounts', required: true, type: 'int', min: 1, max: 500 },
      { key: 'focus', label: 'Product or supplier in focus', required: true, max: 300 }
    ]
  },
  advisory_gtm: {
    label: '#2 Advisory GTM', order: 4, env: 'ADVISORY_GTM',
    outcomes: ['Pursue now', 'Keep warm'], approvalOutcomes: null,
    approveLabel: 'Confirm Pursue now accounts', gateText: 'A human confirms the Pursue now accounts before #3 runs.',
    parent: { agent: 'opportunity_finder' }, next: 'intro_desk',
    fields: [{ key: 'note', label: 'Note for the desk (optional)', type: 'textarea', max: 1000 }]
  },
  intro_desk: {
    label: '#3 Introduction Desk', order: 5, env: 'INTRO_DESK',
    outcomes: ['Intro packs awaiting approval'], approvalOutcomes: null,
    approveLabel: 'Approve this intro pack (the agent sends nothing)', gateText: 'A human approves each intro pack. Nothing is sent by the agent.',
    parent: { agent: 'advisory_gtm' }, next: 'deal_desk', batch: false,
    fields: [{ key: 'account', label: 'Pursue now accounts (one per line, all in ONE request)', type: 'textarea', required: true, max: 1500 }, { key: 'note', label: 'Note for the desk (optional)', type: 'textarea', max: 1800 }]
  },
  deal_desk: {
    label: '#4 Deal Desk', order: 6, env: 'DEAL_DESK',
    outcomes: ['Deal outline awaiting human close'], approvalOutcomes: null,
    approveLabel: 'Mark closed by a human', gateText: 'A human closes the deal. The agent only prepares the outline.',
    parent: { agent: 'intro_desk' }, next: null, batch: false,
    fields: [
      { key: 'account', label: 'Contacts for the Deal Desk (one per line)', required: true, type: 'textarea', max: 3000 },
      { key: 'product', label: 'Product', required: true, max: 600 },
      { key: 'soft_yes_note', label: 'Note (who said what, appointment status)', type: 'textarea', max: 2000 },
      { key: 'soft_yes_confirmed', label: 'A human has recorded a soft yes from this account', required: true, type: 'bool' }
    ]
  }
};
const CODES = Object.keys(AGENTS);
const STATUSES = ['queued', 'running', 'done', 'needs approval', 'error'];
const REQUEST_COLS = ['request_id', 'case_id', 'agent_code', 'submitted_at', 'submitted_by', 'inputs_json', 'parent_request_id', 'status'];
const RESULT_COLS = ['request_id', 'agent_code', 'status', 'outcome', 'summary', 'next_step', 'needs_approval', 'approval_state', 'output_link', 'error_message', 'updated_at', 'sub_agent_steps'];
module.exports = { AGENTS, CODES, STATUSES, REQUEST_COLS, RESULT_COLS };
