import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { dbAll, dbGet } from '../config/database.js';

async function main() {
  console.log('=== [1] Ingesting Dealer Mapping (M.xlsx) ===');
  await importDealerMapping('upload-files/file-1788283401406-85577886.xlsx', 'BAT-202609-759');

  console.log('\n=== [2] Ingesting Prospect Dealers ===');
  await importProspectDealers('upload-files/file-1788285654173-601210103.xlsx', 'BAT-202609-231');

  console.log('\n=== [3] Ingesting Sales History (RSAR SALE) ===');
  await importSalesHistory('upload-files/file-1788285709647-776738376.xlsx', 'BAT-202609-137');

  console.log('\n=== [4] Calculating PJP for 2026-06 / C1 ===');
  const result = await calculatePJP('2026-06', 'C1', { persist: true });

  console.log('\n=== [5] Category Breakdown of Visit Targets in DB ===');
  const catBreakdown = await dbAll(`
    SELECT 
      dealer_status as category,
      COUNT(*) as dealer_count,
      SUM(so_visits) as so_visits,
      SUM(asm_visits) as asm_visits,
      SUM(rsm_visits) as rsm_visits,
      SUM(zh_visits) as zh_visits,
      SUM(total_visits) as total_visits
    FROM dealer_visit_targets
    WHERE period_month = '2026-06' AND cycle_code = 'C1'
    GROUP BY dealer_status
    ORDER BY total_visits DESC
  `);
  console.table(catBreakdown);

  console.log('\n=== [6] Total DJP Visit Targets by Role ===');
  const roleTotals = await dbGet(`
    SELECT 
      COUNT(*) as total_dealers,
      SUM(so_visits) as total_so_visits,
      SUM(asm_visits) as total_asm_visits,
      SUM(rsm_visits) as total_rsm_visits,
      SUM(zh_visits) as total_zh_visits,
      SUM(total_visits) as total_visits
    FROM dealer_visit_targets
    WHERE period_month = '2026-06' AND cycle_code = 'C1'
  `);
  console.table([roleTotals]);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
