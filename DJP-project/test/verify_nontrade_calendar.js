/**
 * Test Suite: Non-Trade Dedicated Red Plan Calendar
 * Verifies backend API endpoints, role filtering, staff filtering, bucket filtering,
 * execution matching, and date navigation.
 */

const BASE_URL = 'http://127.0.0.1:3001/api';

async function runTests() {
  console.log('====================================================');
  console.log('   NON-TRADE RED PLAN CALENDAR VERIFICATION');
  console.log('====================================================\n');

  let passed = 0;
  let total = 0;

  async function assertTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`  ✓ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✗ [FAIL] ${name}: ${err.message}`);
    }
  }

  // 1. Default Calendar (September 2026 - Officer)
  await assertTest('GET /api/nontrade/calendar returns September 2026 Officer calendar', async () => {
    const res = await fetch(`${BASE_URL}/nontrade/calendar?periodMonth=2026-09`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.periodMonth !== '2026-09') throw new Error(`Expected periodMonth 2026-09, got ${data.periodMonth}`);
    if (data.year !== 2026) throw new Error(`Expected year 2026, got ${data.year}`);
    if (data.month !== 9) throw new Error(`Expected month 9, got ${data.month}`);
    if (data.monthName !== 'September') throw new Error(`Expected monthName September, got ${data.monthName}`);
    if (data.daysInMonth !== 30) throw new Error(`Expected 30 days, got ${data.daysInMonth}`);
    if (data.totalVisits !== 577) throw new Error(`Expected 577 visits for Officer, got ${data.totalVisits}`);
    if (data.activeDays !== 26) throw new Error(`Expected 26 active days, got ${data.activeDays}`);
    if (data.officers?.length !== 8) throw new Error(`Expected 8 officers, got ${data.officers?.length}`);
    if (Object.keys(data.days || {}).length !== 30) throw new Error(`Expected 30 calendar days, got ${Object.keys(data.days).length}`);
  });

  // 2. Day Data Structure & SFA Execution Matching
  await assertTest('Calendar day cell structure includes visit details & SFA execution info', async () => {
    const res = await fetch(`${BASE_URL}/nontrade/calendar?periodMonth=2026-09`);
    const data = await res.json();
    const day1 = data.days['2026-09-01'];

    if (!day1) throw new Error('Missing day 2026-09-01');
    if (day1.dayNumber !== 1) throw new Error(`Expected dayNumber 1, got ${day1.dayNumber}`);
    if (day1.visitCount <= 0) throw new Error(`Expected visits on 2026-09-01, got ${day1.visitCount}`);
    if (!Array.isArray(day1.visits) || day1.visits.length !== day1.visitCount) {
      throw new Error('Day visits array does not match visitCount');
    }

    const firstVisit = day1.visits[0];
    if (!firstVisit.party_name) throw new Error('Missing party_name on visit');
    if (!firstVisit.sap_code) throw new Error('Missing sap_code on visit');
    if (!firstVisit.ship_to_party) throw new Error('Missing ship_to_party on visit');
    if (firstVisit.executed === undefined) throw new Error('Missing executed flag');

    // Find any day with executed visit
    let foundExec = false;
    for (const d of Object.values(data.days)) {
      const exec = d.visits.find(v => v.executed);
      if (exec) {
        foundExec = true;
        if (!exec.execution || !exec.execution.visit_status) {
          throw new Error('Executed visit missing execution object or visit_status');
        }
        break;
      }
    }
    if (!foundExec) throw new Error('No executed visits found in 2026-09');
  });

  // 3. ASM Role Filter
  await assertTest('GET /api/nontrade/calendar?roleType=ASM returns 203 ASM visits', async () => {
    const res = await fetch(`${BASE_URL}/nontrade/calendar?periodMonth=2026-09&roleType=ASM`);
    const data = await res.json();
    if (data.totalVisits !== 203) throw new Error(`Expected 203 ASM visits, got ${data.totalVisits}`);
    if (data.activeDays !== 25) throw new Error(`Expected 25 active days, got ${data.activeDays}`);
    if (data.officers?.length !== 3) throw new Error(`Expected 3 ASMs, got ${data.officers?.length}`);
  });

  // 4. HOS Role Filter
  await assertTest('GET /api/nontrade/calendar?roleType=HOS returns 48 HOS visits', async () => {
    const res = await fetch(`${BASE_URL}/nontrade/calendar?periodMonth=2026-09&roleType=HOS`);
    const data = await res.json();
    if (data.totalVisits !== 48) throw new Error(`Expected 48 HOS visits, got ${data.totalVisits}`);
    if (data.activeDays !== 13) throw new Error(`Expected 13 active days, got ${data.activeDays}`);
  });

  // 5. ALL Roles Filter
  await assertTest('GET /api/nontrade/calendar?roleType=ALL returns all 828 visits across roles', async () => {
    const res = await fetch(`${BASE_URL}/nontrade/calendar?periodMonth=2026-09&roleType=ALL`);
    const data = await res.json();
    if (data.totalVisits !== 828) throw new Error(`Expected 828 visits, got ${data.totalVisits}`);
    if (data.officers?.length !== 14) throw new Error(`Expected 14 staff members, got ${data.officers?.length}`);
  });

  // 6. Officer Specific Filter (Debajit Mitra - 2500288)
  await assertTest('GET /api/nontrade/calendar?empCode=2500288 filters to Debajit Mitra (93 visits)', async () => {
    const res = await fetch(`${BASE_URL}/nontrade/calendar?periodMonth=2026-09&empCode=2500288`);
    const data = await res.json();
    if (data.totalVisits !== 93) throw new Error(`Expected 93 visits, got ${data.totalVisits}`);
    if (data.activeDays !== 23) throw new Error(`Expected 23 active days, got ${data.activeDays}`);
    if (data.officers[0]?.emp_code !== '2500288') throw new Error('First officer not 2500288');
  });

  // 7. Bucket Filter (Zero-lifter)
  await assertTest('GET /api/nontrade/calendar?bucket=Zero-lifter filters visits to Zero-lifter counters', async () => {
    const res = await fetch(`${BASE_URL}/nontrade/calendar?periodMonth=2026-09&bucket=Zero-lifter`);
    const data = await res.json();
    if (data.totalVisits !== 148) throw new Error(`Expected 148 Zero-lifter visits, got ${data.totalVisits}`);
    // Check that all visits on all days belong to Zero-lifter
    for (const d of Object.values(data.days)) {
      for (const v of d.visits) {
        if (v.bucket !== 'Zero-lifter') {
          throw new Error(`Unexpected bucket ${v.bucket} in Zero-lifter filtered calendar`);
        }
      }
    }
  });

  // 8. Month Navigation / Period Selector (October 2026)
  await assertTest('GET /api/nontrade/calendar?periodMonth=2026-10 handles 31-day month navigation', async () => {
    const res = await fetch(`${BASE_URL}/nontrade/calendar?periodMonth=2026-10`);
    const data = await res.json();
    if (data.year !== 2026 || data.month !== 10) throw new Error('Incorrect year/month for October 2026');
    if (data.daysInMonth !== 31) throw new Error(`Expected 31 days in October, got ${data.daysInMonth}`);
    if (Object.keys(data.days).length !== 31) throw new Error('Calendar days object count mismatch');
  });

  console.log('\n====================================================');
  console.log(`   CALENDAR VERIFICATION RESULT: ${passed}/${total} PASSED`);
  console.log('====================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests();

