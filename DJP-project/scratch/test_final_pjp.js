import { calculatePJP } from '../src/engines/pjp/pjp.engine.js';
import { dbAll } from '../src/config/database.js';

async function test() {
  console.log('--- RUNNING PJP CALCULATION FOR 2026-09 C1 ---');
  const res = await calculatePJP('2026-09', 'C1', { persist: true, debug: true });
  console.log('Calculation completed. Dealers count:', res.results.length);

  const targets = await dbAll(`
    SELECT 
      sap_code, sfa_code, dealer_name, cust_type, area, block,
      so_name, priority, dealer_status, category,
      score_a, score_b, score_c, total_score,
      current_sales, previous_sales, rsar_six_month_avg,
      so_visits, asm_visits, rsm_visits, zh_visits, total_visits
    FROM dealer_visit_targets 
    WHERE period_month = '2026-09' AND cycle_code = 'C1'
    ORDER BY sap_code ASC, sfa_code ASC
  `);

  console.log('\n--- TARGETS IN DB ---');
  console.table(targets);

  process.exit(0);
}

test().catch(err => {
  console.error('Error running test:', err);
  process.exit(1);
});
