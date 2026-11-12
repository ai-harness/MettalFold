'use strict';
// SHEET_MODE=appsscript: talks to the Google Apps Script web app in apps_script/Code.gs.
// The secret travels in the POST body over https only, never in a URL.
function create(opts) {
  const url = opts.url, secret = opts.secret;
  if (!url || !/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw new Error('APPS_SCRIPT_URL must be the https web app address from Google Apps Script.');
  if (!secret) throw new Error('APPS_SCRIPT_SECRET is empty.');
  // The whole call (connect + body) has one hard limit, so a stalled Google answer can never freeze the app.
  const LIMIT = Number(opts.timeoutMs) || 25000;
  async function call(action, payload) {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), LIMIT);
    try {
      let res;
      try { res = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret, action, ...payload }), signal: ac.signal }); }
      catch (e) { throw new Error('Cannot reach the sheet service (' + (e.name === 'AbortError' ? 'timed out' : e.message) + ')'); }
      let j; try { j = await res.json(); } catch (e) { throw new Error(e && e.name === 'AbortError' ? 'Cannot reach the sheet service (timed out while reading the answer)' : 'Sheet service sent an unreadable answer (HTTP ' + res.status + '). Check the deployment settings.'); }
      if (!j || !j.ok) throw new Error('Sheet service refused: ' + ((j && j.error) || 'unknown'));
      return j;
    } finally { clearTimeout(t); }
  }
  return {
    mode: 'appsscript',
    async ping() { await call('ping', {}); return true; },
    async readTab(tab) { const r = await call('read', { tab }); return Array.isArray(r && r.rows) ? r.rows : []; },
    async appendRow(tab, row) { await call('append', { tab, row }); },
    async updateRow(tab, match, patch) { return (await call('update', { tab, match, patch })).updated === true; }
  };
}
module.exports = { create };
