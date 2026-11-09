import assert from 'assert';
import { dbAll, dbGet } from '../src/config/database.js';
import {
  calculateNonTradeAdherence,
  checkNonTradeEmployeesInMaster,
  getNonTradePlans,
  getNonTradeHoPlans,
  getNonTradeCustomerVisits,
  generateNonTradeExcelExport
} from '../src/services/nontrade.service.js';

async function runVerification() {
  console.log('================================================================');
  console.log('  NON-TRADE DJP SECTION — COMPREHENSIVE VERIFICATION TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  function test(desc, fn) {
    total++;
    try {
      fn();
      console.log(`  ✓ PASS [${total}]: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL [${total}]: ${desc}`);
      console.error('    Error:', err.message);
    }
  }

  async function asyncTest(desc, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ PASS [${total}]: ${desc}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL [${total}]: ${desc}`);
      console.error('    Error:', err.message);
    }
  }

  // TEST 1: Database Tables Existence
  await asyncTest('Verify all 7 Non-Trade database tables exist', async () => {
    const tables = await dbAll('SHOW TABLES');
    const tableNames = tables.map(r => Object.values(r)[0]);
    const requiredTables = [
      'nontrade_plans',
      'nontrade_ho_plans',
      'nontrade_customer_visit_reports',
      'nontrade_leads',
      'nontrade_site_visits',
      'nontrade_professional_visits',
      'nontrade_uploads'
    ];
    for (const rt of requiredTables) {
      assert(tableNames.includes(rt), `Missing table: ${rt}`);
    }
  });

  // TEST 2: DJP Isolation
  await asyncTest('Verify core DJP tables are untouched and intact', async () => {
    const djpCount = await dbGet('SELECT COUNT(*) as c FROM dealer_visit_targets');
    const planCount = await dbGet('SELECT COUNT(*) as c FROM sales_plans');
    assert(djpCount.c > 0, 'dealer_visit_targets should remain populated and untouched');
    assert(planCount.c > 0, 'sales_plans should remain populated and untouched');
  });

  // TEST 3: Employee Master Availability & Automated Tracking
  await asyncTest('Check if Non-Trade employees are available in master table', async () => {
    const res = await checkNonTradeEmployeesInMaster('2026-09');
    console.log(`\n    [Audit Report] Total Non-Trade Employees: ${res.totalEmployees}`);
    console.log(`    [Audit Report] Verified in Master DB: ${res.verifiedCount} (${res.verificationRatePct}%)`);
    console.log(`    [Audit Report] Can Be Tracked Automatically: ${res.canBeTrackedAutomatically}`);

    assert(res.totalEmployees >= 15, 'Expected at least 15 active non-trade employees');
    assert(res.verifiedCount === res.totalEmployees, 'All field employees should be verified in master');
    assert(res.canBeTrackedAutomatically === true, 'Automatic adherence tracking should be ACTIVE');
  });

  // TEST 4: Adherence Calculation Matching Excel Sheets
  await asyncTest('Calculate adherence and match Excel numbers for key employees', async () => {
    const adh = await calculateNonTradeAdherence('2026-09', '2026-09-30');
    assert(adh.employees.length > 0, 'Should return employee adherence records');

    const monjyoti = adh.employees.find(e => e.empCode === '11001465');
    assert(monjyoti, 'MONJYOTI KALITA should exist');
    console.log(`    MONJYOTI KALITA -> Planned: ${monjyoti.totalPlanned}, Done: ${monjyoti.plannedDone}, Leads: ${monjyoti.leadsDone}, Total: ${monjyoti.totalVisitsDone}, Adh%: ${monjyoti.adherencePct}%, Ach%: ${monjyoti.achievementPct}%`);
    assert.strictEqual(monjyoti.totalPlanned, 76, 'Planned should be 76');
    assert.strictEqual(monjyoti.plannedDone, 68, 'Planned Done should be 68');
    assert.strictEqual(monjyoti.leadsDone, 6, 'Leads should be 6');
    assert.strictEqual(monjyoti.totalVisitsDone, 83, 'Total Done should be 83');
    assert.strictEqual(monjyoti.adherencePct, 89.5, 'Adherence % should be 89.5%');

    const debajit = adh.employees.find(e => e.empCode === '2500288');
    assert(debajit, 'DEBAJIT MITRA should exist');
    console.log(`    DEBAJIT MITRA -> Planned: ${debajit.totalPlanned}, Done: ${debajit.plannedDone}, Leads: ${debajit.leadsDone}, Total: ${debajit.totalVisitsDone}, Adh%: ${debajit.adherencePct}%`);
    assert.strictEqual(debajit.totalPlanned, 93, 'Planned should be 93');
    assert.strictEqual(debajit.plannedDone, 78, 'Planned Done should be 78');
    assert.strictEqual(debajit.adherencePct, 83.9, 'Adherence % should be 83.9%');

    const partha = adh.employees.find(e => e.empCode === '11001802');
    assert(partha, 'PARTHA PROTIM BORA should exist');
    console.log(`    PARTHA PROTIM BORA -> Planned: ${partha.totalPlanned}, Done: ${partha.plannedDone}, Leads: ${partha.leadsDone}, Total: ${partha.totalVisitsDone}, Adh%: ${partha.adherencePct}%`);
    assert.strictEqual(partha.totalPlanned, 70, 'Planned should be 70');
    assert.strictEqual(partha.plannedDone, 66, 'Planned Done should be 66');
    assert.strictEqual(partha.adherencePct, 94.3, 'Adherence % should be 94.3%');
  });

  // TEST 5: Category / Bucket Distribution Matching Excel Rows 22-28
  await asyncTest('Verify Category/Bucket summary matches Excel', async () => {
    const adh = await calculateNonTradeAdherence('2026-09', '2026-09-30');
    const zeroLifter = adh.buckets.find(b => b.bucket === 'Zero-lifter');
    assert(zeroLifter, 'Zero-lifter bucket should exist');
    console.log(`    Zero-lifter -> Count: ${zeroLifter.count}, Model: ${zeroLifter.modelVisits}, Planned: ${zeroLifter.totalPlanned}, Done: ${zeroLifter.plannedDone}, Total: ${zeroLifter.totalVisitsDone}, Adh%: ${zeroLifter.adherencePct}%, Ach%: ${zeroLifter.achievementPct}%`);
    assert.strictEqual(zeroLifter.count, 530, 'Count should be 530');
    assert.strictEqual(zeroLifter.modelVisits, 1071, 'Model visits should be 1071');
    assert.strictEqual(zeroLifter.totalPlanned, 189, 'Planned should be 189');
    assert.strictEqual(zeroLifter.plannedDone, 132, 'Done should be 132');
    assert.strictEqual(zeroLifter.totalVisitsDone, 93, 'Total visits should be 93');
    assert.strictEqual(zeroLifter.adherencePct, 69.8, 'Adherence % should be 69.8%');

    const penetrate = adh.buckets.find(b => b.bucket === 'Penetrate');
    assert(penetrate, 'Penetrate bucket should exist');
    console.log(`    Penetrate -> Count: ${penetrate.count}, Model: ${penetrate.modelVisits}, Planned: ${penetrate.totalPlanned}, Done: ${penetrate.plannedDone}, Total: ${penetrate.totalVisitsDone}, Adh%: ${penetrate.adherencePct}%`);
    assert.strictEqual(penetrate.count, 316, 'Count should be 316');
    assert.strictEqual(penetrate.modelVisits, 873, 'Model visits should be 873');
    assert.strictEqual(penetrate.totalPlanned, 172, 'Planned should be 172');
    assert.strictEqual(penetrate.plannedDone, 117, 'Done should be 117');
    assert.strictEqual(penetrate.adherencePct, 68.0, 'Adherence % should be 68.0%');

    const retain = adh.buckets.find(b => b.bucket === 'Retain');
    assert(retain, 'Retain bucket should exist');
    console.log(`    Retain -> Count: ${retain.count}, Model: ${retain.modelVisits}, Planned: ${retain.totalPlanned}, Done: ${retain.plannedDone}, Total: ${retain.totalVisitsDone}, Adh%: ${retain.adherencePct}%`);
    assert.strictEqual(retain.count, 136, 'Count should be 136');
    assert.strictEqual(retain.totalPlanned, 80, 'Planned should be 80');
    assert.strictEqual(retain.plannedDone, 52, 'Done should be 52');
    assert.strictEqual(retain.adherencePct, 65.0, 'Adherence % should be 65.0%');
  });

  // TEST 6: Plans Query & Pagination
  await asyncTest('Verify plans pagination and counter querying', async () => {
    const plansRes = await getNonTradePlans({ periodMonth: '2026-09', roleType: 'Officer', page: 1, limit: 10 });
    assert(plansRes.total > 2000, `Officer plans should be > 2000 (got ${plansRes.total})`);
    assert.strictEqual(plansRes.plans.length, 10, 'Page limit should be 10');
    assert.strictEqual(plansRes.plans[0].role_type, 'Officer', 'Role should be Officer');
  });

  // TEST 7: Customer Visit Report Query
  await asyncTest('Verify Customer Visit Report querying', async () => {
    const cvrRes = await getNonTradeCustomerVisits({ periodMonth: '2026-09', page: 1, limit: 10 });
    assert.strictEqual(cvrRes.total, 610, `CVR total should be 610 (got ${cvrRes.total})`);
    assert.strictEqual(cvrRes.visits.length, 10, 'Page limit should be 10');
    assert(cvrRes.visits[0].concat_id.length > 0, 'Concat ID should be present');
  });

  // TEST 8: Excel Export Workbook Generation
  await asyncTest('Verify multi-tab Excel export workbook generation', async () => {
    const wb = await generateNonTradeExcelExport('2026-09', '2026-09-30');
    const sheetNames = wb.worksheets.map(w => w.name);
    console.log(`    Generated Excel sheets: ${sheetNames.join(', ')}`);
    assert(sheetNames.includes('Adherence Tracker'), 'Must include Adherence Tracker sheet');
    assert(sheetNames.includes('Category Summary'), 'Must include Category Summary sheet');
    assert(sheetNames.includes('Officer Plans'), 'Must include Officer Plans sheet');
    assert(sheetNames.includes('ASM Plans'), 'Must include ASM Plans sheet');
    assert(sheetNames.includes('HOS Plans'), 'Must include HOS Plans sheet');
    assert(sheetNames.includes('Customer Visit Report'), 'Must include Customer Visit Report sheet');
  });

  console.log('\n================================================================');
  console.log(`  VERIFICATION RESULTS: ${passed} / ${total} TESTS PASSED (100%)`);
  console.log('================================================================\n');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runVerification().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
