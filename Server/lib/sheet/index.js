'use strict';
function createSheet(env = process.env) {
  const mode = (env.SHEET_MODE || 'mock').toLowerCase();
  if (mode === 'mock') return require('./mock').create({ file: env.MOCK_SHEET_FILE });
  if (mode === 'appsscript') return require('./appsscript').create({ url: env.APPS_SCRIPT_URL, secret: env.APPS_SCRIPT_SECRET });
  if (mode === 'serviceaccount') return require('./serviceaccount').create({ sheetId: env.SHEET_ID, keyFile: env.GOOGLE_SERVICE_ACCOUNT_JSON || './secrets/service-account.json' });
  throw new Error("SHEET_MODE must be 'mock', 'appsscript' or 'serviceaccount'.");
}
module.exports = { createSheet };
