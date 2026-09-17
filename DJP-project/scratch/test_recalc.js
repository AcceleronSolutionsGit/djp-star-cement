import { calculatePJP } from '../src/engines/pjp/pjp.engine.js';
import { dbAll } from '../src/config/database.js';

async function testCalc() {
  console.log('Running calculatePJP for 2026-09 C1...');
  const res = await calculatePJP('2026-09', 'C1', { persist: true });
  console.log('Done calculatePJP. Stats:', res.stats);

  const targets = await dbAll('SELECT sap_code, sfa_code, dealer_name, category, dealer_status, so_visits, asm_visits, rsm_visits, zh_visits, total_visits FROM dealer_visit_targets ORDER BY id ASC');
  console.log('\n=== NEW TARGETS IN DB ===');
  console.table(targets);
}

testCalc().catch(console.error);
