/**
 * Plan Routing Service
 *
 * Answers two questions for every generated plan:
 *
 *   1. What role does the plan owner hold?   (SO / ASM / RSM / ZH)
 *   2. Who is the ONE person who approves it? (the L1 approver)
 *
 * The approval matrix already tells us the required approver ROLE. It does not
 * tell us WHICH PERSON holds that role over this employee — and the app needs a
 * named individual so an approver can open "plans waiting on me".
 *
 * SOURCE: master_dealer_so_mapping — the Dealer / SO Mapping upload. That file is
 * the authoritative record of who reports to whom, the same way it is authoritative
 * for dm_area. dealer_visit_targets carries a copy of the hierarchy, but it is a
 * per-cycle snapshot written by the DJP run: it only exists after a generation, it
 * only covers dealers that earned a visit, and it goes stale the moment a territory
 * is reassigned. Mapping is read first; targets are used only as a fallback, so
 * routing still works on a database where the mapping has not been loaded yet.
 *
 * L1 is deliberately the only approval level. There is no L2 escalation.
 */

import { dbAll, dbGet, dbRun } from '../config/database.js';
import { getRequiredApproverRole, lookupEmployeeRole } from './approvalMatrix.service.js';

export const EDITABLE_STATUSES  = ['DRAFT', 'RECTIFY'];
export const MAX_RECTIFICATIONS = 1;

/**
 * The hierarchy column that identifies an employee, per role. Both
 * master_dealer_so_mapping and dealer_visit_targets use these same names.
 */
const ROLE_CODE_COLUMN = {
  SO:  'so_emp_code',
  ASM: 'asm_code',
  RSM: 'rsm_code',
  ZH:  'zh_code'
};

/**
 * Hierarchy sources in priority order. Dealer / SO Mapping is authoritative;
 * the per-cycle DJP snapshot is a fallback for databases where the mapping has
 * not been uploaded yet.
 */
const HIERARCHY_SOURCES = ['master_dealer_so_mapping', 'dealer_visit_targets'];

/**
 * Run a query against each hierarchy source in turn, returning the first
 * non-empty result. A missing table (older schema) is skipped rather than thrown.
 *
 * @param {(table: string) => [string, Array]} build - returns [sql, params] for a table
 * @returns {Promise<{rows: Array, source: string|null}>}
 */
async function queryHierarchy(build) {
  for (const table of HIERARCHY_SOURCES) {
    const [sql, params] = build(table);
    try {
      const rows = await dbAll(sql, params);
      if (rows && rows.length > 0) return { rows, source: table };
    } catch (e) {
      // ER_NO_SUCH_TABLE / unknown column — try the next source
      continue;
    }
  }
  return { rows: [], source: null };
}

/**
 * The columns that hold each role's immediate superior.
 */
/**
 * The column holding an employee's own NAME, per role, in either hierarchy source.
 */
const ROLE_NAME_COLUMN = {
  SO:  'so_name',
  ASM: 'asm_name',
  RSM: 'rsm_name',
  ZH:  'zh_name'
};

const L1_OF = {
  SO:  { role: 'ASM',   codeCol: 'asm_code', nameCol: 'asm_name' },
  ASM: { role: 'RSM',   codeCol: 'rsm_code', nameCol: 'rsm_name' },
  RSM: { role: 'ZH',    codeCol: 'zh_code',  nameCol: 'zh_name'  },
  ZH:  { role: 'ADMIN', codeCol: null,       nameCol: null       }
};

/**
 * Resolve an employee's role, preferring an explicit role/designation record and
 * falling back to wherever their code appears in the hierarchy.
 *
 * @param {string} empCode
 * @param {string} [hint] - role the caller already believes to be correct
 * @returns {Promise<string>} SO | ASM | RSM | ZH | ADMIN
 */
export async function resolveEmployeeRole(empCode, hint = null) {
  if (hint && ROLE_CODE_COLUMN[hint.toUpperCase()]) return hint.toUpperCase();

  const looked = await lookupEmployeeRole(empCode);
  if (looked) return looked;

  // Last resort: find the highest role this code occupies in the Dealer / SO
  // Mapping hierarchy. Checked most-senior first so a person who is both an ASM
  // and appears as an RSM on some rows is treated as the more senior of the two.
  for (const role of ['ZH', 'RSM', 'ASM', 'SO']) {
    const col = ROLE_CODE_COLUMN[role];
    const { rows } = await queryHierarchy(table => [
      `SELECT 1 AS found FROM ${table} WHERE UPPER(TRIM(${col})) = UPPER(TRIM(?)) LIMIT 1`, [empCode]
    ]);
    if (rows.length > 0) return role;
  }
  return 'SO';
}

/**
 * Resolve an employee's display name.
 *
 * master_employees is only populated for SO and ASM by the Dealer Mapping importer,
 * so an RSM or ZH has no row there and callers that stopped at that lookup fell back
 * to showing the employee CODE as the name. The hierarchy carries the name for every
 * role, so read it from there when the employee master comes up empty.
 *
 * @param {string} empCode
 * @param {string} [role] - narrows the hierarchy column; all four are tried without it
 * @returns {Promise<{name: string|null, source: string}>}
 */
export async function resolveEmployeeName(empCode, role = null) {
  if (!empCode) return { name: null, source: 'none' };

  try {
    const emp = await dbGet(
      'SELECT emp_name FROM master_employees WHERE UPPER(TRIM(emp_code)) = UPPER(TRIM(?)) LIMIT 1',
      [empCode]
    );
    if (emp?.emp_name && String(emp.emp_name).trim()) {
      return { name: String(emp.emp_name).trim(), source: 'master_employees' };
    }
  } catch (e) { /* fall through to the hierarchy */ }

  // Try the role we were told first, then the rest — a code can legitimately appear
  // in more than one column when someone covers two levels.
  const rolesToTry = role && ROLE_NAME_COLUMN[role.toUpperCase()]
    ? [role.toUpperCase(), ...Object.keys(ROLE_NAME_COLUMN).filter(r => r !== role.toUpperCase())]
    : Object.keys(ROLE_NAME_COLUMN);

  for (const r of rolesToTry) {
    const codeCol = ROLE_CODE_COLUMN[r];
    const nameCol = ROLE_NAME_COLUMN[r];
    const { rows, source } = await queryHierarchy(table => [
      `SELECT ${nameCol} AS name, COUNT(*) AS n
       FROM ${table}
       WHERE UPPER(TRIM(${codeCol})) = UPPER(TRIM(?)) AND ${nameCol} IS NOT NULL AND TRIM(${nameCol}) != ''
       GROUP BY ${nameCol}
       ORDER BY n DESC`,
      [empCode]
    ]);
    if (rows.length > 0 && rows[0].name) {
      return { name: String(rows[0].name).trim(), source: `${source}.${nameCol}` };
    }
  }

  return { name: null, source: 'none' };
}

/**
 * Resolve the single L1 approver for an employee.
 *
 * Returns { empCode, name, role }. For a ZH there is no superior in the
 * hierarchy table, so the approver role is ADMIN and empCode is left null —
 * the decision endpoint lets any ADMIN act on those.
 *
 * If an employee's rows disagree (rare, but it happens when a territory is
 * mid-handover) the most frequently occurring superior wins, so one stray row
 * cannot silently reroute a whole plan.
 *
 * Fallback Logic: If an employee's immediate superior is missing (e.g., an SO 
 * doesn't have an ASM in the mapping), it will recursively check the next level 
 * up (RSM, then ZH, then Admin) until an approver is found.
 *
 * @param {string} empCode
 * @param {string} role - the employee's own role
 */
export async function resolveL1Approver(empCode, role) {
  const roleName = (role || 'SO').toUpperCase();
  const ownCol = ROLE_CODE_COLUMN[roleName];
  
  let startIndex = 0;
  if (roleName === 'SO') startIndex = 0;
  else if (roleName === 'ASM') startIndex = 1;
  else if (roleName === 'RSM') startIndex = 2;
  else if (roleName === 'ZH') startIndex = 3;
  else startIndex = 3;

  const HIERARCHY_UPWARD = ['ASM', 'RSM', 'ZH', 'ADMIN'];

  for (let i = startIndex; i < HIERARCHY_UPWARD.length; i++) {
    const targetRole = HIERARCHY_UPWARD[i];
    
    if (targetRole === 'ADMIN') {
      return { empCode: null, name: 'Admin', role: 'ADMIN', source: null };
    }
    
    const codeCol = ROLE_CODE_COLUMN[targetRole];
    const nameCol = ROLE_NAME_COLUMN[targetRole];
    
    const { rows, source } = await queryHierarchy(table => [
      `SELECT ${codeCol} AS code, ${nameCol} AS name, COUNT(*) AS n
       FROM ${table}
       WHERE UPPER(TRIM(${ownCol})) = UPPER(TRIM(?)) AND ${codeCol} IS NOT NULL AND TRIM(${codeCol}) != ''
       GROUP BY ${codeCol}, ${nameCol}
       ORDER BY n DESC`,
      [empCode]
    ]);

    if (rows.length > 0) {
      const approverCode = String(rows[0].code).trim();
      let approverName = rows[0].name ? String(rows[0].name).trim() : null;

      if (!approverName && approverCode) {
        const resName = await resolveEmployeeName(approverCode, targetRole);
        if (resName?.name) approverName = resName.name;
      }

      return {
        empCode: approverCode,
        name: approverName,
        role: targetRole,
        source,
        ambiguous: rows.length > 1,
        candidates: rows.length > 1 ? rows.map(r => ({ empCode: r.code, name: r.name, rows: r.n })) : undefined
      };
    }
  }
  
  return { empCode: null, name: 'Admin', role: 'ADMIN', source: null };
}

/**
 * Stamp role + required approver role + L1 approver identity onto one plan.
 * Idempotent — safe to call again after a regeneration.
 *
 * @param {number|string} planId
 * @param {Object} [opts]
 * @param {string} [opts.roleHint] - role the generator already knows
 * @returns {Promise<Object>} the routing that was written
 */
export async function stampPlanRouting(planId, opts = {}) {
  const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const role = await resolveEmployeeRole(plan.emp_code, opts.roleHint || plan.emp_role);
  const requiredApproverRole = await getRequiredApproverRole(role);
  const l1 = await resolveL1Approver(plan.emp_code, role);

  await dbRun(
    `UPDATE sales_plans
     SET emp_role = ?, required_approver_role = ?,
         l1_approver_emp_code = ?, l1_approver_name = ?, l1_approver_role = ?
     WHERE id = ?`,
    [role, requiredApproverRole || l1.role || null, l1.empCode, l1.name, l1.role, planId]
  );

  return {
    planId: Number(planId),
    empCode: plan.emp_code,
    empRole: role,
    requiredApproverRole: requiredApproverRole || l1.role || null,
    l1ApproverEmpCode: l1.empCode,
    l1ApproverName: l1.name,
    l1ApproverRole: l1.role,
    hierarchySource: l1.source,
    ambiguous: !!l1.ambiguous
  };
}

/**
 * Stamp every plan for a period (and optionally a cycle) in one pass.
 * Called straight after auto-generation so the app can route immediately.
 *
 * Roles and superiors are resolved once per distinct employee rather than once
 * per plan, because C1 and C2 produce two plans for the same person.
 *
 * @param {string} periodMonth - YYYY-MM
 * @param {string} [cycleCode] - C1 | C2; omit for both
 */
export async function stampPlanRoutingForPeriod(periodMonth, cycleCode = null) {
  const params = [periodMonth];
  let sql = 'SELECT id, emp_code, emp_role FROM sales_plans WHERE period_month = ?';
  if (cycleCode) { sql += ' AND cycle_code = ?'; params.push(cycleCode); }

  const plans = await dbAll(sql, params);
  const cache = new Map();
  const unrouted = [];
  let stamped = 0;

  for (const p of plans) {
    const key = `${p.emp_code}|${p.emp_role || ''}`;
    if (!cache.has(key)) {
      const role = await resolveEmployeeRole(p.emp_code, p.emp_role);
      const requiredApproverRole = await getRequiredApproverRole(role);
      const l1 = await resolveL1Approver(p.emp_code, role);
      cache.set(key, { role, requiredApproverRole, l1 });
    }
    const { role, requiredApproverRole, l1 } = cache.get(key);

    await dbRun(
      `UPDATE sales_plans
       SET emp_role = ?, required_approver_role = ?,
           l1_approver_emp_code = ?, l1_approver_name = ?, l1_approver_role = ?
       WHERE id = ?`,
      [role, requiredApproverRole || l1.role || null, l1.empCode, l1.name, l1.role, p.id]
    );
    stamped++;

    // A ZH legitimately has no named superior — that is not an unrouted plan.
    if (!l1.empCode && l1.role !== 'ADMIN') {
      unrouted.push({ planId: p.id, empCode: p.emp_code, role });
    }
  }

  if (unrouted.length > 0) {
    console.warn(
      `[PlanRouting] ${unrouted.length} plan(s) have no L1 approver in the Dealer / SO Mapping — ` +
      `they will not appear in anyone's approval inbox: ` +
      unrouted.slice(0, 10).map(u => `${u.empCode}(${u.role})`).join(', ')
    );
  }

  const sources = [...new Set([...cache.values()].map(v => v.l1.source).filter(Boolean))];
  if (sources.includes('dealer_visit_targets')) {
    console.warn(
      `[PlanRouting] Some approvers were resolved from dealer_visit_targets rather than ` +
      `master_dealer_so_mapping. Upload the Dealer / SO Mapping file so the hierarchy comes ` +
      `from its authoritative source.`
    );
  }

  console.log(
    `[PlanRouting] Stamped ${stamped} plan(s) for ${periodMonth}${cycleCode ? ' ' + cycleCode : ''}` +
    `${sources.length ? ` (hierarchy from ${sources.join(' + ')})` : ''}.`
  );
  return { stamped, unrouted, hierarchySources: sources };
}

/**
 * May this employee edit this plan right now?
 * Editing is the owner's right, and only while the plan is back in their court.
 */
export function canEdit(plan, empCode) {
  if (!plan) return { ok: false, reason: 'Plan not found.' };
  if (String(plan.emp_code).trim().toUpperCase() !== String(empCode).trim().toUpperCase()) {
    return { ok: false, reason: `Plan ${plan.id} belongs to ${plan.emp_code}, not ${empCode}.` };
  }
  if (!EDITABLE_STATUSES.includes(plan.status)) {
    return {
      ok: false,
      reason: plan.status === 'SUBMITTED'
        ? 'Plan is with your approver and cannot be edited until they act on it.'
        : `Plan is ${plan.status} and can no longer be edited.`
    };
  }
  return { ok: true };
}

/**
 * May this employee act as L1 on this plan?
 * The named L1 approver can. An ADMIN can always. Nobody else can — in
 * particular a correct-role manager from a different territory cannot.
 */
export async function canApprove(plan, empCode) {
  if (!plan) return { ok: false, reason: 'Plan not found.' };

  const actor = String(empCode).trim().toUpperCase();
  const named = plan.l1_approver_emp_code ? String(plan.l1_approver_emp_code).trim().toUpperCase() : null;

  if (named && actor === named) {
    return { ok: true, approverRole: plan.l1_approver_role || null, via: 'L1' };
  }

  const actorRole = await resolveEmployeeRole(empCode);
  if (actorRole === 'ADMIN') return { ok: true, approverRole: 'ADMIN', via: 'ADMIN' };

  // ZH plans have no named superior — any ADMIN handles them, covered above.
  if (!named && plan.l1_approver_role === 'ADMIN') {
    return { ok: false, reason: `Plan ${plan.id} is a ${plan.emp_role} plan and requires an ADMIN approver.` };
  }

  return {
    ok: false,
    reason: named
      ? `Plan ${plan.id} is approved by ${plan.l1_approver_name || named} (${plan.l1_approver_role}), not ${empCode}.`
      : `Plan ${plan.id} has no L1 approver resolved. Re-run plan routing for ${plan.period_month}.`
  };
}
