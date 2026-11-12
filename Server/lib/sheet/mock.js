'use strict';
// SHEET_MODE=mock: a local JSON file stands in for the Google Sheet. Two app copies can share one file.
const fs = require('fs'), path = require('path');
function create(opts = {}) {
  const file = opts.file || path.join(__dirname, '..', '..', 'data', 'mock-sheet.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let failing = false;
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { Requests: [], Results: [] }; } };
  const save = (d) => { const t = file + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(d, null, 1)); fs.renameSync(t, file); };
  const guard = () => { if (failing) throw new Error('Sheet unreachable (simulated)'); };
  return {
    mode: 'mock', file,
    __setFail: (v) => { failing = !!v; },
    async ping() { guard(); return true; },
    async readTab(tab) { guard(); return load()[tab] || []; },
    async appendRow(tab, obj) { guard(); const d = load(); (d[tab] = d[tab] || []).push({ ...obj }); save(d); },
    async updateRow(tab, match, patch) {
      guard(); const d = load(); const rows = d[tab] || [];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (Object.entries(match).every(([k, v]) => String(rows[i][k]) === String(v))) { rows[i] = { ...rows[i], ...patch }; save(d); return true; }
      }
      return false;
    }
  };
}
module.exports = { create };
