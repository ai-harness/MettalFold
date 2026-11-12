'use strict';
const $ = (id) => document.getElementById(id);
const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'mf' };
const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c))); return e; };
let me = null, data = { requests: [], orphans: [] }, desk = 'supplier_qualification', sel = null, caseSel = '', prefill = null, hdrState = {};
const ORDER = ['supplier_qualification', 'product_book', 'opportunity_finder', 'advisory_gtm', 'intro_desk', 'deal_desk'];
const BATCH = { supplier_qualification: { cols: ['supplier_name', 'category', 'brochure_url', 'countries_served'], hint: 'One supplier per line: name | category | brochure link (can be empty) | countries' }, intro_desk: { cols: ['account'], shared: ['note'], hint: 'One Pursue now account per line' }, deal_desk: { cols: ['account', 'product'], shared: ['soft_yes_note', 'soft_yes_confirmed'], hint: 'One per line: account | product' } };
const api = async (path, body) => { const r = await fetch(path, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : {}); if (r.status === 401) { location.href = '/login'; return new Promise(() => {}); } const j = await r.json().catch(() => ({ error: 'Unreadable answer' })); if (!r.ok) { const e = new Error(j.error || 'Something went wrong'); e.info = j; throw e; } return j; };
const fmt = (t) => { if (!t) return ''; const d = new Date(t); return isNaN(d) ? t : d.toLocaleString(); };
const chipClass = (c) => 'chip c-' + c.split(' ')[0].replace(/[^A-Za-z]/g, '');

async function init() {
  me = await api('/api/me'); $('who').textContent = 'Signed in as ' + me.user;
  $('modes').replaceChildren(el('span', { class: 'badge ' + (me.mode.webhook === 'live' ? 'live' : 'test') }, me.mode.webhook === 'live' ? 'LIVE agents' : 'TEST mode: no real agents'), ' ', el('span', { class: 'badge' }, 'Sheet: ' + me.mode.sheet));
  $('logout').onclick = async () => { await api('/api/logout', {}); location.href = '/login'; };
  $('who-filter').onchange = renderCases; $('search').oninput = renderCases;
  { const fh = $('desks').closest('.card').querySelector('h2'); if (fh) fh.id = 'formh'; } loadCase(); window.addEventListener('hashchange', () => { const h = hashCase(); if (h !== null && h !== caseSel) switchCase(h); }); renderDesks(); renderForm(); await refresh(); firstLoad = false; setInterval(() => { if (!document.hidden) refresh(); }, 3000);
}
async function refresh() {
  try { data = await api('/api/cases'); const f = await api('/api/activity?n=60'); renderFeed(f.events); } catch (e) { $('banner').replaceChildren(el('div', { class: 'banner' }, 'I cannot reach the local backend: ' + e.message)); return; }
  if (firstLoad && caseSel && caseSel !== NEWC && !caseIds().includes(caseSel)) caseSel = '';
  const b = $('banner'); b.replaceChildren();
  if (!data.sheet_ok) b.append(el('div', { class: 'banner' }, 'I cannot reach the sheet. ' + (data.last_updated ? 'Showing what I saw at ' + fmt(data.last_updated) + '. ' : '') + 'New requests are paused until it is back. Nothing is hidden or sent while it is down.'));
  const off = Object.entries(me.desks_connected).filter(([, v]) => !v).map(([k]) => me.agents[k].label); if (me.mode.webhook === 'live' && off.length) b.append(el('div', { class: 'banner warn' }, 'Not connected yet (missing address or key): ' + off.join(', ')));
  runBanners(b); renderCases(); renderGStep(); checkApprovals(); renderDetail(); renderForm(true);
  if (crPending && data.requests.length) { const c = crPending; crPending = ''; if (caseSel !== c && caseIds().includes(c)) switchCase(c); openCR(c); }
}
function renderDesks() { $('desks').replaceChildren(...ORDER.map((c) => el('button', { type: 'button', class: c === desk ? 'on' : '', onclick: () => { desk = c; prefill = null; renderDesks(); renderForm(); } }, me.agents[c].label))); }

function approvedParents(agent) { const p = me.agents[agent].parent; if (!p) return []; return data.requests.filter((r) => r.agent_code === p && r.approved); }
function renderForm(soft) {
  const a = me.agents[desk], form = $('form'); if (soft && form.dataset.busy === '1') return;
  if (soft && form.contains(document.activeElement)) return; // do not disturb typing
  const pf = prefill || {}; const keep = {}; if (soft) form.querySelectorAll('[name]').forEach((i) => { keep[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
  $('gate').textContent = 'Human gate: ' + a.gate;
  const kids = [crumbs(null, desk, pf.case_id || (a.parent ? curCase() : ''))];
  const parents = approvedParents(desk);
  if (a.parent) {
    kids.push(el('label', {}, 'Follows (approved earlier step)'));
    const s = el('select', { name: 'parent_request_id' }, el('option', { value: '' }, parents.length ? 'Choose...' : 'No approved ' + me.agents[a.parent].label + ' yet'), (() => { const po = (r) => el('option', { value: r.request_id, selected: (keep.parent_request_id || pf.parent_request_id) === r.request_id }, `${r.request_id} (${r.case_id}) ${Object.values(r.inputs).filter(Boolean).slice(0, 2).join(', ')}`); const cc = curCase(), mine = parents.filter((r) => r.case_id === cc), rest = parents.filter((r) => r.case_id !== cc); return [...mine.map(po), rest.length ? el('optgroup', { label: 'Past cases' }, rest.map(po)) : null]; })());
    kids.push(s, el('div', { class: 'err', 'data-e': 'parent_request_id' }));
  } else if (pf.parent_request_id) kids.push(el('input', { type: 'hidden', name: 'parent_request_id', value: pf.parent_request_id }));
  kids.push(el('label', {}, 'Case'), el('select', { name: 'case_id' }, el('option', { value: '' }, a.parent ? 'Same case as the earlier step' : 'Start a new case'), a.parent ? null : [...new Set(data.requests.map((r) => r.case_id))].map((c) => el('option', { value: c, selected: (keep.case_id || pf.case_id) === c }, c + ' ' + (data.requests.find((r) => r.case_id === c && r.case_label) || { case_label: '' }).case_label))));
  kids.push(el('label', {}, 'Client or case name (optional)'), el('input', { name: 'case_label', value: keep.case_label || pf.case_label || '' }));
  const bm = BATCH[desk]; const isBatch = a.batch && (keep.__batch !== undefined ? keep.__batch : pf.__batch);
  if (a.batch) kids.push(el('label', {}, el('input', { type: 'checkbox', name: '__batch', checked: !!isBatch, onchange: () => { prefill = Object.assign({}, prefill, { __batch: $('form').querySelector('[name=__batch]').checked }); renderForm(); } }), ' Send several at once'));
  for (const f of a.fields) {
    if (isBatch && bm.cols.includes(f.key)) continue;
    const v = keep[f.key] !== undefined ? keep[f.key] : pf[f.key] !== undefined ? pf[f.key] : '';
    kids.push(el('label', {}, f.label));
    kids.push(f.type === 'textarea' ? el('textarea', { name: f.key }, v) : f.type === 'bool' ? el('input', { type: 'checkbox', name: f.key, checked: v === true || v === 'true' }) : el('input', { name: f.key, value: v, type: f.type === 'int' ? 'number' : 'text' }));
    kids.push(el('div', { class: 'err', 'data-e': f.key }));
  }
  if (isBatch) kids.push(el('label', {}, bm.hint), el('textarea', { name: '__lines', style: 'min-height:120px' }, keep.__lines || ''), el('div', { class: 'err', 'data-e': '__lines' }));
  kids.push(el('div', { class: 'err', id: 'formerr' }), el('div', { class: 'actions' }, el('button', { type: 'submit' }, 'Submit'), el('button', { type: 'button', class: 'sec', onclick: () => { prefill = null; renderForm(); } }, 'Clear')));
  form.replaceChildren(...kids);
  form.onsubmit = (ev) => { ev.preventDefault(); submit(false); };
}
function collect() {
  const form = $('form'), o = {}; form.querySelectorAll('[name]').forEach((i) => { o[i.name] = i.type === 'checkbox' ? i.checked : i.value; }); return o;
}
async function submit(again) {
  if (sendingNow) return; const o = collect(), a = me.agents[desk], form = $('form'), sbtn = form.querySelector('button[type=submit]'); form.dataset.busy = '1';
  form.querySelectorAll('[data-e]').forEach((x) => { x.textContent = ''; }); $('formerr').textContent = '';
  try {
    let res;
    if (o.__batch) {
      const bm = BATCH[desk], lines = (o.__lines || '').split('\n').map((l) => l.trim()).filter(Boolean);
      const items = lines.map((l) => { const p = l.split('|').map((x) => x.trim()); const it = {}; bm.cols.forEach((c, i) => { it[c] = p[i] || ''; }); (bm.shared || []).forEach((k) => { it[k] = o[k]; }); return it; });
      res = await gsend(sbtn, '/api/submit-batch', { agent_code: desk, case_id: o.case_id || undefined, parent_request_id: o.parent_request_id, case_label: o.case_label, items, allow_duplicate: again }, {});
      const bad = res.results.filter((r) => !r.ok); const msg = `${res.results.length - bad.length} sent` + (bad.length ? `, ${bad.length} not sent: ` + bad.map((b) => `line ${b.line}: ${b.error}`).join(' ') : '.');
      $('formerr').textContent = msg; if (!bad.length) { prefill = null; renderForm(); } caseSel = res.case_id || caseSel;
    } else {
      const inputs = {}; a.fields.forEach((f) => { inputs[f.key] = o[f.key]; });
      res = await gsend(sbtn, '/api/submit', { agent_code: desk, case_id: o.case_id || undefined, parent_request_id: o.parent_request_id, case_label: o.case_label, inputs, allow_duplicate: again }, { pend: { agent_code: desk, case_id: o.case_id || (a.parent ? curCase() : ''), inputs } });
      sel = res.request_id; caseSel = res.case_id; prefill = null; renderForm(); justSubmitted = res.request_id;
    }
    await refresh();
    if (justSubmitted) { justSubmitted = null; navDone('detail'); }
  } catch (e) {
    const i = e.info || {}; if (i.fields) Object.entries(i.fields).forEach(([k, m]) => { const x = form.querySelector(`[data-e="${k}"]`); if (x) x.textContent = m; });
    if (i.lines) $('formerr').textContent = e.message + ' ' + Object.entries(i.lines).map(([n, m]) => `Line ${n}: ${m}`).join(' '); else $('formerr').textContent = e.message;
    if (i.duplicate_of) $('formerr').append(' ', el('button', { type: 'button', class: 'sec', onclick: () => submit(true) }, 'Submit anyway'), ' ', el('button', { type: 'button', class: 'sec', onclick: () => { const q = data.requests.find((x) => x.request_id === i.duplicate_of); if (q) { sel = q.request_id; caseSel = q.case_id; renderCases(); renderDetail(); navDone('detail'); } } }, 'Open ' + i.duplicate_of));
    toast('Not sent: ' + e.message, 'err');
  } finally { form.dataset.busy = '0'; }
}

function stepClass(rs) { if (!rs.length) return ['', 'Not started']; const r = rs[rs.length - 1]; const s = r.status; if (s === 'error' || r.stuck) return ['s-err', 'Problem']; if (r.approved) return ['s-done', 'Approved']; if (s === 'needs approval') return ['s-wait', 'Needs approval']; if (s === 'done') return ['s-done', r.outcome || 'Done']; return ['s-work', 'Working']; }
function versionMap() {
  const g = {}, m = {};
  data.requests.slice().sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1)).forEach((r) => { const k = r.agent_code + '|' + r.case_id + '|' + JSON.stringify(r.inputs); (g[k] = g[k] || []).push(r); });
  Object.values(g).forEach((list) => list.forEach((r, i) => { m[r.request_id] = { v: i + 1, n: list.length, latest: i === list.length - 1, list }; }));
  return m;
}
function renderCases() {
  const q = $('search').value.toLowerCase(), mine = $('who-filter').value === 'me';
  const VER = versionMap();
  const cc = curCase(); const rows = data.requests.filter((r) => r.case_id === cc && VER[r.request_id].latest && (!mine || r.submitted_by === me.user) && (!q || JSON.stringify(r).toLowerCase().includes(q)));
  const byCase = {}; rows.forEach((r) => { (byCase[r.case_id] = byCase[r.case_id] || []).push(r); });
  const ids = Object.keys(byCase).sort().reverse(); const box = $('cases');
  saveCase(); renderCaseBar();
  if (!ids.length) { box.replaceChildren(el('p', { class: 'muted', id: 'caseempty' }, !cc ? 'New case: nothing sent yet. Fill in Supplier Qualification on the left and press Submit. Your earlier cases are in the Case menu at the top.' : (q || mine) ? 'Nothing in ' + cc + ' matches. Past cases are in the Case menu at the top.' : 'Nothing in ' + cc + ' yet.')); } else
  box.replaceChildren(...ids.map((c) => {
    const rs = byCase[c].slice().sort((a, b) => (a.submitted_at < b.submitted_at ? -1 : 1));
    const all = data.requests.filter((r) => r.case_id === c);
    const flow = el('div', { class: 'flow' }, ORDER.map((code) => { const [cl, t] = stepClass(all.filter((r) => r.agent_code === code)); return el('span', { class: 'step ' + cl, style: 'cursor:pointer', onclick: () => gotoStage(code, c) }, me.agents[code].label.replace(/^#\d /, '') + ': ' + t); }));
    return addDealCard(el('div', { class: 'case' }, el('h3', {}, c + ' ' + (rs.find((r) => r.case_label) || { case_label: '' }).case_label), stepper(c), flow, rs.map((r) => el('div', { class: 'row' + (VER[r.request_id].list.some((x) => x.request_id === sel) ? ' sel' : ''), onclick: () => { dealOpen = null; { const ds = $('dealscreen'); if (ds) ds.remove(); } sel = r.request_id; caseSel = r.case_id; renderCases(); renderGStep(); renderDetail().then(() => navDone('detail')).catch((e) => { $('detail').style.display = 'block'; $('detail').textContent = 'Could not open this request: ' + e.message; }); } },
      el('span', { class: chipClass(r.chip) }, r.chip), el('span', {}, el('b', {}, deskTitle(r)), ' ', el('span', { class: 'muted' }, r.request_id + (VER[r.request_id].n > 1 ? ' · v' + VER[r.request_id].v + ' of ' + VER[r.request_id].n : '') + (r.retry_of ? ' (retry of ' + r.retry_of + ')' : '') + ' by ' + r.submitted_by), el('br'), el('span', { class: 'muted' }, [r.inputs.supplier_name || (r.agent_code === 'intro_desk' ? acctCount(r) + ' shortlisted accounts' : r.agent_code === 'deal_desk' ? acctCount(r) + ' contact' + (acctCount(r) === 1 ? '' : 's') + ' · ' + [...new Set(String(r.inputs.account || '').split(/\n/).map((l) => l.split('|')[0].trim()).filter(Boolean))].join(', ') : r.inputs.account) || r.inputs.region, r.outcome].filter(Boolean).join(' · '))), el('span', { class: 'muted' }, fmt(r.updated_at))))), c, all);
  }));
  $('orphans').replaceChildren(...(data.orphans.length ? [el('div', { class: 'notice' }, 'Results found in the sheet that this app did not request: ' + data.orphans.map((o) => o.request_id).join(', ') + '. They are listed here so nothing runs unseen.')] : []));
}
let optimistic = null;
const NEXT_OF = (code) => { const i = ORDER.indexOf(code); return i >= 0 && i < ORDER.length - 1 ? ORDER[i + 1] : null; };
function confirmBox(title, text, yes, cls) {
  return new Promise((resolve) => {
    const done = (v) => { document.removeEventListener('keydown', onKey); ov.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') done(false); };
    const ov = el('div', { class: 'overlay', onclick: (e) => { if (e.target === ov) done(false); } }, el('div', { class: 'modal', role: 'dialog' }, el('h3', {}, title), el('p', {}, text), el('div', { class: 'actions' }, el('button', { class: cls, onclick: () => done(true) }, yes), el('button', { class: 'sec', onclick: () => done(false) }, 'Go back'))));
    document.addEventListener('keydown', onKey); document.body.append(ov);
  });
}
const wait = (ms) => new Promise((res) => setTimeout(res, ms));
const watching = new Map();
function clearWarn(id) { const w = $('awarn'); if (!w) return; [...w.children].forEach((c) => { if (c.dataset.id === id) c.remove(); }); }
function approveFailed(r, e, override) {
  optimistic = null; const w = $('awarn'); if (!w) return; clearWarn(r.request_id);
  w.append(el('div', { class: 'banner warn awarn', 'data-id': r.request_id, role: 'alert' }, el('b', {}, 'Approval of ' + r.request_id + ' was not saved. '), (e && e.message ? e.message + ' ' : ''), 'Nothing was lost; you can keep working. ', el('button', { class: 'sec', onclick: (ev) => retryApprove(r, override, ev.currentTarget) }, 'Retry approval')));
  try { fetch('/api/client-error', { method: 'POST', headers: H, body: JSON.stringify({ where: 'approve', message: String(e && e.message || e), request_id: r.request_id }) }).catch(() => {}); } catch (_) {}
}
async function postApprove(r, override, st) {
  try { return await api('/api/approve', { request_id: r.request_id, decision: 'approve', override: !!override }); }
  catch (e) {
    if (e.info && e.info.needs_override && !override) { if (st) st.asking = true; const go = await confirmBox('Override as human?', e.message, 'Override as human', 'good'); if (st) st.asking = false; if (!go) throw Object.assign(new Error('Cancelled.'), { cancelled: true }); return api('/api/approve', { request_id: r.request_id, decision: 'approve', override: true }); }
    throw e;
  }
}
function checkApprovals() {
  for (const [id, w] of [...watching]) {
    const x = data.requests.find((q) => q.request_id === id); const age = Date.now() - w.ts;
    if (x && x.approved) { if (age > 30000) { watching.delete(id); clearWarn(id); } }
    else if (age > 6000) { watching.delete(id); approveFailed(w.r, new Error('The save to the sheet did not go through.'), w.override); }
  }
}
async function retryApprove(r, override, btn) {
  if (btn) { btn.disabled = true; btn.replaceChildren(el('span', { class: 'spin' }), ' Retrying…'); }
  try { await postApprove(r, override); clearWarn(r.request_id); watching.set(r.request_id, { ts: Date.now(), r, override }); toast('Approved ✓'); refresh(); const cur = data.requests.find((x) => x.request_id === sel); if (!cur || cur.request_id === r.request_id) goAfterApprove(r); }
  catch (e) { if (btn) { btn.disabled = false; btn.textContent = 'Retry approval'; } if (!e.cancelled) toast('Still could not save: ' + e.message, 'err'); }
}
function navDone(where) {
  // form: top of the page (the form is there). Result / Deal Desk / complete screen: scroll that panel into view.
  if (where === 'form') window.scrollTo({ top: 0, behavior: 'auto' });
  const go = () => { const h = where === 'form' ? $('formh') : where === 'deal' ? document.querySelector('#dealscreen h2') : document.querySelector('#detail h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); } if (where === 'form') window.scrollTo({ top: 0, behavior: 'auto' }); else if (h) { const card = h.closest('.card') || h; const y = card.getBoundingClientRect().top + window.scrollY - ((($('gstep') && $('gstep').offsetHeight) || 0) + 8); window.scrollTo({ top: Math.max(0, y), behavior: 'auto' }); } };
  setTimeout(go, where === 'form' ? 80 : 120); if (where !== 'form') setTimeout(go, 650); // second pass after async content loads
}
function openResubmit(r, keepSel) {
  dealOpen = null; const ds = $('dealscreen'); if (ds) ds.remove(); if (!keepSel) sel = null;
  desk = r.agent_code; prefill = Object.assign({}, r.inputs, { case_id: r.case_id, parent_request_id: r.parent_request_id || r.request_id }); if (me.agents[desk].parent) prefill.parent_request_id = r.parent_request_id;
  caseSel = r.case_id; renderDesks(); renderForm(); renderGStep(); renderDetail(); navDone('form');
}
function showComplete(r) {
  dealOpen = r.request_id; $('detail').style.display = 'none'; let box = $('dealscreen'); if (box) box.remove();
  box = el('div', { class: 'card', id: 'dealscreen' }); $('detail').parentNode.insertBefore(box, $('detail'));
  box.append(el('h2', { tabindex: '-1' }, '🎉 Workflow complete'), el('p', {}, 'Every stage for ' + (r.case_label || r.case_id) + ' is done and approved by a human. The agents sent nothing.'), stepper(r.case_id, true),
    el('div', { class: 'actions' }, el('button', { class: 'big', onclick: closeDeal }, 'Back to cases'), el('button', { class: 'sec', onclick: () => { closeDeal(); sel = r.request_id; caseSel = r.case_id; renderCases(); renderDetail(); } }, 'View the final result')));
  renderGStep(); navDone('deal');
}
function goAfterApprove(r) {
  optimistic = null; refresh().catch(() => {});
  const nx = NEXT_OF(r.agent_code);
  if (!nx) { showComplete(r); return; }
  caseSel = r.case_id;
  if (nx === 'deal_desk') { openDeal(r); navDone('deal'); } else startNext(r, nx);
  renderGStep();
}
async function doApprove(r, btn, override) {
  const tClick = Date.now(); let navigated = false;
  const go = (why) => { if (navigated) return; navigated = true; try { goAfterApprove(r); } catch (e) { failSoft('Moving to the next stage', e); toast('Approved. Pick the next stage from the bar at the top.'); } fetch('/api/client-error', { method: 'POST', headers: H, body: JSON.stringify({ where: 'timing', request_id: r.request_id, message: 'approve click to next screen ' + (Date.now() - tClick) + ' ms (' + why + ')' }) }).catch(() => {}); };
  btn.disabled = true; btn.replaceChildren(el('span', { class: 'spin' }), ' Approving…');
  optimistic = { id: r.request_id, state: 'approved' }; renderDetail(); clearWarn(r.request_id);
  const st = { asking: false }; const p = postApprove(r, override, st);
  const guard = setTimeout(() => { if (!st.asking) go('moved on while the server was still answering'); }, 1500); // never wait on the server to move ahead
  let first = await Promise.race([p.then(() => 'ok', (e) => ({ e })), wait(1000).then(() => 'slow')]);
  if (first === 'slow' && st.asking) first = await p.then(() => 'ok', (e) => ({ e }));
  if (first && first.e) { clearTimeout(guard); if (navigated) { approveFailed(r, first.e, override); return; } if (first.e.cancelled) { optimistic = null; renderDetail(); return; } approveFailed(r, first.e, override); renderDetail(); return; }
  if (first === 'slow') p.then(() => {}, (e) => approveFailed(r, e, override));
  watching.set(r.request_id, { ts: Date.now(), r, override });
  if (first === 'ok') await wait(400);
  clearTimeout(guard); go(first === 'ok' ? 'server answered in time' : 'server slow');
}
async function doReject(r, btn) {
  btn.disabled = true; btn.replaceChildren(el('span', { class: 'spin' }), ' Rejecting…');
  optimistic = { id: r.request_id, state: 'rejected' }; renderDetail();
  try { await api('/api/approve', { request_id: r.request_id, decision: 'reject' }); optimistic = null; refresh().catch(() => {}); openResubmit(r); toast('Rejected. The form is filled in from that result; change it and submit again when ready.'); }
  catch (e) { optimistic = null; await refresh(); toast('Reject did not go through: ' + e.message + ' Nothing changed.', 'err'); $('detail').prepend(el('div', { class: 'notice' }, 'That did not go through, so nothing changed. Please try again in a moment.')); }
}
async function decideFlow(r, decision, btn) {
  const ok = decision === 'approve'
    ? (r.can.override
      ? await confirmBox('Approve anyway?', 'The desk says this is on hold: ' + String(r.hold_reason || r.outcome).slice(0, 300) + '. Approve anyway and move to the next stage? This is recorded as your decision.', 'Yes, approve anyway', 'good')
      : await confirmBox('Approve ' + r.agent_label + '?', 'Are you sure you want to approve and move on to the next step?', 'Yes, approve', 'good'))
    : await confirmBox('Reject ' + r.agent_label + '?', 'Are you sure you want to reject this result? This closes it and takes you back to the form to resubmit.', 'Yes, reject', 'bad');
  if (!ok) return;
  return decision === 'approve' ? doApprove(r, btn, !!r.can.override) : doReject(r, btn);
}
function stageState(code, caseId) {
  const rs = data.requests.filter((r) => r.case_id === caseId && r.agent_code === code); if (!rs.length) return 'wait';
  return rs.some((r) => r.approved) ? 'done' : 'now';
}
// v40: contact research opens only at #3 Introduction Desk, after #2 Advisory GTM is approved (same rule as the server)
const CR_LOCK = 'Unlock in Introduction Desk first';
function crOpen(caseId) {
  if (!caseId || caseId === NEWC) return false; const rs = data.requests.filter((r) => r.case_id === caseId);
  if (!rs.some((r) => r.agent_code === 'advisory_gtm' && r.approved)) return false;
  const cur = ORDER.map((c) => stageState(c, caseId)).findIndex((x) => x !== 'done');
  return rs.some((r) => r.agent_code === 'intro_desk') || cur < 0 || cur >= ORDER.indexOf('intro_desk');
}
// v41: contact research opens as a panel on this screen; ?cr=CASE (old /research links) opens it after loading
var crPending = (() => { try { const q = new URLSearchParams(location.search).get('cr'); if (q) history.replaceState(null, '', location.pathname + location.hash); return q || ''; } catch (e) { return ''; } })();
function openCR(c) { if (!c) return; if (!window.CR) { toast('Contact research did not load. Please reload the page.', 'err'); return; } window.CR.open(c, { toast }); }
function crLink(cc) {
  if (crOpen(cc)) return el('button', { type: 'button', class: 'btn sec', id: 'crlink', style: 'padding:6px 12px;background:#e3e8ee;color:#1c2733', title: 'Find contacts in the shortlisted accounts for this case (opens here)', onclick: () => openCR(cc) }, 'Contact research');
  return el('span', { class: 'crwrap' }, el('span', { class: 'btn sec crlocked', id: 'crlink', role: 'link', 'aria-disabled': 'true', tabindex: '0', 'aria-describedby': 'crtip' }, 'Contact research'), el('span', { class: 'crtip', id: 'crtip', role: 'tooltip' }, CR_LOCK));
}
function curCase() { if (caseSel === NEWC) return ''; if (caseSel) return caseSel; const q = data.requests.find((x) => x.request_id === sel); if (q) return q.case_id; return activeCase(); }
function stepper(caseId, allDone) {
  const s = stepper0(caseId, allDone); if (!crOpen(caseId)) return s;
  const i = ORDER.indexOf('intro_desk'), pill = el('div', { class: 'st crstep', role: 'button', tabindex: '0', title: 'Now is the time to find contacts in the shortlisted accounts (opens here)', onclick: () => openCR(caseId), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCR(caseId); } } }, el('span', { class: 'dot' }, '↗'), el('span', { class: 'lbl' }, 'Contact research'));
  s.insertBefore(pill, s.children[i + 1] || null); return s;
}
function stepper0(caseId, allDone) {
  const st = ORDER.map((c) => (allDone ? 'done' : stageState(c, caseId))); const cur = st.findIndex((x) => x !== 'done');
  return el('div', { class: 'stepper', role: 'navigation', 'aria-label': 'Workflow stages' }, ORDER.map((c, i) => {
    const done = st[i] === 'done', now = i === cur, fut = !done && !now, lab = me.agents[c].label;
    return el('div', { class: 'st ' + (done ? 'done' : now ? 'now' : 'wait dis'), role: 'button', tabindex: fut ? '-1' : '0', 'aria-disabled': fut ? 'true' : 'false', style: 'cursor:' + (fut ? 'not-allowed' : 'pointer'),
      title: fut ? 'Finish stage ' + i + ' first (' + me.agents[ORDER[i - 1]].label + ')' : done ? 'Open the latest ' + lab + ' result' : 'Open ' + lab,
      onclick: () => { if (fut) { toast('Finish stage ' + i + ' first (' + me.agents[ORDER[i - 1]].label + ').'); return; } gotoStage(c, caseId); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } } },
      el('span', { class: 'dot' }, done ? '✓' : String(i + 1)), el('span', { class: 'lbl' }, lab.replace(/^#\d /, '')), fut ? el('span', { class: 'fin' }, 'Finish stage ' + i + ' first') : null);
  }));
}
function renderGStep() {
  const g = $('gstep'); if (!g || !me) return; const cid = curCase();
  const q = data.requests.find((x) => x.case_id === cid && x.case_label); g.style.display = 'block';
  const key = cid + '|' + ORDER.map((c) => stageState(c, cid)).join(',') + '|' + (q ? q.case_label : ''); if (g.dataset.key === key) return; g.dataset.key = key;
  g.replaceChildren(el('span', { class: 'gcase' }, cid ? (q && q.case_label ? q.case_label + ' · ' : '') + cid : 'New case · nothing sent yet'), stepper(cid));
}
function crumbs(r, code, caseId) {
  const i = ORDER.indexOf(code), lab = me.agents[code].label; const q = data.requests.find((x) => x.case_id === caseId && x.case_label);
  const link = (t, f) => el('a', { href: '#', onclick: (e) => { e.preventDefault(); f(); } }, t);
  const home = link('Cases', () => { sel = null; dealOpen = null; const ds = $('dealscreen'); if (ds) ds.remove(); renderDetail(); const c = $('cases'); if (c) c.scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  const back = i > 0 && caseId ? link('← Previous stage: ' + me.agents[ORDER[i - 1]].label, () => gotoStage(ORDER[i - 1], caseId)) : null;
  return el('div', { class: 'crumbs' }, el('span', {}, home, ' › ', caseId ? (q ? q.case_label + ' (' + caseId + ')' : caseId) : 'New case', ' › ', lab, ' › ', r ? r.request_id : 'New request'), back ? el('span', { class: 'back' }, back) : null);
}
function todoLine(r, appr) {
  const nx = NEXT_OF(r.agent_code);
  if (r.approval_state === 'rejected' || r.closed) return 'This one is closed. Nothing more to do here.';
  if (r.status === 'error' || r.stuck) return 'Something went wrong. You can retry below.';
  if (appr) return nx ? 'Approved. Next: ' + me.agents[nx].label : 'Approved. This was the last step.';
  if (r.status === 'queued' || r.status === 'running') return 'Desk is working, nothing to do. This page updates by itself.';
  if (r.can.approve) return 'Waiting for your approval';
  if (r.outcome === 'Hold' || r.outcome === 'Book Waiting') return 'On hold. Add the missing items and resubmit.';
  return 'Have a look at the result below.';
}
function nextCard(r) {
  const nx = NEXT_OF(r.agent_code); if (!nx) return null;
  const lbl = me.agents[nx].label;
  const ex = data.requests.filter((x) => x.case_id === r.case_id && x.agent_code === nx && x.approval_state !== 'rejected' && !x.closed).sort((p, q) => String(q.updated_at).localeCompare(String(p.updated_at)))[0];
  if (ex) {
    const run = ex.status === 'queued' || ex.status === 'running';
    const txt = run ? lbl + ' is running (' + ex.request_id + '). Open it to follow progress.' : lbl + ' (' + ex.request_id + ') is ' + (ex.approved ? 'approved.' : ex.can && ex.can.approve ? 'ready and waiting for your approval.' : 'done. Have a look.');
    return el('div', { class: 'nextcard' }, el('b', {}, "What's next"), el('p', {}, txt), el('button', { class: 'big', 'data-open': ex.request_id }, 'Open ' + lbl + ' results →'));
  }
  return el('div', { class: 'nextcard' }, el('b', {}, "What's next"), el('p', {}, 'Good. Now the next stage is ' + lbl + '. Press the button and I will fill in the form for you.'), el('button', { class: 'big', 'data-next': nx, 'data-from': r.request_id }, 'Next step: go to ' + lbl + ' →'));
}
function toast(msg, kind) { document.querySelectorAll('.toast').forEach((t) => t.remove()); const err = kind === 'err'; const t = el('div', { class: 'toast' + (err ? ' err' : ''), role: err ? 'alert' : 'status' }, msg, err ? el('button', { class: 'tclose', 'aria-label': 'Close', onclick: () => t.remove() }, '✕') : null); document.body.append(t); const ms = err ? 12000 : 5000; setTimeout(() => t.classList.add('out'), ms); setTimeout(() => t.remove(), ms + 600); }
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-next],[data-open]'); if (!b) return;
  try {
    if (b.dataset.open) { sel = b.dataset.open; const q = data.requests.find((x) => x.request_id === sel); if (q) caseSel = q.case_id; renderCases(); renderGStep(); renderDetail().then(() => { navDone('detail'); }).catch((er) => toast('Could not open: ' + er.message, 'err')); return; }
    const r = data.requests.find((x) => x.request_id === b.dataset.from); startNext(r, b.dataset.next);
  } catch (er) { failSoft("What's next button", er); }
});
async function act(path, body) { try { const r = await api(path, body); await refresh(); return r; } catch (e) { toast(e.message, 'err'); } }
let rdBusy = null, rdAgain = false;
function renderDetail() { if (rdBusy) { rdAgain = true; return rdBusy; } rdBusy = (async () => { try { do { rdAgain = false; await renderDetailNow(); } while (rdAgain); } finally { rdBusy = null; } })(); return rdBusy; }
async function renderDetailNow() {
  if (pend && sel === pend.id) { renderPendingView(); return; }
  const d = $('detail'), r = data.requests.find((x) => x.request_id === sel); if (!r) { d.style.display = 'none'; return; }
  if (dealOpen) { d.style.display = 'none'; return; }
  d.style.display = 'block';
  const ev = (await api('/api/activity/' + r.request_id).catch(() => ({ events: [] }))).events;
  const cv = await api('/api/conversation/' + r.request_id).catch(() => null);
  if (sel !== r.request_id || dealOpen) { rdAgain = true; return; } // user moved on while we were loading
  let fileOk = true, fileState = 'ok', fileWait = 0; if (typeof r.file_ready === 'boolean') fileOk = r.file_ready; /* v35: the server says if the file is here; refresh() re-asks every 3 s */ else if (/^\/files\//.test(r.output_link || '')) { const hx = await fetch(r.output_link, { method: 'HEAD', cache: 'no-store', headers: { 'x-requested-with': 'mf' } }).catch(() => null); fileOk = !!(hx && hx.ok); if (!fileOk) { fileState = (hx && hx.headers.get('x-file-state')) || 'waiting'; fileWait = Number((hx && hx.headers.get('x-file-wait')) || 0); if (fileWait > 90 || (hx && hx.status === 404 && !hx.headers.get('x-file-state'))) fileState = 'late'; } }
  if (sel !== r.request_id || dealOpen) { rdAgain = true; return; }
  const hash = JSON.stringify([r, ev, cv, fileOk, caseFilesKey(r.case_id), optimistic, data.requests.map((x) => x.request_id + x.status + (x.approved ? 1 : 0)), versionMap()[r.request_id].list.map((x) => x.request_id)]);
  if (d.dataset.hash === hash && d.dataset.sel === r.request_id) return;
  d.dataset.hash = hash;
  const kids = [crumbs(r, r.agent_code, r.case_id), el('h2', {}, deskTitle(r) + ' · ' + r.request_id), el('p', {}, el('span', { class: chipClass(r.chip) }, r.chip), ' ', el('span', { class: 'muted' }, `${r.case_id} · by ${r.submitted_by} · ${fmt(r.submitted_at)}` + (r.parent_request_id ? ' · follows ' + r.parent_request_id : '')))];
  const opt = optimistic && optimistic.id === r.request_id ? optimistic : null, apprNow = !!r.approved || !!(opt && opt.state === 'approved');
  kids.push(el('div', { class: 'todo' }, '👉 ' + (opt && opt.state === 'rejected' ? 'Rejected.' : todoLine(r, apprNow))));
  if (apprNow && (opt || r.approval_state === 'approved' || r.approved)) { if (opt || r.approval_state === 'approved') kids.push(el('div', { class: 'okbanner' }, el('span', { class: 'tick' }, '✓'), ' Approved ✓')); const nc = nextCard(r); if (nc) kids.push(nc); }
  if (opt && opt.state === 'rejected') kids.push(el('div', { class: 'okbanner rej' }, 'Rejected'));
  { const full = Object.entries(r.inputs).filter(([k]) => k !== 'case_label').map(([k, v]) => k.replace(/_/g, ' ') + ': ' + v).join(' | '); const short = full.length > 260 ? full.slice(0, 260) + '…' : full; const sent = el('div', { class: 'muted', title: full }, 'You sent: ' + short); if (full.length > 260) sent.append(' ', el('a', { href: '#', onclick: (e) => { e.preventDefault(); sent.firstChild.textContent = 'You sent: ' + full; e.currentTarget.remove(); } }, 'show all')); kids.push(sent); }
  { const fp = caseFilesPanel(r); if (fp) kids.push(fp); }
  if (r.stuck) kids.push(el('div', { class: 'notice' }, 'No answer from the desk yet. You can retry; the old request is marked as not answered.'));
  else if (r.delayed) kids.push(el('div', { class: 'notice' }, 'This is taking longer than usual. It may still arrive. You can wait or retry.'));
  else if (r.status === 'queued' || r.status === 'running') kids.push(el('div', { class: 'notice' }, r.status === 'queued' ? 'Sent. Waiting for the desk to pick it up.' : 'The desk is working on it. This page updates by itself.'));
  const vm = versionMap()[r.request_id]; if (vm.n > 1) kids.push(el('div', { class: 'actions' }, el('b', {}, 'Versions: '), vm.list.map((x, i) => el('button', { class: x.request_id === r.request_id ? '' : 'sec', onclick: () => { sel = x.request_id; renderDetail(); } }, 'v' + (i + 1) + ' (' + x.request_id + ')'))));
  if (!fileOk) kids.push(el("p", { class: "muted filenote" }, "File: " + decodeURIComponent(String(r.output_link || "").replace(/^\/files\//, "")) + " — also attached in Grok chat")); // v33: no waiting box; the page re-checks silently and swaps in the link when the file lands
  if (r.details_check && !r.details_check.complete) kids.push(el('div', { class: 'notice detailsflag' }, el('b', {}, 'Incomplete: '), r.details_check.message, ' Ask the desk to add them (Edit and resubmit), or add a newer version of the file.')); // v39
  if (r.outcome) kids.push(el('p', {}, el('b', {}, 'Outcome: '), r.outcome));
  if (r.summary) kids.push(el('p', { class: 'pre' }, r.summary));
  if (r.next_step) kids.push(el('p', {}, el('b', {}, 'Next step: '), r.next_step));
  if (r.output_link && fileOk) kids.push(el('p', {}, el('a', { href: r.output_link, target: '_blank', rel: 'noopener noreferrer' }, 'Open the file or link')));
  kids.push('@IF');
  if (r.error_message) kids.push(el('div', { class: 'notice' }, (r.status === 'error' ? 'Problem: ' : 'Partial result: ') + r.error_message));
  if (r.sub_agent_steps.length) kids.push(el('h2', {}, 'What happened behind this desk'), el('div', { class: 'tl' }, r.sub_agent_steps.map((s) => el('div', {}, ({ done: '✅', running: '⏳', 'needs approval': '✋', error: '⚠️' })[s.status] || '', ' ', el('b', {}, s.step), s.outcome ? ': ' + s.outcome : ''))));
  if (r.held) kids.push(el('div', { class: 'notice' }, el('b', {}, 'The desk says this is on hold. '), String(r.hold_reason || '').slice(0, 400), ' You can still approve it yourself with Approve anyway, or ask for changes.'));
  if (r.can.approve || r.can.reject || r.approved) kids.push(el('div', { class: 'gate' }, 'Human gate: ' + r.gate_text));
  const acts = [];
  if (r.can.approve && !opt) acts.push(el('button', { class: 'good', onclick: (e) => decideFlow(r, 'approve', e.currentTarget) }, r.can.override ? 'Approve anyway' : (r.approve_label || 'Approve and move to next stage')));
  if (r.can.reject && !opt) acts.push(el('button', { class: 'bad', onclick: (e) => decideFlow(r, 'reject', e.currentTarget) }, 'Reject'));
  
  if (r.can.retry) acts.push(el('button', { class: 'sec', onclick: async (e) => { if (sendingNow) return; try { const x = await gsend(e.currentTarget, '/api/retry', { request_id: r.request_id }, {}); await refresh(); if (x) { sel = x.request_id; renderDetail(); } } catch (er) { toast('Retry not sent: ' + er.message, 'err'); } } }, 'Retry'));
  if (r.can.resubmit) acts.push(el('button', { class: 'sec', onclick: () => openResubmit(r, true) }, r.outcome === 'Hold' || r.outcome === 'Book Waiting' ? 'Resubmit with the missing items' : 'Edit and resubmit'));
  if (acts.length) kids.push(el('div', { class: 'actions' }, acts));
  kids.push('@REV'); let revNode = null;
  if ((r.status === 'done' || r.status === 'needs approval') && !r.closed) {
    const ta = el('textarea', { rows: 3, placeholder: 'Not happy? Tell the desk what to change, in your own words (for example: cleaner cover, darker blue, add a spec table).', style: 'width:100%;margin-top:10px' });
    const btn = el('button', { class: 'sec' }, 'Send changes to this desk');
    const files = [], chips = el('div', { class: 'chips' }), pick = el('input', { type: 'file', multiple: true, accept: '.pdf,.png,.jpg,.jpeg,.gif,.webp,application/pdf,image/*', style: 'display:none' }), msg = el('div', { class: 'muted' });
    const drawChips = () => chips.replaceChildren(...files.map((f, i) => el('span', { class: 'fchip' }, f.name, ' ', el('a', { href: '#', onclick: (e) => { e.preventDefault(); files.splice(i, 1); drawChips(); } }, '✕'))));
    pick.onchange = async () => { for (const f of [...pick.files]) { if (f.size > 15 * 1024 * 1024) { msg.textContent = f.name + ' is over 15 MB, so I left it out.'; continue; } msg.textContent = 'Adding ' + f.name + '…'; try { const res = await fetch('/api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', headers: { 'x-requested-with': 'mf', 'content-type': 'application/octet-stream' }, body: f }); const j = await res.json(); if (!res.ok) throw new Error(j.error); files.push(j); msg.textContent = ''; } catch (e) { msg.textContent = 'Could not add ' + f.name + ': ' + e.message; } } pick.value = ''; drawChips(); };
    const attach = el('button', { class: 'sec', onclick: () => pick.click() }, '📎 Attach PDF or image');
    btn.onclick = async () => { const t = ta.value.trim(); if (t.length < 3) { msg.textContent = 'Please type what you want changed.'; toast('Please type what you want changed.', 'err'); ta.focus(); return; } if (sendingNow) return; let x = null; try { x = await gsend(btn, '/api/revise', { request_id: r.request_id, feedback: t, attachments: files.map((f) => ({ name: f.name, file: f.file })) }, { pend: { agent_code: r.agent_code, case_id: r.case_id, inputs: r.inputs } }); await refresh(); } catch (er) { msg.textContent = 'Not sent: ' + er.message; toast('Changes not sent: ' + er.message, 'err'); } if (x) { sel = x.request_id; ta.value = ''; files.length = 0; drawChips(); renderDetail(); } };
    revNode = (el('div', { class: 'revise' }, el('b', {}, 'Ask for changes'), ta, el('div', { class: 'actions' }, btn, attach), pick, chips, msg));
  }
  kids.push(convoPanel(r, cv));
  if (r.outcome === 'Drop') kids.push(el('p', { class: 'muted' }, 'This supplier was dropped. The case is closed for this supplier.'));
  kids.push(el('h2', { style: 'margin-top:16px' }, 'Step by step log'), el('div', { class: 'log' }, ev.length ? ev.map((e) => el('div', {}, fmt(e.ts) + ' · ' + e.event.replace(/_/g, ' ') + (e.user ? ' · ' + e.user : '') + ' · ' + e.detail)) : 'No events yet.'));
  // Persistent holders: iframe and the 'Ask for changes' box are only rebuilt when their own key changes.
  const hasPdf = fileOk && /^\/files\/.+\.pdf$/i.test(r.output_link || ''), hasRev = !!revNode;
  const hasTbl = fileOk && r.agent_code !== 'intro_desk' && /^\/files\/.+\.(csv|xlsx)$/i.test(r.output_link || ''); // #3 uses the lead view instead
  const ifKey = hasPdf || hasTbl ? r.request_id + '|' + r.output_link : '', revKey = hasRev ? r.request_id : '';
  const segs = [[]]; for (let i = 0; i < kids.length; i++) { const k = kids[i]; if (k === '@IF' || k === '@REV') { segs.push([]); } else segs[segs.length - 1].push(k); }
  // segs: [before iframe, between iframe and revise, after revise]
  let H = d._h; if (!H || d.dataset.sel !== r.request_id) { H = d._h = { run: el('div'), a: el('div'), i: el('div'), m: el('div'), b: el('div'), s: el('div'), r: el('div'), c: el('div'), ik: null, rk: null, cards: {} }; d.replaceChildren(H.run, H.a, H.i, H.m, H.b, H.s, H.r, H.c); }
  d.dataset.sel = r.request_id;
  const act0 = document.activeElement, keepScroll = window.scrollY;
  H.a.replaceChildren(...segs[0]);
  if (H.ik !== ifKey) { H.ik = ifKey; H.i.replaceChildren(...(hasPdf ? [el('iframe', { src: r.output_link, style: 'width:100%;height:560px;border:1px solid #ddd;border-radius:8px;margin-top:8px' })] : hasTbl ? [tableViewer(r.output_link)] : [])); }
  H.b.replaceChildren(...(segs[1] || []));
  updateBehind(H, r); updateRunning(H, r); updateMerged(H, r); updateDealView(H, r);
  if (H.rk !== revKey) { H.rk = revKey; H.r.replaceChildren(...(revNode ? [revNode] : [])); }
  H.c.replaceChildren(...(segs[2] || []));
  if (window.scrollY !== keepScroll) scrollTo(0, keepScroll);
}
function convoPanel(r, c) {
  if (!c || c.messages.length < 2) return el('span');
  return el('div', { class: 'convo' }, el('b', {}, 'Conversation'), ...c.messages.map((m) => el('div', { class: 'bub ' + (m.from === 'you' ? 'you' : 'desk') },
    el('div', { class: 'muted' }, (m.from === 'you' ? (m.who || 'You') : (m.label || 'Desk')) + ' · ' + fmt(m.at)),
    el('div', { class: 'pre' }, m.text),
    ...((m.attachments || []).length ? [el('div', { class: 'chips' }, ...m.attachments.map((a) => el('a', { class: 'fchip', href: a.url, target: '_blank', rel: 'noopener noreferrer' }, '📎 ' + a.name + ' (' + Math.max(1, Math.round((a.size || 0) / 1024)) + ' KB)')))] : []),
    ...(m.link ? [el('a', { href: m.link, target: '_blank', rel: 'noopener noreferrer' }, 'Open file')] : []))));
}
function startNext(r, next) {
  if (next === 'deal_desk') { openDeal(r); return; }
  dealOpen = null; { const ds = $('dealscreen'); if (ds) ds.remove(); } sel = null; caseSel = r.case_id; renderDetail();
  desk = next; const a = me.agents[next]; prefill = { case_id: r.case_id, case_label: r.case_label, parent_request_id: r.request_id };
  if (next === 'product_book') { prefill.supplier_name = r.inputs.supplier_name || ''; prefill.products = r.inputs.category || ''; prefill.brochure_url = r.inputs.brochure_url || ''; }
  if (next === 'opportunity_finder') { prefill.region = 'India'; prefill.number_of_accounts = 5; prefill.focus = r.inputs.focus || [r.inputs.supplier_name, r.inputs.products || r.inputs.category].filter(Boolean).join(' - ') || r.case_label || ''; }
  if (next === 'intro_desk') {
    const pn = String(r.summary || '').split('\n').map((l) => (l.match(/^\s*(.+?):\s*Pursue now/i) || [])[1]).filter(Boolean);
    prefill.__batch = false; prefill.account = pn.join('\n');
    prefill.note = 'Nominate only; NO intros or emails sent. For each account, nominate the right prospects per the Mettalfold PPT introduction taxonomy: role, why this person, Supplier Fit mark. Where findable from PUBLIC sources only, add LinkedIn URL and business email, each marked verified or unverified; never guess an email. Output xlsx + csv (account, prospect_name, role, why_this_person, linkedin_url, email, email_verification, supplier_fit, suggested_intro_angle, status=nominated). Name files 03_IntroDesk_<stem>_Prospects_V1. Write sub_agent_steps if you use helpers.';
  }
  if (next === 'deal_desk') { prefill.__batch = false; prefill.account = r.inputs.account; }
  renderDesks(); renderForm();
  const form = $('form'), card = form.closest('.card') || form;
  const narrow = window.innerWidth < 900;
  navDone('form');
  card.classList.remove('pulse'); void card.offsetWidth; card.classList.add('pulse'); setTimeout(() => card.classList.remove('pulse'), 3000);
  const first = [...form.querySelectorAll('input:not([type=hidden]):not([type=checkbox]),textarea')].find((i) => !i.value) || form.querySelector('input:not([type=hidden]),textarea');
  toast('Form ready for ' + a.label + ' — check and press Submit');
}
function renderFeed(events) { $('feed').replaceChildren(...events.map((e) => el('div', {}, fmt(e.ts) + ' · ' + e.event.replace(/_/g, ' ') + (e.request_id ? ' · ' + e.request_id : '') + ((e.case_id || ((data.requests.find((x) => x.request_id === e.request_id) || {}).case_id)) ? ' · ' + (e.case_id || data.requests.find((x) => x.request_id === e.request_id).case_id) : '') + (e.user ? ' · ' + e.user : '') + ' · ' + e.detail))); }
init();

// ---- v35: files ----
const fileNameOf = (l) => { try { return decodeURIComponent(String(l || '').split('/').pop()); } catch (e) { return String(l || '').split('/').pop(); } };
function fileReady(r, link) { if (!link || !/^\/files\//.test(link)) return true; const f = (r.files || []).find((x) => x.url === link || x.name === fileNameOf(link)); return f ? !!f.ready : (link === r.output_link && typeof r.file_ready === 'boolean' ? r.file_ready : true); }
function caseFiles(caseId) {
  const out = [], seen = new Set();
  data.requests.filter((x) => x.case_id === caseId).sort((a, b) => (a.request_id < b.request_id ? -1 : 1)).forEach((x) => (x.files || []).forEach((f) => { if (seen.has(f.name)) return; seen.add(f.name); out.push(Object.assign({ request_id: x.request_id, desk: x.agent_label || (me.agents[x.agent_code] || {}).label || x.agent_code }, f)); }));
  return out;
}
const caseFilesKey = (caseId) => caseFiles(caseId).map((f) => f.name + (f.ready ? '+' : '-')).join('|');
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB');
function caseFilesPanel(r) {
  const list = caseFiles(r.case_id); if (!list.length) return null;
  const ready = list.filter((f) => f.ready).length;
  const rows = list.map((f) => el('div', { class: 'cfrow' + (f.ready ? '' : ' wait') + (f.request_id === r.request_id ? ' mine' : '') },
    el('span', { class: 'cficon' }, f.ready ? '📄' : '⏳'),
    el('span', { class: 'cfname' }, el('b', {}, f.name), el('span', { class: 'muted' }, ' · ' + f.desk.replace(/^#\d+\s*/, '') + ' · ' + f.request_id + (f.ready && f.size ? ' · ' + kb(f.size) : ''))),
    f.ready ? el('span', { class: 'cfacts' }, el('a', { class: 'btn', href: f.url, target: '_blank', rel: 'noopener noreferrer' }, 'Open'), el('a', { class: 'btn sec', href: f.url, download: f.name }, 'Download'))
      : el('span', { class: 'muted cfacts' }, 'On its way (also attached in Grok chat). Shows here by itself.')));
  return el('details', { class: 'casefiles', open: true }, el('summary', {}, el('b', {}, '📁 Files in ' + r.case_id), el('span', { class: 'muted' }, ' · ' + ready + ' of ' + list.length + ' here')), ...rows);
}
function tableViewer(link) {
  const name = decodeURIComponent(link.split('/').pop()).replace(/\.(csv|xlsx)$/i, '');
  const box = el('div', { class: 'tblbox' }, el('div', { class: 'muted' }, 'Loading the table…'));
  const linkify = (v) => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v) ? el('a', { href: 'mailto:' + v }, v) : /^https?:\/\/\S+$/.test(v) ? el('a', { href: v, target: '_blank', rel: 'noopener noreferrer' }, v) : v;
  const table = (rows) => { const w = Math.max(0, ...rows.map((x) => x.filter((c) => String(c).trim()).length)); let hi = rows.findIndex((x) => x.filter((c) => String(c).trim()).length >= Math.max(2, Math.ceil(w / 2))); if (hi < 0) hi = 0; const pre = rows.slice(0, hi).map((x) => x.filter(Boolean).join(' ')).filter(Boolean), head = rows[hi] || [], body = rows.slice(hi + 1), n = Math.max(head.length, ...body.map((x) => x.length));
    return [pre.length ? el('div', { class: 'muted' }, pre.join(' · ')) : null, el('div', { class: 'tblwrap' }, el('table', { class: 'sheet' }, el('thead', {}, el('tr', {}, ...Array.from({ length: n }, (_, i) => el('th', {}, String(head[i] || '').replace(/_/g, ' '))))), el('tbody', {}, ...body.map((x) => el('tr', {}, ...Array.from({ length: n }, (_, i) => el('td', {}, linkify(x[i] || ''))))))))].filter(Boolean); };
  fetch('/api/table/' + encodeURIComponent(name), { cache: 'no-store' }).then((x) => x.json().then((j) => ({ ok: x.ok, j }))).then(({ ok, j }) => {
    if (!ok) { box.replaceChildren(el('div', { class: 'notice' }, j.error || 'Cannot show this table.')); return; }
    const sheets = j.sheets && j.sheets.length ? j.sheets : [{ name: '', rows: j.rows || [] }]; let cur = Math.min(j.main || 0, sheets.length - 1);
    const bar = el('div', { class: 'tblbar' }, el('b', {}, name));
    if (j.xlsx) bar.append(el('a', { class: 'btn', href: j.xlsx, download: name + '.xlsx' }, 'Download Excel'));
    if (j.csv) bar.append(el('a', { class: 'btn', href: j.csv, download: name + '.csv' }, 'Download CSV'));
    const tabs = el('div', { class: 'tbltabs' }), body = el('div');
    const draw = () => { tabs.replaceChildren(...(sheets.length > 1 ? sheets.map((sh, i) => el('button', { type: 'button', class: i === cur ? '' : 'sec', onclick: () => { cur = i; draw(); } }, sh.name.replace(/_/g, ' ') + ' (' + Math.max(0, sh.rows.length - 1) + ')')) : [])); body.replaceChildren(...table(sheets[cur].rows)); };
    draw(); box.replaceChildren(bar, tabs, body);
  }).catch(() => box.replaceChildren(el('div', { class: 'notice' }, 'Cannot show this table right now. Use Open or Download in the Files list above.')));
  return box;
}

const BEHIND_LABEL = { gtm_signals: 'GTM signals', gtm_execution_matching: 'Supplier matches (GTM Execution Matching Desk)', relationship_manager: 'Relationship scores (Relationship Manager)' };
function behindName(r, n) {
  if (r.agent_code !== 'advisory_gtm') return n;
  const k = String(n).toLowerCase();
  if (/signal/.test(k)) return BEHIND_LABEL.gtm_signals;
  if (/match|supplier|execution/.test(k)) return BEHIND_LABEL.gtm_execution_matching;
  if (/relationship/.test(k)) return BEHIND_LABEL.relationship_manager;
  return n;
}
function updateBehind(H, r) {
  const gtm = r.agent_code === 'advisory_gtm'; if (gtm) gtmFiles(H, r);
  const gf = gtm && H.gf && H.gf.id === r.request_id ? H.gf.files : null;
  const b0 = r.behind || { items: [], text: '' }, b = { items: b0.items.slice(), text: b0.text };
  if (gf) { const pick = (n) => (n && !b.items.some((x) => x.output_link && x.output_link.indexOf(n) >= 0) ? '/files/' + encodeURIComponent(n) + '.csv' : ''); b.items = b.items.map((x) => { if (x.output_link) return x; const k = /relationship/i.test(x.name) ? 'RelationshipMap' : /match|supplier|execution/i.test(x.name) ? 'GTMMatching' : ''; return k && gf[k] ? Object.assign({}, x, { output_link: '/files/' + encodeURIComponent(gf[k]) + '.csv' }) : x; }); if (gf.LightPass) b.items.push({ name: 'GTM ranking (main result)', status: 'done', summary: 'Which accounts to pursue now and which to keep warm.', top_items: [], output_link: '/files/' + encodeURIComponent(gf.LightPass) + '.csv' }); }
  if (!b.items.length && !b.text) { H.s.replaceChildren(); H.cards = {}; H.sk = null; return; }
  if (!H.box) { H.box = el('div', { class: 'behind' }); H.head = el('h2', {}, 'Behind the scenes'); H.list = el('div'); H.txt = el('div', { class: 'pre muted' }); H.box.append(H.head, el('div', { class: 'muted' }, 'What each helper desk found while working on this request.'), el('div', { class: 'flowline' }, 'GTM signals → supplier matches + relationship → ready for #3 intros'), H.list, H.txt); }
  if (H.s.firstChild !== H.box) H.s.replaceChildren(H.box);
  H.txt.textContent = b.items.length ? '' : b.text;
  const seen = new Set(), nodes = [];
  b.items.forEach((s, i) => {
    const key = (s.name || '') + '#' + i; seen.add(key);
    let c = H.cards[key];
    if (!c) { c = H.cards[key] = { root: el('div', { class: 'bcard' }), title: el('b'), chip: el('span'), sum: el('div', { class: 'pre' }), ul: el('ul'), lnk: el('div'), lk: null }; c.root.append(el('div', { class: 'bhead' }, c.title, ' ', c.chip), c.sum, c.ul, c.lnk); }
    c.title.textContent = behindName(r, s.name);
    c.chip.className = 'bchip ' + s.status; c.chip.replaceChildren(...(s.status === 'running' ? [el('span', { class: 'spin' }), ' Working…'] : [s.status === 'done' ? 'Done ✓' : 'Waiting']));
    c.sum.textContent = s.summary || ''; c.sum.style.display = s.summary ? '' : 'none';
    c.ul.replaceChildren(...s.top_items.map((t) => el('li', {}, t))); c.ul.style.display = s.top_items.length ? '' : 'none';
    const sReady = fileReady(r, s.output_link);
    if (c.lk !== (s.output_link || '') + '|' + sReady) {
      c.lk = (s.output_link || '') + '|' + sReady; const l = s.output_link || '';
      if (!l) c.lnk.replaceChildren();
      else if (!sReady) c.lnk.replaceChildren(el('div', { class: 'muted filenote' }, 'File: ' + fileNameOf(l) + ' — on its way, also attached in Grok chat. It appears here by itself.'));
      else if (/^\/files\/.+\.(csv|xlsx)$/i.test(l)) { const holder = el('div'); let made = false; const btn = el('button', { class: 'sec' }, 'Open view'); btn.onclick = () => { if (!made) { made = true; holder.append(gtmView(l)); btn.textContent = 'Hide view'; return; } const hid = holder.style.display === 'none'; holder.style.display = hid ? '' : 'none'; btn.textContent = hid ? 'Hide view' : 'Open view'; }; c.lnk.replaceChildren(btn, holder); }
      else if (/^(\/files\/|https?:\/\/)/i.test(l)) c.lnk.replaceChildren(el('a', { href: l, target: '_blank', rel: 'noopener noreferrer' }, 'Open result'));
      else c.lnk.replaceChildren();
    }
    nodes.push(c.root);
  });
  for (const k of Object.keys(H.cards)) if (!seen.has(k)) delete H.cards[k];
  const cur = [...H.list.children];
  if (cur.length !== nodes.length || cur.some((n, i) => n !== nodes[i])) H.list.replaceChildren(...nodes);
}

let justSubmitted = null;
const isRunning = (r) => (r.status === 'queued' || r.status === 'running') && !r.stuck && !r.closed;
function elapsedTxt(iso) { const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000)); const m = Math.floor(s / 60); return m < 1 ? s + ' sec' : m + ' min ' + String(s % 60).padStart(2, '0') + ' sec'; }
function stepperRun(r) {
  const idx = ORDER.indexOf(r.agent_code);
  return el('div', { class: 'stepper' }, ORDER.map((c, i) => { const s = i === idx ? 'now run' : (i < idx || stageState(c, r.case_id) === 'done') ? 'done' : 'wait'; return el('div', { class: 'st ' + s }, el('span', { class: 'dot' }, s === 'done' ? '✓' : String(i + 1)), el('span', { class: 'lbl' }, me.agents[c].label.replace(/^#\d /, ''))); }));
}
function updateRunning(H, r) {
  if (!isRunning(r)) { if (H.runKey) { H.run.replaceChildren(); H.runKey = null; } return; }
  const key = r.request_id + '|' + r.agent_code;
  if (H.runKey !== key) {
    H.runKey = key;
    H.run.replaceChildren(el('div', { class: 'runbox' }, el('div', { class: 'runtop' }, el('span', { class: 'spin big' }), el('b', {}, me.agents[r.agent_code].label + ' is running'), el('span', { class: 'muted' }, ' · time so far: '), el('b', { class: 'elapsed', 'data-since': r.submitted_at }, elapsedTxt(r.submitted_at))), el('div', { class: 'pbar' }, el('div', { class: 'pfill' })), el('p', {}, "Desk is working on it — you don't need to do anything. Usually takes 3 to 10 minutes."), stepperRun(r)));
  } else { const old = H.run.querySelector('.stepper'); if (old) old.replaceWith(stepperRun(r)); }
}
function runBanners(b) {
  const all = data.requests.filter(isRunning), cc = curCase(), runs = all.filter((r) => r.case_id === cc), other = all.filter((r) => r.case_id !== cc);
  if (other.length) b.append(el('div', { class: 'muted otherrun' }, 'Also working in other cases: ', ...other.map((r) => el('a', { href: '#', onclick: (e) => { e.preventDefault(); switchCase(r.case_id); } }, r.case_id + ' (' + me.agents[r.agent_code].label + ') '))));
  runs.forEach((r) => b.append(el('div', { class: 'banner run', onclick: () => { dealOpen = null; { const ds = $('dealscreen'); if (ds) ds.remove(); } sel = r.request_id; caseSel = r.case_id; renderCases(); renderDetail().then(() => navDone('detail')); } }, el('span', { class: 'spin' }), ' ' + me.agents[r.agent_code].label + ' is working… ', el('b', { class: 'elapsed', 'data-since': r.submitted_at }, elapsedTxt(r.submitted_at)), ' — click to open')));
}
setInterval(() => { document.querySelectorAll('.elapsed[data-since]').forEach((x) => { x.textContent = elapsedTxt(x.dataset.since); }); }, 1000);

function gtmFiles(H, r) {
  const g = H.gf; if (g && g.id === r.request_id && (g.files || Date.now() - g.at < 20000)) return;
  if (g && g.id === r.request_id && g.busy) return;
  H.gf = { id: r.request_id, files: g && g.id === r.request_id ? g.files : null, at: Date.now(), busy: true };
  const mine = H.gf;
  fetch('/api/gtm-files/' + encodeURIComponent(r.request_id), { cache: 'no-store', headers: { 'x-requested-with': 'mf' } }).then((x) => x.json()).then((j) => { mine.busy = false; const f = j && j.files && Object.keys(j.files).length ? j.files : null; const changed = JSON.stringify(f) !== JSON.stringify(mine.files); mine.files = f; mine.at = Date.now(); if (changed && H === $('detail')._h) updateBehind(H, r); }).catch(() => { mine.busy = false; });
}
const VIEWS = {
  GTMMatching: { title: 'Supplier matchmaking: which product fits which account', cols: [['account', 'Account'], ['supplier', 'Supplier'], ['product_pitched', 'Product pitched'], ['keep_or_drop', 'Keep / drop', 'chip'], ['fit_note', 'Fit note'], ['open_gaps', 'Open gaps']] },
  RelationshipMap: { title: 'Our relationship with each account', cols: [['company', 'Company'], ['worked_with_us_before', 'Worked with us before'], ['hypothetical_warm_signals', 'Warm signals'], ['decision_makers_by_role', 'Decision makers (by role)'], ['verification_status', 'Verification']] },
  LightPass: { title: 'GTM ranking (main result)', cols: [['company', 'Company'], ['segment', 'Segment'], ['client_status', 'Decision', 'chip'], ['s4_timing', 'Timing'], ['one_line_brief', 'Why']] },
};
function gtmView(link) {
  const name = decodeURIComponent(link.split('/').pop()).replace(/\.(csv|xlsx)$/i, '');
  const kind = (name.match(/_(LightPass|GTMMatching|RelationshipMap)_V\d+$/i) || [])[1];
  const box = el('div', { class: 'tblbox' }, el('div', { class: 'muted' }, 'Loading…'));
  if (!kind) return tableViewer(link);
  fetch('/api/table/' + encodeURIComponent(name), { cache: 'no-store', headers: { 'x-requested-with': 'mf' } }).then((x) => x.json().then((j) => ({ ok: x.ok, j }))).then(({ ok, j }) => {
    if (!ok) { box.replaceChildren(el('div', { class: 'notice' }, j.error || 'Cannot show this view.')); return; }
    const rows = j.rows || [], hi = rows.findIndex((r) => r.filter((c) => String(c).trim()).length >= 4);
    if (hi < 0) { box.replaceChildren(el('div', { class: 'notice' }, 'No table found in this file. Use the download buttons.')); return; }
    const head = rows[hi].map((h) => String(h).trim().toLowerCase()); let body = []; for (const r of rows.slice(hi + 1)) { if (!r.some((c) => String(c).trim())) break; body.push(r); }
    const V = VIEWS[kind]; let cols = V.cols.map((c) => ({ i: head.indexOf(c[0]), l: c[1], t: c[2] })).filter((c) => c.i >= 0);
    if (!cols.length) cols = head.map((h, i) => ({ i, l: h.replace(/_/g, ' ') }));
    const chip = (v) => { const t = String(v || '').trim(), k = /drop|skip/i.test(t) ? 'bad' : /warm|nurture/i.test(t) ? 'warm' : 'good'; return el('span', { class: 'vchip ' + k }, /^keep$/i.test(t) ? 'Keep' : /keep_warm/i.test(t) ? 'Keep warm' : /^drop$/i.test(t) ? 'Drop' : t.replace(/_/g, ' ')); };
    const bar = el('div', { class: 'tblbar' }, el('b', {}, V.title + ' · ' + body.length + ' accounts'));
    if (j.xlsx) bar.append(el('a', { class: 'btn', href: j.xlsx, download: name + '.xlsx' }, 'Download Excel'));
    if (j.csv) bar.append(el('a', { class: 'btn', href: j.csv, download: name + '.csv' }, 'Download CSV'));
    const tbl = el('table', { class: 'sheet' }, el('thead', {}, el('tr', {}, ...cols.map((c) => el('th', {}, c.l)))), el('tbody', {}, ...body.map((r) => el('tr', {}, ...cols.map((c) => el('td', {}, c.t === 'chip' ? chip(r[c.i]) : (r[c.i] || '')))))));
    box.replaceChildren(el('h3', {}, V.title), bar, el('div', { class: 'tblwrap' }, tbl));
  }).catch(() => box.replaceChildren(el('div', { class: 'notice' }, 'Cannot show this view right now.')));
  return box;
}

function updateMerged(H, r) {
  if (!r.merged_children && r.agent_code !== 'intro_desk') { if (H.mk) { H.m.replaceChildren(); H.mk = null; } return; } // every #3 gets the lead view
  const M = H.mm = H.mm && H.mm.id === r.request_id ? H.mm : { id: r.request_id, at: 0, sig: '', filter: '', busy: false, open: new Set() };
  if (!H.mbox) { H.mbox = el('div', { class: 'tblbox' }); }
  if (H.mk !== r.request_id) { H.mk = r.request_id; H.m.replaceChildren(H.mbox); H.mbox.replaceChildren(el('div', { class: 'muted' }, 'Loading all prospects…')); M.sig = ''; M.at = 0; }
  const stKey = r.status + '|' + r.updated_at + '|' + r.output_link; if (M.busy || (M.stKey === stKey && Date.now() - M.at < 8000)) return; M.busy = true; M.stKey = stKey; // refetch at once when the result changes
  fetch('/api/merged/' + encodeURIComponent(r.request_id), { cache: 'no-store', headers: { 'x-requested-with': 'mf' } }).then((x) => x.json()).then((j) => {
    M.busy = false; M.at = Date.now(); if (j.error) return;
    const sig = JSON.stringify(j); if (sig === M.sig) return; M.sig = sig;
    const hd = j.header.map((h) => String(h).trim().toLowerCase());
    const AL = { account: ['account', 'company'], name: ['prospect_name', 'name', 'prospect'], role: ['title_role', 'role', 'title'], seniority: ['seniority', 'decision_maker_role'], li: ['linkedin_url', 'linkedin'], email: ['email'], ev: ['email_verification'], found: ['found_status'], phone: ['phone', 'phone_public'], source: ['source'], surl: ['source_url'], supplier: ['supplier'], sq: ['supplier_qualification_status', 'supplier_qualification'], pb: ['product_book_used', 'product_book'], pitched: ['product_pitched'], fit: ['supplier_fit'], caveat: ['fit_caveat'], why: ['why_this_person'], angle: ['suggested_intro_angle'], status: ['status'], next: ['next_step', 'owner'], country: ['country'], segment: ['segment'], decision: ['decision', 'client_status'], reason: ['ranking_reason'], rel: ['relationship_history'] };
    const fi = (k) => { for (const n of AL[k]) { const i = hd.indexOf(n); if (i >= 0) return i; } return -1; }, IX = {}; Object.keys(AL).forEach((k) => { IX[k] = fi(k); });
    const g = (x, k) => (IX[k] >= 0 ? String(x[IX[k]] || '').trim() : '');
    const EN = j.enrich || {}, en = (a) => EN[String(a || '').trim().toLowerCase()] || {}; RELO = j.rel || {};
    const senior = (t) => /(president|chief|^c[a-z]o\b|\bvp\b|vice|director|head|general manager|\bgm\b)/i.test(t) ? 'Senior decision-maker' : /(manager|lead)/i.test(t) ? 'Influencer / manager' : (t ? 'Team level' : '');
    const nice = (v) => String(v || '').replace(/_/g, ' ');
    const rows = j.rows.map((x) => { const a = g(x, 'account'), e = en(a), role = g(x, 'role'); return { enr: e, account: a, name: g(x, 'name'), role, seniority: g(x, 'seniority') || senior(role), li: g(x, 'li'), email: g(x, 'email'), ev: g(x, 'ev'), found: g(x, 'found'), phone: g(x, 'phone') || 'not public', source: g(x, 'source') || 'public web', surl: g(x, 'surl'), supplier: g(x, 'supplier'), sq: g(x, 'sq'), pb: g(x, 'pb'), pitched: g(x, 'pitched') || e.pitched || '', fit: g(x, 'fit'), caveat: g(x, 'caveat') || e.caveat || '', why: g(x, 'why'), angle: g(x, 'angle'), status: g(x, 'status') || 'nominated', next: g(x, 'next') || 'Human approves, then intro goes out (owner: Rishabh). Nothing sent yet.', country: g(x, 'country') || e.country || '', segment: g(x, 'segment') || e.segment || '', decision: g(x, 'decision') || e.decision || '', reason: g(x, 'reason') || e.reason || '', rel: g(x, 'rel') || (e.worked ? 'Worked with us before: ' + e.worked + (e.warm ? '. ' + e.warm : '') : '') }; });
    const named = rows.filter((x) => x.name && !/not found/i.test(x.found)).length, emails = rows.filter((x) => x.email && /verified/i.test(x.ev) && !/un|not/i.test(x.ev)).length, lis = rows.filter((x) => x.li).length;
    const fitC = {}; rows.forEach((x) => { const k = x.fit || 'none'; fitC[k] = (fitC[k] || 0) + 1; });
    const stat = (n, l) => el('div', { class: 'sstat' }, el('b', {}, String(n)), el('span', {}, l));
    const strip = el('div', { class: 'sstrip' }, stat(j.accounts.length, 'accounts'), stat(rows.length, 'prospects'), stat(named, 'named'), stat(rows.length - named, 'role only'), stat(lis, 'LinkedIn found'), stat(emails, 'emails verified'), ...Object.entries(fitC).map(([k, n]) => stat(n, nice(k))));
    const sel = el('select', {}, el('option', { value: '' }, 'All accounts (' + j.accounts.length + ')'), ...j.accounts.map((a) => el('option', { value: a.account }, a.account + (a.n ? ' · ' + a.n : ' · in progress'))), crOpen(r.case_id) ? el('option', { value: '__cr' }, '↗ Contact research for these accounts') : null);
    sel.value = M.filter;
    const wrap = el('div', { class: 'tblwrap' });
    const decChip = (d) => d ? el('span', { class: 'vchip ' + (/warm/i.test(d) ? 'warm' : 'good') }, d) : '';
    const link = (v, t) => /^https?:\/\//.test(v) ? el('a', { href: v, target: '_blank', rel: 'noopener noreferrer' }, t || v) : (v || '');
    const mail = (v) => /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(v) ? el('a', { href: 'mailto:' + v }, v) : (v || '');
    const draw = () => {
      M.filter = sel.value; const trs = [];
      for (const a of j.accounts) { if (M.filter && a.account !== M.filter) continue;
        const mine = rows.map((x, i) => [x, i]).filter(([x]) => x.account === a.account);
        if (!mine.length) { trs.push(el('tr', {}, el('td', {}, a.account), el('td', { colspan: 9, class: 'muted' }, 'in progress'))); continue; }
        for (const [x, i] of mine) {
          const open = M.open.has(i), btn = el('a', { href: '#', onclick: (ev) => { ev.preventDefault(); if (M.open.has(i)) M.open.delete(i); else M.open.add(i); draw(); } }, open ? '▾ Hide' : '▸ Details');
          trs.push(el('tr', {}, el('td', {}, x.account), el('td', {}, decChip(x.decision)), el('td', {}, relCell(x.account, x.name, x.enr, draw)), el('td', {}, x.name || el('span', { class: 'muted' }, 'not found yet')), el('td', {}, x.role), el('td', {}, x.li ? link(x.li, 'Profile') : el('span', { class: 'muted' }, '–')), el('td', {}, x.email ? [mail(x.email), ' ', el('span', { class: 'muted' }, nice(x.ev))] : el('span', { class: 'muted' }, nice(x.ev) || '–')), el('td', {}, nice(x.fit)), el('td', {}, nice(x.status)), el('td', {}, btn)));
          if (open) { const f = (l, v) => el('div', { class: 'dkv' }, el('b', {}, l), el('span', {}, v || '–')); trs.push(el('tr', { class: 'detail' }, el('td', { colspan: 10 }, el('div', { class: 'dgrid' }, f('Relationship', relOf(x.account, x.name, x.enr) + (/^(Existing contact|Warm lead)$/.test(relOf(x.account, x.name, x.enr)) ? ' — Warm path first' : '')),
            f('Country / segment', [x.country, x.segment].filter(Boolean).join(' · ')), f('#2 decision and why', [x.decision, x.reason].filter(Boolean).join(' — ')), f('Prospect', x.name), f('Title / role', x.role), f('Seniority', x.seniority),
            f('LinkedIn', x.li ? link(x.li) : ''), f('Email', x.email ? mail(x.email) : ''), f('Email / found check', nice(x.ev) + (x.found ? ' (' + x.found + ')' : '')), f('Phone', x.phone),
            f('Source', x.source), f('Source URL', x.surl ? link(x.surl) : ''), f('Supplier', x.supplier), f('Supplier qualification', x.sq), f('Product Book used', x.pb), f('Product pitched', x.pitched),
            f('Supplier Fit and caveat', [nice(x.fit), x.caveat].filter(Boolean).join(' — ')), f('Relationship history', x.rel), f('Why this person', x.why), f('Suggested intro angle', x.angle), f('Status', nice(x.status)), f('Next step / owner', x.next))))); }
        }
      }
      wrap.replaceChildren(el('table', { class: 'sheet' }, el('thead', {}, el('tr', {}, ...['Account', '#2 decision', 'Relationship', 'Prospect', 'Title / role', 'LinkedIn', 'Email', 'Supplier Fit', 'Status', ''].map((h) => el('th', {}, h)))), el('tbody', {}, ...trs)));
    };
    sel.onchange = () => { if (sel.value === '__cr') { sel.value = M.filter || ''; openCR(r.case_id); return; } draw(); }; draw();
    const bar = el('div', { class: 'tblbar' }, el('b', {}, 'All prospects'), sel);
    if (j.xlsx) bar.append(el('a', { class: 'btn', href: j.xlsx, download: '' }, 'Download Excel'));
    if (j.csv) bar.append(el('a', { class: 'btn', href: j.csv, download: '' }, 'Download CSV'));
    H.mbox.replaceChildren(el('h3', {}, 'Lead view: all shortlisted accounts'), strip, bar, wrap);
  }).catch(() => { M.busy = false; });
}
function acctCount(r) { const n = String((r.inputs && r.inputs.account) || '').split(/[\n;]+/).filter((x) => x.trim()).length; return Math.max(n, 0); }
function deskTitle(r) { return r.agent_code === 'intro_desk' ? r.agent_label + ' · ' + acctCount(r) + ' shortlisted accounts' : r.agent_label; }

let dealOpen = null;
function closeDeal() { dealOpen = null; const s = $('dealscreen'); if (s) s.remove(); renderDetail(); }
async function openDeal(from) {
  dealOpen = from.request_id; $('detail').style.display = 'none';
  let box = $('dealscreen'); if (box) box.remove();
  box = el('div', { class: 'card', id: 'dealscreen' }); $('detail').parentNode.insertBefore(box, $('detail'));
  box.append(el('div', { class: 'muted' }, 'Loading contacts…')); window.scrollTo({ top: 0, behavior: 'smooth' });
  let j; try { j = await fetch('/api/merged/' + encodeURIComponent(from.request_id), { cache: 'no-store', headers: { 'x-requested-with': 'mf' } }).then((x) => x.json()); } catch (e) { j = { error: 'x' }; }
  if (!j || j.error) { box.replaceChildren(el('div', { class: 'notice' }, 'Could not load the contacts from ' + from.request_id + '.'), el('button', { class: 'sec', onclick: closeDeal }, 'Back')); return; }
  const hd = j.header.map((h) => String(h).trim().toLowerCase()), fi = (...n) => { for (const k of n) { const i = hd.indexOf(k); if (i >= 0) return i; } return -1; };
  const IX = { a: fi('account', 'company'), n: fi('prospect_name', 'name'), r: fi('title_role', 'role'), f: fi('found_status'), s: fi('supplier'), p: fi('product_book_used', 'product_book'), li: fi('linkedin_url', 'linkedin'), e: fi('email') }, gv = (x, k) => (IX[k] >= 0 ? String(x[IX[k]] || '').trim() : '');
  const EN = j.enrich || {}; RELO = j.rel || {};
  const all = j.rows.map((x) => ({ account: gv(x, 'a'), name: gv(x, 'n'), role: gv(x, 'r'), found: gv(x, 'f'), supplier: gv(x, 's'), pb: gv(x, 'p'), email: gv(x, 'e'), li: gv(x, 'li') })).filter((c) => c.name && !/not found/i.test(c.found));
  const first = (n) => String(n).trim().split(/\s+/).slice(0, -1).join(' ') || String(n).trim(), last = (n) => { const p = String(n).trim().split(/\s+/); return p.length > 1 ? p[p.length - 1] : ''; };
  const pickDefault = () => { const out = new Set(), seenA = new Set(); all.forEach((c, i) => { if (out.size < 2 && !seenA.has(c.account)) { seenA.add(c.account); out.add(i); } }); return out; }; // suggestion: first named contact of the first two accounts
  const picked = pickDefault(), appt = new Map(), APPT = ['Not booked', 'Requested', 'Booked'];
  const review = el('div', { class: 'review' }), go = el('button', { class: 'big' }, 'Start Deal Desk'), note = el('textarea', { rows: 3, style: 'width:100%', placeholder: 'Optional note for the Deal Desk (for example: why these contacts, what was agreed)' });
  const list = el('div', { class: 'cpick' });
  const drawReview = () => {
    const chosen = [...picked].sort((x, y) => x - y).map((i) => all[i]);
    go.disabled = !chosen.length; go.textContent = chosen.length ? 'Start Deal Desk (' + chosen.length + ' contact' + (chosen.length > 1 ? 's' : '') + ')' : 'Pick at least one contact';
    review.replaceChildren(el('h3', {}, 'Review before sending to Deal Desk'), chosen.length ? el('table', { class: 'sheet' }, el('thead', {}, el('tr', {}, ...['First name', 'Last name', 'Company', 'Relationship', 'Supplier', 'Product Book', 'Appointment'].map((h) => el('th', {}, h)))), el('tbody', {}, ...chosen.map((c) => el('tr', {}, el('td', {}, first(c.name)), el('td', {}, last(c.name)), el('td', {}, c.account), el('td', {}, relChip(relOf(c.account, c.name, EN[String(c.account).toLowerCase()]))), el('td', {}, c.supplier), el('td', {}, c.pb), el('td', {}, appt.get(all.indexOf(c)) || 'Not booked'))))) : el('div', { class: 'notice' }, 'No contacts selected yet. Tick at least one above.'));
  };
  const nf = (v, link) => v ? (link && /^https?:\/\//.test(v) ? el('a', { href: v, target: '_blank', rel: 'noopener noreferrer' }, 'Profile') : v) : el('span', { class: 'muted' }, 'not found');
  const tb = el('tbody');
  all.forEach((c, i) => {
    const cb = el('input', { type: 'checkbox' }); cb.checked = picked.has(i); cb.onchange = () => { cb.checked ? picked.add(i) : picked.delete(i); drawReview(); };
    const as = el('select', {}, ...APPT.map((o) => el('option', { value: o }, o))); as.onchange = () => { appt.set(i, as.value); drawReview(); };
    tb.append(el('tr', {}, el('td', {}, cb), el('td', {}, first(c.name)), el('td', {}, last(c.name)), el('td', {}, nf(c.email)), el('td', {}, nf(c.li, true)), el('td', {}, c.account), el('td', {}, relCell(c.account, c.name, EN[String(c.account).toLowerCase()], drawReview)), el('td', {}, c.supplier), el('td', {}, c.pb), el('td', {}, as)));
  });
  list.append(el('div', { class: 'tblwrap' }, el('table', { class: 'sheet' }, el('thead', {}, el('tr', {}, ...['Tick', 'First name', 'Last name', 'Email', 'LinkedIn', 'Company', 'Relationship', 'Supplier', 'Product Book', 'Appointment'].map((h) => el('th', {}, h)))), tb)));
  go.onclick = async () => {
    const chosen = [...picked].sort((x, y) => x - y).map((i) => ({ c: all[i], ap: appt.get(i) || 'Not booked' })); if (!chosen.length) return;
    const ok = await confirmBox('Send to the Deal Desk?', 'Are you sure you want to send these ' + chosen.length + ' contacts to the Deal Desk?', 'Yes, send', 'good'); if (!ok) return;
    if (sendingNow) return;
    const prods = [...new Set(j.accounts.map((x) => (EN[String(x.account).toLowerCase()] || {}).pitched).filter(Boolean))];
    const inputs = { account: chosen.map(({ c, ap }) => [c.account, c.name, c.role, 'Email: ' + (c.email || 'not found'), 'LinkedIn: ' + (c.li || 'not found'), 'Relationship: ' + relOf(c.account, c.name, EN[String(c.account).toLowerCase()]), 'Appointment: ' + ap, c.supplier, c.pb].join(' | ')).join('\n'), product: (prods[0] || caseProduct(from.case_id) || 'Product from the case Product Book').slice(0, 600), soft_yes_note: ((note.value.trim() ? note.value.trim() + '\n' : '') + 'Contacts hand-picked by a human in the app. Appointment status (manual): ' + chosen.map(({ c, ap }) => c.name + ' = ' + ap).join('; ')).slice(0, 2000), soft_yes_confirmed: true };
    try { box.style.display = 'none'; const res = await gsend(go, '/api/submit', { agent_code: 'deal_desk', case_id: from.case_id, parent_request_id: from.request_id, inputs }, { pend: { agent_code: 'deal_desk', case_id: from.case_id, inputs }, keepDeal: true }); dealOpen = null; box.remove(); selSet(res.request_id); caseSel = res.case_id; await refresh(); navDone('detail'); }
    catch (e) { box.style.display = ''; dealOpen = from.request_id; $('detail').style.display = 'none'; go.disabled = false; drawReview(); box.prepend(el('div', { class: 'notice' }, 'Not sent: ' + e.message)); }
  };
  const prev = el('details', { class: 'dealprev2' }, el('summary', {}, 'How the result will look (optional)'), el('div', { class: 'muted' }, 'Deal outline (account, contact, supplier, product, ladder rung, next human step) · Draft proposal (later, placeholder) · Human gates (a human closes the deal; nothing is sent).'));
  box.replaceChildren(el('h2', {}, '#4 Deal Desk · human-gated'), stepperRun({ agent_code: 'deal_desk', case_id: from.case_id }), el('p', {}, 'Only leads we finalise come here. Proposal drafting comes later.'),
    el('h3', {}, 'Pick contacts for the deal desk'), el('div', { class: 'muted' }, 'Named prospects finalised in the Introduction Desk (' + from.request_id + '). A suggested pair is pre-ticked; change it as you like. Only ticked people go to the Deal Desk. Appointment is set by hand; nothing is booked or sent.'),
    all.length ? list : el('div', { class: 'notice' }, 'No named prospects found yet.'), el('b', {}, 'Note'), note, review, el('div', { class: 'actions' }, go, el('button', { class: 'sec', onclick: closeDeal }, 'Back')), prev);
  drawReview();
}

function selSet(id) { sel = id; }
// the product of a case: the approved Product Book (supplier + products), else the #1 focus
function caseProduct(caseId) {
  const rs = data.requests.filter((x) => x.case_id === caseId && x.approval_state !== 'rejected');
  const pb = rs.filter((x) => x.agent_code === 'product_book').sort((a, b) => String(b.submitted_at).localeCompare(String(a.submitted_at)))[0];
  if (pb) return [pb.inputs.supplier_name, pb.inputs.products].filter(Boolean).join(' - ');
  const of = rs.find((x) => x.agent_code === 'opportunity_finder'); return of ? of.inputs.focus || '' : '';
}

function gotoStage(code, caseId) {
  const rs = data.requests.filter((x) => x.case_id === caseId && x.agent_code === code && x.approval_state !== 'rejected').sort((p, q) => String(q.updated_at).localeCompare(String(p.updated_at)));
  if (rs.length) { dealOpen = null; const s = $('dealscreen'); if (s) s.remove(); sel = rs[0].request_id; caseSel = caseId; renderCases(); renderGStep(); renderDetail(); navDone('detail'); return; }
  if (code === 'deal_desk') {
    const ok = data.requests.filter((x) => x.case_id === caseId && x.agent_code === 'intro_desk' && x.approved).sort((p, q) => String(q.updated_at).localeCompare(String(p.updated_at)))[0];
    if (ok) { openDeal(ok); return; }
    toast('#4 Deal Desk opens after #3 Introduction Desk is approved. Approve #3 first.'); return;
  }
  if (code === ORDER[0]) { dealOpen = null; const ds = $('dealscreen'); if (ds) ds.remove(); sel = null; caseSel = caseId || NEWC; desk = code; prefill = null; renderDesks(); renderForm(); renderDetail(); renderGStep(); navDone('form'); return; }
  const i = ORDER.indexOf(code), prev = i > 0 ? data.requests.filter((x) => x.case_id === caseId && x.agent_code === ORDER[i - 1] && x.approved)[0] : null;
  if (prev) { startNext(prev, code); return; }
  toast(me.agents[code].label + ' has not started yet. Finish the earlier stage first.');
}
function updateDealView(H, r) {
  const responded = r.status === 'done' || r.status === 'needs approval';
  if (r.agent_code === 'deal_desk' && responded && !/^\/files\/.+\.(csv|xlsx)$/i.test(r.output_link || '')) { const k0 = 'b|' + r.request_id + '|' + r.status; if (H.dk !== k0) { H.dk = k0; H.m.replaceChildren(wfBanner(true)); } return; }
  if (r.agent_code !== 'deal_desk' || !/^\/files\/.+\.(csv|xlsx)$/i.test(r.output_link || '')) { if (H.dk) { H.dk = null; if (r.agent_code !== 'intro_desk') H.m.replaceChildren(); } return; }
  const key = r.request_id + '|' + r.output_link + '|' + r.updated_at; if (H.dk === key) return; H.dk = key;
  const name = decodeURIComponent(r.output_link.split('/').pop()).replace(/\.(csv|xlsx)$/i, '');
  const box = el('div', { class: 'tblbox' }, el('div', { class: 'muted' }, 'Loading the deal outline…')); H.m.replaceChildren(box);
  fetch('/api/table/' + encodeURIComponent(name), { cache: 'no-store', headers: { 'x-requested-with': 'mf' } }).then((x) => x.json().then((j) => ({ ok: x.ok, j }))).then(({ ok, j }) => {
    if (!ok) { box.replaceChildren(el('div', { class: 'notice' }, j.error || 'Cannot show the deal outline.')); return; }
    const rows = j.rows || [], hi = rows.findIndex((x) => x.filter((c) => String(c).trim()).length >= 4); if (hi < 0) { box.replaceChildren(el('div', { class: 'notice' }, 'The file has no table I can read. Use the download buttons.')); return; }
    const hd = rows[hi].map((h) => String(h).trim().toLowerCase()), body = []; for (const x of rows.slice(hi + 1)) { if (!x.some((c) => String(c).trim())) break; body.push(x); }
    const AL = { account: ['account', 'company', 'company_name'], contact: ['contact', 'contact_name', 'prospect_name', 'name'], role: ['title_role', 'role'], supplier: ['supplier'], product: ['product_line', 'product', 'product_book_used', 'product_book'], rung: ['ladder_rung_draft', 'ladder_rung'], fee: ['fee_tag_draft', 'fee_model', 'fee_shape'], shape: ['commercial_shape_draft', 'commercial_step'], left: ['commercials_left_for_human', 'commercials'], flags: ['moq_certifications_compliance', 'moq', 'certifications', 'compliance_flags', 'supplier_fit_status'], risks: ['risks', 'known_limits'], why: ['why_this_deal'], paper: ['paper_path'], qs: ['open_questions'], next: ['human_next_steps', 'next_step', 'next_owner'], status: ['outline_status', 'status'], segment: ['demand_segment', 'segment'], appt: ['appointment', 'appointment_status'] };
    const IXd = {}; for (const k of Object.keys(AL)) { IXd[k] = -1; for (const n of AL[k]) { const i = hd.indexOf(n); if (i >= 0) { IXd[k] = i; break; } } }
    const gv = (x, k) => (IXd[k] >= 0 ? String(x[IXd[k]] || '').trim() : ''), nice = (v) => String(v || '').replace(/_/g, ' ');
    const cards = body.map((x) => { const f = (l, k, dflt) => el('div', { class: 'dkv' }, el('b', {}, l), el('span', {}, gv(x, k) || dflt || 'Human to set'));
      return el('div', { class: 'ocard' }, el('div', { class: 'bhead' }, el('b', {}, gv(x, 'account') + (gv(x, 'contact') ? ' · ' + gv(x, 'contact') : '')), ' ', gv(x, 'rung') ? el('span', { class: 'vchip good' }, 'Rung: ' + nice(gv(x, 'rung'))) : '', ' ', el('span', { class: 'vchip warm' }, nice(gv(x, 'status')) || 'draft')),
        el('div', { class: 'dgrid' }, f('1. Why this deal', 'why'), f('2. Paper path', 'paper'), f('3. Commercial step', 'shape'), f('4. Fee model', 'fee'), f('5. Open questions', 'qs'), f('6. Human next steps', 'next'),
          f('Supplier', 'supplier', '–'), f('Product / Product Book', 'product', '–'), f('Commercials left for human', 'left', 'Price, terms and fees are set by a human'), f('MOQ / certifications / compliance flags', 'flags'), f('Risks and known limits', 'risks'), f('Appointment', 'appt', '–')));
    });
    const bar = el('div', { class: 'tblbar' }, el('b', {}, body.length + ' deal outline' + (body.length === 1 ? '' : 's')));
    if (j.xlsx) bar.append(el('a', { class: 'btn', href: j.xlsx, download: name + '.xlsx' }, 'Download Excel'));
    if (j.csv) bar.append(el('a', { class: 'btn', href: j.csv, download: name + '.csv' }, 'Download CSV'));
    box.replaceChildren(wfBanner(true), el('h3', {}, 'Deal outline'), el('div', { class: 'muted' }, 'A draft for humans to review. Nothing here is negotiated, signed or sent.'), bar, ...cards,
      el('div', { class: 'pv' }, el('b', {}, 'Draft proposal (later)'), el('div', { class: 'muted' }, 'Not drafted yet. A proposal is only drafted after a human confirms a soft yes and the commercial terms.')),
      el('div', { class: 'pv' }, el('b', {}, 'Human gates'), el('ul', {}, el('li', {}, 'A human holds the intro and the appointment.'), el('li', {}, 'A human records the soft yes.'), el('li', {}, 'A human sets price, terms and fees, and closes the deal.'))));
  }).catch(() => box.replaceChildren(el('div', { class: 'notice' }, 'Cannot show the deal outline right now.')));
}

let RELO = {};
const REL_VALUES = ['Existing contact', 'Warm lead', 'New', 'Unknown'];
function relDerive(e) {
  e = e || {}; const w = String(e.worked || '').trim(), warm = String(e.warm || '').trim();
  if (/^(yes|existing|true|y)\b/i.test(w)) return 'Existing contact';
  if (warm && !/hypothetical|not verified|unverified|none/i.test(warm)) return 'Warm lead';
  if (!w || /^unknown/i.test(w)) return 'Unknown';
  return 'New';
}
function relOf(account, name, e) { const k = (String(account).trim() + '|' + String(name).trim()).toLowerCase(); return RELO[k] || relDerive(e); }
function relChip(v) { return el('span', { class: 'vchip ' + (v === 'Existing contact' ? 'good' : v === 'Warm lead' ? 'warm' : v === 'New' ? 'newc' : 'unk') }, v); }
function relCell(account, name, e, after) {
  const k = (String(account).trim() + '|' + String(name).trim()).toLowerCase(), cur = relOf(account, name, e);
  const sel = el('select', { class: 'relsel', title: 'Set by hand (saved in the app only)' }, ...REL_VALUES.map((o) => el('option', { value: o }, o))); sel.value = cur;
  sel.onchange = async () => { RELO[k] = sel.value; try { await api('/api/rel-override', { key: k, value: sel.value }); } catch (er) { toast('Could not save: ' + er.message, 'err'); } if (after) after(); };
  return el('div', {}, relChip(cur), el('br'), sel);
}

function addDealCard(caseEl, caseId, all) {
  if (all.some((r) => r.agent_code === 'deal_desk' && r.approval_state !== 'rejected')) return caseEl;
  const ok = all.find((r) => r.agent_code === 'intro_desk' && r.approved);
  const btn = el('button', { class: 'big', onclick: (e) => { e.stopPropagation(); gotoStage('deal_desk', caseId); } }, ok ? 'Choose contacts and start →' : 'Waiting for #3 approval');
  if (!ok) btn.disabled = true;
  caseEl.append(ok ? wfBanner(false) : '', el('div', { class: 'row dealrow' }, el('span', { class: 'chip' }, 'Not started'), el('span', {}, el('b', {}, '#4 Deal Desk'), ' ', el('span', { class: 'muted' }, 'Not started — ' + (ok ? 'Choose contacts and start' : 'approve #3 Introduction Desk first, then choose contacts here')), ), btn));
  return caseEl;
}

function wfBanner(contactsDone) {
  const st = (done, n, t, sub) => el('li', { class: done ? 'ok' : '' }, el('span', { class: 'wfdot' }, done ? '✓' : String(n)), el('span', {}, el('b', {}, t), ' ', el('span', { class: 'muted' }, sub)));
  return el('div', { class: 'wfbanner' }, el('div', { class: 'wfhead' }, '🎉 Workflow complete up to Deal Desk — ready to draft proposal and finalise the deal'),
    el('ol', { class: 'wflist' }, st(!!contactsDone, 1, 'Contacts selected', contactsDone ? '(sent to the Deal Desk)' : '(you choose them in the next screen)'), st(false, 2, 'Draft proposal', '(human reviews)'), st(false, 3, 'Finalise deal', '(human closes)')),
    el('button', { class: 'sec', disabled: true, title: 'Coming next. Needs your go. Sends nothing.' }, 'Draft proposal · coming next, needs your go'));
}

// ---- never fail silently: friendly message + log for any error ----
function failSoft(where, e) {
  const m = (e && e.message) || String(e || 'unknown error');
  try { toast('Sorry, that did not work (' + where + '): ' + m + '. It was saved to the log. Please try again or tell us.', 'err'); } catch (_) {}
  try { fetch('/api/client-error', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'mf' }, body: JSON.stringify({ where, message: m }) }); } catch (_) {}
  console.error(where, e);
}
window.addEventListener('error', (ev) => failSoft('page', ev.error || ev.message));
window.addEventListener('unhandledrejection', (ev) => failSoft('page', ev.reason));
const _gotoStage = gotoStage; gotoStage = function (c, id) { try { const r = _gotoStage(c, id); if (r && r.catch) r.catch((e) => failSoft('stage button', e)); return r; } catch (e) { failSoft('stage button', e); } };
const _openDeal = openDeal; openDeal = async function (f) { try { return await _openDeal(f); } catch (e) { failSoft('Deal Desk screen', e); } };
let loadedCode = null;
function checkVersion() { fetch('/api/health', { cache: 'no-store' }).then((x) => x.json()).then((j) => { const v = document.getElementById('ver'); if (v) v.textContent = 'Mettalfold app ' + (j.version || '?') + ' · code ' + (j.code || '?'); if (!loadedCode) loadedCode = j.code; else if (j.code && j.code !== loadedCode && !$('upd')) { const b = el('div', { id: 'upd', class: 'banner warn', role: 'status' }, 'A new version of the app (' + (j.version || '') + ') is installed. ', el('button', { class: 'sec', onclick: () => location.reload() }, 'Refresh now')); document.body.prepend(b); } }).catch(() => {}); }
checkVersion(); setInterval(checkVersion, 60000);

// ---- instant, double-submit-proof sending ----
let sendingNow = false, pend = null, recvTimer = null; const idemKeys = new Map();
const uid = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
function recvBanner(text, cls) {
  let b = $('recv'); if (!b) { b = el('div', { id: 'recv' }); $('banner').after(b); }
  clearTimeout(recvTimer); b.className = 'recvbanner ' + (cls || ''); b.replaceChildren(...(cls === 'err' ? [] : [el('span', { class: 'spin' }), ' ']), text);
  if (cls) recvTimer = setTimeout(() => { b.replaceChildren(); b.className = ''; }, cls === 'err' ? 12000 : 5000);
}
async function gsend(btn, path, body, opts) {
  if (sendingNow) throw new Error('Already sending. Please wait a moment.');
  sendingNow = true; opts = opts || {}; document.querySelectorAll('.toast:not(.err)').forEach((t) => t.remove()); // old hints like "Form ready…" are done
  const sig = path + JSON.stringify(body); const idem = idemKeys.get(sig) || uid(); idemKeys.set(sig, idem);
  const old = btn ? [...btn.childNodes] : [], prevSel = sel;
  if (btn) { btn.disabled = true; btn.replaceChildren(el('span', { class: 'spin' }), ' Submitting…'); }
  recvBanner('Request received — the desk is working on it in the background', '');
  if (opts.pend) { pend = Object.assign({ id: 'PENDING-' + Date.now(), submitted_at: new Date().toISOString() }, opts.pend); sel = pend.id; renderDetail(); navDone('detail'); }
  const ac = new AbortController(), timer = setTimeout(() => ac.abort(), 120000);
  try {
    const r = await fetch(path, { method: 'POST', headers: H, body: JSON.stringify(Object.assign({}, body, { idem })), signal: ac.signal });
    if (r.status === 401) { location.href = '/login'; return new Promise(() => {}); }
    const j = await r.json().catch(() => ({ error: 'Unreadable answer' }));
    if (!r.ok) { const e = new Error(j.error || 'Something went wrong'); e.info = j; throw e; }
    idemKeys.delete(sig); pend = null; recvBanner('Sent ✓ — the desk has it', 'ok');
    return j;
  } catch (e) {
    pend = null; if (sel && String(sel).startsWith('PENDING-')) sel = prevSel;
    let err = e; if (e && e.name === 'AbortError') err = Object.assign(new Error('The service did not answer in time. Nothing was lost: press the button again to try again. It will not create a duplicate.'), {}); else idemKeys.delete(sig);
    recvBanner('Not sent: ' + err.message, 'err'); renderDetail(); throw err;
  } finally {
    clearTimeout(timer); sendingNow = false;
    if (btn) { btn.disabled = false; btn.replaceChildren(...old); }
  }
}
function renderPendingView() {
  const d = $('detail'), p = pend; if (!p) return; d.style.display = 'block'; if (d.dataset.sel === 'PENDING:' + p.id) { return; }
  d.dataset.sel = 'PENDING:' + p.id; d._h = null; d.dataset.hash = '';
  const a = me.agents[p.agent_code], lbl = p.agent_code === 'intro_desk' ? a.label + ' · ' + acctCount({ inputs: p.inputs }) + ' shortlisted accounts' : a.label;
  const steps = p.agent_code === 'advisory_gtm' ? ['GTM signals', 'Supplier matches (GTM Execution Matching Desk)', 'Relationship scores (Relationship Manager)'] : [];
  d.replaceChildren(el('h2', {}, lbl + ' · sending…'), el('div', { class: 'runbox' }, el('div', { class: 'runtop' }, el('span', { class: 'spin big' }), el('b', {}, 'Request received — the desk is working on it in the background'), el('span', { class: 'muted' }, ' · time so far: '), el('b', { class: 'elapsed', 'data-since': p.submitted_at }, elapsedTxt(p.submitted_at))), el('div', { class: 'pbar' }, el('div', { class: 'pfill' })), el('p', {}, "Desk is working on it — you don't need to do anything. Usually takes 3 to 10 minutes."), stepperRun({ agent_code: p.agent_code, case_id: p.case_id })),
    el('div', { class: 'muted' }, 'You sent: ' + Object.entries(p.inputs || {}).filter(([k]) => k !== 'case_label').map(([k, v]) => k.replace(/_/g, ' ') + ': ' + String(v).slice(0, 80)).join(' | ')),
    ...(steps.length ? [el('h2', {}, 'Behind the scenes'), ...steps.map((n) => el('div', { class: 'bcard' }, el('div', { class: 'bhead' }, el('b', {}, n), ' ', el('span', { class: 'bchip waiting' }, 'Waiting')))) ] : []));
}

// ---- v36: one case at a time. The page shows ONLY the selected case; older cases live in the Case menu. ----
const NEWC = 'new'; let firstLoad = true;
function caseIds() { return [...new Set(data.requests.map((r) => r.case_id).filter(Boolean))].sort(); }
function activeCase() { const ids = caseIds(); return ids.length ? ids[ids.length - 1] : ''; } // the newest case is the active one
function hashCase() { const m = /^#case=([A-Za-z0-9-]+)$/.exec(location.hash || ''); return m ? m[1] : null; }
function loadCase() { const h = hashCase(); let v = h; if (v === null) { try { v = localStorage.getItem('mf.case'); } catch (e) { v = null; } } caseSel = v || ''; }
function saveCase() { const v = caseSel || ''; try { localStorage.setItem('mf.case', v); } catch (e) { /* private mode */ } const h = v ? '#case=' + v : ''; if ((location.hash || '') !== h) history.replaceState(null, '', h || location.pathname + location.search); }
function caseInfo(c) {
  const rs = data.requests.filter((r) => r.case_id === c).sort((a, b) => String(a.submitted_at).localeCompare(String(b.submitted_at)));
  const lab = (rs.find((r) => r.case_label) || {}).case_label || '', sup = (rs.find((r) => r.inputs && r.inputs.supplier_name) || { inputs: {} }).inputs.supplier_name || '';
  const last = ORDER.slice().reverse().find((code) => rs.some((r) => r.agent_code === code)); const lr = last ? rs.filter((r) => r.agent_code === last) : [];
  const d = rs[0] ? new Date(rs[0].submitted_at) : null;
  return { id: c, label: lab, supplier: sup, date: d && !isNaN(d) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '', stage: last ? me.agents[last].label + ' (' + stepClass(lr)[1] + ')' : 'Not started' };
}
function switchCase(c) {
  dealOpen = null; { const ds = $('dealscreen'); if (ds) ds.remove(); }
  caseSel = c || NEWC; sel = null; prefill = null; if (caseSel === NEWC) desk = ORDER[0];
  const g = $('gstep'); if (g) g.dataset.key = '';
  saveCase(); renderDesks(); renderForm(); renderCases(); renderGStep(); renderDetail();
  const b = $('banner'); if (b) { b.querySelectorAll('.banner.run,.otherrun').forEach((x) => x.remove()); runBanners(b); }
  if (caseSel === NEWC) { toast('New case started. Fill in Supplier Qualification and press Submit.'); navDone('form'); }
}
function startNewCase() { switchCase(NEWC); }
function renderCaseBar() {
  let bar = $('casebar'); if (!bar) { bar = el('div', { id: 'casebar', class: 'casebar' }); const g = $('gstep'); g.parentNode.insertBefore(bar, g); }
  const cc = curCase(), act = activeCase(), ids = caseIds(), past = ids.filter((c) => c !== act).reverse();
  const key = [cc, caseSel === NEWC, ids.map((c) => { const i = caseInfo(c); return c + i.label + i.supplier + i.stage; }).join(',')].join('|') + '|cr' + crOpen(cc); if (bar.dataset.key === key) return; bar.dataset.key = key;
  const txt = (i) => [i.id, i.label, i.supplier, i.date, 'last: ' + i.stage].filter(Boolean).join(' · ');
  const pick = el('select', { id: 'casepick', 'aria-label': 'Choose a case', onchange: (e) => switchCase(e.target.value === NEWC ? NEWC : e.target.value) },
    !cc ? el('option', { value: NEWC, selected: true }, 'New case (nothing sent yet)') : null,
    act ? el('option', { value: act, selected: cc === act }, txt(caseInfo(act)) + (cc ? ' (active)' : ' (latest)')) : null,
    past.length ? el('optgroup', { label: 'Past cases' }, past.map((c) => el('option', { value: c, selected: cc === c }, txt(caseInfo(c))))) : null);
  const viewingPast = cc && act && cc !== act;
  bar.replaceChildren(...[el('b', {}, 'Case: '), pick, ' ', el('button', { type: 'button', class: 'sec', id: 'newcase', onclick: startNewCase }, '＋ Start a new case'),
    cc ? ' ' : null, cc ? crLink(cc) : null,
    viewingPast ? el('span', { class: 'pastnote' }, ' You are looking at a past case. ', el('a', { href: '#', onclick: (e) => { e.preventDefault(); switchCase(act); } }, 'Back to the active case (' + act + ') →')) : null].filter((x) => x != null));
}
