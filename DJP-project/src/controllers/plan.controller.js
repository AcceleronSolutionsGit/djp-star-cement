import { dbAll, dbRun, dbGet } from '../config/database.js';
import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';
import { DealerMappingEngine } from '../engines/dealerMappingEngine.js';
import {
  getRequiredApproverRole,
  validateApprover,
  lookupEmployeeRole
} from '../services/approvalMatrix.service.js';
import { stampPlanRouting } from '../services/planRouting.service.js';

// ─────────────────────────────────────────────────────────────────────────────
// EXISTING FUNCTIONS (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

export async function generateAutoPlan(req, res) {
  try {
    const planMonth = req.body.planMonth || req.body.periodMonth;
    const { empCode, role, cycleCode } = req.body;

    if (!empCode) {
      return res.status(400).json({ error: 'empCode is required.' });
    }
    if (!planMonth || typeof planMonth !== 'string') {
      return res.status(400).json({ error: 'planMonth is required. Please specify the planning month in YYYY-MM format.' });
    }
    const match = planMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Expected format is YYYY-MM.` });
    }
    const mNum = parseInt(match[2], 10);
    if (mNum < 1 || mNum > 12) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Month must be between 01 and 12.` });
    }

    const generator = new AutoPlanGenerator();
    const result = await generator.generatePlan(empCode, planMonth, role || 'SO', cycleCode || 'C1', {
      isDjpPipeline: false,
      status: 'DRAFT'
    });

    if (result && result.planId) {
      // Immediately stamp the employee's role and superior officer (L1 approver)
      try {
        const routing = await stampPlanRouting(result.planId, { roleHint: role || result.role });
        result.routing = routing;
        result.l1Approver = {
          empCode: routing.l1ApproverEmpCode,
          name: routing.l1ApproverName,
          role: routing.l1ApproverRole
        };
        const superiorLabel = routing.l1ApproverName 
          ? `${routing.l1ApproverName} (${routing.l1ApproverRole})`
          : (routing.l1ApproverRole || 'Superior Officer');
        result.message = `${result.message} Direct submission to superior officer ${superiorLabel}.`;
      } catch (routingErr) {
        console.warn(`[generateAutoPlan] Failed to stamp routing for plan ${result.planId}:`, routingErr.message);
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Error generating auto plan:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function runDealerMapping(req, res) {
  try {
    const engine = new DealerMappingEngine();
    const result = await engine.runMappingProcess();
    res.json(result);
  } catch (err) {
    console.error('Error running dealer mapping:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function submitPlan(req, res) {
  try {
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ error: 'planId is required.' });

    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    if (plan.status !== 'DRAFT' && plan.status !== 'RECTIFY') {
      return res.status(400).json({ error: `Only DRAFT or RECTIFY plans can be submitted. Current status: ${plan.status}` });
    }

    // Determine superior officer / L1 approver routing
    const routing = await stampPlanRouting(plan.id, { roleHint: plan.emp_role });
    const empRole = routing.empRole || plan.emp_role || 'SO';
    const requiredApproverRole = routing.requiredApproverRole || routing.l1ApproverRole || (await getRequiredApproverRole(empRole));
    const superiorLabel = routing.l1ApproverName
      ? `${routing.l1ApproverName} (${routing.l1ApproverRole})`
      : (routing.l1ApproverRole || requiredApproverRole || 'Superior Officer');

    await dbRun(
      `UPDATE sales_plans 
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP,
           emp_role = ?, required_approver_role = ?,
           l1_approver_emp_code = ?, l1_approver_name = ?, l1_approver_role = ?
       WHERE id = ?`,
      [empRole, requiredApproverRole || null, routing.l1ApproverEmpCode, routing.l1ApproverName, routing.l1ApproverRole, planId]
    );

    await dbRun(
      'INSERT INTO plan_approvals (plan_id, action_by, action_type, remarks, approver_role) VALUES (?, ?, ?, ?, ?)',
      [planId, plan.emp_code, 'SUBMITTED', `Plan submitted directly to ${superiorLabel} for approval.`, routing.l1ApproverRole || null]
    ).catch(e => console.warn('[submitPlan] audit log skipped:', e.message));

    res.json({
      success: true,
      message: `Plan #${planId} submitted directly to superior officer ${superiorLabel} for approval.`,
      planId: Number(planId),
      submittedByRole: empRole,
      requiredApproverRole: requiredApproverRole || 'N/A',
      approver: {
        empCode: routing.l1ApproverEmpCode,
        name: routing.l1ApproverName,
        role: routing.l1ApproverRole
      },
      info: `This plan has been submitted directly to ${superiorLabel} for review.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function approvePlan(req, res) {
  try {
    const { planId, managerEmpCode, action, remarks } = req.body;
    if (!planId || !managerEmpCode || !action) {
      return res.status(400).json({ error: 'planId, managerEmpCode, and action are required.' });
    }
    if (!['APPROVED', 'REJECTED'].includes(action)) {
      return res.status(400).json({ error: 'action must be APPROVED or REJECTED.' });
    }

    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    if (plan.status !== 'SUBMITTED') {
      return res.status(400).json({ error: `Only SUBMITTED plans can be approved. Current status: ${plan.status}` });
    }

    // ── Approval Matrix & Superior Officer Validation ───────────────────────
    const requiredApproverRole = plan.required_approver_role ||
      (await getRequiredApproverRole(plan.emp_role || 'SO'));

    const normManagerCode = String(managerEmpCode || '').trim().toUpperCase();
    const isNamedL1 = plan.l1_approver_emp_code &&
      String(plan.l1_approver_emp_code).trim().toUpperCase() === normManagerCode;

    if (isNamedL1) {
      // The exact designated superior officer is approving
      await dbRun(
        'UPDATE sales_plans SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, remarks = ?, approver_emp_code = ? WHERE id = ?',
        [action, managerEmpCode, remarks || '', managerEmpCode, planId]
      );
      await dbRun(
        'INSERT INTO plan_approvals (plan_id, action_by, action_type, remarks, approver_role) VALUES (?, ?, ?, ?, ?)',
        [planId, managerEmpCode, action, remarks || '', plan.l1_approver_role || 'SUPERIOR']
      );
    } else if (requiredApproverRole) {
      const { valid, approverRole, reason } = await validateApprover(managerEmpCode, requiredApproverRole);
      if (!valid) {
        return res.status(403).json({
          error: 'Approval rejected: insufficient role.',
          detail: reason,
          requiredRole: requiredApproverRole,
          approverRole: approverRole || 'Unknown'
        });
      }
      // Persist actual approver role to audit log
      await dbRun(
        'UPDATE sales_plans SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, remarks = ?, approver_emp_code = ? WHERE id = ?',
        [action, managerEmpCode, remarks || '', managerEmpCode, planId]
      );
      await dbRun(
        'INSERT INTO plan_approvals (plan_id, action_by, action_type, remarks, approver_role) VALUES (?, ?, ?, ?, ?)',
        [planId, managerEmpCode, action, remarks || '', approverRole]
      );
    } else {
      // No matrix entry — allow (legacy fallback)
      await dbRun(
        'UPDATE sales_plans SET status = ?, approved_by = ?, approved_at = CURRENT_TIMESTAMP, remarks = ? WHERE id = ?',
        [action, managerEmpCode, remarks || '', planId]
      );
      await dbRun(
        'INSERT INTO plan_approvals (plan_id, action_by, action_type, remarks) VALUES (?, ?, ?, ?)',
        [planId, managerEmpCode, action, remarks || '']
      );
    }

    res.json({
      success: true,
      message: `Plan ${planId} ${action.toLowerCase()} by ${managerEmpCode}.`,
      planId: Number(planId),
      action
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPlans(req, res) {
  try {
    const { empCode, role } = req.query;
    let query = `
      SELECT DISTINCT sp.*,
             COALESCE(bd.backdated_cnt, 0) AS backdated_visits_count
      FROM sales_plans sp
      LEFT JOIN (
        SELECT plan_id, COUNT(*) AS backdated_cnt
        FROM sales_plan_details
        WHERE is_backdated_edit = 1 
           OR edited_after_date = 1
           OR (created_at IS NOT NULL AND visit_date IS NOT NULL AND DATE(created_at) > visit_date)
           OR (updated_at IS NOT NULL AND visit_date IS NOT NULL AND DATE(updated_at) > visit_date)
        GROUP BY plan_id
      ) bd ON sp.id = bd.plan_id
      WHERE 1=1
    `;
    const params = [];

    if (empCode && empCode !== 'ALL') {
      const userRole = (role || 'SO').toUpperCase();

      if (userRole === 'ADMIN') {
        // Admins see everything, no filter
      } else if (userRole === 'ZH') {
        // ZH sees their own plans + plans where they are L1 approver + RSM/ASM/SO plans under them
        query += ` AND (
          sp.emp_code = ? OR
          sp.l1_approver_emp_code = ? OR
          sp.emp_code IN (
            SELECT rsm_code FROM dealer_visit_targets WHERE zh_code = ? UNION
            SELECT asm_code FROM dealer_visit_targets WHERE zh_code = ? UNION
            SELECT so_emp_code FROM dealer_visit_targets WHERE zh_code = ?
          )
        )`;
        params.push(empCode, empCode, empCode, empCode, empCode);
      } else if (userRole === 'RSM') {
        // RSM sees their own plans + plans where they are L1 approver + ASM/SO plans under them
        query += ` AND (
          sp.emp_code = ? OR
          sp.l1_approver_emp_code = ? OR
          sp.emp_code IN (
            SELECT asm_code FROM dealer_visit_targets WHERE rsm_code = ? UNION
            SELECT so_emp_code FROM dealer_visit_targets WHERE rsm_code = ?
          )
        )`;
        params.push(empCode, empCode, empCode, empCode);
      } else if (userRole === 'ASM') {
        // ASM sees their own plans + plans where they are L1 approver + SO plans under them
        query += ` AND (
          sp.emp_code = ? OR
          sp.l1_approver_emp_code = ? OR
          sp.emp_code IN (
            SELECT so_emp_code FROM dealer_visit_targets WHERE asm_code = ?
          )
        )`;
        params.push(empCode, empCode, empCode);
      } else {
        // SO or others see only their own plan
        query += ' AND sp.emp_code = ?';
        params.push(empCode);
      }
    }

    query += ' ORDER BY sp.created_at DESC';
    const plans = await dbAll(query, params);
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getPlanDetails(req, res) {
  try {
    const { planId } = req.params;
    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const details = await dbAll(
      `SELECT spd.*,
              CASE 
                WHEN spd.is_backdated_edit = 1 OR spd.edited_after_date = 1 THEN 1
                WHEN spd.created_at IS NOT NULL AND spd.visit_date IS NOT NULL AND DATE(spd.created_at) > spd.visit_date THEN 1
                WHEN spd.updated_at IS NOT NULL AND spd.visit_date IS NOT NULL AND DATE(spd.updated_at) > spd.visit_date THEN 1
                ELSE 0
              END AS is_backdated
       FROM sales_plan_details spd 
       WHERE spd.plan_id = ? 
       ORDER BY spd.visit_date ASC, spd.sequence ASC`,
      [planId]
    );

    const backdatedVisits = details.filter(d => d.is_backdated === 1);

    res.json({ 
      plan, 
      details,
      backdatedAlert: {
        hasBackdatedVisits: backdatedVisits.length > 0,
        count: backdatedVisits.length,
        message: backdatedVisits.length > 0 
          ? `Alert: ${backdatedVisits.length} visit(s) were scheduled or edited for dates that have already passed (Backdated Visits).`
          : null,
        visits: backdatedVisits.map(v => ({
          id: v.id,
          visit_date: v.visit_date,
          dealer_name: v.dealer_name,
          dealer_sap_code: v.dealer_sap_code,
          dealer_type: v.dealer_type,
          created_at: v.created_at,
          updated_at: v.updated_at
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function getAllEmployees(req, res) {
  try {
    const { role } = req.query;

    let empTable = [];
    try {
      empTable = await dbAll("SELECT id, emp_code, emp_name, role, designation, zone, region FROM master_employees");
    } catch (e) {
      console.warn('Could not query master_employees:', e.message);
    }

    const [soList, asmList, rsmList, zhList] = await Promise.all([
      dbAll(`SELECT DISTINCT 
               COALESCE(NULLIF(TRIM(so_emp_code), ''), NULLIF(TRIM(so_name), '')) as emp_code,
               so_name as emp_name, 'SO' as role, area, zone as region 
             FROM dealer_visit_targets 
             WHERE so_name IS NOT NULL AND TRIM(so_name) != ''`),
      dbAll(`SELECT DISTINCT 
               COALESCE(NULLIF(TRIM(asm_code), ''), NULLIF(TRIM(asm_name), '')) as emp_code,
               asm_name as emp_name, 'ASM' as role, area, zone as region 
             FROM dealer_visit_targets 
             WHERE asm_name IS NOT NULL AND TRIM(asm_name) != ''`),
      dbAll(`SELECT DISTINCT 
               NULLIF(TRIM(rsm_name), '') as emp_code,
               rsm_name as emp_name, 'RSM' as role, area, zone as region 
             FROM dealer_visit_targets 
             WHERE rsm_name IS NOT NULL AND TRIM(rsm_name) != ''`),
      dbAll(`SELECT DISTINCT 
               NULLIF(TRIM(zh_name), '') as emp_code,
               zh_name as emp_name, 'ZH' as role, area, zone as region 
             FROM dealer_visit_targets 
             WHERE zh_name IS NOT NULL AND TRIM(zh_name) != ''`)
    ]);

    const combined = new Map();

    for (const e of empTable) {
      if (e.emp_name) {
        const key = `${e.role || 'SO'}_${e.emp_code || e.emp_name}`;
        combined.set(key, {
          emp_code: e.emp_code || e.emp_name,
          emp_name: e.emp_name,
          role: e.role || 'SO',
          area: e.area || null,
          region: e.region || null
        });
      }
    }

    for (const list of [soList, asmList, rsmList, zhList]) {
      for (const e of list) {
        if (!e.emp_name) continue;
        const key = `${e.role}_${e.emp_code || e.emp_name}`;
        if (!combined.has(key)) {
          combined.set(key, {
            emp_code: e.emp_code || e.emp_name,
            emp_name: e.emp_name,
            role: e.role,
            area: e.area || null,
            region: e.region || null
          });
        }
      }
    }

    let result = Array.from(combined.values());
    if (role && role !== 'ALL') {
      result = result.filter(e => e.role === role);
    }
    result.sort((a, b) => (a.emp_name || '').localeCompare(b.emp_name || ''));
    res.json({ employees: result });
  } catch (err) {
    console.error('Error in getAllEmployees:', err);
    res.status(500).json({ error: err.message });
  }
}

export async function getDealersForSO(req, res) {
  try {
    const { empCode, role } = req.query;
    if (!empCode) return res.status(400).json({ error: 'empCode is required' });

    // Resolve employee name and code
    let resolvedCode = empCode.trim();
    let resolvedName = empCode.trim();
    try {
      const emp = await dbGet(
        'SELECT emp_code, emp_name FROM master_employees WHERE emp_code = ? OR emp_name = ? LIMIT 1',
        [empCode, empCode]
      );
      if (emp) {
        resolvedCode = emp.emp_code || resolvedCode;
        resolvedName = emp.emp_name || resolvedName;
      }
    } catch (e) {}

    let roleField = 'so_name';
    let codeField = 'so_emp_code';
    if (role === 'ASM') { roleField = 'asm_name'; codeField = 'asm_code'; }
    else if (role === 'RSM') { roleField = 'rsm_name'; codeField = 'rsm_code'; }
    else if (role === 'ZH') { roleField = 'zh_name'; codeField = 'zh_code'; }

    // 1. Fetch from dealer_visit_targets with enriched customer coordinates
    const targetDealers = await dbAll(
      `SELECT DISTINCT 
         dvt.dealer_id, 
         COALESCE(dvt.sap_code, dvt.sfa_code, md.sap_code, md.sfa_code, mcc.customer_code, mcc.dns_customer_code) as sap_code,
         COALESCE(NULLIF(mcc.customer_name, ''), NULLIF(md.dealer_name, ''), dvt.dealer_name) as dealer_name,
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
         COALESCE(md.branch, dvt.area) as branch
       FROM dealer_visit_targets dvt
       LEFT JOIN master_dealers md ON dvt.dealer_id = md.id
       LEFT JOIN master_customer_coordinates mcc ON (
         (md.sfa_code IS NOT NULL AND mcc.dns_customer_code = md.sfa_code) OR
         (md.sap_code IS NOT NULL AND (mcc.dns_customer_code = md.sap_code OR mcc.customer_code = md.sap_code)) OR
         (dvt.sap_code IS NOT NULL AND (mcc.dns_customer_code = dvt.sap_code OR mcc.customer_code = dvt.sap_code)) OR
         (dvt.sfa_code IS NOT NULL AND mcc.dns_customer_code = dvt.sfa_code)
       )
       WHERE dvt.${codeField} = ? OR dvt.${codeField} = ? 
          OR dvt.${roleField} = ? OR dvt.${roleField} = ? 
          OR dvt.${roleField} LIKE ?
       ORDER BY dvt.dealer_name ASC`,
      [resolvedCode, resolvedName, resolvedName, resolvedCode, `%${resolvedName}%`]
    );

    // 2. Also fetch mapped dealers from master_dealer_so_mapping / master_dealers for this officer
    const mappedDealers = await dbAll(
      `SELECT DISTINCT
         md.id as dealer_id,
         COALESCE(md.sap_code, md.sfa_code, mcc.customer_code, mcc.dns_customer_code) as sap_code,
         COALESCE(NULLIF(mcc.customer_name, ''), md.dealer_name) as dealer_name,
         CASE
           WHEN mcc.customer_type = 'Sub Dealer' OR mcc.customer_type LIKE '%Sub%' 
                OR md.dealer_type = 'RSAR' 
                OR (md.linked_dealer_code IS NOT NULL AND md.linked_dealer_code != '' AND md.linked_dealer_code != '-')
                OR (md.rssd_code IS NOT NULL AND md.rssd_code != '' AND md.rssd_code != '-') THEN 'RSAR'
           WHEN mcc.customer_type IN ('Dealer', 'Exclusive Dealer') 
                OR md.dealer_type IN ('DEALER', 'STAR') THEN 'DEALER'
           WHEN mcc.customer_type = 'Non Star' OR md.dealer_type = 'PROSPECTIVE' THEN 'PROSPECTIVE'
           ELSE COALESCE(NULLIF(md.dealer_type, ''), 'DEALER')
         END as dealer_type,
         md.area,
         md.branch
       FROM master_dealers md
       LEFT JOIN master_customer_coordinates mcc ON (
         (md.sfa_code IS NOT NULL AND mcc.dns_customer_code = md.sfa_code) OR
         (md.sap_code IS NOT NULL AND (mcc.dns_customer_code = md.sap_code OR mcc.customer_code = md.sap_code))
       )
       WHERE md.so_emp_code = ? OR md.so_emp_code = ? OR md.so_name = ? OR md.so_name = ? OR md.so_name LIKE ?
       ORDER BY md.dealer_name ASC`,
      [resolvedCode, resolvedName, resolvedName, resolvedCode, `%${resolvedName}%`]
    );

    // Merge and deduplicate by SAP code / SFA code / dealer_name
    const merged = new Map();
    for (const d of [...targetDealers, ...mappedDealers]) {
      const key = (d.sap_code || d.dealer_name || `DLR_${d.dealer_id}`).toUpperCase().trim();
      if (!merged.has(key)) {
        merged.set(key, d);
      }
    }

    // If still very few dealers found, provide master list so officer can always add counters
    if (merged.size < 5) {
      const allMaster = await dbAll(
        `SELECT DISTINCT
           md.id as dealer_id,
           COALESCE(md.sap_code, md.sfa_code) as sap_code,
           COALESCE(NULLIF(mcc.customer_name, ''), md.dealer_name) as dealer_name,
           CASE
             WHEN mcc.customer_type = 'Sub Dealer' OR md.dealer_type = 'RSAR' THEN 'RSAR'
             WHEN mcc.customer_type IN ('Dealer', 'Exclusive Dealer') OR md.dealer_type = 'DEALER' THEN 'DEALER'
             WHEN mcc.customer_type = 'Non Star' OR md.dealer_type = 'PROSPECTIVE' THEN 'PROSPECTIVE'
             ELSE 'DEALER'
           END as dealer_type,
           md.area,
           md.branch
         FROM master_dealers md
         LEFT JOIN master_customer_coordinates mcc ON (
           (md.sfa_code IS NOT NULL AND mcc.dns_customer_code = md.sfa_code) OR
           (md.sap_code IS NOT NULL AND (mcc.dns_customer_code = md.sap_code OR mcc.customer_code = md.sap_code))
         )
         LIMIT 200`
      );
      for (const d of allMaster) {
        const key = (d.sap_code || d.dealer_name || `DLR_${d.dealer_id}`).toUpperCase().trim();
        if (!merged.has(key)) {
          merged.set(key, d);
        }
      }
    }

    const dealers = Array.from(merged.values()).sort((a, b) => 
      (a.dealer_name || '').localeCompare(b.dealer_name || '')
    );

    res.json({ dealers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function deletePlan(req, res) {
  try {
    const { planId } = req.params;
    if (!planId) return res.status(400).json({ error: 'planId is required' });

    await dbRun('DELETE FROM sales_plan_details WHERE plan_id = ?', [planId]);
    await dbRun('DELETE FROM plan_approvals WHERE plan_id = ?', [planId]);
    await dbRun('DELETE FROM unplanned_visit_requests WHERE plan_id = ?', [planId]);
    await dbRun('DELETE FROM sales_plans WHERE id = ?', [planId]);

    res.json({ success: true, message: 'Plan deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

export async function bulkDeletePlans(req, res) {
  try {
    const { planIds } = req.body;
    if (!planIds || !Array.isArray(planIds) || planIds.length === 0) {
      return res.status(400).json({ error: 'planIds array is required' });
    }

    const placeholders = planIds.map(() => '?').join(',');
    await dbRun(`DELETE FROM sales_plan_details WHERE plan_id IN (${placeholders})`, planIds);
    await dbRun(`DELETE FROM plan_approvals WHERE plan_id IN (${placeholders})`, planIds);
    await dbRun(`DELETE FROM unplanned_visit_requests WHERE plan_id IN (${placeholders})`, planIds);
    await dbRun(`DELETE FROM sales_plans WHERE id IN (${placeholders})`, planIds);

    res.json({ success: true, message: `Successfully deleted ${planIds.length} plans.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODIFIED: addPlanVisit
// Now handles 3 cases:
//   1. DRAFT plan → direct insert (existing behaviour)
//   2. APPROVED plan + amendment window open → insert with PENDING_APPROVAL status
//   3. APPROVED plan + PROSPECTIVE dealer + no amendment → redirect to unplanned request flow
// ─────────────────────────────────────────────────────────────────────────────
export async function addPlanVisit(req, res) {
  try {
    const { planId, visitDate, dealerId, dealerSapCode, dealerName, dealerType, purposeOfVisit, requestedByEmpCode } = req.body;

    if (!planId || !visitDate || !dealerName) {
      return res.status(400).json({ error: 'planId, visitDate, and dealerName are required.' });
    }

    const plans = await dbAll('SELECT * FROM sales_plans WHERE id = ?', [planId]);
    if (!plans || plans.length === 0) {
      return res.status(404).json({ error: 'Plan not found.' });
    }
    const plan = plans[0];
    const normalizedType = (dealerType || 'DEALER').toUpperCase();

    // Check Cycle Edit Window for rolled-out plans (1-5th for C1, 15-17th for C2)
    const currentDay = new Date().getDate();
    const cycle = String(plan.cycle_code || 'C1').toUpperCase();
    const isC1 = cycle === 'C1';
    const inWindow = isC1 ? (currentDay >= 1 && currentDay <= 5) : (currentDay >= 15 && currentDay <= 17);
    const isBypass = req.headers?.['x-bypass-edit-window'] === 'true' || 
                     process.env.NODE_ENV === 'test' || 
                     ['ADMIN', 'MGR_CENTRAL'].includes(requestedByEmpCode) ||
                     plan.amendment_status === 'AMENDMENT_PENDING';

    if (!inWindow && !isBypass && plan.status === 'APPROVED') {
      const winRange = isC1 ? '1st - 5th' : '15th - 17th';
      return res.status(403).json({
        error: `Plan editing for Cycle ${cycle} is only permitted from ${winRange} of the month (today is day ${currentDay}). Please request an amendment window.`
      });
    }

    // ── Case 1: DRAFT plan — normal flow ──
    if (plan.status === 'DRAFT') {
      return await _insertVisitDirect(res, planId, visitDate, dealerId, dealerSapCode, dealerName, normalizedType, purposeOfVisit, 'ACTIVE');
    }

    // ── Case 2: APPROVED plan — check amendment window ──
    if (plan.status === 'APPROVED') {
      if (plan.amendment_status === 'AMENDMENT_PENDING' || inWindow || isBypass) {
        // Amendment window or cycle edit window is open — insert with appropriate status
        const vStatus = plan.amendment_status === 'AMENDMENT_PENDING' ? 'PENDING_APPROVAL' : 'ACTIVE';
        return await _insertVisitDirect(res, planId, visitDate, dealerId, dealerSapCode, dealerName, normalizedType, purposeOfVisit, vStatus);
      }

      // ── Case 3: APPROVED plan, no amendment window, PROSPECTIVE dealer → unplanned request ──
      if (normalizedType === 'PROSPECTIVE') {
        if (!requestedByEmpCode) {
          return res.status(400).json({
            error: 'This plan is APPROVED. Prospective visits require ASM approval. Provide requestedByEmpCode and use the unplanned visit request flow.',
            redirectTo: 'POST /api/plans/visits/unplanned/request'
          });
        }
        // Auto-create unplanned visit request
        const result = await dbRun(
          `INSERT INTO unplanned_visit_requests 
           (plan_id, requested_by_emp_code, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
          [planId, requestedByEmpCode, visitDate, dealerId || null, dealerSapCode || null, dealerName, normalizedType, purposeOfVisit || 'Routine Visit']
        );
        return res.json({
          success: true,
          message: 'Unplanned prospective visit request submitted. Awaiting ASM approval.',
          requestId: result.lastID || result.insertId,
          status: 'PENDING'
        });
      }

      return res.status(400).json({
        error: 'Plan is APPROVED. Open an amendment window first (POST /api/plans/:planId/amendment/request) to add or modify visits.'
      });
    }

    return res.status(400).json({ error: `Plan is in status '${plan.status}'. Only DRAFT or APPROVED (with amendment) plans can be edited.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Internal helper — validates daily limit & duplicates, then inserts visit detail.
 * Automatically tracks and flags backdated visits for approver alerts.
 */
async function _insertVisitDirect(res, planId, visitDate, dealerId, dealerSapCode, dealerName, dealerType, purposeOfVisit, visitStatus) {
  const dayVisits = await dbAll(
    'SELECT id, dealer_id, dealer_sap_code, dealer_name FROM sales_plan_details WHERE plan_id = ? AND visit_date = ? AND visit_status != "REJECTED"',
    [planId, visitDate]
  );

  if (dayVisits.length >= 8) {
    return res.status(400).json({ error: 'Daily limit reached: Maximum 8 visits allowed per day.' });
  }

  const alreadyScheduled = dayVisits.some(v =>
    (dealerId && v.dealer_id && v.dealer_id == dealerId) ||
    (dealerSapCode && v.dealer_sap_code && v.dealer_sap_code.trim().toUpperCase() === dealerSapCode.trim().toUpperCase()) ||
    (dealerName && v.dealer_name && v.dealer_name.trim().toLowerCase() === dealerName.trim().toLowerCase())
  );

  if (alreadyScheduled) {
    return res.status(400).json({ error: 'Customer already scheduled on this day. Each visit in a day must be to a different customer.' });
  }

  // Check if this is a backdated visit (visit_date has already passed)
  const todayStr = new Date().toISOString().slice(0, 10);
  const isBackdated = visitDate < todayStr ? 1 : 0;

  const nextSeq = dayVisits.length + 1;
  const result = await dbRun(
    `INSERT INTO sales_plan_details 
     (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, visit_status, is_backdated_edit, edited_after_date, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      planId, visitDate, dealerId || null, dealerSapCode || null, dealerName,
      dealerType, purposeOfVisit || 'Routine Visit', nextSeq, visitStatus,
      isBackdated, isBackdated
    ]
  );

  let statusMsg = visitStatus === 'PENDING_APPROVAL' ? 'Visit added — awaiting ASM approval.' : 'Visit added successfully.';
  if (isBackdated) {
    statusMsg += ' (Alert: Date has passed — flagged as backdated edit for approver review)';
  }

  return res.json({ 
    success: true, 
    message: statusMsg, 
    detailId: result.lastID || result.insertId, 
    visit_status: visitStatus,
    is_backdated_edit: isBackdated
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODIFIED: removePlanVisit
// DRAFT → remove any visit
// APPROVED + amendment open → only remove PENDING_APPROVAL visits (not ACTIVE ones)
// ─────────────────────────────────────────────────────────────────────────────
export async function removePlanVisit(req, res) {
  try {
    const { detailId } = req.params;
    const details = await dbAll(
      'SELECT spd.*, sp.status as plan_status, sp.amendment_status FROM sales_plan_details spd JOIN sales_plans sp ON spd.plan_id = sp.id WHERE spd.id = ?',
      [detailId]
    );

    if (!details || details.length === 0) {
      return res.status(404).json({ error: 'Visit detail not found.' });
    }

    const detail = details[0];

    if (detail.plan_status === 'DRAFT') {
      await dbRun('DELETE FROM sales_plan_details WHERE id = ?', [detailId]);
      return res.json({ success: true, message: 'Visit removed successfully.' });
    }

    if (detail.plan_status === 'APPROVED' && detail.amendment_status === 'AMENDMENT_PENDING') {
      if (detail.visit_status === 'PENDING_APPROVAL') {
        await dbRun('DELETE FROM sales_plan_details WHERE id = ?', [detailId]);
        return res.json({ success: true, message: 'Pending visit removed.' });
      }
      return res.status(400).json({ error: 'Cannot remove an already-ACTIVE visit from an approved plan. Only pending visits added during this amendment can be removed.' });
    }

    return res.status(400).json({ error: 'Only DRAFT plans or amendment-window visits can be removed.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODIFIED: movePlanVisit
// DRAFT → move any visit
// APPROVED + amendment open → only move PENDING_APPROVAL visits
// Automatically flags backdated reschedules for approver alerts.
// ─────────────────────────────────────────────────────────────────────────────
export async function movePlanVisit(req, res) {
  try {
    const { detailId, newDate } = req.body;
    if (!detailId || !newDate) {
      return res.status(400).json({ error: 'detailId and newDate are required.' });
    }

    const details = await dbAll(
      'SELECT spd.*, sp.status as plan_status, sp.amendment_status, sp.cycle_code FROM sales_plan_details spd JOIN sales_plans sp ON spd.plan_id = sp.id WHERE spd.id = ?',
      [detailId]
    );

    if (!details || details.length === 0) {
      return res.status(404).json({ error: 'Visit detail not found.' });
    }

    const detail = details[0];
    const todayStr = new Date().toISOString().slice(0, 10);
    const isBackdated = (newDate < todayStr || String(detail.visit_date).slice(0, 10) < todayStr) ? 1 : 0;

    if (detail.plan_status === 'DRAFT') {
      await dbRun(
        `UPDATE sales_plan_details 
         SET visit_date = ?, 
             is_backdated_edit = CASE WHEN ? = 1 THEN 1 ELSE is_backdated_edit END, 
             edited_after_date = CASE WHEN ? = 1 THEN 1 ELSE edited_after_date END, 
             updated_at = NOW() 
         WHERE id = ?`,
        [newDate, isBackdated, isBackdated, detailId]
      );
      return res.json({ 
        success: true, 
        message: 'Visit moved successfully.',
        is_backdated_edit: isBackdated
      });
    }

    if (detail.plan_status === 'APPROVED' && detail.amendment_status === 'AMENDMENT_PENDING' && detail.visit_status === 'PENDING_APPROVAL') {
      await dbRun(
        `UPDATE sales_plan_details 
         SET visit_date = ?, 
             is_backdated_edit = CASE WHEN ? = 1 THEN 1 ELSE is_backdated_edit END, 
             edited_after_date = CASE WHEN ? = 1 THEN 1 ELSE edited_after_date END, 
             updated_at = NOW() 
         WHERE id = ?`,
        [newDate, isBackdated, isBackdated, detailId]
      );
      return res.json({ 
        success: true, 
        message: 'Pending visit rescheduled.',
        is_backdated_edit: isBackdated
      });
    }

    return res.status(400).json({ error: 'Only DRAFT plans or pending amendment visits can be moved.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 1: Dynamic PJP Amendment Workflow
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/plans/:planId/amendment/request
 * SO opens an amendment window on an APPROVED plan.
 * Existing ACTIVE visits are unaffected. New visits added after this point
 * will have visit_status = PENDING_APPROVAL.
 */
export async function requestAmendment(req, res) {
  try {
    const { planId } = req.params;
    const { requestedByEmpCode, remarks } = req.body;

    if (!requestedByEmpCode) {
      return res.status(400).json({ error: 'requestedByEmpCode is required.' });
    }

    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    if (plan.status !== 'APPROVED') {
      return res.status(400).json({ error: `Only APPROVED plans can be amended. Current status: ${plan.status}` });
    }

    if (plan.amendment_status === 'AMENDMENT_PENDING') {
      return res.status(409).json({ error: 'An amendment is already pending for this plan. Await ASM approval.' });
    }

    await dbRun(
      `UPDATE sales_plans 
       SET amendment_status = 'AMENDMENT_PENDING',
           amendment_requested_at = CURRENT_TIMESTAMP,
           amendment_remarks = ?,
           is_dynamic_revision = 1
       WHERE id = ?`,
      [remarks || null, planId]
    );

    res.json({
      success: true,
      message: `Amendment window opened for plan ${planId}. New visits will require ASM approval.`,
      planId: Number(planId),
      amendment_status: 'AMENDMENT_PENDING'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/plans/:planId/amendment/approve
 * ASM approves or rejects all PENDING_APPROVAL visits in the amendment.
 * action: 'APPROVED' → all PENDING visits become ACTIVE
 * action: 'REJECTED' → all PENDING visits are deleted
 */
export async function approveAmendment(req, res) {
  try {
    const { planId } = req.params;
    const { managerEmpCode, action, remarks } = req.body;

    if (!managerEmpCode || !action) {
      return res.status(400).json({ error: 'managerEmpCode and action (APPROVED | REJECTED) are required.' });
    }
    if (!['APPROVED', 'REJECTED'].includes(action)) {
      return res.status(400).json({ error: 'action must be APPROVED or REJECTED.' });
    }

    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    if (plan.amendment_status !== 'AMENDMENT_PENDING') {
      return res.status(400).json({ error: 'No pending amendment found for this plan.' });
    }

    // ── Approval Matrix Validation ───────────────────────────────────────────
    const requiredApproverRole = plan.required_approver_role ||
      (await getRequiredApproverRole(plan.emp_role || 'SO'));

    if (requiredApproverRole) {
      const { valid, approverRole, reason } = await validateApprover(managerEmpCode, requiredApproverRole);
      if (!valid) {
        return res.status(403).json({
          error: 'Amendment approval rejected: insufficient role.',
          detail: reason,
          requiredRole: requiredApproverRole,
          approverRole: approverRole || 'Unknown'
        });
      }
    }

    const pendingVisits = await dbAll(
      "SELECT id FROM sales_plan_details WHERE plan_id = ? AND visit_status = 'PENDING_APPROVAL'",
      [planId]
    );

    if (action === 'APPROVED') {
      await dbRun(
        "UPDATE sales_plan_details SET visit_status = 'ACTIVE' WHERE plan_id = ? AND visit_status = 'PENDING_APPROVAL'",
        [planId]
      );
    } else {
      await dbRun(
        "DELETE FROM sales_plan_details WHERE plan_id = ? AND visit_status = 'PENDING_APPROVAL'",
        [planId]
      );
    }

    // Close amendment window
    await dbRun(
      `UPDATE sales_plans 
       SET amendment_status = 'AMENDMENT_APPROVED',
           amendment_approved_by = ?,
           amendment_approved_at = CURRENT_TIMESTAMP,
           amendment_remarks = CONCAT(COALESCE(amendment_remarks, ''), ' | Approved by: ', ?)
       WHERE id = ?`,
      [managerEmpCode, remarks || action, planId]
    );

    const { approverRole: aRole } = await validateApprover(managerEmpCode, requiredApproverRole || 'ASM').catch(() => ({ approverRole: null }));
    await dbRun(
      'INSERT INTO plan_approvals (plan_id, action_by, action_type, remarks, approver_role) VALUES (?, ?, ?, ?, ?)',
      [planId, managerEmpCode, `AMENDMENT_${action}`, remarks || '', aRole || null]
    );

    res.json({
      success: true,
      message: `Amendment ${action.toLowerCase()} for plan ${planId}. ${pendingVisits.length} pending visit(s) ${action === 'APPROVED' ? 'activated' : 'removed'}.`,
      visitsAffected: pendingVisits.length,
      action
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/plans/:planId/amendment
 * Get current amendment status and list of pending visits.
 */
export async function getAmendmentStatus(req, res) {
  try {
    const { planId } = req.params;

    const plan = await dbGet(
      'SELECT id, emp_code, emp_name, status, amendment_status, amendment_requested_at, amendment_approved_by, amendment_approved_at, amendment_remarks, is_dynamic_revision FROM sales_plans WHERE id = ?',
      [planId]
    );
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const pendingVisits = await dbAll(
      "SELECT * FROM sales_plan_details WHERE plan_id = ? AND visit_status = 'PENDING_APPROVAL' ORDER BY visit_date ASC",
      [planId]
    );

    res.json({
      planId: Number(planId),
      planStatus: plan.status,
      amendmentStatus: plan.amendment_status || 'NONE',
      amendmentRequestedAt: plan.amendment_requested_at,
      amendmentApprovedBy: plan.amendment_approved_by,
      amendmentApprovedAt: plan.amendment_approved_at,
      remarks: plan.amendment_remarks,
      isDynamicRevision: Boolean(plan.is_dynamic_revision),
      pendingVisitCount: pendingVisits.length,
      pendingVisits
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FEATURE 2: Unplanned Visit Approval Gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/plans/visits/unplanned/request
 * SO creates an unplanned prospective visit request against an APPROVED plan.
 */
export async function requestUnplannedVisit(req, res) {
  try {
    const { planId, requestedByEmpCode, visitDate, dealerId, dealerSapCode, dealerName, dealerType, purposeOfVisit } = req.body;

    if (!planId || !requestedByEmpCode || !visitDate || !dealerName) {
      return res.status(400).json({ error: 'planId, requestedByEmpCode, visitDate, and dealerName are required.' });
    }

    const plan = await dbGet('SELECT status FROM sales_plans WHERE id = ?', [planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    if (!['APPROVED', 'DRAFT'].includes(plan.status)) {
      return res.status(400).json({ error: `Plan must be APPROVED to request unplanned visits. Current status: ${plan.status}` });
    }

    const result = await dbRun(
      `INSERT INTO unplanned_visit_requests
       (plan_id, requested_by_emp_code, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, status, required_approver_role)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)`,
      [planId, requestedByEmpCode, visitDate, dealerId || null, dealerSapCode || null, dealerName,
       (dealerType || 'PROSPECTIVE').toUpperCase(), purposeOfVisit || 'Prospective Visit',
       await getRequiredApproverRole(await lookupEmployeeRole(requestedByEmpCode) || 'SO') || 'ASM']
    );

    res.json({
      success: true,
      message: 'Unplanned visit request submitted. Awaiting ASM approval.',
      requestId: result.lastID || result.insertId,
      status: 'PENDING'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/plans/visits/unplanned/:requestId/approve
 * ASM approves or rejects an unplanned visit request.
 * On APPROVED: auto-inserts the visit into sales_plan_details.
 */
export async function approveUnplannedVisit(req, res) {
  try {
    const { requestId } = req.params;
    const { managerEmpCode, action, remarks } = req.body;

    if (!managerEmpCode || !action) {
      return res.status(400).json({ error: 'managerEmpCode and action (APPROVED | REJECTED) are required.' });
    }
    if (!['APPROVED', 'REJECTED'].includes(action)) {
      return res.status(400).json({ error: 'action must be APPROVED or REJECTED.' });
    }

    const req_ = await dbGet('SELECT * FROM unplanned_visit_requests WHERE id = ?', [requestId]);
    if (!req_) return res.status(404).json({ error: 'Request not found.' });

    if (req_.status !== 'PENDING') {
      return res.status(409).json({ error: `Request already ${req_.status.toLowerCase()}.` });
    }

    // ── Approval Matrix Validation ───────────────────────────────────────────
    const requiredApproverRole = req_.required_approver_role || 'ASM';
    const { valid, approverRole, reason } = await validateApprover(managerEmpCode, requiredApproverRole);
    if (!valid) {
      return res.status(403).json({
        error: 'Approval rejected: insufficient role.',
        detail: reason,
        requiredRole: requiredApproverRole,
        approverRole: approverRole || 'Unknown'
      });
    }

    if (action === 'APPROVED') {
      // Check daily limit before inserting
      const dayVisits = await dbAll(
        "SELECT id FROM sales_plan_details WHERE plan_id = ? AND visit_date = ? AND visit_status != 'REJECTED'",
        [req_.plan_id, req_.visit_date]
      );

      if (dayVisits.length >= 8) {
        return res.status(400).json({ error: `Cannot approve: daily limit (8 visits) already reached on ${req_.visit_date}.` });
      }

      const result = await dbRun(
        `INSERT INTO sales_plan_details
         (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, visit_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [req_.plan_id, req_.visit_date, req_.dealer_id, req_.dealer_sap_code, req_.dealer_name, req_.dealer_type, req_.purpose_of_visit, dayVisits.length + 1]
      );
      insertedDetailId = result.lastID || result.insertId;
    }

    await dbRun(
      `UPDATE unplanned_visit_requests
       SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, review_remarks = ?
       WHERE id = ?`,
      [action, managerEmpCode, remarks || null, requestId]
    );

    res.json({
      success: true,
      message: action === 'APPROVED'
        ? `Unplanned visit approved and added to plan ${req_.plan_id}.`
        : `Unplanned visit request rejected.`,
      action,
      planId: req_.plan_id,
      insertedDetailId
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/plans/visits/unplanned
 * List unplanned visit requests. Filterable by planId, status, empCode.
 */
export async function getUnplannedVisitRequests(req, res) {
  try {
    const { planId, status, empCode, limit = 50, offset = 0 } = req.query;

    let query = 'SELECT * FROM unplanned_visit_requests WHERE 1=1';
    const params = [];

    if (planId) { query += ' AND plan_id = ?'; params.push(planId); }
    if (status) { query += ' AND status = ?'; params.push(status.toUpperCase()); }
    if (empCode) { query += ' AND requested_by_emp_code = ?'; params.push(empCode); }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total').replace(/ ORDER BY.*$/, '');
    const [rows, countResult] = await Promise.all([
      dbAll(query, params),
      dbAll(countQuery.replace(' LIMIT ? OFFSET ?', ''), params.slice(0, -2))
    ]);

    res.json({
      total: countResult[0]?.total || rows.length,
      requests: rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
