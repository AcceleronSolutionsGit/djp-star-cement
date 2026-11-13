/**
 * Verification test for non-destructive officer plan submission:
 * Ensures officer visits are ADDED / MERGED into the existing plan,
 * and NEVER replace or delete the DJP-generated visits.
 */
import assert from 'assert';
import { dbAll, dbGet, dbRun } from '../config/database.js';
import { createOfficerPlan } from '../controllers/appPlan.controller.js';

async function runTest() {
  console.log('=== TEST: Officer Plan Submission Append (Non-Destructive) ===\n');

  const testEmpCode = 'TEST_SO_DJP_APPEND';
  const testMonth = '2026-11';
  const testCycle = 'C1';

  try {
    // 1. Cleanup any previous test artifacts
    const oldPlan = await dbGet(
      'SELECT id FROM sales_plans WHERE emp_code = ? AND period_month = ? AND cycle_code = ?',
      [testEmpCode, testMonth, testCycle]
    );
    if (oldPlan) {
      await dbRun('DELETE FROM sales_plan_details WHERE plan_id = ?', [oldPlan.id]);
      await dbRun('DELETE FROM plan_approvals WHERE plan_id = ?', [oldPlan.id]);
      await dbRun('DELETE FROM sales_plans WHERE id = ?', [oldPlan.id]);
    }

    // 2. Simulate DJP Engine creating a plan with 3 algorithmic visits
    const planRes = await dbRun(
      `INSERT INTO sales_plans (emp_code, emp_name, period_month, cycle_code, status, emp_role, required_approver_role)
       VALUES (?, ?, ?, ?, 'DRAFT', 'SO', 'ASM')`,
      [testEmpCode, 'Test Officer DJP', testMonth, testCycle]
    );
    const planId = planRes.insertId || planRes.lastID;
    console.log(`[1] Created simulated DJP Engine Plan #${planId} for ${testEmpCode}`);

    // Insert 3 initial DJP visits
    const initialVisits = [
      { date: '2026-11-03', sap: 'DJP_DLR_01', name: 'DJP Dealer One', seq: 1 },
      { date: '2026-11-04', sap: 'DJP_DLR_02', name: 'DJP Dealer Two', seq: 1 },
      { date: '2026-11-05', sap: 'DJP_DLR_03', name: 'DJP Dealer Three', seq: 1 }
    ];

    for (const iv of initialVisits) {
      await dbRun(
        `INSERT INTO sales_plan_details (plan_id, visit_date, dealer_sap_code, dealer_name, sequence)
         VALUES (?, ?, ?, ?, ?)`,
        [planId, iv.date, iv.sap, iv.name, iv.seq]
      );
    }

    const djpVisitsBefore = await dbAll('SELECT * FROM sales_plan_details WHERE plan_id = ? ORDER BY visit_date', [planId]);
    assert.strictEqual(djpVisitsBefore.length, 3, 'Initial DJP visits count must be 3');
    console.log(`[2] Successfully populated 3 DJP Engine visits in sales_plan_details.`);

    // 3. Officer submits their plan with:
    //    - 1 duplicate visit (already in DJP plan on 2026-11-03)
    //    - 2 brand new visits (2026-11-06 and 2026-11-07)
    //    - submitDirectly = true
    console.log(`[3] Officer submits plan with 2 new visits and 1 existing duplicate...`);

    const mockReq = {
      params: { empCode: testEmpCode },
      body: {
        periodMonth: testMonth,
        cycleCode: testCycle,
        role: 'SO',
        submitDirectly: true,
        remarks: 'Officer submitting custom additional visits',
        visits: [
          { visitDate: '2026-11-03', dealerSapCode: 'DJP_DLR_01', dealerName: 'DJP Dealer One', purposeOfVisit: 'Duplicate visit attempt' },
          { visitDate: '2026-11-06', dealerSapCode: 'OFFICER_DLR_04', dealerName: 'Officer Dealer Four', purposeOfVisit: 'Market Expansion' },
          { visitDate: '2026-11-07', dealerSapCode: 'OFFICER_DLR_05', dealerName: 'Officer Dealer Five', purposeOfVisit: 'Counter Review' }
        ]
      }
    };

    let responseData = null;
    let responseStatus = 200;
    const mockRes = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    await createOfficerPlan(mockReq, mockRes);

    assert.strictEqual(responseStatus, 200, `createOfficerPlan should return 200. Got: ${responseStatus} ${JSON.stringify(responseData)}`);
    assert(responseData && responseData.success === true, 'Response must be success: true');
    console.log(`[4] createOfficerPlan response:`, responseData);

    // 4. Verify visits in database
    const visitsAfter = await dbAll(
      'SELECT id, visit_date, dealer_sap_code, dealer_name, source, visit_status, sequence FROM sales_plan_details WHERE plan_id = ? ORDER BY visit_date, sequence',
      [planId]
    );

    console.log('\n[5] Visits currently in sales_plan_details:');
    visitsAfter.forEach(v => {
      const dStr = v.visit_date instanceof Date ? v.visit_date.toISOString().slice(0, 10) : String(v.visit_date).slice(0, 10);
      console.log(`    - Date: ${dStr} | Code: ${v.dealer_sap_code} | Name: ${v.dealer_name} | Source: ${v.source} | Seq: ${v.sequence}`);
    });

    // Check that original DJP visits are STILL PRESENT and NOT deleted
    const djpRemaining = visitsAfter.filter(v => v.dealer_sap_code.startsWith('DJP_DLR_'));
    assert.strictEqual(djpRemaining.length, 3, 'ALL 3 original DJP engine visits must be preserved!');

    // Check that officer visits were ADDED
    const officerAdded = visitsAfter.filter(v => v.dealer_sap_code.startsWith('OFFICER_DLR_'));
    assert.strictEqual(officerAdded.length, 2, 'Exactly 2 new officer visits must be added!');

    // Check total count: 3 DJP + 2 officer = 5 total (no duplicate for DJP_DLR_01 on 2026-11-03)
    assert.strictEqual(visitsAfter.length, 5, 'Total visits in plan must be exactly 5!');
    assert.strictEqual(responseData.added_visits, 2, 'responseData.added_visits must be 2');
    assert.strictEqual(responseData.skipped_duplicates, 1, 'responseData.skipped_duplicates must be 1');
    assert.strictEqual(responseData.total_visits, 5, 'responseData.total_visits must be 5');

    // Check plan status updated to SUBMITTED
    const updatedPlan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
    assert.strictEqual(updatedPlan.status, 'SUBMITTED', 'Plan status must be SUBMITTED');
    assert(updatedPlan.submitted_at, 'Plan submitted_at must be set');

    console.log('\n[6] SUCCESS: DJP engine visits were preserved, officer visits were appended without duplicates, and plan status was updated.');

    // 5. Test empty visits submission: submitting an existing DJP plan without new visits
    console.log('\n[7] Testing submitting existing plan with empty visits array...');
    const emptySubmitReq = {
      params: { empCode: testEmpCode },
      body: {
        periodMonth: testMonth,
        cycleCode: testCycle,
        role: 'SO',
        submitDirectly: true,
        visits: []
      }
    };
    let emptySubmitData = null;
    const emptySubmitRes = {
      status(code) { return this; },
      json(data) { emptySubmitData = data; return this; }
    };
    await createOfficerPlan(emptySubmitReq, emptySubmitRes);

    assert(emptySubmitData && emptySubmitData.success === true, 'Empty submit must succeed');
    const finalVisits = await dbAll('SELECT COUNT(*) as n FROM sales_plan_details WHERE plan_id = ?', [planId]);
    assert.strictEqual(Number(finalVisits[0].n), 5, 'Visits count must remain 5 and NOT be deleted');
    console.log(`[8] Empty submit preserved all 5 visits cleanly!`);

    // 6. Cleanup test records
    await dbRun('DELETE FROM sales_plan_details WHERE plan_id = ?', [planId]);
    await dbRun('DELETE FROM plan_approvals WHERE plan_id = ?', [planId]);
    await dbRun('DELETE FROM sales_plans WHERE id = ?', [planId]);
    console.log('[9] Cleanup completed successfully.\n');
    console.log('=== ALL TESTS PASSED! ===');
    process.exit(0);
  } catch (err) {
    console.error('TEST FAILED:', err);
    process.exit(1);
  }
}

runTest();

