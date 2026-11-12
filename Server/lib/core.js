'use strict';
const { AGENTS, CODES, REQUEST_COLS } = require('./agents');
const { clean, sha, truthy, parseSteps, parseBehind, scrub } = require('./util');
const mockAgent = require('./mockAgent');
const fs = require('fs'), pathm = require('path');

class HttpError extends Error { constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; } }
const now = () => new Date().toISOString();
const parseInputs = (s) => { try { const o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (_) { return {}; } };
const publicInputs = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
const fingerprint = (agent, caseId, parent, inputs) => sha([agent, caseId, parent || '', JSON.stringify(Object.keys(publicInputs(inputs)).filter((k) => k !== 'case_label').sort().map((k) => [k, String(publicInputs(inputs)[k]).trim().toLowerCase()]))].join('|'));

function validateInputs(agent, raw) {
  const def = AGENTS[agent], errors = {}, out = {};
  raw = raw && typeof raw === 'object' ? raw : {};
  for (const f of def.fields) {
    let v = raw[f.key];
    if (f.type === 'bool') { v = v === true || truthy(v); if (f.required && !v) errors[f.key] = 'Please tick this box. A human must record the soft yes first.'; out[f.key] = v; continue; }
    v = clean(v, f.max || 500);
    if (!v) { if (f.required) errors[f.key] = `Please fill in: ${f.label.split(' (')[0]}.`; continue; }
    if (f.type === 'int') { const n = Number(v); if (!Number.isInteger(n) || n < f.min || n > f.max) { errors[f.key] = `${f.label} must be a whole number from ${f.min} to ${f.max}.`; continue; } v = n; }
    if (f.type === 'url') { try { const u = new URL(v); if (!['http:', 'https:'].includes(u.protocol)) throw 0; } catch (_) { errors[f.key] = 'This link must start with http:// or https://'; continue; } }
    out[f.key] = v;
  }
  const lbl = clean(raw.case_label, 120); if (lbl) out.case_label = lbl;
  return { errors, inputs: out };
}

// v35: file names and links out of free text too, e.g. "Yotta: /workspace/x/03_IntroDesk_..._V1.xlsx (rows for Yotta); Nxtra: ..."
const FILE_TOKEN = /(?:^|[\s\/\\:("'])([A-Za-z0-9][A-Za-z0-9._-]*\.(?:pdf|xlsx|csv|png|jpg|pptx|docx))(?![A-Za-z0-9])/gi;
function fileTokens(v) {
  const ok = /^[A-Za-z0-9._ -]+\.(pdf|xlsx|csv|png|jpg|pptx|docx)$/i, out = [];
  for (const seg of String(v || '').split(/[\n\r,;|]+/).map((x) => x.trim()).filter(Boolean)) {
    if (/^https?:\/\/\S+$/.test(seg)) { out.push(seg); continue; }
    let b = seg.split(/[\\/]/).pop(); try { b = decodeURIComponent(b); } catch (e) {}
    if (ok.test(b)) { out.push(b); continue; }
    for (const m of seg.matchAll(FILE_TOKEN)) out.push(m[1]);
    for (const m of seg.matchAll(/https?:\/\/[^\s)"']+/g)) if (!out.includes(m[0])) out.push(m[0]);
  }
  return [...new Set(out)];
}
function fileLink(v) {
  v = String(v || '').trim(); if (/^https?:\/\/\S+$/.test(v)) return v;
  const ok = /^[A-Za-z0-9._ -]+\.(pdf|xlsx|csv|png|jpg|pptx|docx)$/i;
  const links = fileTokens(v);
  if (!links.length) return '';
  const rank = (b) => /\.pdf$/i.test(b) ? 0 : /\.csv$/i.test(b) ? 1 : /\.xlsx$/i.test(b) ? 2 : 3;
  links.sort((a, b) => rank(a) - rank(b));
  const b = links[0]; return /^https?:\/\//.test(b) ? b : '/files/' + encodeURIComponent(b);
}
// v35: every file a result names (main output_link, all of its links, and every helper desk's output_link), as /files/ links, no duplicates
function allFileLinks(mainRaw, behindItems) {
  const ok = /^[A-Za-z0-9._ -]+\.(pdf|xlsx|csv|png|jpg|pptx|docx)$/i, out = [], seen = new Set();
  const add = (raw, from) => { for (const b of fileTokens(raw)) { if (/^https?:\/\//.test(b) || !ok.test(b) || seen.has(b)) continue; seen.add(b); out.push({ name: b, url: '/files/' + encodeURIComponent(b), from }); } };
  add(mainRaw, 'main'); for (const it of behindItems || []) add(it.output_link, it.name || 'helper');
  return out;
}
function normBehind(b) { return { text: b.text, items: (b.items || []).map((x) => ({ ...x, output_link: x.output_link ? fileLink(x.output_link) : '' })) }; }
function createCore({ sheet, audit, sender, env = process.env, sheetId = '', mockDelayMs = 400, inlineMock = true }) {
  const pollMs = Number(env.POLL_MS) || Math.max(1, Number(env.POLL_SECONDS) || 4) * 1000;
  const delayHintMs = (Number(env.DELAY_HINT_SECONDS) || 300) * 1000;
  const timeoutMs = (Number(env.TIMEOUT_MINUTES) || 15) * 60 * 1000;
  const MAX_RETRIES = 3;
  const strict = String(env.STRICT_GATES || '1') !== '0';
  const cache = { requests: [], results: [], at: null, ok: false, error: '', lastOk: null, ready: false };
  let prev = null, timer = null, busy = false, chain = Promise.resolve();
  const lock = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };

  // Hard cap per read so the poller can never hang (a stalled read once froze it for 16 minutes).
  const READ_LIMIT = Number(env.SHEET_READ_LIMIT_MS) || 30000;
  const capped = (p) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error('Sheet read took too long (over ' + Math.round(READ_LIMIT / 1000) + ' s); will try again')), READ_LIMIT); })]).finally(() => clearTimeout(t)); };
  async function readBoth() {
    const once = async () => {
      const [a, b] = await capped(Promise.all([sheet.readTab('Requests'), sheet.readTab('Results')]));
      if (!Array.isArray(a) || !Array.isArray(b)) throw new Error('Sheet returned an invalid response');
      return [a, b];
    };
    try { return await once(); } catch (e) { await new Promise((r) => setTimeout(r, 800)); return await once(); }
  }

  // ---------- polling (one shared read of both tabs, cached) ----------
  const pendingDec = {}, confirmed = {};
  const DATA = env.DATA_DIR || pathm.join(__dirname, '..', 'data');
  const qFile = pathm.join(DATA, 'pending_writes.json'), snapFile = pathm.join(DATA, 'sheet_snapshot.json');
  const timings = { read: { n: 0, last: 0, avg: 0, max: 0 }, approve_ack_ms: 0, approve_save_ms: 0, submit_ack_ms: 0 };
  let queue = []; try { queue = JSON.parse(fs.readFileSync(qFile, 'utf8')); if (!Array.isArray(queue)) queue = []; } catch (_) { queue = []; }
  for (const e of queue) pendingDec[e.request_id] = e.state;
  const saveQ = () => { try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(qFile + '.tmp', JSON.stringify(queue)); fs.renameSync(qFile + '.tmp', qFile); } catch (_) {} };
  let snapAt = 0; const saveSnap = () => { if (Date.now() - snapAt < 15000) return; snapAt = Date.now(); try { fs.mkdirSync(DATA, { recursive: true }); fs.writeFileSync(snapFile + '.tmp', JSON.stringify({ requests: cache.requests, results: cache.results })); fs.renameSync(snapFile + '.tmp', snapFile); } catch (_) {} };
  try { const sn = JSON.parse(fs.readFileSync(snapFile, 'utf8')); if (Array.isArray(sn.requests) && Array.isArray(sn.results)) { cache.requests = sn.requests; cache.results = sn.results; } } catch (_) {}
  const sleepMs = (n) => new Promise((r) => setTimeout(r, n));
  const cacheAge = () => (cache.lastOk ? Date.now() - Date.parse(cache.lastOk) : Infinity);
  async function readFresh(maxAgeMs) { if (cache.ok && cache.ready && cacheAge() < maxAgeMs) return { requests: cache.requests, results: cache.results }; return freshRead(); }
  let draining = false;
  async function drain() {
    if (draining) return; draining = true;
    try {
      while (queue.length) {
        const e = queue[0]; const wt = (e.nextAt || 0) - Date.now(); if (wt > 0) { await sleepMs(Math.min(wt, 3000)); continue; }
        const t = Date.now();
        try {
          const [ok] = await Promise.all([sheet.updateRow('Results', { request_id: e.request_id }, { approval_state: e.state, status: 'done', updated_at: now() }), sheet.updateRow('Requests', { request_id: e.request_id }, { status: 'done' })]);
          if (!ok) throw new Error('Result row not found');
          const ms = Date.now() - t; timings.approve_save_ms = ms; queue.shift(); saveQ(); confirmed[e.request_id] = Date.now();
          audit.log('timing', { user: e.user, request_id: e.request_id, detail: `${e.state} saved to the sheet in ${ms} ms (${Date.now() - e.ts} ms after click, try ${(e.tries || 0) + 1}).` });
          audit.log('decision_saved', { user: e.user, request_id: e.request_id, detail: `Saved ${e.state} to the sheet (${Date.now() - e.ts} ms after click).` });
        } catch (err) {
          e.tries = (e.tries || 0) + 1; audit.log('sheet_error', { user: e.user, request_id: e.request_id, detail: scrub(err.message) + ' (save try ' + e.tries + ')' });
          if (e.tries >= 8) { delete pendingDec[e.request_id]; queue.shift(); audit.log('decision_failed', { user: e.user, request_id: e.request_id, detail: 'Could not save ' + e.state + ' to the sheet after 8 tries; it was rolled back.' }); }
          else e.nextAt = Date.now() + Math.min(30000, 2000 * 2 ** e.tries);
          saveQ();
        }
      }
    } finally { draining = false; }
  }
  function applyPending() { for (const [id, st] of Object.entries(pendingDec)) { const row = (Array.isArray(cache.results) ? cache.results : []).find((x) => x.request_id === id); if (row) { row.approval_state = st; row.status = 'done'; } const q = (Array.isArray(cache.requests) ? cache.requests : []).find((x) => x.request_id === id); if (q) q.status = 'done'; } }
  async function tick() {
    if (busy) return; busy = true;
    try {
      const rt0 = Date.now(); const [requests, results] = await readBoth(); const rms = Date.now() - rt0; { const R = timings.read; R.n++; R.last = rms; R.max = Math.max(R.max, rms); R.avg = Math.round(R.avg + (rms - R.avg) / Math.min(R.n, 20)); if (rms > 5000) audit.log('timing', { detail: `Slow sheet read: ${rms} ms.` }); }
      if (!cache.ok && cache.ready) audit.log('sheet_recovered', { detail: 'Sheet reachable again.' });
      Object.assign(cache, { requests, results, at: now(), ok: true, error: '', lastOk: now(), ready: true }); applyPending(); saveSnap();
      for (const id of Object.keys(confirmed)) { if (rt0 > confirmed[id] || Date.now() - confirmed[id] > 60000) { delete confirmed[id]; if (!queue.some((q) => q.request_id === id)) delete pendingDec[id]; } }
      const v = views(); const map = {};
      for (const r of v.items) {
        map[r.request_id] = [r.status, r.approval_state, r.outcome, r.error_message, r.sub_agent_steps.map((s) => s.status).join(','), sha(JSON.stringify(r.behind || ''))].join('|');
        if (prev && prev[r.request_id] !== map[r.request_id]) audit.log('status_seen', { request_id: r.request_id, case_id: r.case_id, detail: `${r.agent_label}: ${r.status}${r.outcome ? ' / ' + r.outcome : ''}${r.approval_state ? ' / approval ' + r.approval_state : ''}${r.error_message ? ' / ' + r.error_message : ''}` });
        if (r.delayed && prev && !(prev[r.request_id] || '').includes('#late')) { map[r.request_id] += '#late'; audit.log('delay_flagged', { request_id: r.request_id, case_id: r.case_id, detail: 'No answer yet from the desk after the wait limit.' }); }
      }
      for (const o of v.orphans) { const k = 'orphan:' + o.request_id; if (prev && !(k in prev)) audit.log('unexpected_result', { request_id: o.request_id, detail: 'A result row has no matching request from this app.' }); map[k] = 1; }
      prev = map;
    } catch (e) {
      const msg = scrub(e.message);
      if (cache.ok || !cache.ready) audit.log('sheet_error', { detail: msg });
      Object.assign(cache, { ok: false, error: msg, ready: true });
    } finally { busy = false; }
  }
  function start() { if (timer) return; if (queue.length) drain(); tick(); timer = setInterval(tick, pollMs); }
  function stop() { clearInterval(timer); timer = null; }

  // ---------- views ----------
  function views() {
    const resBy = {}; for (const r of (Array.isArray(cache.results) ? cache.results : [])) resBy[r.request_id] = r; // last row wins
    const reqIds = new Set((Array.isArray(cache.requests) ? cache.requests : []).map((r) => r.request_id));
    const t = Date.now();
    const items = (Array.isArray(cache.requests) ? cache.requests : []).map((q) => {
      const def = AGENTS[q.agent_code]; const res = resBy[q.request_id]; const inputs = parseInputs(q.inputs_json);
      const status = (res && res.status ? String(res.status).toLowerCase().trim() : String(q.status || 'queued').toLowerCase().trim());
      const outcome = res ? res.outcome || '' : '';
      const approval = res ? String(res.approval_state || '').toLowerCase() : '';
      const age = t - Date.parse(q.submitted_at || now());
      const active = status === 'queued' || status === 'running';
      const delayed = active && age > delayHintMs, stuck = active && age > timeoutMs;
      const autoOnboard = q.agent_code === 'supplier_qualification' && (status === 'done' || status === 'needs approval') && outcome !== 'Drop' && approval !== 'rejected';
      const decided = approval === 'approved' || approval === 'rejected';
      const pending = !!res && !active && status !== 'error' && !decided && !autoOnboard;
      const okOutcome = !def || !def.approvalOutcomes || def.approvalOutcomes.includes(outcome);
      const held = ['Hold', 'Drop', 'Book Waiting'].includes(outcome) || !okOutcome;
      const canApprove = pending;
      const approved = approval === 'approved' || autoOnboard;
      const closed = approval === 'rejected';
      let chip = { queued: 'Queued', running: 'Working', done: 'Done', 'needs approval': 'Needs your approval', error: 'Problem' }[status] || 'Working';
      if (approved) chip = autoOnboard ? 'Onboarded (confirmed by you)' : 'Approved'; if (approval === 'rejected') chip = 'Rejected';
      if (outcome === 'Hold' && !autoOnboard) chip = 'On hold'; if (outcome === 'Drop') chip = 'Closed (Drop)'; if (outcome === 'Book Waiting') chip = 'Book waiting';
      if (stuck) chip = 'No answer'; else if (delayed) chip = 'Taking longer than usual';
      const retries = Number(inputs._retry_count || 0);
      const partial = !!res && status !== 'error' && !!res.error_message;
      return {
        request_id: q.request_id, case_id: q.case_id, case_label: inputs.case_label || '', agent_code: q.agent_code, agent_label: def ? def.label : q.agent_code,
        submitted_at: q.submitted_at, submitted_by: q.submitted_by, parent_request_id: q.parent_request_id || '', inputs: publicInputs(inputs), retry_of: inputs._retry_of || '',
        status, chip, outcome, summary: res ? res.summary || '' : '', next_step: res ? res.next_step || '' : '', needs_approval: res ? truthy(res.needs_approval) : false,
        approval_state: approval, output_link: res ? fileLink(res.output_link) : '', error_message: scrub(res ? res.error_message || '' : ''),
        updated_at: res ? res.updated_at || '' : q.submitted_at, sub_agent_steps: res ? parseSteps(res.sub_agent_steps) : [], behind: res ? normBehind(parseBehind(res.sub_agent_steps)) : { items: [], text: '' }, files: res ? allFileLinks(res.output_link, parseBehind(res.sub_agent_steps).items) : [], partial, delayed, stuck, closed, approved,
        approve_label: def ? def.approveLabel : '', held: pending && held, hold_reason: pending && held ? (res.summary || res.next_step || outcome || 'no reason given') : '', gate_text: def ? def.gateText : '',
        can: {
          approve: canApprove, reject: pending, override: canApprove && held,
          retry: (status === 'error' || delayed) && retries < MAX_RETRIES,
          resubmit: !active || delayed,
          next: approved && def && def.next ? def.next : null
        }
      };
    });
    const orphans = (Array.isArray(cache.results) ? cache.results : []).filter((r) => !reqIds.has(r.request_id)).map((r) => ({ request_id: r.request_id, agent_code: r.agent_code, status: r.status }));
    return { items, orphans };
  }
  const find = (id) => views().items.find((r) => r.request_id === id);

  // ---------- ids ----------
  const nextId = (ids, prefix) => { let m = 0; for (const id of ids) { const x = new RegExp('^' + prefix + '-(\\d+)').exec(id || ''); if (x) m = Math.max(m, Number(x[1])); } let id = `${prefix}-${String(m + 1).padStart(4, '0')}`; if (ids.includes(id)) id += '-' + Math.random().toString(36).slice(2, 5).toUpperCase(); return id; };

  async function freshRead() {
    try { const [requests, results] = await readBoth(); Object.assign(cache, { requests, results, at: now(), ok: true, error: '', lastOk: now(), ready: true }); return { requests, results }; }
    catch (e) { audit.log('sheet_error', { detail: scrub(e.message) }); Object.assign(cache, { ok: false, error: scrub(e.message) }); throw new HttpError(503, 'I cannot reach the sheet right now, so nothing was sent. Please try again in a moment.'); }
  }

  // ---------- submit ----------
  async function submitOne({ user, agent_code, case_id, parent_request_id, inputs, allow_duplicate, retry_of, retry_count, revision, stored_feedback, stored_attachments }) {
    const def = AGENTS[agent_code]; if (!def) throw new HttpError(400, 'Unknown desk.');
    const { errors, inputs: clean_ } = validateInputs(agent_code, inputs);
    if (Object.keys(errors).length) throw new HttpError(400, 'Please fix the highlighted fields.', { fields: errors });
    const st0 = Date.now(); const { requests } = await readFresh(10000); const v = views();
    if (agent_code === 'product_book') {
      const busy = v.items.find((r) => r.agent_code === 'product_book' && (r.status === 'queued' || r.status === 'running') && !r.stuck);
      if (busy) { audit.log('one_book_at_a_time', { user, request_id: busy.request_id, detail: `Blocked a new product book while ${busy.request_id} is still running.` }); throw new HttpError(409, `A product book is already running (${busy.request_id}). Please wait for it to finish, then start the next one.`, { busy_request_id: busy.request_id }); }
    }
    let parent = null; parent_request_id = clean(parent_request_id, 40);
    if (def.parent) {
      if (!parent_request_id) throw new HttpError(400, `This step needs an approved earlier step: ${AGENTS[def.parent.agent].label}.`, { fields: { parent_request_id: 'Pick the approved earlier request.' } });
      parent = v.items.find((r) => r.request_id === parent_request_id);
      if (!parent) throw new HttpError(400, 'I cannot find that earlier request.');
      if (parent.agent_code !== def.parent.agent) throw new HttpError(400, `This step must follow ${AGENTS[def.parent.agent].label}.`);
      if (strict && !parent.approved) { audit.log('gate_blocked', { user, request_id: parent_request_id, case_id: parent.case_id, detail: `Blocked ${agent_code}: earlier step not approved by a human.` }); throw new HttpError(409, `A human must approve the earlier step first (${parent.agent_label}, ${parent.request_id}).`); }
      if (strict && def.parent.outcome && parent.agent_code !== 'supplier_qualification' && !parent.approved && parent.outcome !== def.parent.outcome) throw new HttpError(409, `The earlier step must have the outcome "${def.parent.outcome}".`);
      if (case_id && case_id !== parent.case_id) throw new HttpError(400, 'That earlier request belongs to a different case.');
      case_id = parent.case_id;
    } else if (parent_request_id) { const p = v.items.find((r) => r.request_id === parent_request_id); if (!p) throw new HttpError(400, 'I cannot find the request you are resubmitting.'); case_id = case_id || p.case_id; }
    if (agent_code === 'intro_desk' && parent && parent.summary && clean_.account) {
      for (const acct of String(clean_.account).split(/[\n;]+/).map((x) => x.trim()).filter(Boolean)) {
        const line = parent.summary.split('\n').find((l) => l.toLowerCase().includes(acct.toLowerCase()));
        if (line && /keep warm/i.test(line) && !/pursue now/i.test(line)) throw new HttpError(409, `${acct} is "Keep warm" in the #2 result, not "Pursue now". Only Pursue now accounts go to #3.`);
      }
    }
    if (case_id) { if (!requests.some((r) => r.case_id === case_id)) throw new HttpError(400, 'I cannot find that case.'); }
    else case_id = nextId([...new Set(requests.map((r) => r.case_id))], 'CASE');
    if (clean_.case_label === undefined) { const e = v.items.find((r) => r.case_id === case_id && r.case_label); if (e) clean_.case_label = e.case_label; }
    const fp = fingerprint(agent_code, case_id, parent_request_id, clean_);
    if (!allow_duplicate) {
      const dup = views().items.find((r) => r.agent_code === agent_code && r.case_id === case_id && r.parent_request_id === (parent_request_id || '') && fingerprint(r.agent_code, r.case_id, r.parent_request_id, r.inputs) === fp && !(r.status === 'error' || r.stuck || r.approval_state === 'rejected'));
      if (dup) { audit.log('duplicate_blocked', { user, request_id: dup.request_id, case_id, detail: `Same ${agent_code} request already exists.` }); throw new HttpError(409, `This looks the same as ${dup.request_id} (${dup.chip}). If you really want it again, choose "Submit anyway".`, { duplicate_of: dup.request_id }); }
    }
    return lock(async () => {
      const fresh = (await readFresh(10000)).requests;
      const request_id = nextId(fresh.map((r) => r.request_id), 'REQ');
      const stored = { ...clean_ }; if (revision) { stored._revision_of = revision.of; stored._feedback = stored_feedback || revision.feedback; if (stored_attachments && stored_attachments.length) stored._attachments = stored_attachments; }
      if (retry_of) { stored._retry_of = retry_of; stored._retry_count = retry_count || 1; }
      const row = { request_id, case_id, agent_code, submitted_at: now(), submitted_by: user, inputs_json: JSON.stringify(stored), parent_request_id: parent_request_id || '', status: 'queued' };
      try { await sheet.appendRow('Requests', row); } catch (e) { audit.log('sheet_error', { user, detail: scrub(e.message) }); throw new HttpError(503, 'I could not write to the sheet, so nothing was sent. Please try again.'); }
      audit.log('submitted', { user, request_id, case_id, detail: `${def.label} request saved in the sheet${retry_of ? ' (retry of ' + retry_of + ')' : ''}.` });
      cache.requests = [...(Array.isArray(cache.requests) ? cache.requests : []), row];
      const ackMs = Date.now() - st0; timings.submit_ack_ms = ackMs; audit.log('timing', { user, request_id: row.request_id, case_id, detail: `Submit answered in ${ackMs} ms (sheet write included). Checking for an id clash and calling the desk in the background.` });
      // two Macs at the same moment: if the id clash happens, the later row gets a short suffix. Runs after we answer, before the desk is called.
      (async () => {
        try {
          const again = await sheet.readTab('Requests'); const same = again.filter((r) => r.request_id === request_id);
          if (same.length > 1) {
            const idx = same.findIndex((r) => r.submitted_by === row.submitted_by && r.submitted_at === row.submitted_at && r.inputs_json === row.inputs_json);
            if (idx > 0) { const nid = request_id + '-' + Math.random().toString(36).slice(2, 5).toUpperCase(); await sheet.updateRow('Requests', { request_id, submitted_at: row.submitted_at, submitted_by: row.submitted_by, inputs_json: row.inputs_json }, { request_id: nid }); audit.log('id_collision_fixed', { user, request_id: nid, detail: `Two requests got ${request_id} at the same time; this one is now ${nid}.` }); row.request_id = nid; }
          }
        } catch (_) { /* check is best effort */ }
        deliver(row, clean_, parent, revision).catch((e) => audit.log('send_error', { user, request_id: row.request_id, detail: e.message }));
      })();
      return { request_id: row.request_id, case_id, status: 'queued' };
    });
  }

  // Human confirmation travels with EVERY desk AND every helper inside it (GTM Execution Matching Desk, Relationship
  // Manager, signals): an uploaded supplier is onboarded (confirmed by a human), whatever the qualification desk said.
  const SQ = 'Onboard (confirmed by human)';
  const HELPERS = ['GTM Execution Matching Desk', 'Relationship Manager', 'GTM signals', 'any other helper or sub-agent'];
  function buildPayload(row, inputs, parent, revision) {
    const items = views().items; let sq = null;
    { let cur = row.agent_code === 'supplier_qualification' ? row : items.find((x) => x.request_id === row.parent_request_id); let n = 0;
      while (cur && n++ < 12) { if (cur.agent_code === 'supplier_qualification') { sq = cur; break; } cur = items.find((x) => x.request_id === cur.parent_request_id); } }
    // #1 can start without a parent link: fall back to the supplier step of the same case (latest one not rejected)
    if (!sq && row.agent_code !== 'supplier_qualification') sq = items.filter((x) => x.case_id === row.case_id && x.agent_code === 'supplier_qualification' && x.approval_state !== 'rejected' && x.outcome !== 'Drop').sort((x, y) => String(y.submitted_at).localeCompare(String(x.submitted_at)))[0] || null;
    const supplierName = (sq && sq.inputs && sq.inputs.supplier_name) || (inputs && inputs.supplier_name) || '';
    const rule = 'The supplier' + (supplierName ? ' ' + supplierName : '') + ' was uploaded by a human and is ALREADY ONBOARDED (confirmed by a human). Treat its supplier status as "' + SQ + '" everywhere. Never treat it as Hold, On hold, Waiting or not yet onboarded, never park or drop accounts for that reason, and pass this same rule to every helper or sub-agent you call (' + HELPERS.join(', ') + ').';
    const hc = { uploaded_supplier_confirmed: true, supplier_outcome: SQ, supplier_status: SQ, supplier_name: supplierName || null, rule, supplier_request_id: sq ? sq.request_id : (row.agent_code === 'supplier_qualification' ? row.request_id : null), desk_outcome_seen: sq ? sq.outcome || null : null };
    // the whole case so far, with the supplier step already mapped to the human-confirmed outcome
    const case_context = items.filter((x) => x.case_id === row.case_id && x.request_id !== row.request_id && x.approval_state !== 'rejected').sort((x, y) => String(x.submitted_at).localeCompare(String(y.submitted_at)))
      .map((x) => ({ request_id: x.request_id, agent_code: x.agent_code, outcome: x.agent_code === 'supplier_qualification' ? SQ : x.outcome, approved_by_human: !!x.approved, ...(x.agent_code === 'supplier_qualification' ? { original_desk_outcome: x.outcome } : {}) }));
    const helperCtx = Object.fromEntries(['gtm_execution_matching', 'relationship_manager', 'gtm_signals'].map((k) => [k, { ...hc }]));
    // v35: the request id comes FIRST (and again inside inputs) so a desk never has to guess it from case_context
    const idNote = 'This request is ' + row.request_id + ' (case ' + row.case_id + '). Write your Results row with request_id = ' + row.request_id + ' exactly. The other ids in case_context are earlier steps, not this request.';
    return { request_id: row.request_id, case_id: row.case_id, agent_code: row.agent_code, this_request: { request_id: row.request_id, case_id: row.case_id, agent_code: row.agent_code, write_results_row_with_request_id: row.request_id, note: idNote },
      revision: revision || undefined, uploaded_supplier_confirmed: true, supplier_outcome: SQ, supplier_status: SQ,
      human_confirmation: hc, sub_agent_context: { pass_to_every_helper: true, helpers: helperCtx, note: rule }, sub_agent_brief: rule, case_context,
      // the inputs object is what desks forward most reliably, so the confirmation and the request id ride inside it too (not stored in the sheet)
      inputs: { request_id: row.request_id, case_id: row.case_id, ...inputs, supplier_status: SQ, supplier_status_note: rule, request_id_note: idNote }, parent_request_id: row.parent_request_id || null, submitted_by: row.submitted_by, sheet_id: sheetId || null,
      parent: parent ? { request_id: parent.request_id, agent_code: parent.agent_code, outcome: parent.agent_code === 'supplier_qualification' ? SQ : parent.outcome, summary: parent.summary, output_link: parent.output_link, ...(parent.agent_code === 'supplier_qualification' ? { original_desk_outcome: parent.outcome } : {}) } : null, _sq: sq };
  }
  async function deliver(row, inputs, parent, revision) {
    const payload = buildPayload(row, inputs, parent, revision); const sq = payload._sq; delete payload._sq;
    audit.log('payload_flags', { user: row.submitted_by, request_id: row.request_id, case_id: row.case_id, detail: `Payload carries uploaded_supplier_confirmed=true, supplier_outcome="${SQ}" for the desk and its helpers (Matching Desk, Relationship Manager)${sq ? ' (supplier step ' + sq.request_id + ', desk had said ' + (sq.outcome || 'nothing') + ')' : ''}.` });
    audit.log('webhook_sending', { user: row.submitted_by, request_id: row.request_id, case_id: row.case_id, detail: `Calling the ${AGENTS[row.agent_code].label} desk (${sender.mode} mode). Payload starts with request_id=${payload.request_id} (also in this_request and inputs.request_id).` });
    const r = await sender.send(row.agent_code, payload);
    if (r.ok) {
      audit.log('webhook_sent', { user: row.submitted_by, request_id: row.request_id, case_id: row.case_id, detail: `Desk accepted the request (${r.status}, ${r.ms} ms).` });
      if (sender.mode === 'mock' && inlineMock) mockAgent.handle(sheet, { request_id: row.request_id, agent_code: row.agent_code, inputs }, mockDelayMs, { filesDir: env.MOCK_FILES_DIR || '' }).catch((e) => audit.log('mock_error', { request_id: row.request_id, detail: e.message }));
      return;
    }
    audit.log('webhook_failed', { user: row.submitted_by, request_id: row.request_id, case_id: row.case_id, detail: r.message });
    await markError(row.request_id, row.agent_code, r.message);
  }
  async function markError(request_id, agent_code, message) {
    try {
      await sheet.updateRow('Requests', { request_id }, { status: 'error' });
      const ok = await sheet.updateRow('Results', { request_id }, { status: 'error', error_message: message, updated_at: now() });
      if (!ok) await sheet.appendRow('Results', { request_id, agent_code, status: 'error', outcome: '', summary: '', next_step: 'Try again.', needs_approval: 'no', approval_state: '', output_link: '', error_message: message, updated_at: now(), sub_agent_steps: '[]' });
    } catch (e) { audit.log('sheet_error', { request_id, detail: scrub(e.message) }); }
    tick();
  }

  async function submitBatch({ user, agent_code, case_id, parent_request_id, items, allow_duplicate }) {
    const def = AGENTS[agent_code];
    if (!def || !def.batch) throw new HttpError(400, 'Batch is not available for this desk.');
    if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Add at least one line.');
    if (items.length > 50) throw new HttpError(400, 'Please send at most 50 at a time.');
    // validate every line first so one typo does not leave a half-sent batch unnoticed
    const bad = {}; items.forEach((it, i) => { const { errors } = validateInputs(agent_code, it); if (Object.keys(errors).length) bad[i + 1] = Object.values(errors).join(' '); });
    if (Object.keys(bad).length) throw new HttpError(400, 'Some lines need fixing. Nothing was sent.', { lines: bad });
    const out = [];
    for (let i = 0; i < items.length; i++) {
      try { const r = await submitOne({ user, agent_code, case_id, parent_request_id, inputs: items[i], allow_duplicate }); if (!case_id) case_id = r.case_id; out.push({ line: i + 1, ok: true, request_id: r.request_id, case_id: r.case_id }); }
      catch (e) { if (!(e instanceof HttpError)) throw e; out.push({ line: i + 1, ok: false, error: e.message, duplicate_of: e.extra.duplicate_of }); }
    }
    audit.log('batch_submitted', { user, case_id: case_id || '', detail: `${agent_code}: ${out.filter((x) => x.ok).length} sent, ${out.filter((x) => !x.ok).length} not sent.` });
    return { case_id, results: out };
  }

  // ---------- approvals ----------
  async function decide({ user, request_id, decision, override }) {
    const t0 = Date.now();
    if (!['approve', 'reject'].includes(decision)) throw new HttpError(400, 'Decision must be approve or reject.');
    let r = find(request_id); if (!r && !cache.ready) { await freshRead(); r = find(request_id); }
    if (!r) throw new HttpError(404, 'I cannot find that request.');
    if (pendingDec[request_id]) throw new HttpError(409, 'Already ' + pendingDec[request_id] + '.');
    if (decision === 'approve' && !r.can.approve) throw new HttpError(409, r.approval_state ? `Already ${r.approval_state}.` : 'This result cannot be approved right now (it is not waiting for approval, or its outcome is not one that can go forward).');
    if (decision === 'reject' && !r.can.reject) throw new HttpError(409, r.approval_state ? `Already ${r.approval_state}.` : 'This result is not waiting for approval.');
    if (decision === 'approve' && r.can.override && override !== true) throw new HttpError(409, `The desk says this is on hold: ${String(r.hold_reason).slice(0, 300)}. A human can still approve it. Confirm to override as a human decision.`, { needs_override: true, hold_reason: r.hold_reason });
    const state = decision === 'approve' ? 'approved' : 'rejected';
    if (decision === 'approve' && r.can.override) audit.log('human_override', { user, request_id, case_id: r.case_id, detail: `${user} approved ${r.agent_label} anyway although the desk said ${r.outcome || 'hold'}: ${String(r.hold_reason).slice(0, 200)}` });
    pendingDec[request_id] = state; queue.push({ request_id, state, user, ts: Date.now(), tries: 0, nextAt: 0 }); saveQ(); applyPending();
    audit.log(state, { user, request_id, case_id: r.case_id, detail: `${user} ${state} ${r.agent_label}${r.outcome ? ' (' + r.outcome + ')' : ''}. Saving to the sheet in the background.` });
    drain();
    timings.approve_ack_ms = Date.now() - t0; audit.log('timing', { user, request_id, detail: `${state} answered in ${timings.approve_ack_ms} ms (sheet saved in the background).` });
    const v = find(request_id); return { request_id, approval_state: state, next: v ? v.can.next : null, ms: Date.now() - t0 };
  }

  async function retry({ user, request_id }) {
    await readFresh(10000); const r = find(request_id);
    if (!r) throw new HttpError(404, 'I cannot find that request.');
    if (!r.can.retry) throw new HttpError(409, 'This request cannot be retried (it is still working, or it has already been retried 3 times).');
    const def = AGENTS[r.agent_code]; const q = (Array.isArray(cache.requests) ? cache.requests : []).find((x) => x.request_id === request_id); const meta = parseInputs(q.inputs_json);
    const first = r.status !== 'error';
    if (first) await markError(request_id, r.agent_code, 'No answer from the desk in time. Retried as a new request.');
    audit.log('retry', { user, request_id, case_id: r.case_id, detail: `${user} retried ${def.label}.` });
    const out = await submitOne({ user, agent_code: r.agent_code, case_id: r.case_id, parent_request_id: r.parent_request_id, inputs: { ...r.inputs }, allow_duplicate: true, retry_of: request_id, retry_count: Number(meta._retry_count || 0) + 1 });
    return out;
  }

  async function revise({ user, request_id, feedback, attachments }) {
    await freshRead(); const r = find(request_id);
    if (!r) throw new HttpError(404, 'I cannot find that request.');
    feedback = clean(feedback, 2000);
    if (!feedback || feedback.length < 3) throw new HttpError(400, 'Please tell the desk what to change, in a sentence or two.');
    if (r.status === 'queued' || r.status === 'running') throw new HttpError(409, 'This request is still working. Please wait for it to finish, then send your changes.');
    if (r.status === 'error') throw new HttpError(409, 'This request had a problem. Please use Retry first.');
    audit.log('revision_requested', { user, request_id, case_id: r.case_id, detail: `${user} asked ${AGENTS[r.agent_code].label} for changes: ${feedback.slice(0, 160)}` });
    attachments = Array.isArray(attachments) ? attachments.slice(0, 8) : [];
    const note = attachments.length ? '\n\n[Reference files attached: ' + attachments.map((a) => a.name).join(', ') + '. The desks run in the cloud and may not be able to open the local links, so please use the text extract included with each file.]' : '';
    return submitOne({ user, agent_code: r.agent_code, case_id: r.case_id, parent_request_id: r.parent_request_id, inputs: { ...r.inputs }, allow_duplicate: true, stored_feedback: feedback, stored_attachments: attachments.map((a) => ({ name: a.name, url: a.url, size: a.size, type: a.type })),
      revision: { of: request_id, feedback: feedback + note, attachments, previous_summary: r.summary, previous_outcome: r.outcome, previous_output_link: r.output_link ? 'see your earlier output for ' + request_id : '' } });
  }
  return { cache, timings, tick, start, stop, views, find, buildPayload, submitOne, submitBatch, decide, retry, revise, HttpError };
}
module.exports = { createCore, HttpError, validateInputs, REQUEST_COLS, CODES };
