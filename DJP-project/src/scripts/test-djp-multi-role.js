import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { dbAll, dbRun } from '../config/database.js';

async function main() {
  console.log('================================================================');
  console.log('MULTI-ROLE DJP PLAN GENERATION TEST & RECONCILIATION');
  console.log('================================================================');

  const periodMonth = '2026-06';
  const cycleCode = 'C1';

  // 1. Calculate Canonical PJP
  const pjp = await calculatePJP(periodMonth, cycleCode, { persist: true });
  console.log(`PJP calculated for ${periodMonth} ${cycleCode} (${pjp.results.length} dealers).`);

  const generator = new AutoPlanGenerator();

  // Test employees for all 4 roles
  const testEmployees = [
    { code: 'BALARAM DAS', role: 'SO', name: 'BALARAM DAS' },
    { code: 'PRABHAS SARKAR', role: 'SO', name: 'PRABHAS SARKAR' },
    { code: 'ANIMESH NATH', role: 'ASM', name: 'ANIMESH NATH' },
    { code: 'VIKASH KUMAR', role: 'RSM', name: 'VIKASH KUMAR' },
    { code: 'TARAK NATH GHOSH', role: 'ZH', name: 'TARAK NATH GHOSH' }
  ];

  console.log('\n--- Generating Plans for All 4 Roles ---');
  const planSummaries = [];

  for (const emp of testEmployees) {
    const plan = await generator.generatePlan(emp.code, periodMonth, emp.role, cycleCode);
    
    // Fetch generated plan visits
    const visits = plan.planId ? await dbAll('SELECT * FROM sales_plan_details WHERE plan_id = ? ORDER BY visit_date ASC', [plan.planId]) : [];

    // Verify non-working days
    const invalidDays = visits.filter(v => {
      const d = new Date(v.visit_date);
      const day = d.getDay();
      const nthSat = Math.ceil(d.getDate() / 7);
      return day === 0 || (day === 6 && (nthSat === 2 || nthSat === 4));
    });

    planSummaries.push({
      Role: emp.role,
      'Employee': emp.name,
      'Dealers Targeted': plan.totalDealers,
      'Visits Scheduled': plan.totalVisitsScheduled,
      'Working Days Used': new Set(visits.map(v => v.visit_date)).size,
      'Invalid Day Visits': invalidDays.length,
      'Status': plan.success && invalidDays.length === 0 ? '✅ PASSED' : '❌ FAILED'
    });
  }

  console.table(planSummaries);

  // 2. Reconciliation against Control Dealers
  console.log('\n================================================================');
  console.log('CONTROL DEALERS PJP -> DJP FREQUENCY RECONCILIATION');
  console.log('================================================================');

  const CONTROL_DEALERS = [
    { code: '1000000669', name: 'SAIKIA ENTERPRISE', so: 2, asm: 2, rsm: 1, zh: 0 },
    { code: '1000001034', name: 'KALPANA HARDWARE-NGN', so: 2, asm: 2, rsm: 1, zh: 0 },
    { code: '1000003202', name: 'BABU HARDWARE', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003596', name: 'J.D. HARDWARE', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000000671', name: 'SANDHYA HARDWARE STORES', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003532', name: 'SWASTIK HARDWARE STORE', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003497', name: 'BISWAKARMA HARDWARE', so: 3, asm: 1, rsm: 0.5, zh: 0 },
    { code: 'WBS197', name: 'S S ENTERPRISE', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: 'NSRE19295', name: 'MAA DURGA HARDWARE', so: 2, asm: 0.5, rsm: 0, zh: 0 }
  ];

  const reconResults = [];
  for (const exp of CONTROL_DEALERS) {
    const pjpRow = pjp.results.find(r => r.dealerCode === exp.code || r.sap_code === exp.code || r.sfa_code === exp.code);
    if (pjpRow) {
      reconResults.push({
        'Dealer Code': exp.code,
        'Dealer Name': pjpRow.dealerName,
        'PJP SO': pjpRow.soVisits,
        'PJP ASM': pjpRow.asmVisits,
        'PJP RSM': pjpRow.rsmVisits,
        'PJP ZH': pjpRow.zhVisits,
        'Zero-Roles Safe': (pjpRow.zhVisits === 0) ? '✅ 0 visits' : 'Non-zero',
        'PJP Match': (pjpRow.soVisits === exp.so && pjpRow.asmVisits === exp.asm && pjpRow.rsmVisits === exp.rsm && pjpRow.zhVisits === exp.zh) ? '✅ MATCH' : '❌'
      });
    }
  }

  console.table(reconResults);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
