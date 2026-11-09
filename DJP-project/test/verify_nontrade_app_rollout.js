import assert from 'assert';
import { dbAll, dbGet, dbRun } from '../src/config/database.js';
import {
  rolloutNonTradePlans,
  getNonTradeRolloutStatus,
  getNonTradeOfficerPlanSummaries,
  getNonTradePlanDetail,
  recordNonTradeVisitPunch,
  calculateNonTradeAdherence
} from '../src/services/nontrade.service.js';

const BASE_URL = 'http://127.0.0.1:3001/api';

async function fetchJson(endpoint, options = {}) {
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok, data };
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('  NON-TRADE FIELD APP & ROLLOUT — COMPREHENSIVE VERIFICATION SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ PASS [${total}]: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL [${total}]: ${name}`);
      console.error(`    ${err.message}`);
    }
  }

  // Reset plans to PENDING_ROLLOUT initially to test rollout transition
  await dbRun("UPDATE nontrade_plans SET status = 'PENDING_ROLLOUT' WHERE period_month = '2026-09'");
  await dbRun("UPDATE nontrade_ho_plans SET status = 'PENDING_ROLLOUT' WHERE period_month = '2026-09'");

  // ── TEST 1: Check Non-Trade Rollout Status ────────────────────────────────────
  await test('Rollout status endpoint returns counts of pending vs rolled out', async () => {
    const { status, ok, data } = await fetchJson('/nontrade/plans/rollout-status?periodMonth=2026-09');
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    assert.ok(data.totalCounters > 0, `Expected totalCounters > 0, got ${data.totalCounters}`);
    console.log(`    Status: Total=${data.totalCounters}, Pending=${data.pendingRollout}, RolledOut=${data.rolledOut}`);
  });

  // ── TEST 2: Roll out Non-Trade plans via PUT endpoint ────────────────────────
  await test('PUT /api/nontrade/plans/rollout successfully rolls out plans to Field App', async () => {
    const { status, ok, data } = await fetchJson('/nontrade/plans/rollout', {
      method: 'PUT',
      body: JSON.stringify({ periodMonth: '2026-09' })
    });
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    assert.strictEqual(data.success, true);
    assert.ok(data.updatedPlans >= 0, `Expected updatedPlans >= 0, got ${data.updatedPlans}`);

    // Verify in database that status is ROLLED_OUT
    const rolledRows = await dbAll(
      "SELECT status, COUNT(*) as c FROM nontrade_plans WHERE period_month = '2026-09' GROUP BY status"
    );
    const hasRolled = rolledRows.some(r => r.status === 'ROLLED_OUT');
    assert.ok(hasRolled, 'Database records should reflect ROLLED_OUT status');
    console.log(`    Rollout response: ${data.message} (${data.updatedPlans} records updated)`);
  });

  // ── TEST 3: Admin Plan Periods includes Non-Trade period (2026-09) ───────────
  await test('GET /api/app/admin/plan-periods includes Non-Trade month 2026-09', async () => {
    const { status, ok, data } = await fetchJson('/app/admin/plan-periods');
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    assert.ok(data.periods && data.periods.length > 0, 'Should return periods');

    const sep = data.periods.find(p => p.month === '2026-09');
    assert.ok(sep, '2026-09 should be present in periods list');
    assert.ok(sep.officers >= 8, `Expected at least 8 Non-Trade officers, got ${sep.officers}`);
    console.log(`    Period 2026-09 found: ${sep.officers} officers, ${sep.plans} plans`);
  });

  // ── TEST 4: All Plans List contains Non-Trade officers ───────────────────────
  await test('GET /api/app/admin/plans?month=2026-09 lists Non-Trade officers for Simulator', async () => {
    const { status, ok, data } = await fetchJson('/app/admin/plans?month=2026-09');
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    assert.ok(data.plans && data.plans.length > 0, 'Plans list should not be empty');

    const debajit = data.plans.find(p => p.employee?.emp_code === '2500288');
    assert.ok(debajit, 'Debajit Mitra (2500288) should be in plans list');
    assert.strictEqual(debajit.channel, 'NON_TRADE');
    assert.strictEqual(debajit.counts.visits, 93);
    assert.strictEqual(debajit.approver.name, 'DEBASHISH DEY');

    const monjyoti = data.plans.find(p => p.employee?.emp_code === '11001465');
    assert.ok(monjyoti, 'Monjyoti Kalita (11001465) should be in plans list');
    assert.strictEqual(monjyoti.counts.visits, 76);
    console.log(`    Found officers: Debajit Mitra (${debajit.counts.visits} visits), Monjyoti Kalita (${monjyoti.counts.visits} visits)`);
  });

  // ── TEST 5: Officer Plans API returns Non-Trade monthly plan ─────────────────
  await test('GET /api/app/officers/:empCode/plans returns Non-Trade plan', async () => {
    const { status, ok, data } = await fetchJson('/app/officers/2500288/plans?month=2026-09');
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    assert.strictEqual(data.emp_code, '2500288');
    assert.strictEqual(data.emp_name, 'DEBAJIT MITRA');
    assert.ok(data.plans && data.plans.length > 0, 'Should have at least 1 plan');

    const p = data.plans[0];
    assert.strictEqual(p.plan_id, 'NT-2500288-2026-09');
    assert.strictEqual(p.period_month, '2026-09');
    assert.strictEqual(p.channel, 'NON_TRADE');
    assert.strictEqual(p.status, 'APPROVED');
    assert.strictEqual(p.approver.emp_code, '1100160');
    console.log(`    Officer plan: ${p.plan_id}, Status: ${p.status}, Approver: ${p.approver.name}`);
  });

  // ── TEST 6: Day-by-Day Plan Calendar with dealer cards and punch state ───────
  await test('GET /api/app/officers/:empCode/plans/:planId returns day-by-day calendar', async () => {
    const { status, ok, data } = await fetchJson('/app/officers/2500288/plans/NT-2500288-2026-09');
    assert.strictEqual(status, 200, `Expected 200, got ${status}`);
    assert.ok(data.plan, 'Should return plan object');

    const plan = data.plan;
    assert.strictEqual(plan.plan_id, 'NT-2500288-2026-09');
    assert.ok(plan.days && plan.days.length > 0, `Expected days > 0, got ${plan.days.length}`);
    assert.ok(plan.category_mix, 'Expected category_mix');

    // Check first day and visits
    const day1 = plan.days[0];
    assert.ok(day1.visit_date, 'Day should have visit_date');
    assert.ok(day1.visits && day1.visits.length > 0, 'Day should have scheduled visits');

    const v1 = day1.visits[0];
    assert.ok(v1.dealer.name, 'Visit should have dealer name');
    assert.ok(v1.dealer.type, 'Visit should have dealer type/bucket');
    assert.ok(typeof v1.executed === 'boolean', 'Visit should have executed boolean');
    console.log(`    Day-by-day plan: ${plan.days.length} working days, ${plan.counts.visits} total visits`);
    console.log(`    Sample visit on ${day1.visit_date}: ${v1.dealer.name} (${v1.dealer.type}) - Executed: ${v1.executed}`);
  });

  // ── TEST 7: Visit Punching in Field App ──────────────────────────────────────
  await test('POST /api/app/officers/:empCode/visits/punch records visit and updates plan state', async () => {
    // Find an unexecuted visit from Debajit Mitra's plan
    const { data: detailData } = await fetchJson('/app/officers/2500288/plans/NT-2500288-2026-09');
    const day = detailData.plan.days.find(d => d.visits.some(v => !v.executed));
    assert.ok(day, 'Should find at least one day with an unexecuted visit');
    const targetVisit = day.visits.find(v => !v.executed);
    assert.ok(targetVisit, 'Target visit should be found');

    const punchPayload = {
      visitDate: day.visit_date,
      dealerCode: targetVisit.dealer.sfa_code || targetVisit.dealer.sap_code,
      checkInTime: '11:15',
      checkOutTime: '11:45',
      visitStatus: 'Productive',
      purposeOfVisit: 'App Rollout Verification Punch',
      remarks: 'Automated test visit execution'
    };

    const { status, ok, data } = await fetchJson('/app/officers/2500288/visits/punch', {
      method: 'POST',
      body: JSON.stringify(punchPayload)
    });

    assert.strictEqual(status, 201, `Expected 201 Created, got ${status}`);
    assert.strictEqual(data.planned, true, 'Visit should be recognized as planned');
    assert.strictEqual(data.channel, 'NON_TRADE');
    console.log(`    Punch response: ${data.message} (Status: ${data.sfa_row['Visit Status(Productive / Non productive)']})`);

    // Re-fetch plan detail and verify the visit is now marked executed!
    const { data: refreshedData } = await fetchJson('/app/officers/2500288/plans/NT-2500288-2026-09');
    const refreshedDay = refreshedData.plan.days.find(d => d.visit_date === day.visit_date);
    const refreshedVisit = refreshedDay.visits.find(v => (v.dealer.sfa_code === targetVisit.dealer.sfa_code || v.dealer.sap_code === targetVisit.dealer.sap_code));
    assert.ok(refreshedVisit, 'Refreshed visit must exist');
    assert.strictEqual(refreshedVisit.executed, true, 'Visit should now be marked executed = true');
    assert.ok(refreshedVisit.execution, 'Execution details should be populated');
    console.log(`    Verified execution on plan: executed=${refreshedVisit.executed}, check_in=${refreshedVisit.execution.check_in_time}`);
  });

  // ── TEST 8: Manager Review & Team Adherence ──────────────────────────────────
  await test('Approver APIs return team adherence and manager inbox for Non-Trade', async () => {
    // Debashish Dey (1100160) is ASM managing Debajit Mitra and Preetam Karmakar
    const { status: teamStatus, data: teamData } = await fetchJson('/app/approvers/1100160/team-adherence?month=2026-09');
    assert.strictEqual(teamStatus, 200, `Expected 200, got ${teamStatus}`);
    assert.ok(teamData.team && teamData.team.length >= 2, `Expected at least 2 team members, got ${teamData.team?.length}`);

    const debajitInTeam = teamData.team.find(t => t.emp_code === '2500288');
    assert.ok(debajitInTeam, 'Debajit Mitra should appear in Debashish Deys team');
    assert.ok(debajitInTeam.planned_visits > 0, `Expected planned_visits > 0, got ${debajitInTeam.planned_visits}`);
    assert.ok(debajitInTeam.adhered > 0, `Expected adhered > 0, got ${debajitInTeam.adhered}`);

    // Manager Inbox
    const { status: inboxStatus, data: inboxData } = await fetchJson('/app/approvers/1100160/inbox?month=2026-09');
    assert.strictEqual(inboxStatus, 200, `Expected 200, got ${inboxStatus}`);
    assert.ok(inboxData.plans && inboxData.plans.length > 0, 'Manager inbox should have subordinate plans');

    console.log(`    Manager Team: ${teamData.approver.name} has ${teamData.count} subordinates`);
    console.log(`    Debajit Mitra in team: planned=${debajitInTeam.planned_visits}, adhered=${debajitInTeam.adhered}, adh%=${debajitInTeam.capped_pct}%`);
  });

  // Cleanup test punch records created during verification
  await dbRun("DELETE FROM nontrade_customer_visit_reports WHERE remarks = 'Automated test visit execution'");
  await dbRun("DELETE FROM visit_execution_logs WHERE remarks = 'Automated test visit execution'");

  console.log('\n================================================================');
  console.log(`  VERIFICATION RESULTS: ${passed} / ${total} TESTS PASSED (${Math.round((passed / total) * 100)}%)`);
  console.log('================================================================\n');

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
