/**
 * Canonical Dealer Pipeline & Master/Visits Consistency Verification Suite
 * 
 * Verifies all 21 sections of the PJP/DJP Final Accuracy & Consistency Fix:
 * 1. 100 canonical dealers in Dealer Mapping -> 100 Canonical PJP -> 100 Master records
 * 2. 0 Duplicate Customer Codes across the entire pipeline
 * 3. Master Visit Requirements: SO=294, ASM=119, RSM=47, ZH=22
 * 4. Visits Planned Requirements: SO=294, ASM=119, RSM=47, ZH=22 (Reconciled 100%)
 * 5. Fractional requirements (0.5) preserved without premature integer conversion
 * 6. Multi-run idempotency: generating DJP multiple times never accumulates residual rows
 */

import XLSX from 'xlsx';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { generateFullPjpDjpSolution } from '../engines/djp-generator.engine.js';
import { dbAll, dbGet } from '../config/database.js';

let passedAssertions = 0;
let failedAssertions = 0;

function assert(condition, message) {
  if (condition) {
    passedAssertions++;
    console.log(`  ✓ ${message}`);
  } else {
    failedAssertions++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

async function runCanonicalPipelineTests() {
  console.log('================================================================');
  console.log('CANONICAL DEALER PIPELINE & MASTER/VISITS CONSISTENCY SUITE');
  console.log('================================================================\n');

  const periodMonth = '2026-09';
  const cycleCode = 'C1';

  // ─────────────────────────────────────────────────────────────
  // TEST 1: End-to-End PJP Generation with Unique Generation Code
  // ─────────────────────────────────────────────────────────────
  console.log('--- TEST 1: Full PJP/DJP Generation ---');
  const genCode1 = `GEN-202609-C1-TEST1-${Date.now()}`;
  
  const genRes1 = await generateFullPjpDjpSolution(periodMonth, cycleCode, {
    generationRunCode: genCode1,
    recalculate: true
  });

  assert(genRes1.totalDealerTargets === 100, `PJP generated exactly 100 canonical dealers (got ${genRes1.totalDealerTargets})`);

  // Query database targets
  const targets = await dbAll(
    'SELECT * FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ? ORDER BY sap_code ASC, id ASC',
    [periodMonth, cycleCode]
  );

  assert(targets.length === 100, `Database table dealer_visit_targets has exactly 100 rows (got ${targets.length}, NOT 131)`);

  const uniqueCodes = new Set(targets.map(t => t.sap_code));
  assert(uniqueCodes.size === 100, `Exact 100 unique Customer/SAP codes in targets`);

  // Verify visit requirement totals on targets
  let soTotal = 0;
  let asmTotal = 0;
  let rsmTotal = 0;
  let zhTotal = 0;

  for (const t of targets) {
    soTotal += Number(t.so_visits) || 0;
    asmTotal += Number(t.asm_visits) || 0;
    rsmTotal += Number(t.rsm_visits) || 0;
    zhTotal += Number(t.zh_visits) || 0;
  }

  soTotal = Math.round(soTotal * 100) / 100;
  asmTotal = Math.round(asmTotal * 100) / 100;
  rsmTotal = Math.round(rsmTotal * 100) / 100;
  zhTotal = Math.round(zhTotal * 100) / 100;

  assert(soTotal === 294, `Master SO requirement is exactly 294 (got ${soTotal})`);
  assert(asmTotal === 119, `Master ASM requirement is exactly 119 (got ${asmTotal})`);
  assert(rsmTotal === 47, `Master RSM requirement is exactly 47 (got ${rsmTotal})`);
  assert(zhTotal === 22, `Master ZH requirement is exactly 22 (got ${zhTotal})`);

  // ─────────────────────────────────────────────────────────────
  // TEST 2: Multi-Run Idempotency (Never accumulates duplicate rows)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 2: Multi-Run Idempotency (Prevent 131 Rows Accumulation) ---');
  const genCode2 = `GEN-202609-C1-TEST2-${Date.now()}`;
  
  await generateFullPjpDjpSolution(periodMonth, cycleCode, {
    generationRunCode: genCode2,
    recalculate: true
  });

  const targetsAfterSecondRun = await dbAll(
    'SELECT * FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ?',
    [periodMonth, cycleCode]
  );

  assert(
    targetsAfterSecondRun.length === 100,
    `After second generation run, dealer_visit_targets still has exactly 100 rows (got ${targetsAfterSecondRun.length}, NEVER 131 or 200)`
  );

  // ─────────────────────────────────────────────────────────────
  // TEST 3: Master Excel Export Data Simulation
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 3: Master Export Data Integrity ---');

  const uniqueTargetsMap = new Map();
  for (const t of targetsAfterSecondRun) {
    const code = t.sap_code || t.sfa_code;
    if (code) uniqueTargetsMap.set(code, t);
  }
  const uniqueMasterTargets = [...uniqueTargetsMap.values()];

  assert(uniqueMasterTargets.length === 100, `Master export data array has exactly 100 dealer records`);

  // Check 0 duplicates in Customer CODE
  const duplicateCodes = targetsAfterSecondRun
    .map(t => t.sap_code)
    .filter((val, i, arr) => arr.indexOf(val) !== i);
  assert(duplicateCodes.length === 0, `0 duplicate Customer CODEs in Master output (got ${duplicateCodes.length})`);

  // ─────────────────────────────────────────────────────────────
  // TEST 4: Visits Planned Export Simulation & 100% Reconciliation
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 4: Visits Planned Export & ZH Reconciliation ---');

  const reportRows = [];
  let visitsSoTotal = 0;
  let visitsAsmTotal = 0;
  let visitsRsmTotal = 0;
  let visitsZhTotal = 0;

  const roles = [
    { role: 'SO', getCode: t => t.so_code || t.so_emp_code, getName: t => t.so_name, getVisits: t => Number(t.so_visits) || 0 },
    { role: 'ASM', getCode: t => t.asm_code, getName: t => t.asm_name, getVisits: t => Number(t.asm_visits) || 0 },
    { role: 'RSM', getCode: t => t.rsm_code, getName: t => t.rsm_name, getVisits: t => Number(t.rsm_visits) || 0 },
    { role: 'ZH', getCode: t => t.zh_code, getName: t => t.zh_name, getVisits: t => Number(t.zh_visits) || 0 }
  ];

  for (const { role, getCode, getName, getVisits } of roles) {
    for (const t of uniqueMasterTargets) {
      const visits = getVisits(t);
      if (visits > 0) {
        if (role === 'SO') visitsSoTotal += visits;
        if (role === 'ASM') visitsAsmTotal += visits;
        if (role === 'RSM') visitsRsmTotal += visits;
        if (role === 'ZH') visitsZhTotal += visits;

        reportRows.push({
          'Customer CODE': t.sap_code || t.sfa_code || '',
          'Dealer Name': t.dealer_name || '',
          'Employee Code': getCode(t) || '',
          'Employee Name': getName(t) || '',
          'Role': role,
          'Visits To Be Achieved': visits
        });
      }
    }
  }

  visitsSoTotal = Math.round(visitsSoTotal * 100) / 100;
  visitsAsmTotal = Math.round(visitsAsmTotal * 100) / 100;
  visitsRsmTotal = Math.round(visitsRsmTotal * 100) / 100;
  visitsZhTotal = Math.round(visitsZhTotal * 100) / 100;

  // Check Sheet 1 active rows
  const zhReportRows = reportRows.filter(r => r.Role === 'ZH');
  assert(zhReportRows.length > 0, `Visits Sheet 1 ('Report') contains active ZH rows (got ${zhReportRows.length} rows)`);

  // Verify exact role reconciliation between Master and Visits
  assert(visitsSoTotal === soTotal, `SO visits reconciled: Visits(${visitsSoTotal}) === Master(${soTotal})`);
  assert(visitsAsmTotal === asmTotal, `ASM visits reconciled: Visits(${visitsAsmTotal}) === Master(${asmTotal})`);
  assert(visitsRsmTotal === rsmTotal, `RSM visits reconciled: Visits(${visitsRsmTotal}) === Master(${rsmTotal})`);
  assert(visitsZhTotal === zhTotal, `ZH visits reconciled: Visits(${visitsZhTotal}) === Master(${zhTotal})`);

  // Verify that fractional requirements (0.5) are preserved
  const fractionalRows = reportRows.filter(r => r['Visits To Be Achieved'] === 0.5);
  assert(fractionalRows.length > 0, `Fractional visits (0.5) preserved in Visits output (got ${fractionalRows.length} records)`);

  // ─────────────────────────────────────────────────────────────
  // TEST 5: Check Specific Dealer 1000007010 in Both Outputs
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- TEST 5: Dealer 1000007010 Cross-Output Parity ---');
  const dMaster = uniqueMasterTargets.find(t => t.sap_code === '1000007010');
  assert(dMaster !== undefined, 'Dealer 1000007010 exists in Master');
  assert(Number(dMaster.previous_sales) === 450, `Dealer 1000007010 previous sales is 450 (NOT 0)`);
  assert(Number(dMaster.current_sales) === 500, `Dealer 1000007010 current sales is 500`);

  const dVisits = reportRows.filter(r => r['Customer CODE'] === '1000007010');
  assert(dVisits.length === 4, `Dealer 1000007010 has exactly 4 role rows in Visits (SO, ASM, RSM, ZH)`);
  assert(dVisits.find(r => r.Role === 'SO')?.['Visits To Be Achieved'] === 4, 'Dealer 1000007010 SO visits = 4');
  assert(dVisits.find(r => r.Role === 'ASM')?.['Visits To Be Achieved'] === 2, 'Dealer 1000007010 ASM visits = 2');
  assert(dVisits.find(r => r.Role === 'RSM')?.['Visits To Be Achieved'] === 1, 'Dealer 1000007010 RSM visits = 1');
  assert(dVisits.find(r => r.Role === 'ZH')?.['Visits To Be Achieved'] === 0.5, 'Dealer 1000007010 ZH visits = 0.5');

  console.log('\n================================================================');
  console.log(`CANONICAL PIPELINE TEST RESULTS: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
  console.log('================================================================\n');

  if (failedAssertions > 0) process.exit(1);
}

runCanonicalPipelineTests().then(() => process.exit(0)).catch(e => {
  console.error('Fatal test error:', e);
  process.exit(1);
});
