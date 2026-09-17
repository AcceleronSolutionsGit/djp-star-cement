/**
 * Approval Matrix Admin Controller
 *
 * Endpoints for admins to view and update the role-based approval hierarchy.
 * Changes take effect immediately (cache is invalidated on update).
 */

import { dbAll, dbRun, dbGet } from '../config/database.js';
import { getApprovalMatrix, invalidateMatrixCache } from '../services/approvalMatrix.service.js';

/**
 * GET /api/admin/approval-matrix
 * Returns the full approval matrix with all role mappings.
 */
export async function getApprovalMatrixConfig(req, res) {
  try {
    const rows = await dbAll(
      'SELECT * FROM approval_matrix ORDER BY id ASC'
    );

    const matrix = await getApprovalMatrix();

    res.json({
      matrix: rows,
      effectiveHierarchy: Object.fromEntries(matrix),
      description: 'submitter_role → required_approver_role: defines who must approve each role\'s plan'
    });
  } catch (err) {
    console.error('Error fetching approval matrix:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * PUT /api/admin/approval-matrix/:submitterRole
 * Update the required approver role for a given submitter role.
 * Body: { requiredApproverRole: 'RSM', description: '...' }
 */
export async function updateApprovalMatrixEntry(req, res) {
  try {
    const { submitterRole } = req.params;
    const { requiredApproverRole, description } = req.body;

    if (!requiredApproverRole) {
      return res.status(400).json({ error: 'requiredApproverRole is required.' });
    }

    const validRoles = ['SO', 'SR', 'MT', 'ASM', 'RSM', 'ZH', 'ADMIN'];
    if (!validRoles.includes(submitterRole.toUpperCase())) {
      return res.status(400).json({ error: `Invalid submitterRole. Must be one of: ${validRoles.join(', ')}` });
    }
    if (!validRoles.includes(requiredApproverRole.toUpperCase())) {
      return res.status(400).json({ error: `Invalid requiredApproverRole. Must be one of: ${validRoles.join(', ')}` });
    }

    await dbRun(
      `INSERT INTO approval_matrix (submitter_role, required_approver_role, description)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         required_approver_role = VALUES(required_approver_role),
         description = VALUES(description),
         updated_at = CURRENT_TIMESTAMP`,
      [submitterRole.toUpperCase(), requiredApproverRole.toUpperCase(), description || null]
    );

    // Invalidate cache so changes take effect immediately
    invalidateMatrixCache();

    res.json({
      success: true,
      message: `Approval matrix updated: ${submitterRole.toUpperCase()} plans now require ${requiredApproverRole.toUpperCase()} approval.`,
      submitterRole: submitterRole.toUpperCase(),
      requiredApproverRole: requiredApproverRole.toUpperCase()
    });
  } catch (err) {
    console.error('Error updating approval matrix:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/admin/approval-matrix/pending-plans
 * Lists all SUBMITTED plans grouped by the required approver role.
 * Useful for ASM/RSM/ZH dashboards to see pending approvals.
 *
 * Query params: requiredApproverRole (e.g. 'ASM'), empCode (specific approver)
 */
export async function getPendingApprovals(req, res) {
  try {
    const { requiredApproverRole, empCode, limit = 50, offset = 0 } = req.query;

    let query = `
      SELECT 
        sp.id, sp.emp_code, sp.emp_name, sp.emp_role, sp.period_month,
        sp.status, sp.submitted_at, sp.required_approver_role, sp.remarks,
        (SELECT COUNT(*) FROM sales_plan_details WHERE plan_id = sp.id) as total_visits
      FROM sales_plans sp
      WHERE sp.status = 'SUBMITTED'
    `;
    const params = [];

    if (requiredApproverRole) {
      query += ' AND sp.required_approver_role = ?';
      params.push(requiredApproverRole.toUpperCase());
    }

    query += ' ORDER BY sp.submitted_at ASC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const plans = await dbAll(query, params);

    // Group by required_approver_role for summary
    const byRole = {};
    for (const plan of plans) {
      const role = plan.required_approver_role || 'Unknown';
      if (!byRole[role]) byRole[role] = 0;
      byRole[role]++;
    }

    res.json({
      total: plans.length,
      pendingByRole: byRole,
      plans
    });
  } catch (err) {
    console.error('Error fetching pending approvals:', err);
    res.status(500).json({ error: err.message });
  }
}
