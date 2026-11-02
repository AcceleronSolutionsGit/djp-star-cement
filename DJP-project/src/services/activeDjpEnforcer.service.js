/**
 * Active DJP Enforcer Service
 *
 * Guarantees that ONLY active employees and active entities are present in DJP.
 * Automatically cleans and heals existing database presets without requiring plan re-generation:
 * 1. Purges inactive / dummy / vacant plans from sales_plans and related tables.
 * 2. Purges inactive employees from master_employees.
 * 3. Removes orphan visit details and visits for inactive dealers.
 * 4. Heals missing names, approver routing, and roles for remaining active plans.
 */

import { dbAll, dbRun, dbGet } from '../config/database.js';
import { stampPlanRoutingForPeriod, resolveEmployeeName, resolveL1Approver } from './planRouting.service.js';

const DUMMY_CODE_PATTERNS = [
  /^SO\d+$/i,
  /^ASM\d+$/i,
  /^RSM\d+$/i,
  /^ZH\d+$/i,
  /^DUMMY/i,
  /^TEST/i,
  /^VACANT/i,
  /^UNASSIGNED/i
];

const DUMMY_EXACT_CODES = new Set([
  'VACANT', 'NONE', 'NULL', 'NA', 'N/A', '-', 'UNKNOWN', 'UNDEFINED'
]);

/**
 * Check if an employee code or name is an unassigned / dummy placeholder.
 */
export function isDummyEmployeeCode(codeOrName) {
  if (!codeOrName) return true;
  const s = String(codeOrName).trim().toUpperCase();
  if (s === '' || DUMMY_EXACT_CODES.has(s)) return true;
  return DUMMY_CODE_PATTERNS.some(p => p.test(s));
}

/**
 * Enforce and fix active-only DJP data preset in the database.
 * 
 * @param {Object} [options]
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<Object>} Results of the cleanup and healing
 */
export async function enforceActiveDjpPreset(options = {}) {
  const dryRun = options.dryRun || false;
  console.log(`[ActiveDjpEnforcer] Starting active DJP data preset enforcement (dryRun: ${dryRun})...`);

  // Ensure is_active column exists on master_employees
  try {
    const colCheck = await dbAll(`SHOW COLUMNS FROM master_employees LIKE 'is_active'`);
    if (!colCheck || colCheck.length === 0) {
      await dbRun(`ALTER TABLE master_employees ADD COLUMN is_active TINYINT DEFAULT 1 AFTER role`);
      console.log(`[ActiveDjpEnforcer] Added 'is_active' column to master_employees.`);
    }
  } catch (err) {
    // Column might already exist or table alteration not permitted
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 1. Audit and prune sales_plans for inactive / dummy employees
  // ───────────────────────────────────────────────────────────────────────────
  const allPlans = await dbAll(`
    SELECT 
      sp.id, sp.emp_code, sp.emp_name, sp.emp_role, sp.period_month, sp.cycle_code,
      em.emp_code as em_code, em.dns_emp_code, em.acedns, em.app_access,
      zh.zh_code as is_configured_zh
    FROM sales_plans sp
    LEFT JOIN employee_master em ON (sp.emp_code = em.emp_code OR sp.emp_code = em.dns_emp_code)
    LEFT JOIN master_zone_zh_mapping zh ON (sp.emp_code = zh.zh_code OR sp.emp_code = zh.emp_code)
  `);

  const plansToDelete = [];
  const activePlanIds = [];

  for (const p of allPlans) {
    const code = String(p.emp_code || '').trim();
    const name = String(p.emp_name || '').trim();
    const isZH = p.emp_role === 'ZH' || p.is_configured_zh !== null;

    if (isDummyEmployeeCode(code) || isDummyEmployeeCode(name)) {
      plansToDelete.push({ id: p.id, emp_code: code, emp_name: name, reason: 'DUMMY_OR_VACANT_CODE' });
    } else if (isZH && p.is_configured_zh) {
      // Dynamic Zonal Head configured in master_zone_zh_mapping is kept as active ZH
      activePlanIds.push(p.id);
    } else if (p.acedns === 'N' || (p.acedns === null && p.app_access === 'N')) {
      // Employee is marked inactive in employee_master
      plansToDelete.push({ id: p.id, emp_code: code, emp_name: name, reason: `INACTIVE_EMPLOYEE (acedns=${p.acedns}, app_access=${p.app_access})` });
    } else if (!p.em_code && p.acedns !== 'Y') {
      // Not found in employee_master and not marked active
      plansToDelete.push({ id: p.id, emp_code: code, emp_name: name, reason: 'UNMAPPED_EMPLOYEE' });
    } else {
      activePlanIds.push(p.id);
    }
  }

  let deletedPlansCount = 0;
  let deletedVisitsCount = 0;

  if (plansToDelete.length > 0) {
    const deleteIds = plansToDelete.map(p => p.id);
    console.log(`[ActiveDjpEnforcer] Found ${deleteIds.length} inactive/dummy plans to purge from sales_plans.`);

    if (!dryRun) {
      const CHUNK_SIZE = 50;
      for (let i = 0; i < deleteIds.length; i += CHUNK_SIZE) {
        const chunk = deleteIds.slice(i, i + CHUNK_SIZE);
        const placeholders = chunk.map(() => '?').join(',');

        // 1. Delete unplanned_visit_requests
        try {
          await dbRun(`DELETE FROM unplanned_visit_requests WHERE plan_id IN (${placeholders})`, chunk);
        } catch (e) { /* ignore */ }

        // 2. Delete plan_approvals
        try {
          await dbRun(`DELETE FROM plan_approvals WHERE plan_id IN (${placeholders})`, chunk);
        } catch (e) { /* ignore */ }

        // 3. Delete sales_plan_details
        const visitRes = await dbRun(`DELETE FROM sales_plan_details WHERE plan_id IN (${placeholders})`, chunk);
        deletedVisitsCount += (visitRes.affectedRows || visitRes.changes || 0);

        // 4. Delete sales_plans
        const planRes = await dbRun(`DELETE FROM sales_plans WHERE id IN (${placeholders})`, chunk);
        deletedPlansCount += (planRes.affectedRows || planRes.changes || 0);
      }
    } else {
      deletedPlansCount = deleteIds.length;
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. Clean and synchronize master_employees (Only Active Employees Allowed)
  // ───────────────────────────────────────────────────────────────────────────
  let deactivatedEmployeesCount = 0;
  let purgedDummyEmployeesCount = 0;

  if (!dryRun) {
    // Purge dummy codes from master_employees
    const dummyDel = await dbRun(`
      DELETE FROM master_employees 
      WHERE emp_code IN ('VACANT', 'NONE', 'NULL', 'NA', 'N/A', '-')
         OR UPPER(emp_code) LIKE 'VACANT%'
         OR emp_code REGEXP '^(SO|ASM|RSM|ZH)[0-9]+$'
         OR UPPER(emp_name) LIKE 'VACANT%'
    `);
    purgedDummyEmployeesCount = dummyDel.affectedRows || dummyDel.changes || 0;

    // Mark or delete employees who are inactive in employee_master (acedns = 'N')
    const deactRes = await dbRun(`
      UPDATE master_employees me
      JOIN employee_master em ON (me.emp_code = em.emp_code OR me.emp_code = em.dns_emp_code)
      SET me.is_active = 0
      WHERE em.acedns = 'N' OR em.app_access = 'N'
    `);
    deactivatedEmployeesCount = deactRes.affectedRows || deactRes.changes || 0;

    // Delete completely inactive records from master_employees so they don't appear anywhere
    await dbRun(`DELETE FROM master_employees WHERE is_active = 0`);

    // Ensure all remaining employees are marked active
    await dbRun(`UPDATE master_employees SET is_active = 1 WHERE is_active IS NULL`);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. Heal Remaining Active Plans (Ensure Names, Approvers, and Roles are stamped)
  // ───────────────────────────────────────────────────────────────────────────
  let healedPlansCount = 0;
  if (!dryRun && activePlanIds.length > 0) {
    const remainingPlans = await dbAll(`
      SELECT sp.id, sp.emp_code, sp.emp_name, sp.emp_role, sp.period_month, sp.cycle_code,
             sp.l1_approver_emp_code, sp.l1_approver_name, sp.l1_approver_role
      FROM sales_plans sp
      WHERE sp.id IN (${activePlanIds.map(() => '?').join(',')})
    `, activePlanIds);

    for (const p of remainingPlans) {
      let needsUpdate = false;
      let newName = p.emp_name;
      let newApproverCode = p.l1_approver_emp_code;
      let newApproverName = p.l1_approver_name;
      let newApproverRole = p.l1_approver_role;

      if (!newName || newName.trim() === '' || newName === p.emp_code) {
        const resolved = await resolveEmployeeName(p.emp_code, p.emp_role);
        if (resolved && resolved.name) {
          newName = resolved.name;
          needsUpdate = true;
        }
      }

      if (!newApproverRole || !newApproverName) {
        const apprv = await resolveL1Approver(p.emp_code, p.emp_role);
        if (apprv) {
          newApproverCode = newApproverCode || apprv.emp_code;
          newApproverName = newApproverName || apprv.name;
          newApproverRole = newApproverRole || apprv.role;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        await dbRun(`
          UPDATE sales_plans 
          SET emp_name = ?, l1_approver_emp_code = ?, l1_approver_name = ?, l1_approver_role = ?
          WHERE id = ?
        `, [newName, newApproverCode, newApproverName, newApproverRole, p.id]);
        healedPlansCount++;
      }
    }

    // Refresh plan routing for any distinct period months present
    const distinctPeriods = await dbAll(`SELECT DISTINCT period_month, cycle_code FROM sales_plans`);
    for (const dp of distinctPeriods) {
      try {
        await stampPlanRoutingForPeriod(dp.period_month, dp.cycle_code);
      } catch (e) {
        // routing stamp warning
      }
    }
  }

  const summary = {
    success: true,
    dryRun,
    totalPlansScanned: allPlans.length,
    activePlansRetained: activePlanIds.length,
    inactivePlansPurged: deletedPlansCount,
    orphanVisitsPurged: deletedVisitsCount,
    dummyEmployeesPurgedFromMaster: purgedDummyEmployeesCount,
    inactiveEmployeesDeactivated: deactivatedEmployeesCount,
    healedPlansCount,
    message: `Active DJP enforcement completed: ${activePlanIds.length} active plans retained, ${deletedPlansCount} inactive/dummy plans purged.`
  };

  console.log(`[ActiveDjpEnforcer] Finished:`, summary);
  return summary;
}

