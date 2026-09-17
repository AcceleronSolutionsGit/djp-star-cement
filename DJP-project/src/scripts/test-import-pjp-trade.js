import { importPjpTradeFile } from '../imports/pjp-trade.importer.js';
import { dbAll } from '../config/database.js';

async function main() {
  console.log('Testing importPjpTradeFile on full-generated-visit-file.xlsx...');
  const count = await importPjpTradeFile('upload-files/full-generated-visit-file.xlsx', '2026-07', 'C1');

  console.log(`Imported ${count} targets.`);

  const targets = await dbAll('SELECT COUNT(*) as cnt FROM dealer_visit_targets WHERE period_month = "2026-07" AND cycle_code = "C1"');
  console.log('DB Target Count:', targets[0].cnt);

  const sample = await dbAll('SELECT * FROM dealer_visit_targets LIMIT 5');
  console.log('Sample DB rows:');
  console.dir(sample, { depth: null });
}

main().catch(console.error);
