/** Stub for engines/djp-generator.engine.js
 *  The real solver writes dealer_visit_targets for the cycle; the stub does the same
 *  minimally, so the plan stage downstream has something to fan out over. Without
 *  this the C2 purge would leave the stubbed pipeline with no targets at all.
 */
import { calls } from './__stub_state.js';
import { dbRun, dbGet } from '../config/database.js';

export async function generateFullPjpDjpSolution(periodMonth, cycleCode) {
  calls.order.push(`djp:${cycleCode}`);

  const existing = await dbGet(
    'SELECT COUNT(*) AS n FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ?',
    [periodMonth, cycleCode]
  );
  if (!existing || Number(existing.n) === 0) {
    await dbRun(
      `INSERT INTO dealer_visit_targets
        (period_month, cycle_code, sap_code, dealer_name, so_emp_code, so_name, asm_code, asm_name,
         rsm_code, rsm_name, zh_code, zh_name, so_visits, asm_visits, rsm_visits, zh_visits)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [periodMonth, cycleCode, '1000001153', 'R P ENTERPRISE',
       '11001774', 'DEBABRATA CHAKRABORTY- FKT', '11001393', 'DEBABRATA GHOSH',
       '11001813', 'RITWICK CHATTERJEE', '11002257', 'GIRIDHARI MUKHERJEE', 2, 2, 1, 1]
    );
  }

  return { totalDealerTargets: 1, totalVisitsRequired: 6, totalDjpSlots: 6,
           unallocatedCount: 0, capacityViolated: false, validationErrors: [] };
}
