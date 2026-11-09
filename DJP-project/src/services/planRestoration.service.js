/**
 * Plan Restoration Service
 * 
 * Recovers and restores missing DJP algorithmic visits for any plan
 * where officer submission or manual edits previously removed/overrode DJP engine visits.
 * 
 * Rules:
 * - NEVER deletes or modifies visits already submitted by the officer.
 * - Restores algorithmic visits from dealer_visit_targets based on canonical PJP rules.
 * - Prevents duplicate visits on the same date for the same dealer.
 * - Preserves existing plan status (e.g. SUBMITTED, APPROVED), approval history, and routing.
 */

import { dbAll, dbRun, dbGet } from '../config/database.js';
import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';
import { getWorkingDays } from '../engines/pjp/calendar.engine.js';
import { getCoordinatesForDealers } from './customerCoordinates.service.js';
import { clusterAndScheduleHeuristicRoutes } from '../engines/heuristicRouting.engine.js';

function toDateStr(d) {
  if (!d) return '';
  if (d instanceof Date) {
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${yr}-${mo}-${da}`;
  }
  return String(d).trim().slice(0, 10);
}

/**
 * Restores DJP engine visits for a specific plan.
 */
export async function restorePlanDjpVisits(planId) {
  const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
  if (!plan) throw new Error(`Plan #${planId} not found.`);

  const generator = new AutoPlanGenerator();
  const rules = await generator.loadRules();

  const empCode = plan.emp_code;
  const role = plan.emp_role || 'SO';
  const periodMonth = plan.period_month;
  const cycleCode = plan.cycle_code || 'C1';

  // Fetch targets for this employee
  const targetDealers = await generator.fetchEmployeeTargetDealers(empCode, role, periodMonth, cycleCode);
  if (!targetDealers || targetDealers.length === 0) {
    return { planId, empCode, restored: 0, reason: 'No dealer targets found for this employee/period' };
  }

  // Fetch existing visits in sales_plan_details
  const existingVisits = await dbAll(
    'SELECT id, visit_date, dealer_id, dealer_sap_code, dealer_name, source, sequence FROM sales_plan_details WHERE plan_id = ?',
    [planId]
  );

  const existingKeys = new Set();
  const maxSeqByDate = new Map();

  for (const ev of existingVisits) {
    const dStr = toDateStr(ev.visit_date);
    const sap = String(ev.dealer_sap_code || '').trim().toUpperCase();
    const name = String(ev.dealer_name || '').trim().toUpperCase();
    const id = ev.dealer_id ? String(ev.dealer_id) : '';

    if (sap) existingKeys.add(`${dStr}#SAP#${sap}`);
    if (id) existingKeys.add(`${dStr}#ID#${id}`);
    if (name) existingKeys.add(`${dStr}#NAME#${name}`);

    const curSeq = Number(ev.sequence) || 0;
    const curMax = maxSeqByDate.get(dStr) || 0;
    if (curSeq > curMax) maxSeqByDate.set(dStr, curSeq);
  }

  // Determine working days and daily capacity
  const isC1 = cycleCode === 'C1';
  const cycleStart = isC1 ? rules.cycleConfig.c1StartDay : rules.cycleConfig.c2StartDay;
  const cycleEnd = isC1 ? rules.cycleConfig.c1EndDay : rules.cycleConfig.c2EndDay;

  const workingDays = getWorkingDays(periodMonth, cycleStart, cycleEnd, rules.calendarOptions);
  if (workingDays.length === 0) {
    return { planId, empCode, restored: 0, reason: 'No working days in cycle' };
  }

  let effectiveDailyCapacity = rules.soCapacity;
  if (role === 'ASM') effectiveDailyCapacity = rules.asmCapacity;
  else if (role === 'RSM') effectiveDailyCapacity = rules.rsmCapacity;
  else if (role === 'ZH') effectiveDailyCapacity = Math.max(1, Math.ceil(rules.zhMonthlyCapacity / 2 / workingDays.length));

  const visitItems = [];
  let halfVisitCounter = 0;

  for (const d of targetDealers) {
    const freq = d.required_visits;
    let count = 0;
    if (freq >= 1) {
      count = Math.round(freq);
    } else if (freq > 0 && freq < 1) {
      halfVisitCounter++;
      if (cycleCode === 'C1' ? (halfVisitCounter % 2 === 1) : (halfVisitCounter % 2 === 0)) {
        count = 1;
      } else if (targetDealers.length <= 2) {
        count = 1;
      }
    }

    for (let v = 0; v < count; v++) {
      visitItems.push({
        ...d,
        visit_instance: v + 1,
        total_instances: count,
        dealer_code: d.sap_code || d.sfa_code || (d.dealer_id ? `DLR_${d.dealer_id}` : `TGT_${d.target_id}`)
      });
    }
  }

  visitItems.sort((a, b) => {
    const blockA = a.block || a.area || '';
    const blockB = b.block || b.area || '';
    if (blockA !== blockB) return blockA.localeCompare(blockB);
    return (b.priority_score || 0) - (a.priority_score || 0);
  });

  const dealerCodes = [];
  for (const d of visitItems) {
    if (d.sap_code) dealerCodes.push(d.sap_code);
    if (d.sfa_code) dealerCodes.push(d.sfa_code);
    if (d.dealer_code) dealerCodes.push(d.dealer_code);
  }
  let coordsMap = new Map();
  try {
    coordsMap = await getCoordinatesForDealers(dealerCodes);
  } catch (e) {}

  const { dayAllocations } = clusterAndScheduleHeuristicRoutes(
    visitItems,
    workingDays,
    effectiveDailyCapacity,
    coordsMap
  );

  let restoredCount = 0;
  for (const [vDate, visits] of dayAllocations.entries()) {
    const vDateStr = toDateStr(vDate);
    for (const item of visits) {
      const sap = item.sap_code || item.sfa_code || null;
      const sapKey = sap ? `${vDateStr}#SAP#${String(sap).trim().toUpperCase()}` : null;
      const idKey = item.dealer_id ? `${vDateStr}#ID#${item.dealer_id}` : null;
      const nameKey = item.dealer_name ? `${vDateStr}#NAME#${String(item.dealer_name).trim().toUpperCase()}` : null;

      const alreadyExists = (sapKey && existingKeys.has(sapKey)) ||
                            (idKey && existingKeys.has(idKey)) ||
                            (nameKey && existingKeys.has(nameKey));

      if (alreadyExists) continue;

      const nextSeq = (maxSeqByDate.get(vDateStr) || 0) + 1;
      maxSeqByDate.set(vDateStr, nextSeq);

      await dbRun(
        `INSERT INTO sales_plan_details 
         (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, latitude, longitude, distance_from_prev_km, route_name, source, visit_status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DJP_ENGINE', 'ACTIVE')`,
        [
          planId,
          vDateStr,
          item.dealer_id || null,
          sap,
          item.dealer_name,
          item.dealer_type || 'DEALER',
          `PJP Scheduled Visit (${item.grade || 'A'} - ${item.final_category || 'Routine'})`,
          nextSeq,
          item.latitude || null,
          item.longitude || null,
          item.distance_from_prev_km || 0,
          item.route_name || null
        ]
      );

      if (sapKey) existingKeys.add(sapKey);
      if (idKey) existingKeys.add(idKey);
      if (nameKey) existingKeys.add(nameKey);
      restoredCount++;
    }
  }

  const finalTotal = await dbGet('SELECT COUNT(*) as n FROM sales_plan_details WHERE plan_id = ?', [planId]);

  return {
    planId,
    empCode,
    empName: plan.emp_name,
    periodMonth,
    cycleCode,
    status: plan.status,
    previouslyExistingVisits: existingVisits.length,
    restoredDjpVisits: restoredCount,
    totalVisitsNow: Number(finalTotal?.n || 0)
  };
}

/**
 * Scans all plans in sales_plans (or for specific period/cycle/empCode)
 * and restores any missing DJP visits.
 */
export async function restoreOverriddenPlans({ periodMonth, cycleCode, empCode, forceAll = false } = {}) {
  let query = 'SELECT sp.id, sp.emp_code, sp.emp_name, sp.emp_role, sp.period_month, sp.cycle_code, sp.status FROM sales_plans sp WHERE 1=1';
  const params = [];

  if (periodMonth) {
    query += ' AND sp.period_month = ?';
    params.push(periodMonth);
  }
  if (cycleCode && cycleCode !== 'ALL') {
    query += ' AND sp.cycle_code = ?';
    params.push(cycleCode);
  }
  if (empCode && empCode !== 'ALL') {
    query += ' AND sp.emp_code = ?';
    params.push(empCode);
  }

  const plans = await dbAll(query, params);
  const results = [];

  for (const plan of plans) {
    // Check visit composition
    const counts = await dbGet(
      `SELECT 
         COUNT(*) as total_cnt,
         SUM(IF(source = 'OFFICER', 1, 0)) as officer_cnt,
         SUM(IF(source = 'DJP_ENGINE' OR source IS NULL, 1, 0)) as engine_cnt
       FROM sales_plan_details 
       WHERE plan_id = ?`,
      [plan.id]
    );

    const totalCnt = Number(counts?.total_cnt || 0);
    const officerCnt = Number(counts?.officer_cnt || 0);
    const engineCnt = Number(counts?.engine_cnt || 0);

    // Overridden criteria:
    // 1. Plan has only officer visits and 0 DJP engine visits (classic override symptom)
    // 2. Or total visits is 0
    // 3. Or forceAll is true
    const isOverridden = forceAll || (officerCnt > 0 && engineCnt === 0) || totalCnt === 0;

    if (isOverridden) {
      console.log(`[Restoration] Plan #${plan.id} (${plan.emp_code} - ${plan.emp_name}) was overridden (Officer: ${officerCnt}, DJP: ${engineCnt}). Restoring...`);
      try {
        const res = await restorePlanDjpVisits(plan.id);
        results.push(res);
      } catch (err) {
        console.error(`[Restoration] Failed for plan #${plan.id}:`, err.message);
        results.push({ planId: plan.id, empCode: plan.emp_code, error: err.message });
      }
    }
  }

  return results;
}

