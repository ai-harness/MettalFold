'use strict';
// v38: server-side adapter for the outside contact data service. Internal only: nothing in this file is sent to the
// browser, and every message that leaves it goes through neutral() in lib/research.js first.
// Credentials come from .env (CR_CLIENT_ID / CR_CLIENT_SECRET); without them the adapter reports "not connected".
const DEFAULT_BASE = 'https://api.snov.io';
// patterns used by lib/research.js to scrub the service name and its links out of anything users can see
const NAME_RE = /snov(?:\s*[.\-_]?\s*io)?/gi;
const LINK_RE = /https?:\/\/[^\s"']*snov[^\s"']*/gi;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createLiveProvider(env = process.env) {
  const id = String(env.CR_CLIENT_ID || env.SNOVIO_CLIENT_ID || '').trim();
  const secret = String(env.CR_CLIENT_SECRET || env.SNOVIO_CLIENT_SECRET || '').trim();
  const BASE = String(env.CR_API_BASE || DEFAULT_BASE).replace(/\/$/, '');
  const connected = !!(id && secret);
  let token = null, tokenExp = 0;
  async function call(method, url, { form, query } = {}) {
    if (!connected) throw new Error('Contact research is not connected on this computer.');
    if (!url.startsWith(BASE + '/')) throw new Error('Refused an unexpected address.');
    const u = new URL(url);
    for (const [k, v] of Object.entries(query || {})) { if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x)); else if (v != null) u.searchParams.set(k, v); }
    const headers = {}; let body;
    if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    if (!/oauth/.test(u.pathname)) headers.Authorization = 'Bearer ' + (await tok());
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 30000);
    let r; try { r = await fetch(u, { method, headers, body, signal: ac.signal, redirect: 'error' }); } finally { clearTimeout(t); }
    const txt = await r.text(); let j = null; try { j = JSON.parse(txt); } catch (e) { j = null; }
    if (!r.ok) throw new Error('Contact research service answered ' + r.status + '.');
    return j || {};
  }
  async function tok() {
    if (token && Date.now() < tokenExp) return token;
    const j = await call('POST', BASE + '/v1/oauth/access_token', { form: { grant_type: 'client_credentials', client_id: id, client_secret: secret } });
    if (!j.access_token) throw new Error('Contact research sign-in failed.');
    token = j.access_token; tokenExp = Date.now() + Math.max(60, Number(j.expires_in) || 3000) * 1000 - 60000; return token;
  }
  async function poll(url, tries = 25) {
    let j = {}; for (let i = 0; i < tries; i++) { j = await call('GET', url); if (!['in_progress', 'not_started', 'pending'].includes(j.status)) return j; await sleep(2000); }
    return j;
  }
  const hashOf = (j) => (j && j.meta && j.meta.task_hash) || (j && j.data && j.data.task_hash) || '';
  return {
    kind: 'live', connected,
    // free
    async balance() { const j = await call('GET', BASE + '/v1/get-balance'); return Number(j && j.data && j.data.balance); },
    // 1 credit per company
    async company(domain) {
      const s = await call('POST', BASE + '/v2/domain-search/start', { query: { domain } }); const h = hashOf(s); if (!h) throw new Error('Company lookup did not start.');
      const j = await poll(BASE + '/v2/domain-search/result/' + h); const d = j.data || {}, m = j.meta || {};
      return { name: d.company_name || '', city: d.city || '', founded: d.founded || '', website: d.website || '', industry: d.industry || '', size: d.size || '', related_domains: Array.isArray(d.related_domains) ? d.related_domains : [], people_listed: Number(m.prospects_count) || 0 };
    },
    // 1 credit per page that returns people (an empty page cost 0 in the 22 Oct test)
    async people(domain, { page = 1, positions = [] } = {}) {
      const q = { domain, page }; if (positions.length) q['positions[]'] = positions.slice(0, 10);
      const s = await call('POST', BASE + '/v2/domain-search/prospects/start', { query: q }); const h = hashOf(s); if (!h) throw new Error('People list did not start.');
      const j = await poll(BASE + '/v2/domain-search/prospects/result/' + h);
      const items = (Array.isArray(j.data) ? j.data : []).map((p) => ({ first_name: p.first_name || '', last_name: p.last_name || '', position: p.position || '', profile_url: p.source_page || p.linkedin_url || '', ref: p.search_emails_start || '' }));
      return { items, total: Number(j.meta && j.meta.total_count) || items.length };
    },
    // 1 credit per person
    async email(person) {
      if (!person.ref) return { email: '', status: 'not found' };
      const s = await call('POST', person.ref); const h = hashOf(s); if (!h) throw new Error('Email lookup did not start.');
      const j = await poll(BASE + '/v2/domain-search/prospects/search-emails/result/' + h); const e = ((j.data && j.data.emails) || [])[0] || {};
      return { email: e.email || '', status: e.smtp_status || (e.email ? 'unknown' : 'not found') };
    }
  };
}
module.exports = { createLiveProvider, NAME_RE, LINK_RE };
