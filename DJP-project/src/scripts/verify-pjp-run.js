import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { dbAll, dbGet } from '../config/database.js';

async function main() {
  console.log('==============================================');
  console.log('RUNNING FULL PJP CALCULATION & VERIFICATION');
  console.log('==============================================\n');

  const result = await calculatePJP('2026-06', 'C1', { persist: true, debug: false });

  console.log('Calculation complete. Summary stats:');
  console.log({
    totalDealers: result.totalDealers,
    categoryCounts: result.categoryCounts,
    gradeCounts: result.gradeCounts,
    totalVisits: result.totalVisits
  });

  console.log('\n[1] Checking persisted dealer_visit_targets...');
  const count = await dbGet('SELECT COUNT(*) as cnt FROM dealer_visit_targets WHERE period_month = "2026-06" AND cycle_code = "C1"');
  console.log('Persisted targets count:', count.cnt);

  console.log('\n[2] Sample 5 targets:');
  const samples = await dbAll(`
    SELECT dvt.dealer_name, dvt.sap_code, dvt.dealer_status as category, dvt.category as grade,
           dvt.priority, dvt.so_name, dvt.asm_name, dvt.so_visits, dvt.asm_visits, dvt.rsm_visits, dvt.zh_visits
    FROM dealer_visit_targets dvt
    WHERE dvt.period_month = "2026-06" AND dvt.cycle_code = "C1"
    ORDER BY dvt.so_visits DESC
    LIMIT 5
  `);
  console.table(samples);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
