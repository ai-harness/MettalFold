'use strict';
// v39 hard rule: every #1 Opportunity Finder target list must give Website, Headcount, LinkedIn and Industry for each account.
// checkFile() reads the output (csv preferred, else xlsx main sheet) and lists what is missing, in plain words.
const fs = require('fs'), path = require('path');
const FIELDS = [
  { key: 'website', label: 'website', cols: ['company_website', 'website', 'domain', 'company_domain', 'url'] },
  { key: 'headcount', label: 'headcount', cols: ['headcount', 'employees', 'employee_count', 'employee_range', 'company_size', 'size'] },
  { key: 'linkedin', label: 'LinkedIn', cols: ['company_linkedin_url', 'linkedin', 'linkedin_url', 'company_linkedin'] },
  { key: 'industry', label: 'industry', cols: ['industry', 'company_industry'] }
];
const NAME_COLS = ['company_name', 'company', 'account', 'account_name', 'name'];
const EMPTY = /^(|-+|—|–|n\/?a|na|none|null|unknown|tbd|tbc|not found|not available|\?+)$/i;
const hnorm = (h) => String(h == null ? '' : h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const isEmpty = (v) => EMPTY.test(String(v == null ? '' : v).trim());
const looksLinkedIn = (v) => /linkedin\.com\/(company|school|showcase)\//i.test(String(v || ''));

function parseCsv(t) { const rows = []; let row = [], f = '', q = false; t = String(t).replace(/^\uFEFF/, ''); for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; } else if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; } else f += c; } if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows.filter((r) => r.some((x) => String(x).trim() !== '')); }

const listNames = (a) => (a.length <= 6 ? a.join(', ') : a.slice(0, 6).join(', ') + ' and ' + (a.length - 6) + ' more');
function message(missing, accounts) {
  if (!accounts) return 'Missing company details: no accounts found in the file.';
  if (!missing.length) return 'Company details complete: website, headcount, LinkedIn and industry for all ' + accounts + ' accounts.';
  const by = {}; for (const m of missing) for (const f of m.fields) (by[f] = by[f] || []).push(m.account);
  return 'Missing company details: ' + FIELDS.filter((f) => by[f.label]).map((f) => f.label + ' for ' + listNames(by[f.label])).join('; ') + '.';
}

// rows: array of arrays, first row with a company-name column is the header
function checkRows(rows) {
  rows = (rows || []).map((r) => (r || []).map((c) => (c == null ? '' : String(c))));
  const hi = rows.findIndex((r) => r.map(hnorm).some((h) => NAME_COLS.includes(h)));
  if (hi < 0) return { complete: false, accounts: 0, missing: [], missing_columns: FIELDS.map((f) => f.label), message: 'Missing company details: no company list found in the file.' };
  const h = rows[hi].map(hnorm), ni = NAME_COLS.map((n) => h.indexOf(n)).find((i) => i >= 0);
  const idx = {}; for (const f of FIELDS) idx[f.key] = f.cols.map((c) => h.indexOf(c)).filter((i) => i >= 0);
  const missingCols = FIELDS.filter((f) => !idx[f.key].length).map((f) => f.label);
  const missing = []; let accounts = 0;
  for (const r of rows.slice(hi + 1)) {
    const acc = String(r[ni] || '').trim(); if (!acc) continue; accounts++;
    const gaps = [];
    for (const f of FIELDS) {
      const vals = idx[f.key].map((i) => String(r[i] || '').trim()).filter((v) => !isEmpty(v));
      const okv = f.key === 'linkedin' ? vals.some(looksLinkedIn) : vals.length > 0;
      if (!okv) gaps.push(f.label);
    }
    if (gaps.length) missing.push({ account: acc, fields: gaps });
  }
  return { complete: accounts > 0 && !missing.length, accounts, missing, missing_columns: missingCols, message: message(missing, accounts) };
}

const cache = new Map();
// name: file name in filesDir (csv or xlsx). Returns null when the file is not on this computer yet.
function checkFile(filesDir, name) {
  const base = path.basename(String(name || '')).replace(/\.(csv|xlsx)$/i, ''); if (!base) return null;
  const csv = path.join(filesDir, base + '.csv'), xl = path.join(filesDir, base + '.xlsx');
  const f = fs.existsSync(csv) ? csv : fs.existsSync(xl) ? xl : null; if (!f) return null;
  let st; try { st = fs.statSync(f); } catch (e) { return null; }
  const key = f + '|' + st.mtimeMs + '|' + st.size, hit = cache.get(f); if (hit && hit.key === key) return hit.v;
  let rows = [];
  try { if (f === csv) rows = parseCsv(fs.readFileSync(f, 'utf8')); else { const X = require('./xlsx'), sh = X.readWorkbook(fs.readFileSync(f)); const tal = sh.find((s) => /^tal$|target/i.test(s.name)); rows = (tal || sh[X.mainSheet(sh)]).rows; } }
  catch (e) { return { complete: false, accounts: 0, missing: [], file: path.basename(f), message: 'Missing company details: the file could not be read here.' }; }
  const v = { ...checkRows(rows), file: path.basename(f), checked_at: new Date().toISOString() };
  cache.set(f, { key, v }); if (cache.size > 500) cache.delete(cache.keys().next().value);
  return v;
}

// for one request view: only #1 Opportunity Finder target lists (01_OpportunityFinder_*), never other desks
function forRequest(r, filesDir) {
  if (!r || r.agent_code !== 'opportunity_finder') return null;
  const link = String(r.output_link || ''); const m = link.match(/^\/files\/([^?#]+)$/); if (!m) return null;
  const n = path.basename(decodeURIComponent(m[1])); if (!/^01_OpportunityFinder_.+\.(csv|xlsx)$/i.test(n)) return null;
  return checkFile(filesDir, n);
}
module.exports = { checkRows, checkFile, forRequest, FIELDS, message };
