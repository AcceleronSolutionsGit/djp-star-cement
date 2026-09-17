import { importDealerMapping } from '../src/imports/dealer-mapping.importer.js';
import { importProspectDealers } from '../src/imports/prospect-dealer.importer.js';
import { importSalesHistory } from '../src/imports/sales-history.importer.js';
import { importSBG } from '../src/imports/sbg.importer.js';
import { importDealerPerformance } from '../src/imports/dealer-performance.importer.js';
import { calculatePJP } from '../src/engines/pjp/pjp.engine.js';
import { dbAll, dbRun } from '../src/config/database.js';

async function reimportAll() {
  const batchCode = 'BAT-202609-991';
  console.log('Reimporting 5 files for batch:', batchCode);

  // 1. Dealer Mapping
  await importDealerMapping('upload-files/file-1788516978051-43298044.xlsx', batchCode);
  console.log('1. Dealer Mapping imported');

  // 2. Prospects
  await importProspectDealers('upload-files/file-1788516993268-268221556.xlsx', batchCode);
  console.log('2. Prospects imported');

  // 3. RSAR Sales
  await importSalesHistory('upload-files/file-1788516988388-780604793.xlsx', batchCode);
  console.log('3. RSAR Sales imported');

  // 4. SBG
  await importSBG('upload-files/file-1788516999475-534451568.xlsx', batchCode);
  console.log('4. SBG imported');

  // 5. Dealer Performance
  await importDealerPerformance('upload-files/05_Dealer_Performance_user_test.xlsx', batchCode);
  console.log('5. Dealer Performance imported');

  // Register in upload_batches table
  const files = [
    { type: 'DEALER_MAPPING', name: '01_Dealer_Mapping.xlsx', path: 'upload-files/file-1788516978051-43298044.xlsx' },
    { type: 'PROSPECTS', name: '02_Prospects.xlsx', path: 'upload-files/file-1788516993268-268221556.xlsx' },
    { type: 'SALES_HISTORY', name: '03_RSAR_Sales.xlsx', path: 'upload-files/file-1788516988388-780604793.xlsx' },
    { type: 'SBG', name: '04_SBG.xlsx', path: 'upload-files/file-1788516999475-534451568.xlsx' },
    { type: 'DEALER_PERFORMANCE', name: '05_Dealer_Performance.xlsx', path: 'upload-files/05_Dealer_Performance_user_test.xlsx' }
  ];

  for (const f of files) {
    const subBatch = `${batchCode}-${f.type}`;
    await dbRun(
      `INSERT INTO upload_batches (batch_code, file_type, file_name, file_path, status, period_month)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE file_path = VALUES(file_path), status = VALUES(status)`,
      [subBatch, f.type, f.name, f.path, 'COMPLETED', '2026-06']
    );
  }

  console.log('\n--- RUNNING PJP CALCULATION (2026-06) ---');
  const res = await calculatePJP('2026-06', 'C1', { persist: true, debug: true });
  console.log('PJP Calculation complete, targets:', res.results.length);

  const targets = await dbAll(`
    SELECT sap_code, sfa_code, dealer_name, cust_type, area, block,
      so_name, priority, dealer_status, category,
      score_a, score_b, score_c, total_score,
      current_sales, previous_sales, lysm_sales, rsar_six_month_avg, dp_six_month_avg,
      so_visits, asm_visits, rsm_visits, zh_visits, total_visits
    FROM dealer_visit_targets
    WHERE period_month = '2026-06' AND cycle_code = 'C1'
    ORDER BY sap_code ASC, sfa_code ASC
  `);
  console.table(targets);

  process.exit(0);
}

reimportAll().catch(e => { console.error(e); process.exit(1); });
