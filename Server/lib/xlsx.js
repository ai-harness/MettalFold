'use strict';
// v35: read the first sheet of an .xlsx in plain Node (no python/openpyxl needed on the Macs). Returns rows of strings.
const zlib = require('zlib');
function unzip(buf) {
  let e = buf.length - 22; while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--; if (e < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16); const files = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nl).toString('utf8'); p += 46 + nl + xl + cl;
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28), data = buf.slice(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
    files[name] = () => (method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
  }
  return files;
}
const ent = (s) => String(s).replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (m, k) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" })[k.toLowerCase()] || (k[1] === 'x' || k[1] === 'X' ? String.fromCodePoint(parseInt(k.slice(2), 16)) : String.fromCodePoint(parseInt(k.slice(1), 10))));
const texts = (x) => { let o = ''; x.replace(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g, (m, t) => { o += t; return m; }); return ent(o); };
const colIdx = (ref) => { const L = (String(ref).match(/^[A-Z]+/) || ['A'])[0]; let n = 0; for (const c of L) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
function sheetRows(xml, shared) {
  const rows = [];
  xml.replace(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g, (m, body) => {
    const row = []; let next = 0;
    String(body || '').replace(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g, (m2, attrs, inner) => {
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1], t = (attrs.match(/\bt="([^"]+)"/) || [])[1] || 'n', i = ref ? colIdx(ref) : next; next = i + 1;
      const v = ((inner || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1]; let val = '';
      if (t === 's') val = shared[Number(v)] || ''; else if (t === 'inlineStr') val = texts(inner || ''); else if (t === 'b') val = v === '1' ? 'TRUE' : v == null ? '' : 'FALSE'; else val = v == null ? '' : ent(v);
      while (row.length < i) row.push(''); row[i] = val; return m2;
    });
    rows.push(row); return m;
  });
  return rows.filter((r) => r.some((x) => x !== ''));
}
// every sheet, in workbook order: [{ name, rows }]
function readWorkbook(buf) {
  const z = unzip(buf), get = (n) => (z[n] ? z[n]() : '');
  const shared = []; get('xl/sharedStrings.xml').replace(/<si>([\s\S]*?)<\/si>/g, (m, si) => { shared.push(texts(si)); return m; });
  const wb = get('xl/workbook.xml'), rels = get('xl/_rels/workbook.xml.rels'), target = {};
  rels.replace(/<Relationship\b[^>]*>/g, (tag) => { const id = (tag.match(/\bId="([^"]+)"/) || [])[1], t = (tag.match(/\bTarget="([^"]+)"/) || [])[1]; if (id && t) { const x = t.replace(/^\//, ''); target[id] = x.startsWith('xl/') ? x : 'xl/' + x; } return tag; });
  const out = [];
  wb.replace(/<sheet\b[^>]*>/g, (tag) => { const name = ent((tag.match(/\bname="([^"]*)"/) || [])[1] || 'Sheet'), rid = (tag.match(/\br:id="([^"]+)"/) || [])[1]; const f = target[rid]; if (f && z[f]) out.push({ name, rows: sheetRows(get(f), shared) }); return tag; });
  if (!out.length) { for (const k of Object.keys(z).filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()) out.push({ name: k.split('/').pop().replace(/\.xml$/, ''), rows: sheetRows(get(k), shared) }); }
  if (!out.length) throw new Error('no sheet');
  return out;
}
// the sheet to show first: the first real table (3+ columns) that is not a cover/summary/notes sheet, else the first sheet
function mainSheet(sheets) {
  const cols = (s) => Math.max(0, ...s.rows.map((r) => r.filter((c) => String(c).trim()).length));
  const i = sheets.findIndex((s) => !/^(summary|cover|readme|read_me|methodology|sources|notes)$/i.test(s.name.trim()) && cols(s) >= 3 && s.rows.length >= 2);
  return i < 0 ? 0 : i;
}
function readXlsx(buf) { return readWorkbook(buf)[0].rows; }
module.exports = { readXlsx, readWorkbook, mainSheet };
