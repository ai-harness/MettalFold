'use strict';
const crypto = require('crypto');
const clean = (s, max = 2000) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex');
const truthy = (v) => ['yes', 'true', 'y', '1'].includes(String(v == null ? '' : v).trim().toLowerCase());
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest(), y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
// Remove any secret value from text before it is logged or shown.
let secrets = [];
const setSecrets = (list) => { secrets = list.filter((v) => v && String(v).length >= 6).map(String); };
function scrub(text) {
  let t = String(text == null ? '' : text);
  for (const s of secrets) t = t.split(s).join('[hidden]');
  return t.replace(/crsr_[A-Za-z0-9]{8,}/g, '[hidden]').replace(/Bearer\s+[A-Za-z0-9._-]{10,}/g, 'Bearer [hidden]');
}
// Client view must never show scores, ranks, weights, percentages.
const INTERNAL = /(\bscore|\brank|\bweight|\d\s*%|\bpercent|\bpoints?\b|\btop\s*\d)/i;
function parseSteps(raw) {
  if (Array.isArray(raw)) return cleanSteps(raw);
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return [];
  try { return cleanSteps(JSON.parse(s)); } catch (e) { return []; }
}
function cleanSteps(arr) {
  if (!Array.isArray(arr)) return [];
  const ok = ['done', 'running', 'needs approval', 'error'];
  return arr.filter((x) => x && typeof x === 'object').slice(0, 20).map((x) => {
    const outcome = clean(x.outcome, 300);
    return { step: clean(x.step, 120), outcome: INTERNAL.test(outcome) ? '' : outcome, status: ok.includes(String(x.status)) ? String(x.status) : 'done' };
  }).filter((x) => x.step);
}
function parseBehind(raw) {
  const t = (x, n) => String(x == null ? '' : x).slice(0, n);
  let v = raw; const s = String(raw == null ? '' : raw).trim();
  if (Array.isArray(raw)) v = raw; else { if (!s) return { items: [], text: '' }; try { v = JSON.parse(s); } catch (e) { return { items: [], text: t(s, 2000) }; } }
  if (v && !Array.isArray(v) && typeof v === 'object') v = Array.isArray(v.steps) ? v.steps : [v];
  if (!Array.isArray(v)) return { items: [], text: typeof v === 'string' ? t(v, 2000) : '' };
  const items = v.filter((x) => x && typeof x === 'object' && (x.name || x.step)).slice(0, 12).map((x) => {
    const st = String(x.status || '').toLowerCase(); const top = Array.isArray(x.top_items) ? x.top_items : (x.top_items ? [x.top_items] : []);
    return { name: t(x.name || x.step, 120), status: /^(wait|run|done)/.test(st) ? (st.startsWith('wait') ? 'waiting' : st.startsWith('run') ? 'running' : 'done') : (st === 'error' ? 'done' : 'waiting'), summary: t(x.summary || x.outcome, 800), top_items: top.slice(0, 8).map((i) => t(typeof i === 'object' ? (i.name || JSON.stringify(i)) : i, 200)), output_link: t(x.output_link, 500) };
  });
  return { items, text: '' };
}
module.exports = { parseBehind, clean, sha, truthy, safeEqual, setSecrets, scrub, parseSteps, INTERNAL };
