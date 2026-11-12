const sel = document.getElementById('u');
fetch('/api/users').then((r) => r.json()).then((j) => j.users.forEach((n) => { const o = document.createElement('option'); o.textContent = n; sel.appendChild(o); }));
document.getElementById('f').addEventListener('submit', async (ev) => {
  ev.preventDefault(); const e = document.getElementById('e'); e.textContent = '';
  const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'mf' }, body: JSON.stringify({ user: sel.value, password: document.getElementById('p').value }) });
  const j = await r.json().catch(() => ({})); if (r.ok) location.href = '/'; else e.textContent = j.error || 'Could not sign in.';
});
