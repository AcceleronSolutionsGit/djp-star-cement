import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { dbGet, dbAll } from '../config/database.js';

async function main() {
  console.log('--- 1. Importing Prospect Dealers ---');
  const res = await importProspectDealers('upload-files/file-1788285654173-601210103.xlsx', 'BAT-202609-231');
  console.log('Result:', res);

  console.log('\n--- 2. Checking master_dealers breakdown ---');
  const summary = await dbAll('SELECT dealer_type, counter_strategy, COUNT(*) as cnt FROM master_dealers GROUP BY dealer_type, counter_strategy');
  console.log('Breakdown:', summary);

  console.log('\n--- 3. Checking Sample Prospects ---');
  const samples = await dbAll('SELECT id, dealer_name, dealer_type, sfa_code, area, counter_potential, expected_sale FROM master_dealers WHERE dealer_type = "PROSPECTIVE" LIMIT 3');
  console.table(samples);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
