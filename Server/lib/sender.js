'use strict';
// Sends one request to one desk webhook. Format checked against Cursor automations docs:
// POST JSON to https://api2.cursor.sh/automations/webhook/<id> with header "Authorization: Bearer crsr_...".
const { AGENTS } = require('./agents');
const { scrub } = require('./util');
function create(env = process.env) {
  const mode = (env.WEBHOOK_MODE || 'mock').toLowerCase() === 'live' ? 'live' : 'mock';
  const conf = (code) => { const p = AGENTS[code].env; return { url: (env[p + '_URL'] || env['WEBHOOK_' + p + '_URL'] || '').trim(), key: (env[p + '_KEY'] || env['WEBHOOK_' + p + '_KEY'] || '').trim() }; };
  const sent = []; // mock mode only: what would have gone to each desk (used by the tests)
  const status = () => Object.fromEntries(Object.keys(AGENTS).map((c) => { const x = conf(c); return [c, !!(x.url && x.key)]; }));
  async function send(code, payload) {
    const t0 = Date.now();
    if (mode === 'mock') {
      sent.push({ code, payload: JSON.parse(JSON.stringify(payload)), at: Date.now() }); if (sent.length > 300) sent.shift();
      if (JSON.stringify(payload.inputs).toUpperCase().includes('WEBHOOKFAIL')) return { ok: false, status: 500, ms: 1, message: 'The desk did not accept the request (simulated send failure). You can retry.' };
      return { ok: true, status: 200, ms: 1 };
    }
    const { url, key } = conf(code);
    if (!url || !key) return { ok: false, status: 0, ms: 0, message: 'This desk is not connected yet: its webhook address or key is missing in .env.' };
    let u; try { u = new URL(url); } catch (_) { return { ok: false, status: 0, ms: 0, message: 'The webhook address for this desk is not a valid link.' }; }
    // the key may only ever go to the Cursor automations host over https
    if (u.protocol !== 'https:' || !/(^|\.)cursor\.sh$/.test(u.hostname) || !u.pathname.startsWith('/automations/webhook/')) return { ok: false, status: 0, ms: 0, message: 'The webhook address does not look like a Cursor automation address, so I did not send anything.' };
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 8000);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key, 'X-Automation-Key': key }, body: JSON.stringify(payload), signal: ac.signal, redirect: 'error' });
      const ms = Date.now() - t0; if (res.ok) return { ok: true, status: res.status, ms };
      const bodyText = await Promise.resolve().then(() => res.text()).catch(() => ''); const busy = /rate limit/i.test(bodyText);
      const why = res.status === 401 || res.status === 403 ? 'The desk rejected the key. Generate a new key in its routine panel and update .env.' : res.status === 404 ? 'The desk address was not found. Check the routine is saved and switched on.' : res.status === 429 || /rate limit/i.test(bodyText) ? 'The desk is busy. Please retry in a minute.' : `The desk could not take the request (HTTP ${res.status}).`;
      return { ok: false, status: res.status, ms, busy, message: why };
    } catch (e) { return { ok: false, status: 0, ms: Date.now() - t0, message: e.name === 'AbortError' ? 'The desk did not answer within 8 seconds. You can retry.' : scrub('Could not reach the desk (' + e.message + '). Check your internet connection.') }; }
    finally { clearTimeout(timer); }
  }
  // one line per desk: one request at a time, a short gap, and automatic retry when the platform is busy
  const lines = {}; const GAP = Number(env.SEND_GAP_MS) || 1500; const TRIES = Number(env.SEND_RETRIES) || 5;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isBusy = (r) => !r.ok && (r.status === 429 || r.status === 503 || r.busy);
  function queued(code, payload) {
    const prev = lines[code] || Promise.resolve();
    const run = prev.then(async () => {
      let r;
      for (let i = 0; i < TRIES; i++) {
        r = await send(code, payload);
        if (!isBusy(r)) break;
        await sleep(Math.min(60000, 5000 * Math.pow(2, i)));
      }
      await sleep(GAP);
      return r;
    });
    lines[code] = run.catch(() => {});
    return run;
  }
  return { mode, send: queued, status, sent };
}
module.exports = { create };
