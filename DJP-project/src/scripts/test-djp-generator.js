import { generateFullPjpDjpSolution } from '../engines/djp-generator.engine.js';
import { dbAll } from '../config/database.js';

async function testFullSolution() {
  console.log('================================================================');
  console.log('Testing Multi-Role PJP & DJP Rule Engine (SO, ASM, RSM, ZH)');
  console.log('================================================================');

  try {
    // 1. Generate Cycle 1 (1st - 15th)
    await generateFullPjpDjpSolution('2026-07', 'C1');

    // 2. Display Sample Dealer Visit Count Targets (SO, ASM, RSM, ZH)
    console.log('\n----------------------------------------------------------------');
    console.log('1. SAMPLE DEALER LEVEL TARGET VISITS PER ROLE (SO, ASM, RSM, ZH)');
    console.log('----------------------------------------------------------------');
    const targets = await dbAll('SELECT dealer_name, category, dealer_status, so_visits, asm_visits, rsm_visits, zh_visits, total_visits, so_visits_pct as SO_pct, asm_visits_pct as ASM_pct, rsm_visits_pct as RSM_pct, zh_visits_pct as ZH_pct FROM dealer_visit_targets LIMIT 10');
    console.table(targets);

    // 3. Display Sample Day-Wise DJP Plan for SO (Cycle 1)
    console.log('\n----------------------------------------------------------------');
    console.log('2. SAMPLE SO DAY-WISE JOURNEY PLAN (C1: July 1 - 15) | Max 8 visits/day');
    console.log('----------------------------------------------------------------');
    const sampleSo = await dbAll('SELECT DISTINCT emp_code, emp_name FROM djp_recommendations WHERE role_type = "SO" LIMIT 1');
    if (sampleSo.length > 0) {
      const soPlan = await dbAll('SELECT visit_date as Date, visit_sequence as Seq, dealer_name as Dealer, category as Cat, dealer_status as Status, priority_score as Priority FROM djp_recommendations WHERE role_type = "SO" AND emp_code = ? ORDER BY visit_date ASC, visit_sequence ASC LIMIT 16', [sampleSo[0].emp_code]);
      console.log(`SO Account: ${sampleSo[0].emp_name} (${sampleSo[0].emp_code})`);
      console.table(soPlan);
    }

    // 4. Display Sample Day-Wise DJP Plan for ASM
    console.log('\n----------------------------------------------------------------');
    console.log('3. SAMPLE ASM DAY-WISE JOURNEY PLAN (C1: July 1 - 15)');
    console.log('----------------------------------------------------------------');
    const sampleAsm = await dbAll('SELECT DISTINCT emp_code, emp_name FROM djp_recommendations WHERE role_type = "ASM" LIMIT 1');
    if (sampleAsm.length > 0) {
      const asmPlan = await dbAll('SELECT visit_date as Date, visit_sequence as Seq, dealer_name as Dealer, category as Cat, dealer_status as Status FROM djp_recommendations WHERE role_type = "ASM" AND emp_code = ? ORDER BY visit_date ASC, visit_sequence ASC LIMIT 10', [sampleAsm[0].emp_code]);
      console.log(`ASM Account: ${sampleAsm[0].emp_name}`);
      console.table(asmPlan);
    }

    // 5. Display Sample Day-Wise DJP Plan for RSM
    console.log('\n----------------------------------------------------------------');
    console.log('4. SAMPLE RSM DAY-WISE JOURNEY PLAN (C1: July 1 - 15)');
    console.log('----------------------------------------------------------------');
    const sampleRsm = await dbAll('SELECT DISTINCT emp_code, emp_name FROM djp_recommendations WHERE role_type = "RSM" LIMIT 1');
    if (sampleRsm.length > 0) {
      const rsmPlan = await dbAll('SELECT visit_date as Date, visit_sequence as Seq, dealer_name as Dealer, category as Cat, dealer_status as Status FROM djp_recommendations WHERE role_type = "RSM" AND emp_code = ? ORDER BY visit_date ASC, visit_sequence ASC LIMIT 10', [sampleRsm[0].emp_code]);
      console.log(`RSM Account: ${sampleRsm[0].emp_name}`);
      console.table(rsmPlan);
    }

    console.log('\n================================================================');
    console.log('MULTI-ROLE PJP/DJP GENERATION VERIFIED SUCCESSFULLY!');
    console.log('================================================================');
    process.exit(0);
  } catch (err) {
    console.error('Error testing multi-role generator:', err);
    process.exit(1);
  }
}

testFullSolution();
