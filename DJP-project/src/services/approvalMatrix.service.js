/**
 * Approval Matrix Service
 *
 * Enforces the role-based approval hierarchy for PJP plans:
 *   SO / SR / MT  → approved by → ASM
 *   ASM           → approved by → RSM
 *   RSM           → approved by → ZH
 *   ZH            → approved by → ADMIN
 *
 * Matrix is stored in the `approval_matrix` table and is admin-configurable.
 * Approver identity and role are looked up from `master_employees` first,
 * then from the `dealer_visit_targets` hierarchy as fallback.
 */

import { dbAll, dbGet } from '../config/database.js';

// In-memory cache of the matrix (refreshed on each module import)
let _matrixCache = null;
let _matrixCachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load the approval matrix from the database.
 * Returns a Map: submitterRole → requiredApproverRole
 * Falls back to hardcoded defaults if the table is empty or unavailable.
 */
export async function getApprovalMatrix() {
  const now = Date.now();
  if (_matrixCache && (now - _matrixCachedAt) < CACHE_TTL_MS) {
    return _matrixCache;
  }

  try {
    const rows = await dbAll(
      "SELECT submitter_role, required_approver_role FROM approval_matrix WHERE is_active = 1"
    );

    if (rows.length > 0) {
      _matrixCache = new Map(rows.map(r => [r.submitter_role.toUpperCase(), r.required_approver_role.toUpperCase()]));
    } else {
      // Hardcoded defaults — used as fallback when table is empty
      _matrixCache = new Map([
        ['SO',    'ASM'],
        ['SR',    'ASM'],
        ['MT',    'ASM'],
        ['ASM',   'RSM'],
        ['RSM',   'ZH'],
        ['ZH',    'ADMIN'],
        ['ADMIN', 'ADMIN']
      ]);
    }

    _matrixCachedAt = now;
    return _matrixCache;
  } catch (err) {
    console.warn('[ApprovalMatrix] DB error, using defaults:', err.message);
    return new Map([
      ['SO', 'ASM'], ['SR', 'ASM'], ['MT', 'ASM'],
      ['ASM', 'RSM'], ['RSM', 'ZH'], ['ZH', 'ADMIN'], ['ADMIN', 'ADMIN']
    ]);
  }
}

/**
 * Invalidate the in-memory cache (call after admin updates the matrix).
 */
export function invalidateMatrixCache() {
  _matrixCache = null;
  _matrixCachedAt = 0;
}

/**
 * Get the required approver role for a given submitter role.
 * @param {string} submitterRole - e.g. 'SO', 'ASM', 'RSM'
 * @returns {Promise<string|null>} required approver role, or null if not found
 */
export async function getRequiredApproverRole(submitterRole) {
  const matrix = await getApprovalMatrix();
  return matrix.get((submitterRole || 'SO').toUpperCase()) || null;
}

/**
 * Look up an employee's role by emp_code.
 * Priority: master_employees → dealer_visit_targets hierarchy → null
 *
 * @param {string} empCode
 * @returns {Promise<string|null>} e.g. 'ASM', 'RSM', 'ZH', 'ADMIN', or null
 */
export async function lookupEmployeeRole(empCode) {
  if (!empCode) return null;

  // 1. Try master_employees (most authoritative)
  try {
    const emp = await dbGet(
      'SELECT role, designation FROM master_employees WHERE emp_code = ? LIMIT 1',
      [empCode]
    );
    if (emp) {
      const role = (emp.role || emp.designation || '').toUpperCase().trim();
      if (role) return normalizeRole(role);
    }
  } catch (e) { /* table may not have role column yet */ }

  // 2. Try app_users table
  try {
    const user = await dbGet('SELECT role FROM app_users WHERE emp_code = ? LIMIT 1', [empCode]);
    if (user?.role) return normalizeRole(user.role);
  } catch (e) { /* ignore */ }

  // 3. Infer from hierarchy in dealer_visit_targets
  // If empCode appears as asm_code → role is ASM, rsm_code → RSM, zh_code → ZH
  try {
    const hierarchyCheck = await dbGet(`
      SELECT 
        MAX(CASE WHEN so_emp_code = ? THEN 'SO' ELSE NULL END) as so_match,
        MAX(CASE WHEN asm_code = ? THEN 'ASM' ELSE NULL END) as asm_match,
        MAX(CASE WHEN rsm_code = ? THEN 'RSM' ELSE NULL END) as rsm_match,
        MAX(CASE WHEN zh_code = ? THEN 'ZH' ELSE NULL END) as zh_match
      FROM dealer_visit_targets
      LIMIT 1
    `, [empCode, empCode, empCode, empCode]);

    if (hierarchyCheck?.zh_match) return 'ZH';
    if (hierarchyCheck?.rsm_match) return 'RSM';
    if (hierarchyCheck?.asm_match) return 'ASM';
    if (hierarchyCheck?.so_match) return 'SO';
  } catch (e) { /* ignore */ }

  return null;
}

/**
 * Normalize various role name variants to canonical form.
 */
function normalizeRole(raw) {
  const r = raw.toUpperCase().trim();
  if (['SO', 'SE', 'SR', 'SALES OFFICER', 'SALES EXECUTIVE'].some(v => r.includes(v))) return 'SO';
  if (['ASM', 'AREA SALES', 'AREA MANAGER'].some(v => r.includes(v))) return 'ASM';
  if (['RSM', 'REGIONAL', 'REGION'].some(v => r.includes(v))) return 'RSM';
  if (['ZH', 'ZONE', 'ZONAL'].some(v => r.includes(v))) return 'ZH';
  if (['ADMIN', 'ADMINISTRATOR', 'NATIONAL'].some(v => r.includes(v))) return 'ADMIN';
  return r;
}

/**
 * Validate that an approver (by emp_code) has the required role.
 * Admins can approve any plan regardless of the matrix.
 *
 * @param {string} approverEmpCode
 * @param {string} requiredRole
 * @returns {Promise<{ valid: boolean, approverRole: string|null, reason: string }>}
 */
export async function validateApprover(approverEmpCode, requiredRole) {
  const approverRole = await lookupEmployeeRole(approverEmpCode);

  if (!approverRole) {
    return {
      valid: false,
      approverRole: null,
      reason: `Approver '${approverEmpCode}' not found in master employees. Cannot verify role.`
    };
  }

  // ADMIN can approve anything
  if (approverRole === 'ADMIN') {
    return { valid: true, approverRole, reason: 'Admin override — approved.' };
  }

  const required = (requiredRole || '').toUpperCase();
  if (approverRole === required) {
    return { valid: true, approverRole, reason: `${approverRole} is authorized to approve this plan.` };
  }

  return {
    valid: false,
    approverRole,
    reason: `Plan requires approval by ${required}. Approver '${approverEmpCode}' has role ${approverRole}.`
  };
}
