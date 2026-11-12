'use strict';
// SHEET_MODE=serviceaccount: Google Sheets API with a service account key file (share the sheet with its email as Editor).
const fs = require('fs');
const { REQUEST_COLS, RESULT_COLS } = require('../agents');
const COLS = { Requests: REQUEST_COLS, Results: RESULT_COLS };
function create(opts) {
  let google;
  try { ({ google } = require('googleapis')); } catch (e) { throw new Error('googleapis is not installed. Run: npm install'); }
  if (!opts.sheetId) throw new Error('SHEET_ID is empty.');
  if (!fs.existsSync(opts.keyFile)) throw new Error('Service account key file not found at ' + opts.keyFile);
  const auth = new google.auth.GoogleAuth({ keyFile: opts.keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  const sheets = google.sheets({ version: 'v4', auth });
  const id = opts.sheetId;
  const rangeAll = (tab) => `${tab}!A2:${String.fromCharCode(64 + COLS[tab].length)}`;
  const toObj = (tab, arr) => Object.fromEntries(COLS[tab].map((c, i) => [c, arr[i] == null ? '' : String(arr[i])]));
  const toArr = (tab, o) => COLS[tab].map((c) => (o[c] == null ? '' : String(o[c])));
  const wrap = async (f) => { try { return await f(); } catch (e) { throw new Error('Cannot reach the sheet (' + (e.message || e) + ')'); } };
  async function read(tab) {
    const r = await wrap(() => sheets.spreadsheets.values.get({ spreadsheetId: id, range: rangeAll(tab) }));
    return (r.data.values || []).map((a) => toObj(tab, a));
  }
  return {
    mode: 'serviceaccount',
    async ping() { await wrap(() => sheets.spreadsheets.get({ spreadsheetId: id, fields: 'spreadsheetId' })); return true; },
    readTab: read,
    async appendRow(tab, obj) {
      await wrap(() => sheets.spreadsheets.values.append({ spreadsheetId: id, range: `${tab}!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [toArr(tab, obj)] } }));
    },
    async updateRow(tab, match, patch) {
      const rows = await read(tab);
      for (let i = rows.length - 1; i >= 0; i--) {
        if (Object.entries(match).every(([k, v]) => String(rows[i][k]) === String(v))) {
          const n = i + 2, merged = { ...rows[i], ...patch };
          await wrap(() => sheets.spreadsheets.values.update({ spreadsheetId: id, range: `${tab}!A${n}:${String.fromCharCode(64 + COLS[tab].length)}${n}`, valueInputOption: 'RAW', requestBody: { values: [toArr(tab, merged)] } }));
          return true;
        }
      }
      return false;
    }
  };
}
module.exports = { create };
