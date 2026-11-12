'use strict';
// v38: contact research filters for a case. It never spends credits.
// v40: locked until the case reaches #3 Introduction Desk with #2 Advisory GTM approved; no credit amounts are shown.
// v41: a panel that opens inside the case screen (window.CR.open). The old /research page only forwards to the case screen.
(function () {
  const H = { 'Content-Type': 'application/json', 'X-Requested-With': 'mf' };
  const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v); } for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c)); return e; };
  const api = async (p, body) => { const r = await fetch(p, body ? { method: 'POST', headers: H, body: JSON.stringify(body) } : {}); if (r.status === 401) { location.href = '/login'; return new Promise(() => {}); } const j = await r.json().catch(() => ({ error: 'Unreadable answer' })); if (!r.ok) { const e = new Error(j.error || 'Error'); e.fields = j.fields; e.locked = !!j.locked; throw e; } return j; };
  const fmt = (t) => { if (!t) return ''; const d = new Date(t); return isNaN(d) ? t : d.toLocaleString(); };
  const LISTS = [['job_titles', 'Job titles (sent as title filter, and matched here)'], ['persona_roles', 'Persona roles for this case'], ['seniority', 'Seniority words'], ['departments', 'Departments'], ['exclude_titles', 'Leave out titles containing'], ['locations', 'Locations (countries or regions)'], ['company_size', 'Company size (e.g. 1001-5000; empty = any)']];
  const LOCK = 'Unlock in Introduction Desk first';
  // replaceChildren() would print a skipped (null/false) part as the word "null"; drop those first
  const put = (n, ...kids) => n.replaceChildren(...kids.flat().filter((c) => c != null && c !== false).map((c) => (c.nodeType ? c : String(c))));

  // Builds the panel inside `root` for one case. opts.toast(msg, bad) shows messages; opts.onClose() is the Back control.
  function mount(root, caseId, opts = {}) {
    let S = null; const cur = caseId;
    const toast = (m, bad) => (opts.toast ? opts.toast(m, bad ? 'err' : '') : null);
    const box = {}; const part = (k, tag = 'div', a = {}) => (box[k] = el(tag, { 'data-cr': k, ...a }));
    const card = (title, ...kids) => el('div', { class: 'card' }, el('h2', {}, title), ...kids);
    const back = el('button', { type: 'button', class: 'crback', 'data-cr': 'back', onclick: () => opts.onClose && opts.onClose() }, '← Back to workflow');
    root.replaceChildren(
      el('div', { class: 'crhead' }, el('h2', { id: 'crtitle' }, 'Contact research · ' + cur, ' ', el('span', { class: 'badge' }, 'internal')), el('span', { class: 'crsp' }), back,
        el('button', { type: 'button', class: 'sec crx', 'aria-label': 'Close contact research', title: 'Close', onclick: () => opts.onClose && opts.onClose() }, '✕')),
      part('banner'),
      el('div', { class: 'crgrid' },
        el('section', {}, card('Case', part('conn', 'p', { class: 'muted' }), part('rules', 'div', { class: 'notice' })), card('#1 Company enrichment', part('enr')), card('Approval', part('appr'))),
        el('section', {}, card('#3 Contacts: Pursue now accounts only', part('acc')),
          card('Filters for this case', el('p', { class: 'muted' }, 'Check these against the case requirement. One value per line. Saving new filters cancels any approval given for the old ones.'), part('ff', 'form'), part('saved', 'p', { class: 'crsaved', role: 'status', 'aria-live': 'polite' })),
          card('Files and history', part('outs'), part('hist', 'div', { class: 'log' })))));
    const AREAS = ['enr', 'appr', 'acc', 'ff', 'outs', 'hist'];
    function renderLocked() {
      put(box.banner, el('div', { class: 'banner' }, el('b', {}, LOCK + '. '), (S.why || '') + ' Contact research opens once #2 Advisory GTM is approved and the shortlist is handed to #3 Introduction Desk.'));
      box.conn.textContent = 'This case is at: ' + (S.step || 'an earlier step') + '.'; put(box.rules); box.saved.textContent = '';
      for (const id of AREAS) put(box[id], id === 'acc' ? el('p', { class: 'muted' }, 'Locked. Nothing can be changed or run for this case yet.') : '');
    }
    function render() {
      put(box.banner);
      box.conn.textContent = S.connected ? 'Contact research is connected on this computer.' : 'Contact research is not connected on this computer, so nothing can run here.';
      put(box.rules, el('b', {}, 'Rules'), el('ul', {}, S.rules.map((r) => el('li', {}, r))));
      const E = S.enrichment;
      put(box.enr, 
        el('p', {}, E.why), el('p', {}, el('b', {}, 'Now: '), E.resolved === 'skip' ? 'Skip' : 'Run on ' + E.run_on.length + ' compan' + (E.run_on.length === 1 ? 'y' : 'ies') + ' missing data.'),
        el('div', { class: 'actions' }, ['auto', 'run', 'skip'].map((m) => el('button', { type: 'button', class: E.mode === m ? '' : 'sec', onclick: (ev) => setMode(m, ev.target) }, m === 'auto' ? 'Auto (skip if enough found)' : m === 'run' ? 'Run' : 'Skip'))),
        E.companies.length ? el('div', { class: 'tblwrap', style: 'margin-top:8px' }, el('table', { class: 'sheet' }, el('thead', {}, el('tr', {}, ['Company', 'Website', 'Missing', 'Status'].map((h) => el('th', {}, h)))), el('tbody', {}, E.companies.map((x) => el('tr', {}, el('td', {}, x.company), el('td', {}, x.domain || 'none'), el('td', {}, x.missing.join(', ') || '-'), el('td', {}, x.already_enriched ? 'Done' : !x.in_location_filter ? 'Outside location filter' : E.run_on.includes(x.company) ? 'Would run' : '-')))))) : el('p', { class: 'muted' }, 'No #1 target list found for this case yet.'),
        (E.blockers || []).filter(Boolean).length && E.resolved !== 'skip' ? el('p', { class: 'err' }, E.blockers.filter(Boolean).join(' ')) : null);
      const C = S.contacts;
      put(box.acc, 
        el('p', {}, 'Up to ', el('b', {}, String(C.per_company)), ' contacts per company.'),
        el('div', { class: 'tblwrap' }, el('table', { class: 'sheet' }, el('thead', {}, el('tr', {}, ['Account', '#2 decision', 'Website', 'Country', 'Filters'].map((h) => el('th', {}, h)))),
          el('tbody', {}, C.accounts.map((a) => el('tr', {}, el('td', {}, a.account), el('td', {}, a.decision), el('td', {}, a.domain || 'missing'), el('td', {}, a.country || ''), el('td', {}, a.in_filters ? 'OK' : a.note))),
            C.not_shortlisted.map((a) => el('tr', { style: 'color:#6b7c8d' }, el('td', {}, a.account), el('td', {}, a.decision), el('td', { colspan: '3' }, a.note)))))),
        C.blockers.length ? el('p', { class: 'err' }, C.blockers.join(' ')) : el('p', { class: 'muted' }, 'Ready for approval.'),
        el('div', { class: 'actions' }, el('button', { type: 'button', class: 'sec', onclick: (ev) => checkPlan(ev.target) }, 'Check the plan (free)')), part('planout'));
      const open = S.approvals.filter((a) => a.status === 'approved');
      put(box.appr, 
        open.length ? el('div', {}, open.map((a) => el('div', { class: 'gate' }, el('b', {}, a.label + ' approved'), el('br'), 'By ' + a.approved_by + ' at ' + fmt(a.approved_at) + '. Accounts: ' + a.accounts.join(', ') + (a.max_per_company ? '. ' + a.max_per_company + ' contact(s) per company' : '') + '. Valid until ' + fmt(a.expires_at) + '.' + (a.matches_filters ? '' : ' (filters changed: not usable)')))) : el('p', {}, 'Waiting for approval. Approval is given in chat; nothing runs before it.'),
        S.approvals.length ? el('details', {}, el('summary', {}, 'Past approvals (' + S.approvals.length + ')'), el('ul', {}, S.approvals.map((a) => el('li', {}, a.id + ' · ' + a.label + ' · ' + a.status + ' · by ' + a.approved_by)))) : null,
        S.runs.length ? el('details', {}, el('summary', {}, 'Runs (' + S.runs.length + ')'), el('ul', {}, S.runs.map((r) => el('li', {}, r.id + ' · ' + r.label + ' · ' + r.status + ' · ' + fmt(r.finished_at || r.started_at) + (r.notes && r.notes.length ? ' · ' + r.notes.join(' ') : ''))))) : null);
      renderForm();
      put(box.outs, S.outputs.length ? el('ul', {}, S.outputs.map((o) => el('li', {}, el('a', { href: o.url, target: '_blank' }, o.name), o.ready ? '' : ' (not on this Mac yet)'))) : el('p', { class: 'muted' }, 'No files yet.'));
      put(box.hist, ...S.history.map((h) => el('div', {}, fmt(h.ts) + ' · ' + h.detail)));
    }
    const fid = (k) => 'crf_' + k, eid = (k) => 'cre_' + k, $f = (k) => root.querySelector('#' + fid(k));
    function renderForm() {
      const f = S.filters, form = box.ff;
      const ta = (k, label, v) => [el('label', { for: fid(k) }, label), el('textarea', { id: fid(k), name: k, rows: Math.min(8, Math.max(2, v.split('\n').length)) }, v), el('div', { class: 'err', id: eid(k) })];
      form.replaceChildren(
        ...LISTS.map(([k, l]) => ta(k, l, (f[k] || []).join('\n'))).flat(),
        ...ta('domains', 'Domains: one per line as  Account | website', Object.entries(f.domains || {}).map(([a, d]) => a + ' | ' + d).join('\n')),
        el('label', { for: fid('max') }, 'Max contacts per company (1-15)'), el('input', { id: fid('max'), type: 'number', min: '1', max: '15', value: String(f.max_prospects_per_company) }), el('div', { class: 'err', id: eid('max_prospects_per_company') }),
        el('label', { for: fid('pages') }, 'People-list pages per company (1-3)'), el('input', { id: fid('pages'), type: 'number', min: '1', max: '3', value: String(f.search_pages) }), el('div', { class: 'err', id: eid('search_pages') }),
        ...ta('requirement_note', 'Case requirement (what we are looking for)', f.requirement_note || ''),
        el('p', { class: 'muted' }, (S.filters_source === 'edited' ? 'Last edited by ' + S.filters_updated_by + ' at ' + fmt(S.filters_updated_at) : 'Default filters, built from the #1 region and target list') + '. Filter id ' + S.filters_hash + '.'),
        el('div', { class: 'actions' }, el('button', { type: 'submit' }, 'Save filters'), el('button', { type: 'button', class: 'sec', onclick: () => { renderForm(); box.saved.textContent = ''; } }, 'Undo changes')));
      form.onsubmit = save;
    }
    const lockedNow = (e) => { if (e && e.locked) { S = { locked: true, why: e.message.replace(/^Unlock in Introduction Desk first\.\s*/, '') }; renderLocked(); return true; } return false; };
    async function save(ev) {
      ev.preventDefault(); const b = ev.submitter || box.ff.querySelector('button[type=submit]'); b.disabled = true; b.textContent = 'Saving...'; box.saved.textContent = '';
      box.ff.querySelectorAll('.err').forEach((x) => { x.textContent = ''; });
      const v = (k) => $f(k).value; const filters = {}; for (const [k] of LISTS) filters[k] = v(k).split('\n');
      filters.domains = v('domains'); filters.max_prospects_per_company = Number($f('max').value); filters.search_pages = Number($f('pages').value); filters.requirement_note = v('requirement_note');
      try { S = await api('/api/research/' + encodeURIComponent(cur) + '/filters', { filters }); render(); box.saved.textContent = '✓ Filters saved at ' + new Date().toLocaleTimeString() + '. You can keep editing or go back to the workflow.'; toast('Filters saved.'); }
      catch (e) { toast(e.message, true); if (lockedNow(e)) return; for (const [k, m] of Object.entries(e.fields || {})) { const x = root.querySelector('#' + eid(k)); if (x) x.textContent = m; } b.disabled = false; b.textContent = 'Save filters'; }
    }
    async function setMode(m, b) { b.disabled = true; b.textContent = 'Saving...'; try { S = await api('/api/research/' + encodeURIComponent(cur) + '/enrichment', { mode: m }); render(); toast('Company enrichment: ' + m + '.'); } catch (e) { toast(e.message, true); if (!lockedNow(e)) render(); } }
    async function checkPlan(b) { b.disabled = true; b.textContent = 'Checking...'; try { const p = await api('/api/research/' + encodeURIComponent(cur) + '/plan', { step: 'contacts' }); put(box.planout, el('div', { class: 'gate' }, 'Plan: ' + (p.run_on.length ? p.run_on.join(', ') : 'no accounts') + '. ' + p.note)); } catch (e) { toast(e.message, true); if (lockedNow(e)) return; } b.disabled = false; b.textContent = 'Check the plan (free)'; }
    async function load() { put(box.acc, el('p', { class: 'muted' }, 'Loading...')); try { S = await api('/api/research/' + encodeURIComponent(cur)); if (S.locked) renderLocked(); else render(); } catch (e) { put(box.banner, el('div', { class: 'banner' }, e.message)); } }
    load(); return { reload: load, focus: () => back.focus() };
  }

  // One drawer on the case screen. Closing it returns to the same scroll spot and the control that opened it.
  let D = null;
  function open(caseId, opts = {}) {
    if (!caseId) return; close(true);
    const ret = { x: window.scrollX, y: window.scrollY, el: document.activeElement };
    const shade = el('div', { class: 'crshade', onclick: () => close() });
    const panel = el('div', { class: 'crdrawer', id: 'crpanel', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'crtitle', 'data-case': caseId });
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.body.append(shade, panel); document.body.classList.add('cropen'); document.addEventListener('keydown', onKey);
    D = { shade, panel, ret, onKey, onClosed: opts.onClosed };
    const m = mount(panel, caseId, { toast: opts.toast, onClose: () => close() }); m.focus();
  }
  function close(silent) {
    if (!D) return; const d = D; D = null;
    d.shade.remove(); d.panel.remove(); document.body.classList.remove('cropen'); document.removeEventListener('keydown', d.onKey);
    if (!silent) { window.scrollTo(d.ret.x, d.ret.y); if (d.ret.el && d.ret.el.isConnected && d.ret.el.focus) d.ret.el.focus({ preventScroll: true }); if (d.onClosed) d.onClosed(); }
  }
  window.CR = { open, close, mount, isOpen: () => !!D, caseId: () => (D ? D.panel.dataset.case : '') };

  // Old /research#CASE links: go to the case screen and open the panel there.
  if (document.body && document.body.dataset.crgo != null) {
    const h = decodeURIComponent(location.hash.slice(1) || '');
    location.replace(/^[A-Za-z0-9-]+$/.test(h) ? '/?cr=' + encodeURIComponent(h) + '#case=' + encodeURIComponent(h) : '/');
  }
})();
