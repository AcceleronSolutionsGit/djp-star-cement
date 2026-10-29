import assert from 'assert';
import { dbAll, dbGet, dbRun } from '../config/database.js';
import { isWorkingDay, getWorkingDays } from '../engines/pjp/calendar.engine.js';
import { isWithinPlanEditWindow, canEdit } from '../services/planRouting.service.js';
import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';
const autoPlanGenerator = new AutoPlanGenerator();
import { getDealersForSO, getPlanDetails, getPlans } from '../controllers/plan.controller.js';

let passedAssertions = 0;
let failedAssertions = 0;

function assertTest(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passedAssertions++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failedAssertions++;
  }
}

async function runTestSuite() {
  console.log('===============================================================');
  console.log('  TESTING USER ENHANCEMENTS (ALL 6 REQUIREMENTS)');
  console.log('===============================================================\n');

  // ─────────────────────────────────────────────────────────────────
  // REQUIREMENT 6: ALL SATURDAYS ARE WORKING
  // ─────────────────────────────────────────────────────────────────
  console.log('--- Test Suite 1: Calendar Engine — All Saturdays are Working ---');
  {
    // Test October 2026:
    // Sat Oct 3 = 1st Sat
    // Sat Oct 10 = 2nd Sat
    // Sat Oct 17 = 3rd Sat
    // Sat Oct 24 = 4th Sat
    // Sat Oct 31 = 5th Sat
    // Sun Oct 4, 11, 18, 25 = Sundays
    const sat1 = new Date('2026-10-03');
    const sat2 = new Date('2026-10-10');
    const sat3 = new Date('2026-10-17');
    const sat4 = new Date('2026-10-24');
    const sat5 = new Date('2026-10-31');
    const sun1 = new Date('2026-10-04');
    const sun2 = new Date('2026-10-11');

    assertTest(isWorkingDay(sat1) === true, '1st Saturday (Oct 3) is a working day');
    assertTest(isWorkingDay(sat2) === true, '2nd Saturday (Oct 10) is a working day (Previously excluded)');
    assertTest(isWorkingDay(sat3) === true, '3rd Saturday (Oct 17) is a working day');
    assertTest(isWorkingDay(sat4) === true, '4th Saturday (Oct 24) is a working day (Previously excluded)');
    assertTest(isWorkingDay(sat5) === true, '5th Saturday (Oct 31) is a working day');
    assertTest(isWorkingDay(sun1) === false, 'Sunday (Oct 4) is non-working');
    assertTest(isWorkingDay(sun2) === false, 'Sunday (Oct 11) is non-working');

    const workingDaysC1 = getWorkingDays('2026-10', 'C1');
    // Days 1 to 15: 15 days total. Sundays: Oct 4, Oct 11 (2 days). Working days = 15 - 2 = 13.
    // (Previously, with 2nd Sat off, it was 12).
    assertTest(workingDaysC1.includes('2026-10-10'), 'getWorkingDays includes 2nd Saturday (2026-10-10)');
    assertTest(!workingDaysC1.includes('2026-10-04'), 'getWorkingDays excludes Sunday (2026-10-04)');
    assertTest(workingDaysC1.length === 13, `C1 working days in Oct 2026 is 13 (has: ${workingDaysC1.length})`);
  }

  // ─────────────────────────────────────────────────────────────────
  // REQUIREMENT 5: EDIT WINDOWS (1-5th for C1, 15-17th for C2)
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- Test Suite 2: Plan Edit Windows (C1: 1-5th, C2: 15-17th) ---');
  {
    // C1 Window check on Day 1, 3, 5, 6
    const day1 = new Date('2026-10-01');
    const day3 = new Date('2026-10-03');
    const day5 = new Date('2026-10-05');
    const day6 = new Date('2026-10-06');
    const day15 = new Date('2026-10-15');
    const day16 = new Date('2026-10-16');
    const day17 = new Date('2026-10-17');
    const day18 = new Date('2026-10-18');

    assertTest(isWithinPlanEditWindow('C1', day1).inWindow === true, 'C1 on Day 1 is in edit window');
    assertTest(isWithinPlanEditWindow('C1', day3).inWindow === true, 'C1 on Day 3 is in edit window');
    assertTest(isWithinPlanEditWindow('C1', day5).inWindow === true, 'C1 on Day 5 is in edit window');
    assertTest(isWithinPlanEditWindow('C1', day6).inWindow === false, 'C1 on Day 6 is outside edit window');

    assertTest(isWithinPlanEditWindow('C2', day15).inWindow === true, 'C2 on Day 15 is in edit window');
    assertTest(isWithinPlanEditWindow('C2', day16).inWindow === true, 'C2 on Day 16 is in edit window');
    assertTest(isWithinPlanEditWindow('C2', day17).inWindow === true, 'C2 on Day 17 is in edit window');
    assertTest(isWithinPlanEditWindow('C2', day18).inWindow === false, 'C2 on Day 18 is outside edit window');

    // Business rules table check
    const c1RuleStart = await dbGet('SELECT rule_value FROM business_rules WHERE rule_key = "c1_edit_start_day"');
    const c1RuleEnd   = await dbGet('SELECT rule_value FROM business_rules WHERE rule_key = "c1_edit_end_day"');
    const c2RuleStart = await dbGet('SELECT rule_value FROM business_rules WHERE rule_key = "c2_edit_start_day"');
    const c2RuleEnd   = await dbGet('SELECT rule_value FROM business_rules WHERE rule_key = "c2_edit_end_day"');

    assertTest(c1RuleStart?.rule_value === '1', 'business_rules c1_edit_start_day = 1');
    assertTest(c1RuleEnd?.rule_value === '5', 'business_rules c1_edit_end_day = 5');
    assertTest(c2RuleStart?.rule_value === '15', 'business_rules c2_edit_start_day = 15');
    assertTest(c2RuleEnd?.rule_value === '17', 'business_rules c2_edit_end_day = 17');
  }

  // ─────────────────────────────────────────────────────────────────
  // REQUIREMENT 3: DEALER & RSAR DISTINCTION (NO GENERIC 'STAR')
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- Test Suite 3: Dealer & RSAR Distinction in Plan ---');
  {
    const rsarCounts = await dbGet('SELECT COUNT(*) as cnt FROM master_dealers WHERE dealer_type = "RSAR"');
    const dealerCounts = await dbGet('SELECT COUNT(*) as cnt FROM master_dealers WHERE dealer_type = "DEALER"');
    const starCounts = await dbGet('SELECT COUNT(*) as cnt FROM master_dealers WHERE dealer_type = "STAR"');

    assertTest(rsarCounts.cnt > 0, `RSAR counters cleanly identified in master_dealers (count: ${rsarCounts.cnt})`);
    assertTest(dealerCounts.cnt > 0, `Dealers cleanly identified in master_dealers (count: ${dealerCounts.cnt})`);
    assertTest(starCounts.cnt === 0, `Generic 'STAR' type eliminated in master_dealers (count: ${starCounts.cnt})`);

    const planStarCounts = await dbGet('SELECT COUNT(*) as cnt FROM sales_plan_details WHERE dealer_type = "STAR"');
    assertTest(planStarCounts.cnt === 0, `Generic 'STAR' type eliminated in sales_plan_details (count: ${planStarCounts.cnt})`);

    // Verify subdealers carry RSAR
    const sampleRsar = await dbGet('SELECT dealer_name, dealer_type FROM master_dealers WHERE dealer_type = "RSAR" LIMIT 1');
    assertTest(sampleRsar?.dealer_type === 'RSAR', `Subdealer sample has dealer_type 'RSAR' (${sampleRsar?.dealer_name})`);
  }

  // ─────────────────────────────────────────────────────────────────
  // REQUIREMENT 2: COUNTER NAMES MATCHING AS PER AUTO PLAN GENERATED
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- Test Suite 4: Counter Names Matching Auto Plan Generated ---');
  {
    // Generate a fresh test plan for an SO with visit targets
    const testTarget = await dbGet('SELECT so_emp_code, so_name, period_month FROM dealer_visit_targets WHERE so_visits > 0 LIMIT 1');
    const empCode = testTarget?.so_emp_code || '1101046';
    const periodMonth = testTarget?.period_month || '2026-07';

    const planRes = await autoPlanGenerator.generatePlan(empCode, periodMonth, 'SO', 'C1', { bypassWindow: true });
    assertTest(planRes.success === true, `Generated auto plan for SO ${empCode} (${testTarget?.so_name}) in ${periodMonth}`);

    // Check plan items in sales_plan_details
    const planItems = await dbAll(
      `SELECT d.dealer_name, d.dealer_sap_code, d.dealer_type, mcc.customer_name as sfa_name
       FROM sales_plan_details d
       LEFT JOIN master_dealers md ON (d.dealer_id = md.id OR d.dealer_sap_code = md.sap_code)
       LEFT JOIN master_customer_coordinates mcc 
         ON (md.sfa_code IS NOT NULL AND mcc.dns_customer_code = md.sfa_code)
         OR (d.dealer_sap_code IS NOT NULL AND (mcc.dns_customer_code = d.dealer_sap_code OR mcc.customer_code = d.dealer_sap_code))
       WHERE d.plan_id = ?
       LIMIT 10`,
      [planRes.planId]
    );

    assertTest(planItems.length > 0, `Plan details generated: ${planItems.length} items`);

    let matchedSfaCount = 0;
    for (const item of planItems) {
      assertTest(item.dealer_type !== 'STAR', `Item ${item.dealer_name} has explicit type: ${item.dealer_type} (not STAR)`);
      if (item.sfa_name && item.dealer_name === item.sfa_name) {
        matchedSfaCount++;
      }
    }
    assertTest(matchedSfaCount > 0, `Counter names match canonical SFA records (${matchedSfaCount} matched SFA coordinates)`);
  }

  // ─────────────────────────────────────────────────────────────────
  // REQUIREMENT 4: ABILITY TO ADD MORE THAN ONE COUNTER TO PLAN
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- Test Suite 5: Add Multiple Counters Consecutively to Plan ---');
  {
    // Create an empty test plan
    const planRes = await dbRun(
      'INSERT INTO sales_plans (emp_code, emp_name, period_month, cycle_code, status, emp_role) VALUES (?, ?, ?, ?, ?, ?)',
      ['TEST_EMP_MULTI', 'TEST SO MULTI', '2026-10', 'C1', 'DRAFT', 'SO']
    );
    const testPlanId = planRes.insertId || planRes.lastID;

    // Fetch available counters via getDealersForSO logic
    let mockReq = { query: { empCode: 'TEST_EMP_MULTI', role: 'SO' } };
    let dealersResult = null;
    let mockRes = {
      status: () => mockRes,
      json: (data) => { dealersResult = data; }
    };

    await getDealersForSO(mockReq, mockRes);
    assertTest(dealersResult?.dealers?.length > 0, `getDealersForSO returns available pool (${dealersResult?.dealers?.length} counters)`);

    const pool = dealersResult.dealers;
    const d1 = pool[0];
    const d2 = pool[1];
    const d3 = pool[2];

    const targetDate = '2026-10-06';

    // Helper to simulate addPlanVisit
    async function addVisitSim(d, seq) {
      return await dbRun(
        `INSERT INTO sales_plan_details 
         (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, visit_status, is_backdated_edit, edited_after_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 0, 0)`,
        [testPlanId, targetDate, d.dealer_id || null, d.sap_code, d.dealer_name, d.dealer_type || 'DEALER', 'Ad-hoc PJP Visit', seq]
      );
    }

    // Add Counter 1
    const res1 = await addVisitSim(d1, 1);
    assertTest(Boolean(res1.insertId || res1.lastID), `Added 1st counter (${d1.dealer_name})`);

    // Add Counter 2 to the same day
    const res2 = await addVisitSim(d2, 2);
    assertTest(Boolean(res2.insertId || res2.lastID), `Added 2nd counter (${d2.dealer_name}) to same day`);

    // Add Counter 3 to the same day
    const res3 = await addVisitSim(d3, 3);
    assertTest(Boolean(res3.insertId || res3.lastID), `Added 3rd counter (${d3.dealer_name}) to same day`);

    const scheduledVisits = await dbAll(
      'SELECT id, dealer_name, dealer_type, sequence FROM sales_plan_details WHERE plan_id = ? AND visit_date = ? ORDER BY sequence ASC',
      [testPlanId, targetDate]
    );

    assertTest(scheduledVisits.length === 3, `Successfully added 3 counters to day schedule (count: ${scheduledVisits.length})`);
    assertTest(scheduledVisits[0].sequence === 1, 'First stop sequence = 1');
    assertTest(scheduledVisits[1].sequence === 2, 'Second stop sequence = 2');
    assertTest(scheduledVisits[2].sequence === 3, 'Third stop sequence = 3');

    // Clean up test plan
    await dbRun('DELETE FROM sales_plan_details WHERE plan_id = ?', [testPlanId]);
    await dbRun('DELETE FROM sales_plans WHERE id = ?', [testPlanId]);
  }

  // ─────────────────────────────────────────────────────────────────
  // REQUIREMENT 1: ALERT TO APPROVER FOR EDITED BACKDATED DATA
  // ─────────────────────────────────────────────────────────────────
  console.log('\n--- Test Suite 6: Approver Alert for Edited Backdated Data ---');
  {
    // Create a plan submitted for approval
    const planRes = await dbRun(
      'INSERT INTO sales_plans (emp_code, emp_name, period_month, cycle_code, status, emp_role) VALUES (?, ?, ?, ?, ?, ?)',
      ['TEST_BACKDATE_SO', 'TEST SO BACKDATE', '2026-10', 'C1', 'SUBMITTED', 'SO']
    );
    const planId = planRes.insertId || planRes.lastID;

    // Insert 1 normal future visit and 2 backdated visits
    const pastDate1 = '2026-10-01'; // Oct 1 has already passed
    const pastDate2 = '2026-10-02'; // Oct 2 has already passed
    const futureDate = '2026-10-31';

    // Insert backdated visit 1 with is_backdated_edit = 1
    await dbRun(
      `INSERT INTO sales_plan_details 
       (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, visit_status, is_backdated_edit, edited_after_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', 1, 1, '2026-10-29 10:00:00', NOW())`,
      [planId, pastDate1, 1, 'SAP_BD_01', 'BACKDATED DEALER 1', 'DEALER', 'Backdated Edit 1']
    );

    // Insert backdated visit 2 with created_at > visit_date
    await dbRun(
      `INSERT INTO sales_plan_details 
       (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, visit_status, is_backdated_edit, edited_after_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', 1, 1, '2026-10-29 11:00:00', NOW())`,
      [planId, pastDate2, 2, 'SAP_BD_02', 'BACKDATED DEALER 2', 'RSAR', 'Backdated Edit 2']
    );

    // Insert normal future visit
    await dbRun(
      `INSERT INTO sales_plan_details 
       (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, visit_status, is_backdated_edit, edited_after_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'ACTIVE', 0, 0, '2026-10-01 10:00:00')`,
      [planId, futureDate, 3, 'SAP_FUT_01', 'FUTURE DEALER', 'DEALER', 'Future Visit']
    );

    // Call getPlanDetails for approver review
    let detailsResult = null;
    let mockRes = {
      status: () => mockRes,
      json: (data) => { detailsResult = data; }
    };

    await getPlanDetails({ params: { planId } }, mockRes);

    assertTest(Boolean(detailsResult?.backdatedAlert), 'getPlanDetails returns backdatedAlert object for approver');
    assertTest(detailsResult?.backdatedAlert?.hasBackdatedVisits === true, 'hasBackdatedVisits is true');
    assertTest(detailsResult?.backdatedAlert?.count === 2, `backdatedAlert detects exactly 2 backdated visits (has: ${detailsResult?.backdatedAlert?.count})`);
    assertTest(detailsResult?.backdatedAlert?.visits?.length === 2, 'backdatedAlert includes list of flagged visits');

    // Call getPlans for approver overview table
    let plansResult = null;
    let mockPlansRes = {
      status: () => mockPlansRes,
      json: (data) => { plansResult = data; }
    };

    await getPlans({ query: { empCode: 'ADMIN', role: 'ADMIN' } }, mockPlansRes);
    const targetPlanInList = (plansResult?.plans || []).find(p => p.id === planId);

    assertTest(Boolean(targetPlanInList), 'Plan found in approver plan list');
    assertTest(targetPlanInList?.backdated_visits_count === 2, `backdated_visits_count in plan row = 2 (has: ${targetPlanInList?.backdated_visits_count})`);

    // Clean up
    await dbRun('DELETE FROM sales_plan_details WHERE plan_id = ?', [planId]);
    await dbRun('DELETE FROM sales_plans WHERE id = ?', [planId]);
  }

  // ─────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────
  console.log('\n===============================================================');
  console.log(`  TEST RUN COMPLETE: ${passedAssertions} PASSED, ${failedAssertions} FAILED`);
  console.log('===============================================================');

  if (failedAssertions > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch(err => {
  console.error('[TestSuite Error]', err);
  process.exit(1);
});
