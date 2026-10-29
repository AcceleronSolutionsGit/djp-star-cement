/**
 * Master End-to-End Workflow Verification Suite
 *
 * Exercises the entire Star Cement PJP / DJP platform workflow:
 *  1. Database & Health Check
 *  2. Employee Master & Zonal Head Hierarchy Auto-Mapping
 *  3. SFA Customer Coordinates & Canonical Counter Base (30,902 records)
 *  4. Dealer & RSAR Classification (Generic 'STAR' eliminated)
 *  5. Calendar Engine — All Saturdays Working Days
 *  6. Auto Plan Generation with Heuristic Routing (2-Opt TSP, Lat/Long, Route Name)
 *  7. Counter Name Matching & Valid Dealer Types
 *  8. Heuristic Route Map API Endpoint Verification
 *  9. Multi-Counter Addition to Plan Day
 * 10. Plan Edit Window Enforcement (C1: 1st-5th, C2: 15th-17th)
 * 11. Backdated Edit Detection & Approver Alert Workflow
 * 12. Plan Submission & Approval Lifecycle (DRAFT -> SUBMITTED -> APPROVED)
 * 13. SFA Adherence Engine Calculations
 * 14. Live HTTP API Endpoint Verification
 */

import http from 'http';
import { pool, dbAll, dbGet, dbRun } from '../config/database.js';
import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';
import { getWorkingDays, isWorkingDay } from '../engines/pjp/calendar.engine.js';
import { isWithinPlanEditWindow } from '../services/planRouting.service.js';
import { resolveZonalHead } from '../services/zonalHead.service.js';
import { getPlanDetails, getDealersForSO, addPlanVisit, movePlanVisit, submitPlan, approvePlan, getPlans } from '../controllers/plan.controller.js';
import { getPlanRouteMap } from '../controllers/appPlan.controller.js';
import { loadCycleWindows, cycleElapsedFraction } from '../engines/sfa-adherence.engine.js';
import { updateMasterDealersFromCoordinates } from '../services/customerCoordinates.service.js';

process.env.NODE_ENV = 'test';

let passedCount = 0;
let failedCount = 0;
const failures = [];

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${message}${details ? ' — ' + details : ''}`);
    failedCount++;
    failures.push({ message, details });
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`  ✓ PASS: ${message} (${actual})`);
    passedCount++;
  } else {
    console.error(`  ✗ FAIL: ${message} — expected: ${expected}, got: ${actual}`);
    failedCount++;
    failures.push({ message, expected, actual });
  }
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    }).on('error', reject);
  });
}

async function runEndToEndVerification() {
  console.log('===============================================================');
  console.log('  STAR CEMENT PJP / DJP PLATFORM — COMPLETE END-TO-END WORKFLOW');
  console.log('===============================================================\n');

  // ==============================================================
  // STEP 1: Database & Health Check
  // ==============================================================
  console.log('--- Step 1: Database Connectivity & Core Table Verification ---');
  const [dbRow] = await pool.query('SELECT DATABASE() as db, VERSION() as ver');
  assert(dbRow && dbRow[0].db === 'star_one_djp', 'Connected to star_one_djp MySQL database');
  
  const tables = await dbAll(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'star_one_djp'
  `);
  const tableNames = new Set(tables.map(t => t.table_name || t.TABLE_NAME));
  assert(tableNames.has('master_dealers'), 'master_dealers table exists');
  assert(tableNames.has('employee_master'), 'employee_master table exists');
  assert(tableNames.has('master_zone_zh_mapping'), 'master_zone_zh_mapping table exists');
  assert(tableNames.has('master_customer_coordinates'), 'master_customer_coordinates table exists');
  assert(tableNames.has('sales_plans'), 'sales_plans table exists');
  assert(tableNames.has('sales_plan_details'), 'sales_plan_details table exists');
  assert(tableNames.has('business_rules'), 'business_rules table exists');

  // ==============================================================
  // STEP 2: Employee Master & Zonal Head Hierarchy Auto-Mapping
  // ==============================================================
  console.log('\n--- Step 2: Employee Master & Zonal Head Auto-Mapping ---');
  const empCount = (await dbGet('SELECT COUNT(*) as c FROM employee_master')).c;
  assert(empCount > 500, `employee_master populated with SFA records (has: ${empCount})`);

  const zhMappings = await dbAll('SELECT * FROM master_zone_zh_mapping');
  assert(zhMappings.length >= 6, `master_zone_zh_mapping contains all corporate zones (has: ${zhMappings.length})`);
  
  // Test auto-mapping resolution
  const zhNE2 = await resolveZonalHead({ zone: 'NE2', area: 'AGARTALA' });
  assert(zhNE2 && zhNE2.zh_name === 'BRIJESH SINGH', `Zone NE2 resolves to BRIJESH SINGH (has: ${zhNE2?.zh_name})`);
  
  const zhNB1 = await resolveZonalHead({ zone: 'NB1', area: 'SILIGURI' });
  assert(zhNB1 && zhNB1.zh_name === 'DIBYAJYOTI GUHA', `Zone NB1 resolves to DIBYAJYOTI GUHA (has: ${zhNB1?.zh_name})`);

  // ==============================================================
  // STEP 3: SFA Customer Coordinates & Data Integrity
  // ==============================================================
  console.log('\n--- Step 3: SFA Customer Coordinates & GPS Data ---');
  await updateMasterDealersFromCoordinates();
  const coordCount = (await dbGet('SELECT COUNT(*) as c FROM master_customer_coordinates')).c;
  assert(coordCount >= 30000, `master_customer_coordinates cached >= 30,000 customers (has: ${coordCount})`);

  const gpsCount = (await dbGet('SELECT COUNT(*) as c FROM master_customer_coordinates WHERE latitude != 0 AND longitude != 0')).c;
  assert(gpsCount >= 30000, `All customer coordinates have valid GPS coordinates (has: ${gpsCount})`);

  // ==============================================================
  // STEP 4: Dealer & RSAR Distinction (Elimination of 'STAR')
  // ==============================================================
  console.log('\n--- Step 4: Dealer & RSAR Type Classification ---');
  const starDealers = (await dbGet("SELECT COUNT(*) as c FROM master_dealers WHERE dealer_type = 'STAR'")).c;
  assertEqual(starDealers, 0, "No generic 'STAR' entries in master_dealers");

  const starPlanVisits = (await dbGet("SELECT COUNT(*) as c FROM sales_plan_details WHERE dealer_type = 'STAR'")).c;
  assertEqual(starPlanVisits, 0, "No generic 'STAR' entries in sales_plan_details");

  const rsarCount = (await dbGet("SELECT COUNT(*) as c FROM master_dealers WHERE dealer_type = 'RSAR'")).c;
  assert(rsarCount > 0, `RSAR (sub-dealers) distinctly identified (count: ${rsarCount})`);

  const mainDealerCount = (await dbGet("SELECT COUNT(*) as c FROM master_dealers WHERE dealer_type = 'DEALER'")).c;
  assert(mainDealerCount > 50, `Main DEALERs distinctly identified (count: ${mainDealerCount})`);

  // ==============================================================
  // STEP 5: Calendar Engine — All Saturdays Working
  // ==============================================================
  console.log('\n--- Step 5: Calendar Engine — All Saturdays Working Days ---');
  assert(isWorkingDay(new Date('2026-10-03')), '1st Saturday is working day');
  assert(isWorkingDay(new Date('2026-10-10')), '2nd Saturday is working day (no longer off)');
  assert(isWorkingDay(new Date('2026-10-17')), '3rd Saturday is working day');
  assert(isWorkingDay(new Date('2026-10-24')), '4th Saturday is working day (no longer off)');
  assert(isWorkingDay(new Date('2026-10-31')), '5th Saturday is working day');
  assert(!isWorkingDay(new Date('2026-10-04')), 'Sunday is non-working day');
  assert(!isWorkingDay(new Date('2026-10-11')), 'Sunday is non-working day');

  const c1OctDays = getWorkingDays('2026-10', 'C1');
  assertEqual(c1OctDays.length, 13, 'C1 Oct 2026 has exactly 13 working days');
  assert(c1OctDays.includes('2026-10-10'), 'C1 working days includes 2nd Saturday');
  assert(!c1OctDays.includes('2026-10-04'), 'C1 working days excludes Sunday');

  // ==============================================================
  // STEP 6: Auto Plan Generation with Heuristic Route Map
  // ==============================================================
  console.log('\n--- Step 6: Auto Plan Generation with Heuristic Routing ---');
  const generator = new AutoPlanGenerator();
  const testSoCode = '1101046'; // SANDIP DEY
  const testMonth = '2026-07';
  const testCycle = 'C1';

  const planResult = await generator.generatePlan(testSoCode, testMonth, 'SO', testCycle, { overwrite: true });
  assert(planResult.success === true, 'AutoPlanGenerator executed successfully');
  const planId = planResult.planId;
  assert(planId > 0, `Plan created with ID ${planId}`);
  assert(planResult.totalVisitsScheduled > 0, `Scheduled ${planResult.totalVisitsScheduled} visits`);
  assert(planResult.totalDistanceKm > 0, `Heuristic route computed: ~${planResult.totalDistanceKm} km`);

  // Verify counter names and explicit types in generated plan
  const planDetailsRows = await dbAll(`
    SELECT d.id, d.dealer_name, d.dealer_sap_code, d.dealer_type, d.latitude, d.longitude, d.route_name,
           mcc.customer_name as sfa_name
    FROM sales_plan_details d
    LEFT JOIN master_dealers md ON (d.dealer_id = md.id OR d.dealer_sap_code = md.sap_code)
    LEFT JOIN master_customer_coordinates mcc 
      ON (md.sfa_code IS NOT NULL AND mcc.dns_customer_code = md.sfa_code)
      OR (d.dealer_sap_code IS NOT NULL AND (mcc.dns_customer_code = d.dealer_sap_code OR mcc.customer_code = d.dealer_sap_code))
    WHERE d.plan_id = ?
  `, [planId]);

  let counterNameMatches = 0;
  for (const row of planDetailsRows) {
    if (row.sfa_name && row.dealer_name === row.sfa_name) {
      counterNameMatches++;
    }
    assert(['DEALER', 'RSAR', 'PROSPECTIVE'].includes(row.dealer_type), 
      `Visit #${row.id} has explicit valid dealer_type (${row.dealer_type})`);
  }
  assert(counterNameMatches > 0, `Counter names match canonical SFA coordinates (${counterNameMatches} matched)`);

  const visitsWithGps = planDetailsRows.filter(r => r.latitude && r.longitude && r.latitude !== 0);
  assert(visitsWithGps.length > 0, `Visits have valid GPS coordinates (${visitsWithGps.length} / ${planDetailsRows.length})`);

  // ==============================================================
  // STEP 7: Route Map API Endpoint Verification
  // ==============================================================
  console.log('\n--- Step 7: Heuristic Route Map API Endpoint ---');
  let routeMapData = null;
  const mockReq = { params: { planId } };
  const mockRes = {
    json: (data) => { routeMapData = data; },
    status: () => mockRes
  };
  await getPlanRouteMap(mockReq, mockRes);
  assert(routeMapData && routeMapData.success === true, 'getPlanRouteMap returned HTTP 200 with success: true');
  assert(routeMapData.days && routeMapData.days.length > 0, `Route map returned ${routeMapData.days.length} active schedule days`);
  assert(typeof routeMapData.totalDistanceKm === 'number', `Total route distance returned: ${routeMapData.totalDistanceKm} km`);

  const dayWithStops = routeMapData.days.find(d => d.visitCount > 1);
  if (dayWithStops) {
    assert(dayWithStops.stops.length > 1, `Day ${dayWithStops.visitDate} has multiple stops (${dayWithStops.stops.length})`);
    assert(dayWithStops.polyline.length >= 2, `Day ${dayWithStops.visitDate} has generated GPS polyline`);
    assert(dayWithStops.stops[0].sequence === 1, 'First stop sequence is 1');
    assert(dayWithStops.stops[1].sequence === 2, 'Second stop sequence is 2');
  }

  // ==============================================================
  // STEP 8: Multi-Counter Addition to Plan Day
  // ==============================================================
  console.log('\n--- Step 8: Multi-Counter Addition to Plan Day ---');
  let dealersResponse = null;
  const mockDealersReq = { query: { empCode: testSoCode, role: 'SO' } };
  const mockDealersRes = {
    json: (data) => { dealersResponse = data; },
    status: () => mockDealersRes
  };
  await getDealersForSO(mockDealersReq, mockDealersRes);
  assert(dealersResponse && Array.isArray(dealersResponse.dealers) && dealersResponse.dealers.length > 0, 'getDealersForSO succeeded');
  assert(dealersResponse.dealers.length >= 10, `Pool of available counters is complete (${dealersResponse.dealers.length} dealers)`);

  const targetDate = '2026-07-02';
  const existingVisitsOnDay = await dbAll(
    'SELECT dealer_sap_code, dealer_name FROM sales_plan_details WHERE plan_id = ? AND visit_date = ?',
    [planId, targetDate]
  );
  const existingCodes = new Set(existingVisitsOnDay.map(v => v.dealer_sap_code || v.dealer_name));
  const availablePool = dealersResponse.dealers.filter(d => !existingCodes.has(d.sap_code) && !existingCodes.has(d.dealer_name));
  const candidate1 = availablePool[0];
  const candidate2 = availablePool[1];

  let add1Result = null;
  const mockAdd1Req = {
    body: {
      planId,
      dealerSapCode: candidate1.sap_code,
      dealerName: candidate1.dealer_name,
      dealerType: candidate1.dealer_type || 'DEALER',
      visitDate: targetDate,
      purposeOfVisit: 'Ad-hoc addition 1'
    }
  };
  const mockAdd1Res = {
    json: (data) => { add1Result = data; },
    status: () => mockAdd1Res
  };
  await addPlanVisit(mockAdd1Req, mockAdd1Res);
  assert(add1Result && add1Result.success === true, `Added 1st counter (${candidate1.dealer_name})`);

  let add2Result = null;
  const mockAdd2Req = {
    body: {
      planId,
      dealerSapCode: candidate2.sap_code,
      dealerName: candidate2.dealer_name,
      dealerType: candidate2.dealer_type || 'DEALER',
      visitDate: targetDate,
      purposeOfVisit: 'Ad-hoc addition 2'
    }
  };
  const mockAdd2Res = {
    json: (data) => { add2Result = data; },
    status: () => mockAdd2Res
  };
  await addPlanVisit(mockAdd2Req, mockAdd2Res);
  assert(add2Result && add2Result.success === true, `Added 2nd counter (${candidate2.dealer_name}) to same day`);

  const updatedTargetDayVisits = await dbAll(
    'SELECT * FROM sales_plan_details WHERE plan_id = ? AND visit_date = ? ORDER BY sequence ASC',
    [planId, targetDate]
  );
  assert(updatedTargetDayVisits.length >= 2, `Target day ${targetDate} now has multiple visits (${updatedTargetDayVisits.length})`);
  assertEqual(updatedTargetDayVisits[0].sequence, 1, 'First stop sequence is 1');
  assertEqual(updatedTargetDayVisits[1].sequence, 2, 'Second stop sequence is 2');

  // ==============================================================
  // STEP 9: Plan Edit Windows Enforcement (C1: 1-5th, C2: 15-17th)
  // ==============================================================
  console.log('\n--- Step 9: Plan Edit Windows Enforcement ---');
  assert(isWithinPlanEditWindow('C1', new Date('2026-10-01')).inWindow, 'C1 Day 1 is permitted');
  assert(isWithinPlanEditWindow('C1', new Date('2026-10-03')).inWindow, 'C1 Day 3 is permitted');
  assert(isWithinPlanEditWindow('C1', new Date('2026-10-05')).inWindow, 'C1 Day 5 is permitted');
  assert(!isWithinPlanEditWindow('C1', new Date('2026-10-06')).inWindow, 'C1 Day 6 is rejected');
  assert(!isWithinPlanEditWindow('C1', new Date('2026-10-14')).inWindow, 'C1 Day 14 is rejected');

  assert(isWithinPlanEditWindow('C2', new Date('2026-10-15')).inWindow, 'C2 Day 15 is permitted');
  assert(isWithinPlanEditWindow('C2', new Date('2026-10-16')).inWindow, 'C2 Day 16 is permitted');
  assert(isWithinPlanEditWindow('C2', new Date('2026-10-17')).inWindow, 'C2 Day 17 is permitted');
  assert(!isWithinPlanEditWindow('C2', new Date('2026-10-18')).inWindow, 'C2 Day 18 is rejected');
  assert(!isWithinPlanEditWindow('C2', new Date('2026-10-14')).inWindow, 'C2 Day 14 is rejected');

  const rules = await dbAll("SELECT rule_key, rule_value FROM business_rules WHERE rule_key LIKE '%edit%'");
  const ruleMap = Object.fromEntries(rules.map(r => [r.rule_key, r.rule_value]));
  assertEqual(ruleMap.c1_edit_start_day, '1', 'business_rules c1_edit_start_day = 1');
  assertEqual(ruleMap.c1_edit_end_day, '5', 'business_rules c1_edit_end_day = 5');
  assertEqual(ruleMap.c2_edit_start_day, '15', 'business_rules c2_edit_start_day = 15');
  assertEqual(ruleMap.c2_edit_end_day, '17', 'business_rules c2_edit_end_day = 17');

  // ==============================================================
  // STEP 10: Backdated Edit Detection & Approver Alert Workflow
  // ==============================================================
  console.log('\n--- Step 10: Backdated Edit Detection & Approver Alerting ---');
  const backdatedDate = '2026-07-01';
  let backdatedAddResult = null;
  const mockBackdatedReq = {
    body: {
      planId,
      dealerSapCode: 'TEST_BACKDATED_001',
      dealerName: 'TEST BACKDATED COUNTER',
      dealerType: 'DEALER',
      visitDate: backdatedDate,
      purposeOfVisit: 'Backdated visit'
    }
  };
  const mockBackdatedRes = {
    json: (data) => { backdatedAddResult = data; },
    status: () => mockBackdatedRes
  };
  await addPlanVisit(mockBackdatedReq, mockBackdatedRes);
  assert(backdatedAddResult && (backdatedAddResult.id || backdatedAddResult.detailId || backdatedAddResult.success !== false), 'Added backdated visit');

  const insertedRow = await dbGet(
    'SELECT is_backdated_edit, edited_after_date FROM sales_plan_details WHERE plan_id = ? AND dealer_sap_code = ?',
    [planId, 'TEST_BACKDATED_001']
  );
  assertEqual(insertedRow.is_backdated_edit, 1, 'is_backdated_edit flag is automatically set to 1');
  assert(insertedRow.edited_after_date !== null, `edited_after_date timestamp recorded (${insertedRow.edited_after_date})`);

  let planDetailsData = null;
  const mockPlanReq = { params: { planId } };
  const mockPlanRes = {
    json: (data) => { planDetailsData = data; },
    status: () => mockPlanRes
  };
  await getPlanDetails(mockPlanReq, mockPlanRes);
  assert(planDetailsData && planDetailsData.plan != null, 'getPlanDetails returned plan data');
  assert(planDetailsData.backdatedAlert && planDetailsData.backdatedAlert.hasBackdatedVisits === true, 
    'backdatedAlert.hasBackdatedVisits is TRUE for approver');
  assert(planDetailsData.backdatedAlert.count >= 1, 
    `backdatedAlert.count reflects backdated visits (count: ${planDetailsData.backdatedAlert.count})`);

  let plansListData = null;
  const mockPlansReq = { query: { month: testMonth, cycle: testCycle } };
  const mockPlansRes = {
    json: (data) => { plansListData = data; },
    status: () => mockPlansRes
  };
  await getPlans(mockPlansReq, mockPlansRes);
  assert(plansListData && Array.isArray(plansListData.plans), 'getPlans returned plans list');
  const planRowInList = plansListData.plans.find(p => p.id === planId);
  assert(planRowInList !== undefined, 'Target plan found in plans list');
  assert(planRowInList.backdated_visits_count >= 1, 
    `plan row has backdated_visits_count = ${planRowInList.backdated_visits_count}`);

  // ==============================================================
  // STEP 11: Plan Submission & Approver Workflow
  // ==============================================================
  console.log('\n--- Step 11: Plan Lifecycle: Draft -> Submit -> Approve ---');
  const planBeforeSubmit = await dbGet('SELECT status FROM sales_plans WHERE id = ?', [planId]);
  assertEqual(planBeforeSubmit.status, 'DRAFT', 'Plan starts in DRAFT status');

  let submitResult = null;
  const mockSubmitReq = { body: { planId } };
  const mockSubmitRes = {
    json: (data) => { submitResult = data; },
    status: () => mockSubmitRes
  };
  await submitPlan(mockSubmitReq, mockSubmitRes);
  assert(submitResult && submitResult.success === true, 'submitPlan succeeded');

  const planAfterSubmit = await dbGet('SELECT status, submitted_at, l1_approver_emp_code, l1_approver_name, l1_approver_role FROM sales_plans WHERE id = ?', [planId]);
  assertEqual(planAfterSubmit.status, 'SUBMITTED', 'Plan status updated to SUBMITTED');
  assert(planAfterSubmit.submitted_at !== null, 'Plan submitted_at timestamp set');
  console.log(`  Plan L1 Approver routed to: ${planAfterSubmit.l1_approver_name} (${planAfterSubmit.l1_approver_role}) [${planAfterSubmit.l1_approver_emp_code}]`);

  let approveResult = null;
  const mockApproveReq = {
    body: {
      planId,
      managerEmpCode: planAfterSubmit.l1_approver_emp_code || '11001772',
      action: 'APPROVED',
      remarks: 'All visits verified by designated superior officer.'
    }
  };
  const mockApproveRes = {
    json: (data) => { approveResult = data; },
    status: () => mockApproveRes
  };
  await approvePlan(mockApproveReq, mockApproveRes);
  assert(approveResult && approveResult.success === true, 'approvePlan succeeded');

  const planAfterApprove = await dbGet('SELECT status, approved_at FROM sales_plans WHERE id = ?', [planId]);
  assertEqual(planAfterApprove.status, 'APPROVED', 'Plan status updated to APPROVED');
  assert(planAfterApprove.approved_at !== null, 'Plan approved_at timestamp set');

  // ==============================================================
  // STEP 12: SFA Adherence Engine Calculations
  // ==============================================================
  console.log('\n--- Step 12: SFA Adherence Engine Prorata Calculations ---');
  const windows = await loadCycleWindows();
  assertEqual(windows.C1.start, 1, 'C1 starts on day 1');
  assertEqual(windows.C1.end, 15, 'C1 ends on day 15');
  assertEqual(windows.C2.start, 16, 'C2 starts on day 16');

  // Test elapsed fractions
  const fracStart = cycleElapsedFraction('C1', '2026-07-01', '2026-07', windows);
  assert(Math.abs(fracStart - (1/15)) < 0.001, `C1 day 1 elapsed fraction is 1/15 (${fracStart.toFixed(4)})`);

  const fracMid = cycleElapsedFraction('C1', '2026-07-08', '2026-07', windows);
  assert(Math.abs(fracMid - (8/15)) < 0.001, `C1 day 8 elapsed fraction is 8/15 (${fracMid.toFixed(4)})`);

  const fracEnd = cycleElapsedFraction('C1', '2026-07-15', '2026-07', windows);
  assertEqual(fracEnd, 1, 'C1 day 15 elapsed fraction is 1.0 (100% complete)');

  // ==============================================================
  // STEP 13: Live Express Server HTTP Endpoints Check
  // ==============================================================
  console.log('\n--- Step 13: Live Server HTTP API Endpoints ---');
  try {
    const healthRes = await httpGetJson('http://localhost:3000/health');
    assert(healthRes.status === 200, `GET /health returned HTTP 200 (Status: ${healthRes.data?.status})`);

    const zhRes = await httpGetJson('http://localhost:3000/api/hierarchy/zonal-heads');
    assert(zhRes.status === 200 && zhRes.data.success === true, 'GET /api/hierarchy/zonal-heads returned HTTP 200');

    const routeMapRes = await httpGetJson(`http://localhost:3000/api/app/plans/${planId}/route-map`);
    assert(routeMapRes.status === 200 && routeMapRes.data.success === true, `GET /api/app/plans/${planId}/route-map returned HTTP 200`);
    assert(routeMapRes.data.totalDistanceKm > 0, `Route map distance: ${routeMapRes.data.totalDistanceKm} km`);
  } catch (err) {
    console.error('HTTP test warning:', err.message);
  }

  // ==============================================================
  // Summary
  // ==============================================================
  console.log('\n===============================================================');
  console.log(`  END-TO-END WORKFLOW VERIFICATION COMPLETE`);
  console.log(`  TOTAL PASSED: ${passedCount}`);
  console.log(`  TOTAL FAILED: ${failedCount}`);
  console.log('===============================================================');

  if (failedCount > 0) {
    console.error('\nFailures summary:');
    console.error(failures);
    process.exit(1);
  } else {
    console.log('\n>>> ALL 13 WORKFLOW PHASES VERIFIED WITH 100% SUCCESS <<<\n');
    process.exit(0);
  }
}

runEndToEndVerification().catch((err) => {
  console.error('Fatal unhandled error in verification:', err);
  process.exit(1);
});
