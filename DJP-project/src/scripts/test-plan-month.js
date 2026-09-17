import { dbRun, dbAll, dbGet } from '../config/database.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { generateFullPjpDjpSolution } from '../engines/djp-generator.engine.js';
import { buildCalculationContext } from '../engines/pjp/sales-calculation.engine.js';
import { getLatestAvailableSalesPeriod } from '../engines/pjp/data-loader.engine.js';

let passedCount = 0;
let failedCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedCount++;
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('RUNNING REGRESSION TEST SUITE: USER-SELECTABLE PJP PLANNING MONTH');
  console.log('================================================================\n');

  // Verify baseline: sales data max period in DB
  const latestSales = await getLatestAvailableSalesPeriod();
  console.log(`Database Sales Anchor (MAX period_year_month): ${latestSales}\n`);

  // -------------------------------------------------------------------------
  // Test 1: User selects July 2026 -> generated plan is July 2026
  // -------------------------------------------------------------------------
  console.log('Test 1: User selects July 2026 (2026-07) -> generated plan is July 2026');
  const resJuly = await calculatePJP('2026-07', 'C1', { persist: true });
  assert(resJuly.calcContext.planningMonth === '2026-07', 'calcContext.planningMonth is 2026-07');
  
  const savedJulyTargets = await dbAll(
    'SELECT DISTINCT period_month FROM dealer_visit_targets WHERE period_month = ?',
    ['2026-07']
  );
  assert(savedJulyTargets.length === 1 && savedJulyTargets[0].period_month === '2026-07', 'Persisted targets retain period_month = 2026-07');

  // -------------------------------------------------------------------------
  // Test 2: User selects August 2026 -> generated plan is August 2026
  // -------------------------------------------------------------------------
  console.log('\nTest 2: User selects August 2026 (2026-08) -> generated plan is August 2026');
  const resAug = await calculatePJP('2026-08', 'C1', { persist: true });
  assert(resAug.calcContext.planningMonth === '2026-08', 'calcContext.planningMonth is 2026-08');
  
  const savedAugTargets = await dbAll(
    'SELECT DISTINCT period_month FROM dealer_visit_targets WHERE period_month = ?',
    ['2026-08']
  );
  assert(savedAugTargets.length === 1 && savedAugTargets[0].period_month === '2026-08', 'Persisted targets retain period_month = 2026-08');

  // -------------------------------------------------------------------------
  // Test 3: User selects September 2026 while sales data ends June 2026 -> plan is September, sales anchor remains June
  // -------------------------------------------------------------------------
  console.log('\nTest 3: User selects September 2026 while sales ends June 2026 -> plan is September, sales anchor is June');
  const resSept = await calculatePJP('2026-09', 'C1', { persist: true });
  assert(resSept.calcContext.planningMonth === '2026-09', 'calcContext.planningMonth is 2026-09');
  assert(resSept.calcContext.latestAvailableSalesPeriod === '2026-06', 'calcContext.latestAvailableSalesPeriod anchored to 2026-06');
  assert(resSept.calcContext.currentSalesPeriod === '2026-06', 'Current sales period is 2026-06');
  assert(resSept.calcContext.previousSalesPeriod === '2026-05', 'Previous sales period is 2026-05');
  assert(resSept.calcContext.lysmSalesPeriod === '2025-06', 'LYSM sales period is 2025-06');
  
  // Non-zero sales verified: future Plan Month does not create artificial zero sales!
  const septDealersWithSales = resSept.results.filter(r => r.currentSales > 0);
  assert(septDealersWithSales.length > 0, `Future Plan Month preserved actual sales figures (${septDealersWithSales.length} dealers with currentSales > 0, not artificial zeroes)`);

  // -------------------------------------------------------------------------
  // Test 4: Changing Plan Month changes the planning period without changing historical sales calculations
  // -------------------------------------------------------------------------
  console.log('\nTest 4: Changing Plan Month changes planning period without changing sales calculations');
  const sampleDealer = resJuly.results[0];
  const sampleCode = sampleDealer.dealerCode || sampleDealer.sap_code;
  const septDealer = resSept.results.find(r => (r.dealerCode || r.sap_code) === sampleCode);
  assert(sampleDealer && septDealer, `Sample dealer (${sampleCode}) exists in both July and September plans`);
  if (sampleDealer && septDealer) {
    assert(sampleDealer.currentSales === septDealer.currentSales, `Dealer ${sampleCode} currentSales identical (${sampleDealer.currentSales} MT) across planning months`);
    assert(sampleDealer.previousSales === septDealer.previousSales, `Dealer ${sampleCode} previousSales identical (${sampleDealer.previousSales} MT) across planning months`);
    assert(sampleDealer.grade === septDealer.grade, `Dealer ${sampleCode} Grade identical (${sampleDealer.grade}) across planning months`);
    assert(sampleDealer.finalCategory === septDealer.finalCategory, `Dealer ${sampleCode} Category identical (${sampleDealer.finalCategory}) across planning months`);
  }

  // -------------------------------------------------------------------------
  // Test 5: Backend does not ignore the selected Plan Month
  // -------------------------------------------------------------------------
  console.log('\nTest 5: Backend does not ignore the selected Plan Month');
  const djpSept = await generateFullPjpDjpSolution('2026-09', 'C1');
  const djpRecommendationsSept = await dbAll(
    'SELECT DISTINCT period_month, MIN(visit_date) as min_date, MAX(visit_date) as max_date FROM djp_recommendations WHERE period_month = ?',
    ['2026-09']
  );
  assert(djpRecommendationsSept.length === 1 && djpRecommendationsSept[0].period_month === '2026-09', 'DJP recommendations persisted with period_month = 2026-09');
  assert(djpRecommendationsSept[0].min_date.startsWith('2026-09'), `DJP visit dates scheduled in September (${djpRecommendationsSept[0].min_date})`);

  // -------------------------------------------------------------------------
  // Test 6: Backend does not silently use the server's current month
  // -------------------------------------------------------------------------
  console.log('\nTest 6: Backend does not silently use server current month');
  const serverCurrentMonth = new Date().toISOString().slice(0, 7);
  // When user asks for 2026-11 (November 2026), ensure it NEVER becomes server current month
  const testNov = await calculatePJP('2026-11', 'C1', { persist: true });
  assert(testNov.calcContext.planningMonth === '2026-11', 'Plan Month strictly 2026-11, not server current month');
  const novTargets = await dbAll('SELECT COUNT(*) as cnt FROM dealer_visit_targets WHERE period_month = ?', ['2026-11']);
  assert(novTargets[0].cnt > 0, 'Saved targets under 2026-11');
  // Clean up testNov
  await dbRun('DELETE FROM dealer_visit_targets WHERE period_month = ?', ['2026-11']);

  // -------------------------------------------------------------------------
  // Test 7: Saved/exported plan retains the selected Plan Month
  // -------------------------------------------------------------------------
  console.log('\nTest 7: Saved/exported plan retains selected Plan Month');
  const savedJuly = await dbAll('SELECT DISTINCT period_month FROM dealer_visit_targets WHERE period_month = "2026-07"');
  const savedAug = await dbAll('SELECT DISTINCT period_month FROM dealer_visit_targets WHERE period_month = "2026-08"');
  const savedSept = await dbAll('SELECT DISTINCT period_month FROM dealer_visit_targets WHERE period_month = "2026-09"');
  assert(savedJuly.length === 1 && savedJuly[0].period_month === '2026-07', 'July plan retains 2026-07');
  assert(savedAug.length === 1 && savedAug[0].period_month === '2026-08', 'August plan retains 2026-08');
  assert(savedSept.length === 1 && savedSept[0].period_month === '2026-09', 'September plan retains 2026-09');

  // -------------------------------------------------------------------------
  // Test 8: Generating another month's plan does not incorrectly change an existing plan's month
  // -------------------------------------------------------------------------
  console.log('\nTest 8: Multiple-month isolation: Generating 2026-10 does not overwrite 2026-09');
  await calculatePJP('2026-10', 'C1', { persist: true });
  const countSeptAfter = await dbGet('SELECT COUNT(*) as cnt FROM dealer_visit_targets WHERE period_month = "2026-09"');
  const countOct = await dbGet('SELECT COUNT(*) as cnt FROM dealer_visit_targets WHERE period_month = "2026-10"');
  assert(countSeptAfter.cnt > 0, `September targets still intact (${countSeptAfter.cnt} records)`);
  assert(countOct.cnt > 0, `October targets independently exist (${countOct.cnt} records)`);
  // Clean up test Oct
  await dbRun('DELETE FROM dealer_visit_targets WHERE period_month = ?', ['2026-10']);

  // -------------------------------------------------------------------------
  // Test 9: Invalid/missing Plan Month is rejected clearly
  // -------------------------------------------------------------------------
  console.log('\nTest 9: Invalid/missing Plan Month is rejected clearly');
  let threwMissing = false;
  try {
    await calculatePJP(null, 'C1');
  } catch (err) {
    threwMissing = true;
    assert(err.message.includes('planMonth') || err.message.includes('required'), `Missing planMonth rejected: "${err.message}"`);
  }
  assert(threwMissing, 'Threw error on missing planMonth');

  let threwInvalidFormat = false;
  try {
    await calculatePJP('2026/09', 'C1');
  } catch (err) {
    threwInvalidFormat = true;
    assert(err.message.includes('format') || err.message.includes('YYYY-MM'), `Invalid format rejected: "${err.message}"`);
  }
  assert(threwInvalidFormat, 'Threw error on invalid format planMonth');

  let threwInvalidMonthNum = false;
  try {
    await calculatePJP('2026-15', 'C1');
  } catch (err) {
    threwInvalidMonthNum = true;
    assert(err.message.includes('between 01 and 12'), `Invalid month number 15 rejected: "${err.message}"`);
  }
  assert(threwInvalidMonthNum, 'Threw error on invalid month number (2026-15)');

  // Summary
  console.log('\n================================================================');
  console.log(`TEST SUMMARY: ${passedCount} PASSED, ${failedCount} FAILED`);
  console.log('================================================================\n');

  process.exit(failedCount > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
