import { importDealerPerformance } from '../src/imports/dealer-performance.importer.js';
import { dbAll } from '../src/config/database.js';

async function main() {
  const res = await importDealerPerformance('upload-files/05_Dealer_Performance_user_test.xlsx', 'TEST_PERF_2');
  console.log('Import result:', res);
  const rows = await dbAll('SELECT sap_code, period_year_month, quantity_mt, target_mt, prorata_target_mt FROM dealer_performance_history WHERE period_year_month = "2026-06" LIMIT 5');
  console.log('2026-06 rows:', rows);
}

main().catch(console.error);
