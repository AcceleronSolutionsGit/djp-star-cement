import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { dbAll, dbGet } from '../config/database.js';

async function main() {
  console.log('=== Step 1: Ingesting Full 12,287 Dealer Mapping (M.xlsx) ===');
  await importDealerMapping('upload-files/file-1788286244476-380209937.xlsx', 'BAT-FULL-MAPPING');

  console.log('=== Step 2: Ingesting Prospect Dealers (73 prospects) ===');
  await importProspectDealers('upload-files/file-1788285654173-601210103.xlsx', 'BAT-FULL-PROSPECT');

  console.log('=== Step 3: Ingesting Full Sales History (206,361 rows) ===');
  await importSalesHistory('upload-files/file-1788285709647-776738376.xlsx', 'BAT-FULL-SALES');

  console.log('=== Step 4: Running PJP Calculation for 2026-06 / C1 ===');
  const pjp = await calculatePJP('2026-06', 'C1', { persist: true });

  console.log('\n=== Step 5: Checking Control Dealers in MySQL ===');
  const controlCodes = [
    '1000000669', '1000001034', '1000002747', '1000003202', '1000003596',
    '1000000671', '1000003532', '1000003497', 'WBS197', 'NSRE19295'
  ];

  const results = [];
  for (const code of controlCodes) {
    const row = await dbGet(
      `SELECT dealer_name, sap_code, sfa_code, category as priority_grade, dealer_status as final_category,
              so_visits, asm_visits, rsm_visits, zh_visits
       FROM dealer_visit_targets 
       WHERE (sap_code = ? OR sfa_code = ? OR linked_dealer_code = ?) AND period_month = '2026-06' AND cycle_code = 'C1'`,
      [code, code, code]
    );

    if (row) {
      results.push({
        'Cust Code': code,
        'Dealer Name': row.dealer_name,
        'Priority (Grade)': row.priority_grade,
        'Category (Status)': row.final_category,
        'SO Visits': row.so_visits,
        'ASM Visits': row.asm_visits,
        'RSM Visits': row.rsm_visits,
        'ZH Visits': row.zh_visits
      });
    } else {
      results.push({ 'Cust Code': code, 'Status': 'NOT FOUND' });
    }
  }

  console.table(results);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
