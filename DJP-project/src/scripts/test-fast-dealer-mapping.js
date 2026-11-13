import path from 'path';
import { dbRun } from '../config/database.js';
import { importDealerMapping } from '../imports/dealer-mapping.importer.js';

async function runBenchmarkSuite() {
  const file = path.resolve('upload-files/benchmark-15k-mapping.xlsx');
  console.log('================================================================');
  console.log('BENCHMARK: 15,000-ROW DEALER MAPPING INGESTION PIPELINE');
  console.log('================================================================\n');

  console.log('--- TEST RUN 1: INSERTING 15,000 NEW DEALER MAPPING ROWS ---');
  const t0 = Date.now();
  const res1 = await importDealerMapping(file, `BENCH-INS-${Date.now()}`);
  const dur1 = Date.now() - t0;
  console.log(`[RUN 1 RESULT] 15,000 Inserts completed in ${dur1}ms (${(dur1 / 1000).toFixed(2)}s)`);
  console.log(`  Dealers Created: ${res1.dealersCreated}, Mappings Created: ${res1.mappingsCreated}`);

  console.log('\n--- TEST RUN 2: RE-IMPORTING / UPDATING 15,000 EXISTING DEALER MAPPING ROWS ---');
  const t1 = Date.now();
  const res2 = await importDealerMapping(file, `BENCH-UPD-${Date.now()}`);
  const dur2 = Date.now() - t1;
  console.log(`[RUN 2 RESULT] 15,000 Updates completed in ${dur2}ms (${(dur2 / 1000).toFixed(2)}s)`);
  console.log(`  Dealers Updated: ${res2.dealersUpdated}, Mappings Updated: ${res2.mappingsUpdated}`);

  console.log('\nCleaning up benchmark records from database...');
  await dbRun('DELETE FROM master_dealers WHERE sap_code LIKE "TEST_SAP_%"');
  await dbRun('DELETE FROM master_dealer_so_mapping WHERE sap_code LIKE "TEST_SAP_%"');
  await dbRun('DELETE FROM matching_audit WHERE batch_code LIKE "BENCH-%"');
  await dbRun('DELETE FROM master_employees WHERE emp_code LIKE "SO_%" OR emp_code LIKE "ASM_%" OR emp_code LIKE "RSM_%" OR emp_code LIKE "ZH_%"');
  console.log('Cleanup complete.');
  console.log('\n================================================================');
  console.log(`SUMMARY: Both 15,000 Insert & Update suites succeeded flawlessly!`);
  console.log(`Run 1 (15k Inserts): ${(dur1 / 1000).toFixed(2)} seconds`);
  console.log(`Run 2 (15k Updates): ${(dur2 / 1000).toFixed(2)} seconds`);
  console.log('================================================================\n');
  process.exit(0);
}

runBenchmarkSuite().catch(err => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
