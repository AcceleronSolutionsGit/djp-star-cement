import { importDealerPerformance } from '../src/imports/dealer-performance.importer.js';
import { dbAll, dbGet } from '../src/config/database.js';

async function main() {
  console.log('Running importDealerPerformance on Dealer performance june uploadable.xlsx...');
  const res = await importDealerPerformance('upload-files/file-1788945753182-322572491.xlsx', 'TEST_PERF_DOA_FIX');
  console.log('Import result:', res);

  const zeros = await dbGet('SELECT COUNT(*) as zeros FROM master_dealers WHERE doa = ?', ['0000-00-00']);
  console.log('Dealers with 0000-00-00:', zeros);

  const nonNull = await dbGet('SELECT COUNT(*) as cnt FROM master_dealers WHERE doa IS NOT NULL AND doa != "0000-00-00"');
  console.log('Dealers with valid non-zero DOA:', nonNull);

  const samples = await dbAll('SELECT sap_code, dealer_name, doa FROM master_dealers WHERE doa IS NOT NULL AND doa != "0000-00-00" ORDER BY sap_code ASC LIMIT 10');
  console.log('Sample updated dealers:', samples);
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
