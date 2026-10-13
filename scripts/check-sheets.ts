/**
 * Checks the Google Sheets connection without writing anything: the service
 * account can read the sheet, every tab has the columns the app uses, and
 * what's in Prospects / Do Not Call.
 *
 * Usage: npm run sheets:check
 */

import { getSheets } from '../src/services/sheets.service';

async function main() {
  const sheets = getSheets();
  if (!sheets) {
    console.error('Google Sheets sync is off: set GOOGLE_SHEETS_ID and GOOGLE_SERVICE_ACCOUNT_JSON (see README).');
    process.exitCode = 1;
    return;
  }

  let ok = true;
  for (const { tab, missing } of await sheets.checkLayout()) {
    if (missing.length) {
      ok = false;
      console.log(`✗ ${tab}: missing column(s) ${missing.map((m) => `"${m}"`).join(', ')}`);
    } else {
      console.log(`✓ ${tab}`);
    }
  }

  const [prospects, doNotCall] = await Promise.all([sheets.getProspects(), sheets.getDoNotCall()]);
  console.log(`\n${prospects.length} prospect(s), ${doNotCall.length} on Do Not Call.`);
  for (const p of prospects.slice(0, 10)) {
    console.log(`  ${p.pubName}${p.area ? ` (${p.area})` : ''} — ${p.status || 'no status'}`);
  }
  if (prospects.length > 10) console.log(`  …and ${prospects.length - 10} more`);

  if (!ok) process.exitCode = 1;
  else console.log('\nSheets sync is ready.');
}

main().catch((err) => {
  const message = (err as { message?: string }).message ?? String(err);
  console.error(`Couldn't read the sheet: ${message}`);
  if (/permission|403/i.test(message)) {
    console.error('Share the spreadsheet with the service account\'s client_email as an Editor.');
  }
  process.exitCode = 1;
});
