'use strict';
// Standalone fake desk: watches the sheet for queued requests and answers them. Use with SHEET_MODE=mock (shared file) for UI testing.
require('dotenv').config();
const { createSheet } = require('./lib/sheet');
const { handle } = require('./lib/mockAgent');
const sheet = createSheet(process.env); const seen = new Set();
console.log('Mock agent running. Press Ctrl+C to stop. It only writes to the', sheet.mode, 'sheet.');
setInterval(async () => {
  try {
    const [reqs, res] = await Promise.all([sheet.readTab('Requests'), sheet.readTab('Results')]);
    const answered = new Set(res.map((r) => r.request_id));
    for (const r of reqs) {
      if (r.status !== 'queued' || answered.has(r.request_id) || seen.has(r.request_id)) continue;
      seen.add(r.request_id);
      let inputs = {}; try { inputs = JSON.parse(r.inputs_json); } catch (_) {}
      console.log('Answering', r.request_id, r.agent_code);
      handle(sheet, { request_id: r.request_id, agent_code: r.agent_code, inputs }, 1500).catch((e) => console.log('mock error', e.message));
    }
  } catch (e) { console.log('mock agent: sheet problem:', e.message); }
}, 2000);
