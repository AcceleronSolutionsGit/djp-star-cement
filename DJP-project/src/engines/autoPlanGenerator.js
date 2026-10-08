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
        exclude2ndSaturday: rules.hol_2nd_sat !== 'false',
        exclude4thSaturday: rules.hol_4th_sat !== 'false'
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
    const sql = `
      SELECT 
        dvt.id as target_id,
        dvt.dealer_id,
        dvt.dealer_name,
        COALESCE(dvt.sap_code, md.sap_code) as sap_code,
        COALESCE(dvt.sfa_code, md.sfa_code) as sfa_code,
        md.dealer_type,
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
      WHERE (dvt.${codeField} = ? OR dvt.${roleField} = ? OR dvt.${roleField} LIKE ?)
        AND dvt.period_month = ?
        AND dvt.${visitCol} > 0
      ORDER BY md.block ASC, dvt.category ASC, dvt.dealer_name ASC
    `;

    const rawRows = await dbAll(sql, [empCode, empCode, `%${empCode}%`, targetPeriod]);

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
          dealer_code: d.sap_code || d.sfa_code || `DLR_${d.dealer_id}`
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
    const planRes = await dbRun(
      `INSERT INTO sales_plans (emp_code, emp_name, period_month, cycle_code, status, emp_role) VALUES (?, ?, ?, ?, 'PENDING_ROLLOUT', ?)`,
      [empCode, empName, periodMonth, cycleCode, resolvedRole]
    );
    const planId = planRes.insertId || planRes.lastID;

    // Distribute visits across working days with daily capacity & same-dealer-same-day rule
    const dayAllocations = new Map();
    for (const dStr of workingDays) {
      dayAllocations.set(dStr, []);
    }

    let dayIndex = 0;
    const workingDateList = workingDays;

    for (const item of visitItems) {
      let placed = false;
      let attempts = 0;

      // Pass 1: find working day with capacity < effectiveDailyCapacity AND no same dealer
      while (!placed && attempts < workingDateList.length) {
        const currentDate = workingDateList[dayIndex];
        const dayVisits = dayAllocations.get(currentDate);

        const hasSameDealer = dayVisits.some(v => v.dealer_code === item.dealer_code || (item.dealer_id && v.dealer_id === item.dealer_id));

        if (dayVisits.length < effectiveDailyCapacity && !hasSameDealer) {
          dayVisits.push(item);
          placed = true;
        }

        dayIndex = (dayIndex + 1) % workingDateList.length;
        attempts++;
      }

      // Pass 2: if not placed due to cycle rotation, search all days strictly respecting no-same-dealer and hard cap of 8
      if (!placed) {
        for (const dDate of workingDateList) {
          const dayVisits = dayAllocations.get(dDate);
          const hasSameDealer = dayVisits.some(v => v.dealer_code === item.dealer_code || (item.dealer_id && v.dealer_id === item.dealer_id));
          if (dayVisits.length < 8 && !hasSameDealer) {
            dayVisits.push(item);
            placed = true;
            break;
          }
        }
      }
    }

    // Insert scheduled details into sales_plan_details and djp_recommendations
    let totalScheduled = 0;
    for (const [vDate, visits] of dayAllocations.entries()) {
      let seq = 1;
      for (const item of visits) {
        await dbRun(
          `INSERT INTO sales_plan_details 
           (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            planId,
            vDate,
            item.dealer_id,
            item.sap_code || item.sfa_code,
            item.dealer_name,
            item.dealer_type || 'DEALER',
            `PJP Scheduled Visit (${item.grade || 'A'} - ${item.final_category || 'Routine'})`,
            seq++
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
      periodMonth,
      cycleCode,
      totalDealers: targetDealers.length,
      totalVisitsScheduled: totalScheduled,
      workingDaysCount: workingDays.length,
      missedFromC1: missedDealerCodes.size,
      message: `Plan generated for ${empName} (${resolvedRole}) [${cycleCode}] — ${totalScheduled} visits scheduled across ${workingDays.length} working days in ${periodMonth}${
        missedDealerCodes.size > 0 ? ` (${missedDealerCodes.size} missed C1 dealers prioritised)` : ''
      }.`
    };
  }
}
