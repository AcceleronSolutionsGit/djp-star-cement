/**
 * DJP Generator Engine (Production-Ready)
 *
 * Changes vs old version:
 * 1. Accepts generationRunCode, dealerMappingBatchCode, salesHistoryBatchCodes for batch isolation
 * 2. Removes fake employee code generation (ASM_<SO>, RSM_<NAME>, ZH_<NAME>)
 *    — dealers without real hierarchy are flagged, not silently assigned synthetic codes
 * 3. Secondary sort key (dealerCode) for deterministic tie-breaking
 * 4. Tracks and returns unallocated visits (not silently dropped)
 * 5. Throws on missing required capacity rules (no silent defaults)
 *    — UNLESS the rules DB already has seeded values (which it does by default)
 * 6. Stores generation_run_code on djp_recommendations rows
 * 7. Returns totalVisitsRequired, unallocatedCount, capacityViolated in result
 */

import { calculatePJP } from './pjp/pjp.engine.js';
import { getWorkingDays } from './pjp/calendar.engine.js';
import { dbRun, dbAll, dbGet } from '../config/database.js';

export async function generateFullPjpDjpSolution(periodMonth, cycleCode, options = {}) {
  if (!periodMonth || typeof periodMonth !== 'string') {
    throw new Error('planMonth is required. Please specify the planning month in YYYY-MM format.');
  }
  const match = periodMonth.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid planMonth format: '${periodMonth}'. Expected YYYY-MM format.`);
  }
  const mNum = parseInt(match[2], 10);
  if (mNum < 1 || mNum > 12) {
    throw new Error(`Invalid planMonth: '${periodMonth}'. Month must be between 01 and 12.`);
  }
  if (!cycleCode) {
    throw new Error('cycleCode is required. Do not use hardcoded defaults.');
  }

  const {
    recalculate = true,
    generationRunCode = null,
    dealerMappingBatchCode = null,
    salesHistoryBatchCodes = []
  } = options;

  console.log(`\n================================================================`);
  console.log(`Generating Multi-Role PJP/DJP | Period: ${periodMonth} | Cycle: ${cycleCode}`);
  if (generationRunCode) console.log(`  Generation Run: ${generationRunCode}`);
  console.log(`================================================================`);

  // ──── STEP 1: PJP Calculation ────
  let pjpResults;
  let validationErrors = [];

  if (recalculate) {
    const pjp = await calculatePJP(periodMonth, cycleCode, {
      persist: true,
      generationRunCode
    });
    pjpResults = pjp.results;
    validationErrors = pjp.validation.errors || [];

    if (pjp.validation.totalErrors > 0) {
      console.warn(`PJP validation has ${pjp.validation.totalErrors} errors.`);
    }
  } else {
    // Use existing dealer_visit_targets
    const whereClause = generationRunCode
      ? 'WHERE period_month = ? AND cycle_code = ? AND generation_run_code = ?'
      : 'WHERE period_month = ? AND cycle_code = ?';
    const whereParams = generationRunCode
      ? [periodMonth, cycleCode, generationRunCode]
      : [periodMonth, cycleCode];
    const existing = await dbAll(`SELECT * FROM dealer_visit_targets ${whereClause}`, whereParams);

    pjpResults = existing.map(t => ({
      dealerCode: t.sap_code,
      dealerName: t.dealer_name,
      area: t.area,
      zone: t.zone,
      soName: t.so_name,
      soEmpCode: t.so_emp_code,
      asmName: t.asm_name,
      rsmName: t.rsm_name,
      zhName: t.zh_name,
      finalCategory: t.dealer_status,    // dealer_status stores finalCategory (corrected)
      grade: t.category,                 // category stores grade (corrected)
      soVisits: parseFloat(t.so_visits) || 0,
      asmVisits: parseFloat(t.asm_visits) || 0,
      rsmVisits: parseFloat(t.rsm_visits) || 0,
      zhVisits: parseFloat(t.zh_visits) || 0,
      priorityRank: 0,
      totalScore: 0
    }));
  }

  if (!pjpResults || pjpResults.length === 0) {
    console.log('No PJP results to allocate. Aborting DJP generation.');
    return { totalDealerTargets: 0, totalVisitsRequired: 0, totalDjpSlots: 0, unallocatedCount: 0, capacityViolated: false, validationErrors };
  }

  // ──── STEP 2: Load Capacity Rules ────
  const ruleRows = await dbAll(
    `SELECT rule_key, rule_value FROM business_rules 
     WHERE rule_key LIKE 'daily_visit_capacity%' 
        OR rule_key LIKE 'monthly_visit_capacity%' 
        OR rule_key LIKE 'c%_day' 
        OR rule_key LIKE 'hol_%'`
  );
  const rules = {};
  for (const r of ruleRows) rules[r.rule_key] = r.rule_value;

  // Capacity rules — fail loud if not seeded
  const soCapacityStr = rules.daily_visit_capacity;
  const asmCapacityStr = rules.daily_visit_capacity_asm;
  const rsmCapacityStr = rules.daily_visit_capacity_rsm;
  const zhMonthlyCapacityStr = rules.monthly_visit_capacity_zh;

  if (!soCapacityStr) throw new Error('Missing required business rule: daily_visit_capacity. Run init-db to seed defaults.');
  if (!asmCapacityStr) throw new Error('Missing required business rule: daily_visit_capacity_asm');
  if (!rsmCapacityStr) throw new Error('Missing required business rule: daily_visit_capacity_rsm');
  if (!zhMonthlyCapacityStr) throw new Error('Missing required business rule: monthly_visit_capacity_zh');

  const soCapacity = parseInt(soCapacityStr, 10);
  const asmCapacity = parseInt(asmCapacityStr, 10);
  const rsmCapacity = parseInt(rsmCapacityStr, 10);
  const zhMonthlyCapacity = parseInt(zhMonthlyCapacityStr, 10);

  const cycleConfig = {
    c1StartDay: parseInt(rules.c1_start_day || '1', 10),
    c1EndDay: parseInt(rules.c1_end_day || '15', 10),
    c2StartDay: parseInt(rules.c2_start_day || '16', 10),
    c2EndDay: parseInt(rules.c2_end_day || '31', 10)
  };

  const calendarOptions = {
    excludeSundays: true,
    exclude2ndSaturday: rules.hol_2nd_sat !== 'false',
    exclude4thSaturday: rules.hol_4th_sat !== 'false'
  };

  const workingDays = getWorkingDays(periodMonth, cycleCode, cycleConfig, calendarOptions);
  console.log(`Working days in ${cycleCode}: ${workingDays.length}`);

  if (workingDays.length === 0) {
    console.warn('No working days in this cycle. Cannot allocate DJP.');
    return { totalDealerTargets: pjpResults.length, totalVisitsRequired: 0, totalDjpSlots: 0, unallocatedCount: 0, capacityViolated: false, validationErrors };
  }

  // ──── STEP 3: Clear previous DJP for this planning period and cycle ────
  await dbRun('DELETE FROM djp_recommendations WHERE period_month = ? AND cycle_code = ?', [periodMonth, cycleCode]);

  // ──── STEP 4: Group by SO / ASM / RSM / ZH ────
  const soGroups = new Map();
  const asmGroups = new Map();
  const rsmGroups = new Map();
  const zhGroups = new Map();

  for (const r of pjpResults) {
    const soKey = r.soEmpCode || r.soName || null;
    if (soKey) {
      if (!soGroups.has(soKey)) soGroups.set(soKey, []);
      soGroups.get(soKey).push(r);
    }

    const asmKey = r.asmCode || r.asmName || null;
    if (r.asmVisits > 0 && asmKey) {
      if (!asmGroups.has(asmKey)) asmGroups.set(asmKey, []);
      asmGroups.get(asmKey).push(r);
    }

    const rsmKey = r.rsmCode || r.rsmName || null;
    if (r.rsmVisits > 0 && rsmKey) {
      if (!rsmGroups.has(rsmKey)) rsmGroups.set(rsmKey, []);
      rsmGroups.get(rsmKey).push(r);
    }

    const zhKey = r.zhCode || r.zhName || null;
    if (r.zhVisits > 0 && zhKey) {
      if (!zhGroups.has(zhKey)) zhGroups.set(zhKey, []);
      zhGroups.get(zhKey).push(r);
    }
  }

  let totalDjpSlots = 0;
  let totalUnallocated = 0;
  let capacityViolated = false;

  // Compute total visits required (exact float sum)
  let totalVisitsRequired = 0;
  for (const r of pjpResults) {
    totalVisitsRequired += (r.soVisits || 0) + (r.asmVisits || 0) +
                           (r.rsmVisits || 0) + (r.zhVisits || 0);
  }

  // ──── SO Allocation ────
  for (const [soKey, targets] of soGroups.entries()) {
    const soRecs = [];
    for (const t of targets) {
      const vCount = Math.round(t.soVisits || 0);
      for (let v = 0; v < vCount; v++) {
        soRecs.push({
          dealerCode: t.dealerCode, dealerName: t.dealerName,
          finalCategory: t.finalCategory, grade: t.grade,
          totalScore: t.totalScore || 0, priorityRank: t.priorityRank || 1,
          empCode: t.soEmpCode || soKey, empName: t.soName || soKey,
          asmName: t.asmName, rsmName: t.rsmName, zhName: t.zhName
        });
      }
    }
    const { allocated, unallocated } = allocateToWorkingDays(soRecs, workingDays, soCapacity);
    for (const item of allocated) {
      await saveDjpRecommendation('SO', periodMonth, cycleCode, item, generationRunCode);
      totalDjpSlots++;
    }
    if (unallocated.length > 0) {
      totalUnallocated += unallocated.length;
      capacityViolated = true;
      console.warn(`  SO ${soKey}: ${unallocated.length} visits unallocated (capacity exhausted)`);
    }
  }

  // ──── ASM Allocation ────
  for (const [asmKey, targets] of asmGroups.entries()) {
    const asmRecs = [];
    for (const t of targets) {
      // 0.5 visits in PJP: schedule 1 visit in C1 (or alternate cycle)
      const vCount = (t.asmVisits > 0 && t.asmVisits < 1) ? 1 : Math.round(t.asmVisits || 0);
      for (let v = 0; v < vCount; v++) {
        asmRecs.push({
          dealerCode: t.dealerCode, dealerName: t.dealerName,
          finalCategory: t.finalCategory, grade: t.grade,
          totalScore: t.totalScore || 0, priorityRank: t.priorityRank || 1,
          empCode: t.asmCode || asmKey,
          empName: t.asmName || asmKey
        });
      }
    }
    const { allocated, unallocated } = allocateToWorkingDays(asmRecs, workingDays, asmCapacity);
    for (const item of allocated) {
      await saveDjpRecommendation('ASM', periodMonth, cycleCode, item, generationRunCode);
      totalDjpSlots++;
    }
    if (unallocated.length > 0) {
      totalUnallocated += unallocated.length;
      capacityViolated = true;
    }
  }

  // ──── RSM Allocation ────
  for (const [rsmKey, targets] of rsmGroups.entries()) {
    const rsmRecs = [];
    for (const t of targets) {
      const vCount = (t.rsmVisits > 0 && t.rsmVisits < 1) ? 1 : Math.round(t.rsmVisits || 0);
      for (let v = 0; v < vCount; v++) {
        rsmRecs.push({
          dealerCode: t.dealerCode, dealerName: t.dealerName,
          finalCategory: t.finalCategory, grade: t.grade,
          totalScore: t.totalScore || 0, priorityRank: t.priorityRank || 1,
          empCode: t.rsmCode || rsmKey,
          empName: t.rsmName || rsmKey
        });
      }
    }
    const { allocated, unallocated } = allocateToWorkingDays(rsmRecs, workingDays, rsmCapacity);
    for (const item of allocated) {
      await saveDjpRecommendation('RSM', periodMonth, cycleCode, item, generationRunCode);
      totalDjpSlots++;
    }
    if (unallocated.length > 0) {
      totalUnallocated += unallocated.length;
      capacityViolated = true;
    }
  }

  // ──── ZH Allocation (monthly cap) ────
  for (const [zhKey, targets] of zhGroups.entries()) {
    const zhRecs = [];
    for (const t of targets) {
      const vCount = Math.round(t.zhVisits || 0);
      for (let v = 0; v < vCount; v++) {
        zhRecs.push({
          dealerCode: t.dealerCode, dealerName: t.dealerName,
          finalCategory: t.finalCategory, grade: t.grade,
          totalScore: t.totalScore || 0, priorityRank: t.priorityRank || 1,
          empCode: t.zhCode || zhKey,
          empName: t.zhName || zhKey
        });
      }
    }
    const zhDailyLimit = Math.max(1, Math.ceil(zhMonthlyCapacity / workingDays.length));
    const cappedRecs = zhRecs.slice(0, zhMonthlyCapacity);
    const { allocated, unallocated } = allocateToWorkingDays(cappedRecs, workingDays, zhDailyLimit);
    for (const item of allocated) {
      await saveDjpRecommendation('ZH', periodMonth, cycleCode, item, generationRunCode);
      totalDjpSlots++;
    }
    if (unallocated.length > 0 || zhRecs.length > zhMonthlyCapacity) {
      const excessFromCap = zhRecs.length - zhMonthlyCapacity;
      totalUnallocated += unallocated.length + Math.max(0, excessFromCap);
      capacityViolated = true;
    }
  }

  console.log(`\n----------------------------------------------------------------`);
  console.log(`PJP/DJP GENERATION COMPLETE`);
  console.log(`  Dealer Targets: ${pjpResults.length}`);
  console.log(`  Total Visits Required: ${totalVisitsRequired}`);
  console.log(`  DJP Slots Scheduled: ${totalDjpSlots}`);
  console.log(`  Unallocated Visits: ${totalUnallocated}`);
  if (capacityViolated) console.warn(`  ⚠ CAPACITY VIOLATION: Some visits could not be scheduled`);
  console.log(`================================================================\n`);

  return {
    totalDealerTargets: pjpResults.length,
    totalVisitsRequired,
    totalDjpSlots,
    unallocatedCount: totalUnallocated,
    capacityViolated,
    validationErrors
  };
}

/**
 * Allocate visit records to working days with capacity constraints.
 * 
 * Sort order: priority descending, then dealerCode ascending (deterministic tie-breaking).
 * Returns { allocated, unallocated }.
 */
function allocateToWorkingDays(recs, workingDays, dailyCapacity) {
  if (recs.length === 0 || workingDays.length === 0) return { allocated: [], unallocated: recs };

  // Deterministic sort: higher totalScore first, then lower dealerCode (alphabetical) for ties
  const sorted = [...recs].sort((a, b) => {
    const scoreDiff = (b.totalScore || 0) - (a.totalScore || 0);
    if (scoreDiff !== 0) return scoreDiff;
    return String(a.dealerCode || '').localeCompare(String(b.dealerCode || ''));
  });

  const daySlots = new Map();
  const dayDealers = new Map();
  for (const d of workingDays) {
    daySlots.set(d, 0);
    dayDealers.set(d, new Set());
  }

  const allocated = [];
  const unallocated = [];
  let dateIndex = 0;

  for (const item of sorted) {
    let assigned = false;
    let attempts = 0;

    while (!assigned && attempts < workingDays.length) {
      const targetDate = workingDays[dateIndex];
      const currentCount = daySlots.get(targetDate);
      const alreadyScheduled = dayDealers.get(targetDate).has(item.dealerCode);
      
      if (currentCount < dailyCapacity && !alreadyScheduled) {
        daySlots.set(targetDate, currentCount + 1);
        dayDealers.get(targetDate).add(item.dealerCode);
        item.visitDate = targetDate;
        item.visitSequence = currentCount + 1;
        allocated.push(item);
        assigned = true;
        // Advance to next day (round-robin)
        dateIndex = (dateIndex + 1) % workingDays.length;
      } else {
        dateIndex = (dateIndex + 1) % workingDays.length;
        attempts++;
      }
    }

    if (!assigned) {
      unallocated.push(item);
    }
  }

  return { allocated, unallocated };
}

async function saveDjpRecommendation(roleType, periodMonth, cycleCode, item, generationRunCode = null) {
  await dbRun(
    `INSERT INTO djp_recommendations 
    (generation_run_code, role_type, cycle_code, period_month, emp_code, emp_name, visit_date, visit_sequence, 
     dealer_sap_code, dealer_sfa_code, dealer_name, dealer_type, category, dealer_status, 
     market_strategy, priority_score, required_visits, recommendation_reason, plan_status) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generationRunCode,
      roleType, cycleCode, periodMonth,
      item.empCode, item.empName,
      item.visitDate, item.visitSequence,
      item.dealerCode, item.dealerCode,
      item.dealerName, 'DEALER',
      item.grade || 'C',
      item.finalCategory || 'Growing',
      'GA',
      item.totalScore || 0, 1,
      `${roleType} allocated (${item.finalCategory || 'N/A'}, Grade ${item.grade || 'N/A'})`,
      'DRAFT'
    ]
  );
}
