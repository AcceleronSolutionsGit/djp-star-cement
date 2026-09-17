import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { dbAll, dbGet } from '../config/database.js';

async function main() {
  console.log('=== Ingesting Dealer Mapping (9 sample dealers) ===');
  await importDealerMapping('upload-files/file-1788297658798-537043424.xlsx', 'BAT-SAMPLE-MAP');
  
  console.log('=== Ingesting Prospects (2 sample prospects) ===');
  await importProspectDealers('upload-files/file-1788297698481-757768975.xlsx', 'BAT-SAMPLE-PROSP');
  
  console.log('=== Ingesting Sales History (243 rows) ===');
  await importSalesHistory('upload-files/file-1788297672131-843790029.xlsx', 'BAT-SAMPLE-SALES');

  console.log('=== Running PJP for 2026-06 / C1 ===');
  const pjp = await calculatePJP('2026-06', 'C1', { persist: true });

  console.log('\n=== Persisted Results in DB ===');
  const rows = await dbAll(`
    SELECT dealer_name, COALESCE(sap_code, sfa_code) as cust_code, 
           category as priority_grade, dealer_status as final_category,
           so_visits, asm_visits, rsm_visits, zh_visits
    FROM dealer_visit_targets
    ORDER BY dealer_name ASC
  `);

  console.table(rows);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
