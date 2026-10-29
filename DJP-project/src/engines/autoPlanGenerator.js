/**
 * Multi-Role Auto Plan Generator Engine
 * 
 * Generates date-wise dealer visit plans independently for:
 * 1. SO / SE
 * 2. ASM
 * 3. RSM
 * 4. Zonal Head (ZH)
 * 
 * Rules:
 * - PJP is the source of truth (reads dealer_visit_targets, never recalculates categories/grades/frequencies).
 * - Real employee codes/names (no synthetic prefixes).
 * - Respects working days calendar (Sundays, 2nd/4th Saturdays, holidays).
 * - Enforces daily capacity limits per role.
 * - Handles 0.5 fractional frequency with proper cadence without Math.ceil() inflation.
 * - Geographically balances dealer routes across days.
 */

import { dbAll, dbRun, dbGet } from '../config/database.js';
import { getWorkingDays } from './pjp/calendar.engine.js';
import { getAdherenceForEmployee } from './sfa-adherence.engine.js';
import { resolveEmployeeName } from '../services/planRouting.service.js';
import { getCoordinatesForDealers } from '../services/customerCoordinates.service.js';
import { clusterAndScheduleHeuristicRoutes } from './heuristicRouting.engine.js';

export class AutoPlanGenerator {
  /**
   * Load capacity and calendar rules from database.
   */
  async loadRules() {
    const rows = await dbAll(
      `SELECT rule_key, rule_value FROM business_rules 
       WHERE rule_key LIKE 'daily_visit_capacity%' 
          OR rule_key LIKE 'monthly_visit_capacity%' 
          OR rule_key LIKE 'c%_day' 
          OR rule_key LIKE 'hol_%'`
    );
    const rules = {};
    for (const r of rows) rules[r.rule_key] = r.rule_value;

    return {
      soCapacity: parseInt(rules.daily_visit_capacity || '8', 10),
      asmCapacity: parseInt(rules.daily_visit_capacity_asm || '5', 10),
      rsmCapacity: parseInt(rules.daily_visit_capacity_rsm || '3', 10),
      zhMonthlyCapacity: parseInt(rules.monthly_visit_capacity_zh || '20', 10),
      cycleConfig: {
        c1StartDay: parseInt(rules.c1_start_day || '1', 10),
        c1EndDay: parseInt(rules.c1_end_day || '15', 10),
        c2StartDay: parseInt(rules.c2_start_day || '16', 10),
        c2EndDay: parseInt(rules.c2_end_day || '31', 10)
      },
      calendarOptions: {
        excludeSundays: true,
        exclude2ndSaturday: rules.all_saturdays_working === '0' || rules.hol_2nd_sat === 'true',
        exclude4thSaturday: rules.all_saturdays_working === '0' || rules.hol_4th_sat === 'true'
      }
    };
  }

  /**
   * Determine employee role and fetch assigned dealers with PJP visit frequencies.
   */
  async fetchEmployeeTargetDealers(empCode, role, periodMonth, cycleCode = 'C1') {
    // Check dealer_visit_targets for this employee across roles
    let roleField = 'so_name';
    let codeField = 'so_emp_code';
    let visitCol = 'so_visits';

    if (role === 'ASM') {
      roleField = 'asm_name';
      codeField = 'asm_code';
      visitCol = 'asm_visits';
    } else if (role === 'RSM') {
      roleField = 'rsm_name';
      // FIX: was 'rsm_name'. The caller passes rsm_CODE (see generatePlansForAllRoles),
      // so matching it against the name column found nothing and every RSM plan came
      // back empty — no sales_plans row was ever created for an RSM.
      codeField = 'rsm_code';
      visitCol = 'rsm_visits';
    } else if (role === 'ZH') {
      roleField = 'zh_name';
      // FIX: was 'zh_name'. Same defect as RSM above.
      codeField = 'zh_code';
      visitCol = 'zh_visits';
    }

    // 1. Resolve canonical target period in dealer_visit_targets
    let targetPeriod = periodMonth;
    const periodCheck = await dbGet(
      `SELECT COUNT(*) as cnt FROM dealer_visit_targets WHERE period_month = ? AND ${visitCol} > 0`,
      [periodMonth]
    );

    if (!periodCheck || periodCheck.cnt === 0) {
      const latestPeriod = await dbGet(
        `SELECT period_month FROM dealer_visit_targets WHERE ${visitCol} > 0 ORDER BY period_month DESC LIMIT 1`
      );
      if (latestPeriod && latestPeriod.period_month) {
        targetPeriod = latestPeriod.period_month;
      }
    }

    // 2. Fetch targets strictly for targetPeriod and cycleCode (or latest run)
    // Enriches dealer_name and dealer_type (DEALER vs RSAR vs PROSPECTIVE) matching SFA coordinates master
    const sql = `
      SELECT 
        dvt.id as target_id,
        dvt.dealer_id,
        COALESCE(NULLIF(mcc.customer_name, ''), NULLIF(md.dealer_name, ''), dvt.dealer_name) as dealer_name,
        COALESCE(dvt.sap_code, md.sap_code, mcc.customer_code) as sap_code,
        COALESCE(dvt.sfa_code, md.sfa_code, mcc.dns_customer_code) as sfa_code,
        CASE 
          WHEN mcc.customer_type = 'Sub Dealer' OR mcc.customer_type LIKE '%Sub%' 
               OR md.dealer_type = 'RSAR' 
               OR (md.linked_dealer_code IS NOT NULL AND md.linked_dealer_code != '' AND md.linked_dealer_code != '-')
               OR (md.rssd_code IS NOT NULL AND md.rssd_code != '' AND md.rssd_code != '-')
               OR dvt.dealer_status LIKE '%Sub%' THEN 'RSAR'
          WHEN mcc.customer_type IN ('Dealer', 'Exclusive Dealer') 
               OR md.dealer_type IN ('DEALER', 'STAR') THEN 'DEALER'
          WHEN mcc.customer_type = 'Non Star' OR md.dealer_type = 'PROSPECTIVE' THEN 'PROSPECTIVE'
          ELSE COALESCE(NULLIF(md.dealer_type, ''), 'DEALER')
        END as dealer_type,
        dvt.area,
        md.block,
        dvt.zone,
        dvt.category as grade,
        dvt.dealer_status as final_category,
        dvt.so_name,
        dvt.so_emp_code,
        dvt.asm_name,
        dvt.rsm_name,
        dvt.zh_name,
        dvt.priority as priority_score,
        dvt.${visitCol} as required_visits
      FROM dealer_visit_targets dvt
      LEFT JOIN master_dealers md ON dvt.dealer_id = md.id
      LEFT JOIN master_customer_coordinates mcc ON (
        (md.sfa_code IS NOT NULL AND mcc.dns_customer_code = md.sfa_code) OR
        (md.sap_code IS NOT NULL AND (mcc.dns_customer_code = md.sap_code OR mcc.customer_code = md.sap_code)) OR
        (dvt.sap_code IS NOT NULL AND (mcc.dns_customer_code = dvt.sap_code OR mcc.customer_code = dvt.sap_code)) OR
        (dvt.sfa_code IS NOT NULL AND mcc.dns_customer_code = dvt.sfa_code)
      )
      WHERE (dvt.${codeField} = ? OR dvt.${roleField} = ? OR dvt.${roleField} LIKE ?)
        AND dvt.period_month = ?
        AND (dvt.cycle_code = ? OR dvt.cycle_code IS NULL OR dvt.cycle_code = '')
        AND dvt.${visitCol} > 0
      ORDER BY md.block ASC, dvt.category ASC, dvt.dealer_name ASC
    `;

    const rawRows = await dbAll(sql, [empCode, empCode, `%${empCode}%`, targetPeriod, cycleCode]);

    // 3. Strict Deduplication by canonical dealer identity
    const uniqueDealers = new Map();
    for (const r of rawRows) {
      const canonicalKey = r.sap_code || r.sfa_code || (r.dealer_name ? r.dealer_name.trim().toUpperCase() : `DLR_${r.dealer_id}`);
      if (!uniqueDealers.has(canonicalKey)) {
        uniqueDealers.set(canonicalKey, {
          ...r,
          required_visits: parseFloat(r.required_visits) || 0
        });
      }
    }

    return Array.from(uniqueDealers.values());
  }

  /**
   * Generates a date-wise multi-role dealer plan for a specific employee and period.
   * 
   * @param {string} empCode - Employee code or name
   * @param {string} periodMonth - YYYY-MM
   * @param {string} role - 'SO' | 'ASM' | 'RSM' | 'ZH'
   * @param {string} cycleCode - 'C1' | 'C2'
   * @param {Object} options
   * @param {Map}   [options.sfaAdherenceByEmployee] - adherence map from analyseC1Adherence() for C2 regen
   */
  async generatePlan(empCode, periodMonth, role = 'SO', cycleCode = 'C1', options = {}) {
    if (!empCode || String(empCode).trim() === '' || ['-', 'NA', 'N/A', 'NONE', 'NULL'].includes(String(empCode).trim().toUpperCase())) {
      console.warn(`[AutoPlanGen] Rejecting plan generation for invalid/dummy employee code: "${empCode}"`);
      return { planId: null, totalVisitsScheduled: 0 };
    }

    const rules = await this.loadRules();

    // Resolve employee name and role.
    //
    // The Dealer Mapping importer only writes master_employees rows for SO and ASM,
    // so an RSM or ZH has no record there. This used to fall straight back to the
    // employee CODE, which is why those plans showed an id where a name belongs.
    // resolveEmployeeName() reads the hierarchy, which carries names for all four roles.
    const empRecord = await dbGet(
      `SELECT * FROM master_employees WHERE emp_code = ? OR emp_name = ?`,
      [empCode, empCode]
    );

    let empName = empRecord?.emp_name || null;
    if (!empName) {
      const resolved = await resolveEmployeeName(empCode, role);
      empName = resolved.name;
      if (empName) {
        console.log(`[AutoPlanGen] Name for ${empCode} resolved from ${resolved.source}: ${empName}`);
      } else {
        console.warn(
          `[AutoPlanGen] No name found for ${empCode} (${role}) in master_employees or the ` +
          `Dealer / SO Mapping — the plan will show the code. Check that this employee appears ` +
          `in the mapping file.`
        );
        empName = empCode;
      }
    }

    const resolvedRole = role || empRecord?.role || empRecord?.designation || 'SO';

    // Determine capacity limit for role (Strict Hard Cap: Max 8 visits/day)
    let dailyCapacity = rules.soCapacity;
    if (resolvedRole === 'ASM') dailyCapacity = rules.asmCapacity;
    else if (resolvedRole === 'RSM') dailyCapacity = rules.rsmCapacity;
    else if (resolvedRole === 'ZH') dailyCapacity = Math.max(1, Math.ceil(rules.zhMonthlyCapacity / 12));

    // Strict business rule: Max 8 visits to different customers per day
    const effectiveDailyCapacity = Math.min(dailyCapacity, 8);

    // Get Working Days from calendar engine
    const workingDays = getWorkingDays(periodMonth, cycleCode, rules.cycleConfig, rules.calendarOptions);
    if (workingDays.length === 0) {
      throw new Error(`No working days available in calendar for ${periodMonth} cycle ${cycleCode}.`);
    }

    // Fetch target dealers from PJP visit frequencies
    const targetDealers = await this.fetchEmployeeTargetDealers(empCode, resolvedRole, periodMonth, cycleCode);
    if (!targetDealers || targetDealers.length === 0) {
      return {
        success: true,
        message: `No PJP visit targets required for ${empName} (${resolvedRole}) in ${periodMonth}.`,
        planId: null,
        totalDealers: 0,
        totalVisits: 0
      };
    }

    // Build list of visit instances to schedule
    // Handles 0.5 fractional frequency with proper cadence without Math.ceil() inflation.
    // For C2 regen with SFA adherence: boost missed C1 dealers to the front.
    const { sfaAdherenceByEmployee } = options;
    let visitedDealerCodes = new Set();
    let missedDealerCodes  = new Set();

    if (sfaAdherenceByEmployee && cycleCode === 'C2') {
      const adherence = getAdherenceForEmployee(sfaAdherenceByEmployee, empCode);
      visitedDealerCodes = adherence.visitedDealerCodes;
      missedDealerCodes  = adherence.missedDealerCodes;
    }
    const visitItems = [];
    let halfVisitCounter = 0;

    for (const d of targetDealers) {
      const freq = d.required_visits;
      let count = 0;

      if (freq >= 1) {
        count = Math.round(freq);
      } else if (freq > 0 && freq < 1) {
        // 0.5 Cadence: allocate in cycle C1 for odd index, or allocate 1 visit
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

    // Group visits geographically by Block/Area for route continuity.
    // For C2 with SFA adherence: missed C1 dealers sort first (priority boost).
    visitItems.sort((a, b) => {
      const aCode = (a.sap_code || a.sfa_code || `DLR_${a.dealer_id}` || '').toUpperCase();
      const bCode = (b.sap_code || b.sfa_code || `DLR_${b.dealer_id}` || '').toUpperCase();

      // Missed dealers in C1 → sort to front of C2 schedule
      if (cycleCode === 'C2' && missedDealerCodes.size > 0) {
        const aMissed = missedDealerCodes.has(aCode);
        const bMissed = missedDealerCodes.has(bCode);
        if (aMissed && !bMissed) return -1;
        if (!aMissed && bMissed) return 1;
      }

      const blockA = a.block || a.area || '';
      const blockB = b.block || b.area || '';
      if (blockA !== blockB) return blockA.localeCompare(blockB);
      return (b.priority_score || 0) - (a.priority_score || 0);
    });

    // Delete only the specific cycle's plan for this employee+period (not both cycles)
    await dbRun(
      `DELETE FROM sales_plan_details
       WHERE plan_id IN (
         SELECT id FROM sales_plans
         WHERE emp_code = ? AND period_month = ? AND cycle_code = ?
       )`,
      [empCode, periodMonth, cycleCode]
    );
    await dbRun(
      `DELETE FROM sales_plans WHERE emp_code = ? AND period_month = ? AND cycle_code = ?`,
      [empCode, periodMonth, cycleCode]
    );

    // emp_role is persisted here so the app can route the plan to the right L1
    // approver. Without it every plan defaulted to 'SO' and an ASM's own plan
    // was routed back to an ASM for approval.
    // DJP batch pipeline runs create plans with PENDING_ROLLOUT so Admin can review and rollout.
    // Individually added / generated plans start directly as DRAFT so they route to superior officer without Admin rollout.
    const initialStatus = (options.isDjpPipeline || options.status === 'PENDING_ROLLOUT')
      ? 'PENDING_ROLLOUT'
      : (options.status || 'DRAFT');

    const planRes = await dbRun(
      `INSERT INTO sales_plans (emp_code, emp_name, period_month, cycle_code, status, emp_role) VALUES (?, ?, ?, ?, ?, ?)`,
      [empCode, empName, periodMonth, cycleCode, initialStatus, resolvedRole]
    );
    const planId = planRes.insertId || planRes.lastID;

    // Load customer coordinates for all target dealers (include both SAP code and SFA code)
    const dealerCodes = [];
    for (const d of visitItems) {
      if (d.sap_code) dealerCodes.push(d.sap_code);
      if (d.sfa_code) dealerCodes.push(d.sfa_code);
      if (d.dealer_code) dealerCodes.push(d.dealer_code);
    }
    let coordsMap = new Map();
    try {
      coordsMap = await getCoordinatesForDealers(dealerCodes);
    } catch (coordErr) {
      console.warn(`[AutoPlanGen] Warning loading coordinates for ${empCode}:`, coordErr.message);
    }

    // Heuristic Route Map Clustering and Daily Scheduling
    const { dayAllocations, dayRouteMaps, unallocated } = clusterAndScheduleHeuristicRoutes(
      visitItems,
      workingDays,
      effectiveDailyCapacity,
      coordsMap
    );

    // Insert scheduled details into sales_plan_details with route sequences and coordinates
    let totalScheduled = 0;
    let totalDistanceKm = 0;

    for (const [vDate, visits] of dayAllocations.entries()) {
      const dayRoute = dayRouteMaps.get(vDate);
      if (dayRoute) totalDistanceKm += (dayRoute.totalDistanceKm || 0);

      for (const item of visits) {
        await dbRun(
          `INSERT INTO sales_plan_details 
           (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, latitude, longitude, distance_from_prev_km, route_name) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            planId,
            vDate,
            item.dealer_id,
            item.sap_code || item.sfa_code,
            item.dealer_name,
            item.dealer_type || 'DEALER',
            `PJP Scheduled Visit (${item.grade || 'A'} - ${item.final_category || 'Routine'})`,
            item.sequence || 1,
            item.latitude || null,
            item.longitude || null,
            item.distance_from_prev_km || 0,
            item.route_name || null
          ]
        );
        totalScheduled++;
      }
    }

    return {
      success: true,
      planId,
      empCode,
      empName,
      role: resolvedRole,
      status: initialStatus,
      periodMonth,
      cycleCode,
      totalDealers: targetDealers.length,
      totalVisitsScheduled: totalScheduled,
      totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
      unallocatedCount: unallocated.length,
      workingDaysCount: workingDays.length,
      missedFromC1: missedDealerCodes.size,
      message: `Plan generated for ${empName} (${resolvedRole}) [${cycleCode}] — ${totalScheduled} visits scheduled across ${workingDays.length} working days in ${periodMonth} (~${Math.round(totalDistanceKm)} km heuristic route)${
        missedDealerCodes.size > 0 ? ` (${missedDealerCodes.size} missed C1 dealers prioritised)` : ''
      }.`
    };
  }
}
