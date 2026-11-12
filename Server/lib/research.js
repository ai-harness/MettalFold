'use strict';
// v38: Contact research + Company enrichment (internal). Per case:
//   data/contact_research/<CASE-ID>.json holds the filters, the run/skip choice, approvals, runs and history.
// Hard rules: nothing that spends credits runs without a matching approval record (approved_by, credit cap, time);
// contacts are found ONLY for accounts #2 Advisory GTM marked "Pursue now"; a credit meter stops at the cap;
// every text that leaves this module is neutral (no outside service names).
const fs = require('fs'), path = require('path'), crypto = require('crypto');

const { NAME_RE, LINK_RE } = require('./providers/cr');
const neutralStr = (s) => String(s).replace(LINK_RE, '[link hidden]').replace(NAME_RE, 'contact research');
const neutral = (v) => { if (typeof v === 'string') return neutralStr(v); if (Array.isArray(v)) return v.map(neutral); if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[neutralStr(k)] = neutral(x); return o; } return v; };
const hasVendor = (s) => { NAME_RE.lastIndex = 0; return NAME_RE.test(String(s)); };

const CASE_RE = /^CASE-\d{3,6}$/;
const STEPS = { enrichment: 'Company enrichment', contacts: 'Contact research' };
const LIMITS = { per_company_max: 15, pages_max: 3, list_max: 40, item_max: 120 };
const now = () => new Date().toISOString();
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const domainOf = (u) => { const s = String(u || '').trim().split(/[\s|,;]+/)[0]; if (!s) return ''; try { return new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s).hostname.replace(/^www\./i, '').toLowerCase(); } catch (e) { return ''; } };
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const REGIONS = { 'middle east': ['UAE', 'United Arab Emirates', 'Saudi Arabia', 'KSA', 'Qatar', 'Oman', 'Kuwait', 'Bahrain'], gcc: ['UAE', 'United Arab Emirates', 'Saudi Arabia', 'KSA', 'Qatar', 'Oman', 'Kuwait', 'Bahrain'], me: ['UAE', 'Saudi Arabia', 'Qatar', 'Oman', 'Kuwait', 'Bahrain'] };
const DEFAULT_FILTERS = {
  job_titles: ['Data Center', 'Critical Facilities', 'Critical Infrastructure', 'Electrical', 'MEP', 'Energy', 'Power', 'Infrastructure', 'Projects', 'Construction', 'Design', 'Engineering', 'Facilities', 'Operations', 'Procurement', 'Supply Chain', 'Strategic Sourcing', 'Sustainability'],
  persona_roles: ['CTO', 'VP Design / Energy', 'Head of Data Centre Design', 'VP Projects / Construction', 'Chief Sustainability Officer', 'Head Electrical / MEP', 'Critical Facilities Head', 'Power and Energy Manager', 'Head Procurement'],
  seniority: ['Chief', 'CTO', 'COO', 'Vice President', 'VP', 'SVP', 'EVP', 'Head', 'Director', 'General Manager', 'Lead'],
  departments: ['Engineering', 'Operations', 'Projects', 'Procurement', 'Sustainability', 'Design', 'Facilities'],
  exclude_titles: ['HR', 'Human Resources', 'Recruiter', 'Recruitment', 'Talent', 'Intern', 'Trainee', 'Sales Executive', 'Marketing Executive', 'Accountant'],
  locations: [], company_size: [], domains: {}, max_prospects_per_company: 10, search_pages: 1, requirement_note: ''
};

function parseCsv(t) { const rows = []; let row = [], f = '', q = false; t = String(t).replace(/^\uFEFF/, ''); for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; } else f += c; } if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows.filter((r) => r.some((x) => x !== '')); }
const csvCell = (v) => { const s = String(v == null ? '' : v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
const asObjects = (rows) => { const hi = rows.findIndex((x) => x.filter((c) => String(c).trim()).length >= 3); if (hi < 0) return []; const h = rows[hi].map((c) => String(c).trim().toLowerCase()); return rows.slice(hi + 1).filter((x) => x.some((c) => String(c).trim())).map((x) => { const o = {}; h.forEach((k, i) => { o[k] = String(x[i] == null ? '' : x[i]).trim(); }); return o; }); };
const fileToken = (v) => { const m = String(v || '').match(/([A-Za-z0-9._ -]+\.(?:csv|xlsx))/i); return m ? path.basename(m[1].trim()) : ''; };

// requests for the CLI, read from the app's own sheet snapshot (the server passes core.views() instead)
function itemsFromSnapshot(dataDir) {
  let s = {}; try { s = JSON.parse(fs.readFileSync(path.join(dataDir, 'sheet_snapshot.json'), 'utf8')); } catch (e) { return []; }
  const res = {}; for (const r of s.results || []) res[r.request_id] = r;
  return (s.requests || []).map((q) => { const r = res[q.request_id] || {}; let inputs = {}; try { inputs = JSON.parse(q.inputs_json || '{}'); } catch (e) {} const b = fileToken(r.output_link);
    return { request_id: q.request_id, case_id: q.case_id, agent_code: q.agent_code, inputs, status: String(r.status || q.status || '').toLowerCase(), outcome: r.outcome || '', summary: r.summary || '', approval_state: String(r.approval_state || '').toLowerCase(), output_link: b ? '/files/' + encodeURIComponent(b) : '' }; });
}

function cleanList(v, max = LIMITS.list_max) { const a = Array.isArray(v) ? v : String(v == null ? '' : v).split(/\r?\n|;/); const out = []; for (const x of a) { const s = String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.item_max); if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s); } return out.slice(0, max); }
function validateFilters(input, base) {
  const f = { ...DEFAULT_FILTERS, ...(base || {}) }, b = input || {}, errors = {};
  for (const k of ['job_titles', 'persona_roles', 'seniority', 'departments', 'exclude_titles', 'locations', 'company_size']) if (b[k] !== undefined) f[k] = cleanList(b[k]);
  if (b.domains !== undefined) {
    const d = {}; const src = typeof b.domains === 'string' ? Object.fromEntries(b.domains.split(/\r?\n/).map((l) => l.split('|')).filter((p) => p.length >= 2).map((p) => [p[0].trim(), p.slice(1).join('|').trim()])) : (b.domains || {});
    for (const [a, v] of Object.entries(src)) { const acc = String(a).trim().slice(0, 200), dm = domainOf(v); if (!acc) continue; if (!dm || !DOMAIN_RE.test(dm)) { errors.domains = 'Not a valid website for ' + acc + ': ' + String(v).slice(0, 80); continue; } d[acc] = dm; }
    f.domains = d;
  }
  const int = (k, lo, hi) => { if (b[k] === undefined) return; const n = Number(b[k]); if (!Number.isInteger(n) || n < lo || n > hi) errors[k] = 'Must be a whole number from ' + lo + ' to ' + hi + '.'; else f[k] = n; };
  int('max_prospects_per_company', 1, LIMITS.per_company_max); int('search_pages', 1, LIMITS.pages_max);
  if (b.requirement_note !== undefined) f.requirement_note = String(b.requirement_note || '').slice(0, 2000);
  if (!f.job_titles.length && !f.persona_roles.length) errors.job_titles = 'Add at least one job title or persona role.';
  return { filters: f, errors };
}
const filtersHash = (f) => crypto.createHash('sha1').update(JSON.stringify(f, Object.keys(f).sort())).digest('hex').slice(0, 12);

// ---- prospect matching: free, done here on the list the service returns ----
const kw = (s) => { const t = String(s).trim(); if (!t) return null; const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s*\/\s*/g, '|'); return new RegExp('(^|[^a-z0-9])(' + e + ')([^a-z0-9]|$)', 'i'); };
function scoreTitle(title, f) {
  const t = String(title || ''); if (!t.trim()) return { score: 0, why: [] };
  for (const x of f.exclude_titles) { const r = kw(x); if (r && r.test(t)) return { score: -1, why: ['excluded: ' + x] }; }
  const why = []; let s = 0;
  const hit = (list) => list.find((x) => { const r = kw(x); return r && r.test(t); });
  const persona = f.persona_roles.find((p) => p.split('/').map((x) => x.trim()).filter(Boolean).every((part) => part.split(/\s+/).filter((w) => w.length > 2 || /^[A-Z]{2,4}$/.test(w)).every((w) => kw(w).test(t))));
  if (persona) { s += 4; why.push('persona: ' + persona); }
  const jt = hit(f.job_titles); if (jt) { s += 3; why.push('title: ' + jt); }
  const se = hit(f.seniority); if (se) { s += 2; why.push('seniority: ' + se); }
  const de = hit(f.departments); if (de) { s += 1; why.push('department: ' + de); }
  return { score: s, why };
}
const properCase = (s) => String(s || '').toLowerCase().replace(/(^|[\s'-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const sizeMatch = (size, list) => { if (!list.length || !size) return true; const n = (x) => String(x).replace(/\s|,/g, '').toLowerCase(); return list.some((l) => n(l) === n(size) || n(size).startsWith(n(l))); };
function locMatch(country, list) {
  if (!list.length) return true; const c = norm(country); if (!c) return true;
  const all = []; for (const l of list) { all.push(l); for (const x of REGIONS[norm(l)] || []) all.push(x); }
  return all.some((l) => { const n = norm(l); return n && (c === n || c.includes(n) || n.includes(c)); });
}

function createResearch(o) {
  const dataDir = o.dataDir, filesDir = o.filesDir, audit = o.audit || { log() {} }, env = o.env || process.env;
  const dir = path.join(dataDir, 'contact_research');
  const items = () => (typeof o.items === 'function' ? o.items() : itemsFromSnapshot(dataDir)) || [];
  const providerFor = o.provider || (() => require('./providers/cr').createLiveProvider(env));
  const maxCap = Math.max(1, Number(env.CR_MAX_CAP) || 50);
  const ttlMs = (Number(env.CR_APPROVAL_HOURS) || 48) * 3600e3;
  const latest = (n) => { if (!n) return n; const m = n.match(/^(.*_V)(\d+)(\.[A-Za-z0-9]+)$/); if (!m) return n; let best = +m[2], bn = n; try { for (const f of fs.readdirSync(filesDir)) if (f.startsWith(m[1]) && f.endsWith(m[3])) { const v = f.slice(m[1].length, f.length - m[3].length); if (/^\d+$/.test(v) && +v > best) { best = +v; bn = f; } } } catch (e) {} return bn; };
  const checkCase = (id) => { const c = String(id || '').trim().toUpperCase(); if (!CASE_RE.test(c)) { const e = new Error('Not a valid case id.'); e.status = 400; throw e; } return c; };
  const file = (c) => path.join(dir, c + '.json');
  const readState = (c) => { try { return JSON.parse(fs.readFileSync(file(c), 'utf8')); } catch (e) { return null; } };
  const writeState = (c, s) => { fs.mkdirSync(dir, { recursive: true }); s.updated_at = now(); const tmp = file(c) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(neutral(s), null, 1)); fs.renameSync(tmp, file(c)); };
  const hist = (s, user, event, detail) => { s.history = s.history || []; s.history.push({ ts: now(), user: user || '', event, detail: neutralStr(detail) }); if (s.history.length > 300) s.history.splice(0, s.history.length - 300); audit.log('contact_research_' + event, { user, case_id: s.case_id, detail: neutralStr(detail) }); };

  // tables from a /files/ name (csv preferred, else xlsx, every sheet)
  function readTables(base) {
    if (!base) return [];
    const stem = base.replace(/\.(csv|xlsx)$/i, ''), csv = path.join(filesDir, latest(stem + '.csv') || ''), xl = path.join(filesDir, latest(stem + '.xlsx') || '');
    try { if (fs.existsSync(csv)) return [{ name: 'csv', rows: parseCsv(fs.readFileSync(csv, 'utf8')) }]; } catch (e) {}
    try { if (fs.existsSync(xl)) return require('./xlsx').readWorkbook(fs.readFileSync(xl)); } catch (e) {}
    return [];
  }
  function context(c) {
    const all = items().filter((r) => r.case_id === c);
    const pick = (code) => all.filter((r) => r.agent_code === code && r.approval_state !== 'rejected').pop() || null;
    const of = pick('opportunity_finder'), gtm = pick('advisory_gtm');
    const ofBase = of ? fileToken(decodeURIComponent(String(of.output_link || '').replace(/^\/files\//, ''))) : '';
    const tal = asObjects((readTables(ofBase)[0] || { rows: [] }).rows).map((x) => ({ company: x.company_name || x.company || x.account || '', website: x.company_website || x.website || '', domain: domainOf(x.company_website || x.website || x.domain), country: x.country || x.geography || '', industry: x.industry || '', size: x.size || x.headcount || x.company_size || '', city: x.city || x.hq_city || '' })).filter((x) => x.company);
    // #2 decisions: summary lines "Name: Pursue now." plus the ranking file sheets/columns. Keep warm wins on conflict.
    const dec = {}; const put = (a, d) => { const name = String(a || '').trim(), k = norm(name); if (!k || k.length < 3 || /^(none|n\/a|na|total|all)\b/i.test(name) || !d) return; const cur = dec[k] || (dec[k] = { account: name, decision: d }); if (d !== 'Pursue now') cur.decision = d; };
    const decOf = (t) => { t = String(t || ''); return /pursue[\s_-]*now|strong[\s_-]*pursue/i.test(t) ? 'Pursue now' : /keep[\s_-]*warm|nurture/i.test(t) ? 'Keep warm' : ''; };
    if (gtm) {
      for (const m of String(gtm.summary || '').matchAll(/([A-Z][^.:\n]{2,140}?):\s*(Pursue now|Keep warm|Nurture[^.\n]*)/g)) put(m[1].trim(), decOf(m[2]));
      const gb = fileToken(decodeURIComponent(String(gtm.output_link || '').replace(/^\/files\//, '')));
      for (const sh of readTables(gb)) {
        // a sheet name decides only for plain bucket sheets (Strong_Pursue, Nurture_Later); "Skip_or_Routed" and others never decide by name
        const d = /skip|rout|summary|method|source|detail|match|fit|map|role|path/i.test(sh.name) ? '' : decOf(sh.name); const rows = asObjects(sh.rows);
        for (const x of rows) { const a = x.company || x.account || x.company_name; if (!a) continue; const d2 = decOf(x.client_status || x.decision || x.status || '') || decOf(x.reason || '') || d; if (d2) put(a, d2); }
      }
    }
    const decisions = Object.values(dec);
    const stemOf = (b, re) => { const m = String(b).match(re); return m ? m[1] : ''; };
    const stem = stemOf(ofBase, /^01_OpportunityFinder_(.+?)_TAL_V\d+/i) || stemOf(gtm ? fileToken(decodeURIComponent(gtm.output_link || '')) : '', /^02_AdvisoryGTM_(.+?)_LightPass_V\d+/i) || c.replace('-', '');
    return { of, gtm, tal, decisions, stem, gtm_approved: !!gtm && gtm.approval_state === 'approved' };
  }
  function defaultsFor(ctx) {
    const f = JSON.parse(JSON.stringify(DEFAULT_FILTERS));
    const region = ctx.of && ctx.of.inputs ? String(ctx.of.inputs.region || '') : '';
    f.locations = cleanList(region.split(/,|\band\b/));
    for (const t of ctx.tal) if (t.domain) f.domains[t.company] = t.domain;
    return f;
  }
  function load(c) {
    const ctx = context(c); let s = readState(c);
    if (!s) s = { case_id: c, created_at: now(), filters: defaultsFor(ctx), filters_source: 'default (from #1 region and target list)', company_enrichment: { mode: 'auto' }, approvals: [], runs: [], outputs: [], history: [] };
    s.filters = validateFilters({}, s.filters).filters;
    for (const a of s.approvals || []) if (a.status === 'approved' && Date.parse(a.expires_at) < Date.now()) a.status = 'expired';
    return { s, ctx };
  }
  const domainFor = (f, ctx, account) => { const k = norm(account); for (const [a, d] of Object.entries(f.domains || {})) if (norm(a) === k) return d; const t = ctx.tal.find((x) => norm(x.company) === k || norm(x.company).startsWith(k) || k.startsWith(norm(x.company))); return t ? t.domain : ''; };
  const enrichedSet = (s) => { const set = {}; for (const r of s.runs || []) for (const e of r.companies || []) if (e.domain) set[e.domain] = e; return set; };

  function plan(c, step) {
    const { s, ctx } = load(c), f = s.filters, enr = enrichedSet(s), blockers = [];
    if (step === 'enrichment') {
      const requested = Number(ctx.of && ctx.of.inputs && ctx.of.inputs.number_of_accounts) || 0, found = ctx.tal.length;
      const mode = s.company_enrichment.mode || 'auto', resolved = mode === 'auto' ? (found && found >= requested ? 'skip' : 'run') : mode;
      const why = mode === 'auto' ? (resolved === 'skip' ? 'Web research already found ' + found + ' of ' + requested + ' companies, so enrichment is skipped by default.' : 'Web research found ' + found + ' of ' + (requested || '?') + ' companies, so enrichment is suggested.') : 'Set by hand to ' + resolved + '.';
      const companies = ctx.tal.map((t) => { const missing = ['size', 'city', 'industry'].filter((k) => !t[k]); const done = !!enr[t.domain]; return { company: t.company, domain: t.domain, country: t.country, missing: done ? [] : missing, already_enriched: done, in_location_filter: locMatch(t.country, f.locations) }; });
      const todo = companies.filter((x) => x.domain && x.missing.length && !x.already_enriched && x.in_location_filter);
      if (!ctx.of) blockers.push('This case has no #1 Opportunity Finder result yet.');
      if (resolved === 'skip') blockers.push('Company enrichment is set to skip.');
      return { step, label: STEPS[step], mode, resolved, why, companies, run_on: todo.map((x) => x.company), estimated_credits: resolved === 'skip' ? 0 : todo.length, cost_note: '1 credit per company', blockers };
    }
    const pursue = ctx.decisions.filter((d) => d.decision === 'Pursue now'), other = ctx.decisions.filter((d) => d.decision !== 'Pursue now');
    if (!ctx.gtm) blockers.push('This case has no #2 Advisory GTM result yet.'); else if (!ctx.gtm_approved) blockers.push('#2 Advisory GTM is not approved yet. A human confirms the Pursue now accounts first.');
    if (!pursue.length) blockers.push('No "Pursue now" accounts in the #2 result.');
    const accounts = pursue.map((d) => { const dm = domainFor(f, ctx, d.account), t = ctx.tal.find((x) => norm(x.company) === norm(d.account)) || {}; const e = enr[dm]; const country = t.country || ''; const lookup = e ? 0 : 1;
      const ok = !!dm && locMatch(country, f.locations) && sizeMatch(e && e.size, f.company_size);
      return { account: d.account, decision: d.decision, domain: dm, country, company_known: !!e, in_filters: ok, note: !dm ? 'Needs a website (add it under Domains).' : !locMatch(country, f.locations) ? 'Country is not in the location filter.' : !sizeMatch(e && e.size, f.company_size) ? 'Company size is not in the size filter.' : '', est: ok ? lookup + f.search_pages + f.max_prospects_per_company : 0 }; });
    for (const a of accounts) if (!a.domain) blockers.push(a.account + ' needs a website before it can run.');
    return { step: 'contacts', label: STEPS.contacts, accounts, not_shortlisted: other.map((d) => ({ account: d.account, decision: d.decision, note: 'Not shortlisted: no contact research (comes later).' })), run_on: accounts.filter((a) => a.in_filters).map((a) => a.account), estimated_credits: accounts.reduce((n, a) => n + a.est, 0), cost_note: 'up to 1 credit for the company lookup (if not known yet) + 1 per people-list page + 1 per contact', per_company: f.max_prospects_per_company, blockers };
  }
  function summary(c0) {
    const c = checkCase(c0), { s } = load(c), fh = filtersHash(s.filters);
    const live = (() => { try { return providerFor().connected; } catch (e) { return false; } })();
    const ap = (s.approvals || []).map((a) => ({ ...a, matches_filters: a.filters_hash === fh }));
    const outs = (s.outputs || []).map((n) => ({ name: n, url: '/files/' + encodeURIComponent(n), ready: fs.existsSync(path.join(filesDir, n)) }));
    return neutral({ case_id: c, connected: live, filters: s.filters, filters_hash: fh, filters_source: s.filters_source || '', filters_updated_by: s.filters_updated_by || '', filters_updated_at: s.filters_updated_at || '',
      enrichment: plan(c, 'enrichment'), contacts: plan(c, 'contacts'), approvals: ap.slice(-20).reverse(), runs: (s.runs || []).slice(-20).reverse().map((r) => ({ ...r, companies: undefined, people: undefined })), outputs: outs.slice(-20).reverse(), history: (s.history || []).slice(-50).reverse(),
      rules: ['Nothing that spends credits runs without an approval (who approved, credit cap, time).', 'Contacts only for "Pursue now" accounts. Keep warm / nurture accounts are never searched for now.', 'Changing the filters cancels any approval given for the old filters.', 'Credits stop at the approved cap.'] });
  }
  function saveFilters(c0, input, user) {
    const c = checkCase(c0), { s } = load(c), before = filtersHash(s.filters); const { filters, errors } = validateFilters(input, s.filters);
    if (Object.keys(errors).length) { const e = new Error('Please fix the highlighted filters.'); e.status = 400; e.fields = errors; throw e; }
    s.filters = filters; const after = filtersHash(filters);
    if (after !== before) { s.filters_source = 'edited'; s.filters_updated_by = user || ''; s.filters_updated_at = now(); let n = 0; for (const a of s.approvals || []) if (a.status === 'approved' && a.filters_hash !== after) { a.status = 'stale'; n++; } hist(s, user, 'filters_edited', 'Filters changed by ' + (user || 'someone') + '.' + (n ? ' ' + n + ' approval(s) for the old filters were cancelled; a new approval is needed.' : '')); }
    writeState(c, s); return summary(c);
  }
  function setEnrichment(c0, mode, user) {
    const c = checkCase(c0); if (!['auto', 'run', 'skip'].includes(mode)) { const e = new Error('Choose run, skip or auto.'); e.status = 400; throw e; }
    const { s } = load(c); s.company_enrichment = { mode, set_by: user || '', set_at: now() }; hist(s, user, 'enrichment_mode', 'Company enrichment set to ' + mode + ' by ' + (user || 'someone') + '.'); writeState(c, s); return summary(c);
  }
  function approve(c0, a) {
    const c = checkCase(c0), step = a.step === 'enrichment' ? 'enrichment' : a.step === 'contacts' ? 'contacts' : null; const fail = (m) => { const e = new Error(m); e.status = 400; throw e; };
    if (!step) fail('Step must be contacts or enrichment.');
    const by = String(a.approved_by || '').trim().slice(0, 60); if (!by) fail('approved_by is required.');
    const cap = Number(a.credit_cap); if (!Number.isInteger(cap) || cap < 1 || cap > maxCap) fail('credit_cap must be a whole number from 1 to ' + maxCap + '.');
    const p = plan(c, step); const hard = p.blockers.filter((b) => !/needs a website/.test(b)); if (hard.length) fail('Cannot approve yet: ' + hard.join(' '));
    let accounts = p.run_on; if (a.accounts && a.accounts.length) { const want = cleanList(a.accounts); const bad = want.filter((w) => !p.run_on.some((x) => norm(x) === norm(w))); if (bad.length) fail('Not allowed (not in the ' + (step === 'contacts' ? 'Pursue now' : 'enrichment') + ' list or outside the filters): ' + bad.join(', ')); accounts = p.run_on.filter((x) => want.some((w) => norm(w) === norm(x))); }
    if (!accounts.length) fail('No accounts to run.');
    const { s } = load(c); let mpc = null; if (a.max_per_company != null) { mpc = Number(a.max_per_company); if (!Number.isInteger(mpc) || mpc < 1 || mpc > s.filters.max_prospects_per_company) fail('max_per_company must be 1 to ' + s.filters.max_prospects_per_company + '.'); }
    for (const x of s.approvals || []) if (x.status === 'approved' && x.step === step) x.status = 'replaced';
    const est = step === 'enrichment' ? accounts.length : p.accounts.filter((x) => accounts.includes(x.account)).reduce((n, x) => n + (x.company_known ? 0 : 1) + s.filters.search_pages + (mpc || s.filters.max_prospects_per_company), 0);
    const rec = { id: 'APR-' + c.slice(5) + '-' + String((s.approvals || []).length + 1).padStart(3, '0'), step, label: STEPS[step], case_id: c, accounts, max_per_company: mpc, credit_cap: cap, estimated_credits: est, filters_hash: filtersHash(s.filters), approved_by: by, approved_at: now(), expires_at: new Date(Date.now() + ttlMs).toISOString(), ref: String(a.ref || '').slice(0, 200), status: 'approved', recorded_by: String(a.recorded_by || 'Grok Bot').slice(0, 60) };
    s.approvals = s.approvals || []; s.approvals.push(rec); hist(s, by, 'approved', STEPS[step] + ' approved by ' + by + ': ' + accounts.length + ' account(s), cap ' + cap + ' credits' + (mpc ? ', ' + mpc + ' contact(s) per company' : '') + (rec.ref ? ' (' + rec.ref + ')' : '') + '.');
    writeState(c, s); return neutral(rec);
  }
  function revoke(c0, id, user) { const c = checkCase(c0), { s } = load(c); const a = (s.approvals || []).find((x) => x.id === id && x.status === 'approved'); if (!a) { const e = new Error('No open approval with that id.'); e.status = 404; throw e; } a.status = 'revoked'; hist(s, user, 'revoked', 'Approval ' + id + ' cancelled by ' + (user || 'someone') + '.'); writeState(c, s); return neutral(a); }

  const running = new Set();
  async function run(c0, { step, dryRun = false, user = '', provider } = {}) {
    const c = checkCase(c0); step = step === 'enrichment' ? 'enrichment' : 'contacts'; const fail = (m, st = 409) => { const e = new Error(m); e.status = st; throw e; };
    const p = plan(c, step);
    if (dryRun) return neutral({ dry_run: true, credits_used: 0, ...p, note: 'Plan only. Nothing was sent and no credits were used.' });
    const { s } = load(c), fh = filtersHash(s.filters);
    const ap = (s.approvals || []).filter((a) => a.step === step && a.status === 'approved').pop();
    if (!ap) fail('No approval for ' + STEPS[step] + ' on ' + c + '. Nothing was run and no credits were used.');
    if (ap.filters_hash !== fh) fail('The filters changed after the approval. A new approval is needed. Nothing was run.');
    if (Date.parse(ap.expires_at) < Date.now()) fail('The approval has expired. Nothing was run.');
    const hard = p.blockers.filter((b) => !/needs a website/.test(b)); if (hard.length) fail(hard.join(' ') + ' Nothing was run.');
    const accounts = ap.accounts.filter((a) => p.run_on.some((x) => norm(x) === norm(a)));
    if (!accounts.length) fail('None of the approved accounts are still allowed (Pursue now and inside the filters). Nothing was run.');
    const lock = path.join(dir, c + '.lock'); fs.mkdirSync(dir, { recursive: true });
    try { const st = fs.statSync(lock); if (Date.now() - st.mtimeMs < 30 * 60e3) fail('A run is already going for this case.'); fs.unlinkSync(lock); } catch (e) { if (e.status) throw e; }
    if (running.has(c)) fail('A run is already going for this case.');
    running.add(c); fs.writeFileSync(lock, String(process.pid));
    const prov = provider || providerFor();
    if (!prov.connected) { running.delete(c); try { fs.unlinkSync(lock); } catch (e) {} fail('Contact research is not connected on this computer. Nothing was run and no credits were used.'); }
    const runRec = { id: 'RUN-' + c.slice(5) + '-' + String((s.runs || []).length + 1).padStart(3, '0'), step, label: STEPS[step], approval_id: ap.id, started_at: now(), by: user || ap.recorded_by, credit_cap: ap.credit_cap, credits_used: 0, status: 'running', accounts, notes: [] };
    let startBal = null;
    try { const b = await prov.balance(); if (Number.isFinite(b)) startBal = b; } catch (e) {}
    if (startBal != null && startBal < 1) { running.delete(c); try { fs.unlinkSync(lock); } catch (e) {} fail('No credits left on the account. Nothing was run.'); }
    // claim the approval before spending anything: it can never be used twice
    ap.status = 'in use'; ap.run_id = runRec.id; s.runs = s.runs || []; s.runs.push(runRec); hist(s, runRec.by, 'run_started', STEPS[step] + ' started under ' + ap.id + ' (cap ' + ap.credit_cap + ' credits).'); writeState(c, s);
    const meter = { used: 0, cap: ap.credit_cap };
    class Cap extends Error {}
    const reserve = (n, what) => { if (meter.used + n > meter.cap) throw new Cap('Stopped at the credit cap (' + meter.cap + ') before: ' + what + '.'); meter.used += n; };
    const sync = async () => { if (startBal == null) return; try { const b = await prov.balance(); if (Number.isFinite(b)) { const actual = Math.round((startBal - b) * 100) / 100; if (actual > meter.used) meter.used = actual; } } catch (e) {} };
    const companies = [], people = [];
    try {
      const enr = enrichedSet(s);
      if (step === 'enrichment') {
        for (const name of accounts) {
          const t = p.companies.find((x) => norm(x.company) === norm(name)); if (!t || !t.domain) continue;
          reserve(1, 'company lookup for ' + name); const info = await prov.company(t.domain); await sync();
          companies.push({ company: name, domain: t.domain, country: t.country, ...info });
        }
      } else {
        const f = s.filters, per = Math.min(ap.max_per_company || f.max_prospects_per_company, f.max_prospects_per_company);
        for (const name of accounts) {
          const a = p.accounts.find((x) => norm(x.account) === norm(name)); if (!a || !a.domain) continue;
          let info = enr[a.domain];
          if (!info) { reserve(1, 'company lookup for ' + name); info = { company: name, domain: a.domain, country: a.country, ...(await prov.company(a.domain)) }; await sync(); companies.push(info); }
          if (!sizeMatch(info.size, f.company_size)) { runRec.notes.push(name + ': company size ' + info.size + ' is outside the size filter, skipped.'); continue; }
          const seen = new Set(), pool = []; let paid = 0;
          const take = (res) => { for (const x of res.items || []) { const k = (x.profile_url || x.first_name + x.last_name + x.position).toLowerCase(); if (seen.has(k)) continue; seen.add(k); pool.push(x); } };
          const ranked = () => pool.map((x) => ({ x, m: scoreTitle(x.position, f) })).filter((y) => y.m.score >= 3).sort((u, v) => v.m.score - u.m.score);
          const exact = f.job_titles.concat(f.persona_roles).slice(0, 10);
          // 1) title-filtered list (an empty answer costs nothing, so it is refunded on the meter)
          reserve(1, 'people list for ' + name); const r1 = await prov.people(a.domain, { page: 1, positions: exact }); if ((r1.items || []).length) paid++; else meter.used -= 1; await sync(); take(r1);
          // 2) plain list pages, matched here for free, until enough people match or the page budget is used
          for (let pg = 1; ranked().length < per && paid < f.search_pages && pg <= LIMITS.pages_max; pg++) { reserve(1, 'people list page ' + pg + ' for ' + name); const r = await prov.people(a.domain, { page: pg }); if (!(r.items || []).length) { meter.used -= 1; break; } paid++; await sync(); take(r); if ((r.items || []).length < 20) break; }
          const top = ranked().slice(0, per);
          if (!top.length) runRec.notes.push(name + ': nobody matched the filters in the people list. Check the job titles.');
          for (const { x, m } of top) {
            reserve(1, 'email for ' + properCase(x.first_name + ' ' + x.last_name) + ' at ' + name); const e = await prov.email(x); await sync();
            people.push({ account: name, domain: a.domain, prospect_name: properCase((x.first_name + ' ' + x.last_name).trim()), public_title: x.position, why_matched: m.why.join('; '), linkedin_url: /^https:\/\/([a-z]+\.)?linkedin\.com\//i.test(x.profile_url) ? x.profile_url : '', email: e.email || '', email_verification: e.status === 'valid' ? 'Verified' : e.email ? 'Likely (not verified)' : 'Not found' });
          }
        }
      }
      runRec.status = 'done';
    } catch (e) {
      if (e instanceof Cap) { runRec.status = 'stopped at cap'; runRec.notes.push(e.message); } else { runRec.status = 'error'; runRec.notes.push(neutralStr(require('./util').scrub(e.message))); }
    } finally { running.delete(c); try { fs.unlinkSync(lock); } catch (e) {} }
    await sync(); runRec.credits_used = Math.max(0, meter.used); runRec.finished_at = now(); runRec.companies = companies; runRec.people_found = people.length;
    // output files (neutral names and headers), newest _V<n>; old versions stay on disk
    const outputs = [];
    const writeOut = (prefix, header, rows) => {
      if (!rows.length) return; fs.mkdirSync(filesDir, { recursive: true });
      let v = 1; try { for (const f of fs.readdirSync(filesDir)) { const m = f.match(new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_V(\\d+)\\.(csv|xlsx)$')); if (m) v = Math.max(v, +m[1] + 1); } } catch (e) {}
      const table = neutral([header, ...rows]); const base = prefix + '_V' + v;
      fs.writeFileSync(path.join(filesDir, base + '.csv'), toCsv(table)); fs.writeFileSync(path.join(filesDir, base + '.xlsx'), require('./xlsxw').writeXlsx(table, prefix.includes('Contact') ? 'Contact research' : 'Company enrichment'));
      outputs.push(base + '.xlsx', base + '.csv');
    };
    const stamp = runRec.finished_at.slice(0, 10);
    writeOut('01_OpportunityFinder_' + p_stem(c) + '_CompanyEnrichment', ['company', 'domain', 'country', 'company_name_found', 'size', 'industry', 'hq_city', 'founded', 'related_domains', 'people_listed', 'enriched_by', 'enriched_on', 'case_id'], companies.map((x) => [x.company, x.domain, x.country || '', x.name || '', x.size || '', x.industry || '', x.city || '', x.founded || '', (x.related_domains || []).slice(0, 8).join(' | '), String(x.people_listed || ''), 'Company enrichment', stamp, c]));
    if (step === 'contacts') writeOut('03_IntroDesk_' + p_stem(c) + '_ContactResearch', ['account', 'domain', 'prospect_name', 'public_title', 'why_matched', 'linkedin_url', 'email', 'email_verification', 'found_by', 'found_on', 'status', 'case_id'], people.map((x) => [x.account, x.domain, x.prospect_name, x.public_title, x.why_matched, x.linkedin_url, x.email, x.email_verification, 'Contact research', stamp, 'For human review', c]));
    runRec.outputs = outputs;
    const s2 = load(c).s; const r2 = (s2.runs || []).find((x) => x.id === runRec.id); Object.assign(r2 || {}, runRec); const ap2 = (s2.approvals || []).find((x) => x.id === ap.id); if (ap2) { ap2.status = 'used'; ap2.credits_used = runRec.credits_used; }
    s2.outputs = (s2.outputs || []).concat(outputs);
    hist(s2, runRec.by, 'run_finished', STEPS[step] + ' ' + runRec.status + ': ' + (step === 'contacts' ? people.length + ' contact(s), ' : '') + companies.length + ' company lookup(s), ' + runRec.credits_used + ' of ' + ap.credit_cap + ' credits used.' + (runRec.notes.length ? ' ' + runRec.notes.join(' ') : ''));
    writeState(c, s2);
    return neutral({ ...runRec, companies: undefined, people_preview: people.slice(0, 20) });
  }
  function p_stem(c) { return context(c).stem.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 80); }
  function cases() { const ids = [...new Set(items().map((r) => r.case_id).filter((x) => CASE_RE.test(String(x))))].sort(); return ids; }
  return { summary, plan: (c, st) => neutral(plan(checkCase(c), st === 'enrichment' ? 'enrichment' : 'contacts')), saveFilters, setEnrichment, approve, revoke, run, cases, neutral, hasVendor, scoreTitle, validateFilters, filtersHash };
}
module.exports = { createResearch, itemsFromSnapshot, neutral, hasVendor, DEFAULT_FILTERS, scoreTitle, validateFilters };
