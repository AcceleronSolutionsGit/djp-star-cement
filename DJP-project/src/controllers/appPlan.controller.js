/**
 * App Plan Controller — ID-scoped endpoints for the field app
 *
 * Every route carries the employee's code in the path. There are no tokens and
 * no session: the app tells us who it is, and each handler checks that the
 * person named in the path actually owns (or approves) the plan being touched.
 *
 * Workflow this implements
 * ------------------------
 *   generation  →  DRAFT
 *   agent edits the DRAFT, then submits      →  SUBMITTED
 *   L1 approves                              →  APPROVED   (end)
 *   L1 sends back for rectification          →  RECTIFY    (allowed ONCE)
 *   agent edits and re-submits               →  SUBMITTED
 *   L1 must now approve — a second RECTIFY is refused
 *
 * Only L1 is involved. There is no second approval level.
 */

import { dbAll, dbGet, dbRun } from '../config/database.js';
import {
  canEdit,
  canApprove,
  stampPlanRouting,
  resolveEmployeeRole,
  resolveEmployeeName,
  resolveL1Approver,
  MAX_RECTIFICATIONS
} from '../services/planRouting.service.js';

const HARD_DAILY_CAP = 8;

// ─────────────────────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractGradeAndCategory(purpose) {
  if (!purpose) return { grade: null, category: null };
  const m = String(purpose).match(/\(([A-D])\s*[-–]\s*([^)]+)\)/i);
  if (m) {
    return { grade: m[1].toUpperCase(), category: m[2].trim() };
  }
  return { grade: null, category: null };
}

const norm = v => String(v ?? '').trim();
const same = (a, b) => norm(a).toUpperCase() === norm(b).toUpperCase();

async function loadCycleWindow() {
  const rows = await dbAll(
    `SELECT rule_key, rule_value FROM business_rules
     WHERE rule_key IN ('c1_start_day','c1_end_day','c2_start_day','c2_end_day',
                        'daily_visit_capacity','daily_visit_capacity_asm','daily_visit_capacity_rsm')`
  );
  const r = Object.fromEntries(rows.map(x => [x.rule_key, x.rule_value]));
  return {
    C1: { start: parseInt(r.c1_start_day || '1', 10),  end: parseInt(r.c1_end_day || '15', 10) },
    C2: { start: parseInt(r.c2_start_day || '16', 10), end: parseInt(r.c2_end_day || '31', 10) },
    capacity: {
      SO:  parseInt(r.daily_visit_capacity      || '8', 10),
      ASM: parseInt(r.daily_visit_capacity_asm  || '5', 10),
      RSM: parseInt(r.daily_visit_capacity_rsm  || '3', 10),
      ZH:  HARD_DAILY_CAP
    }
  };
}

function dayOf(dateStr) {
  return parseInt(String(dateStr).slice(8, 10), 10);
}

function monthOf(dateStr) {
  return String(dateStr).slice(0, 7);
}

/**
 * What the app is allowed to render as a button, derived from state alone so
 * the client never has to encode the rules itself.
 */
function actionsFor(plan, viewerIsOwner) {
  const editable = ['DRAFT', 'RECTIFY'].includes(plan.status);
  const rectifiedAlready = (plan.rectification_count || 0) >= MAX_RECTIFICATIONS;
  return {
    can_edit:    viewerIsOwner && editable,
    can_submit:  viewerIsOwner && editable,
    can_approve: !viewerIsOwner && plan.status === 'SUBMITTED',
    can_rectify: !viewerIsOwner && plan.status === 'SUBMITTED' && !rectifiedAlready,
    rectify_blocked_reason: rectifiedAlready
      ? 'This plan has already been sent back once. The only remaining action is Approve.'
      : null
  };
}

async function planSummaryRows(where, params) {
  return dbAll(
    `SELECT
       sp.*,
       (SELECT COUNT(*)                    FROM sales_plan_details d WHERE d.plan_id = sp.id) AS total_visits,
       (SELECT COUNT(DISTINCT d.dealer_sap_code) FROM sales_plan_details d WHERE d.plan_id = sp.id) AS total_dealers,
       (SELECT COUNT(DISTINCT d.visit_date)      FROM sales_plan_details d WHERE d.plan_id = sp.id) AS total_days,
       (SELECT MIN(d.visit_date)           FROM sales_plan_details d WHERE d.plan_id = sp.id) AS first_visit_date,
       (SELECT MAX(d.visit_date)           FROM sales_plan_details d WHERE d.plan_id = sp.id) AS last_visit_date
     FROM sales_plans sp
     WHERE ${where}
     ORDER BY sp.period_month DESC, sp.cycle_code ASC, sp.id DESC`,
    params
  );
}

function shapeSummary(p, viewerIsOwner) {
  const empRole = p.emp_role || 'SO';
  const approverRole = p.l1_approver_role || p.required_approver_role || (empRole === 'ZH' ? 'ADMIN' : (empRole === 'RSM' ? 'ZH' : (empRole === 'ASM' ? 'RSM' : 'ASM')));
  const approverName = p.l1_approver_name || (approverRole === 'ADMIN' ? 'Admin' : null);

  return {
    plan_id: p.id,
    period_month: p.period_month,
    cycle_code: p.cycle_code,
    status: p.status,
    employee: {
      emp_code: p.emp_code,
      emp_name: p.emp_name || null,
      role: empRole
    },
    approver: {
      emp_code: p.l1_approver_emp_code ?? null,
      name: approverName,
      role: approverRole
    },
    counts: {
      visits: Number(p.total_visits || 0),
      dealers: Number(p.total_dealers || 0),
      working_days: Number(p.total_days || 0)
    },
    date_range: { from: p.first_visit_date, to: p.last_visit_date },
    rectification: {
      count: Number(p.rectification_count || 0),
      remaining: Math.max(0, MAX_RECTIFICATIONS - Number(p.rectification_count || 0)),
      requested_by: p.rectify_requested_by,
      requested_at: p.rectify_requested_at,
      remarks: p.rectify_remarks
    },
    timestamps: {
      created_at: p.created_at,
      submitted_at: p.submitted_at,
      resubmitted_at: p.resubmitted_at,
      approved_at: p.approved_at,
      last_edited_at: p.last_edited_at
    },
    actions: actionsFor(p, viewerIsOwner)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT — list view
// GET /api/app/officers/:empCode/plans?month=YYYY-MM&cycle=C1&status=DRAFT
// ─────────────────────────────────────────────────────────────────────────────
export async function listMyPlans(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    if (!empCode) return res.status(400).json({ error: 'empCode is required in the path.' });

    const { month, cycle, status } = req.query;
    let where = 'UPPER(TRIM(sp.emp_code)) = UPPER(TRIM(?))';
    const params = [empCode];
    if (month)  { where += ' AND sp.period_month = ?'; params.push(month); }
    if (cycle)  { where += ' AND sp.cycle_code = ?';   params.push(String(cycle).toUpperCase()); }
    if (status) { where += ' AND sp.status = ?';       params.push(String(status).toUpperCase()); }

    const rows = await planSummaryRows(where, params);

    for (const r of rows) {
      if (!r.emp_name) {
        const resEmp = await resolveEmployeeName(r.emp_code, r.emp_role);
        if (resEmp?.name) r.emp_name = resEmp.name;
      }
      if (!r.emp_role) {
        r.emp_role = await resolveEmployeeRole(r.emp_code);
      }
      if (!r.l1_approver_emp_code && r.emp_role !== 'ZH') {
        const l1 = await resolveL1Approver(r.emp_code, r.emp_role);
        if (l1?.empCode) {
          r.l1_approver_emp_code = l1.empCode;
          r.l1_approver_name = l1.name;
          r.l1_approver_role = l1.role;
          dbRun(
            `UPDATE sales_plans SET emp_role = ?, l1_approver_emp_code = ?, l1_approver_name = ?, l1_approver_role = ? WHERE id = ?`,
            [r.emp_role, l1.empCode, l1.name, l1.role, r.id]
          ).catch(() => {});
        } else if (l1?.role) {
          r.l1_approver_role = l1.role;
          if (l1.role === 'ADMIN') r.l1_approver_name = 'Admin';
        }
      } else if (r.emp_role === 'ZH') {
        r.l1_approver_role = 'ADMIN';
        r.l1_approver_name = r.l1_approver_name || 'Admin';
      } else if (r.l1_approver_emp_code && !r.l1_approver_name) {
        const resAppr = await resolveEmployeeName(r.l1_approver_emp_code, r.l1_approver_role);
        if (resAppr?.name) {
          r.l1_approver_name = resAppr.name;
          dbRun(`UPDATE sales_plans SET l1_approver_name = ? WHERE id = ?`, [resAppr.name, r.id]).catch(() => {});
        }
      }
    }

    const resolvedRole = rows[0]?.emp_role || (await resolveEmployeeRole(empCode));
    const resolvedName = rows[0]?.emp_name || (await resolveEmployeeName(empCode, resolvedRole))?.name || null;

    res.json({
      emp_code: empCode,
      emp_name: resolvedName,
      role: resolvedRole,
      count: rows.length,
      plans: rows.map(p => shapeSummary(p, true))
    });
  } catch (err) {
    console.error('[listMyPlans]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT — home screen counters
// GET /api/app/officers/:empCode/summary?month=YYYY-MM
// ─────────────────────────────────────────────────────────────────────────────
export async function getMySummary(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const { month } = req.query;

    const params = [empCode];
    let where = 'UPPER(TRIM(emp_code)) = UPPER(TRIM(?))';
    if (month) { where += ' AND period_month = ?'; params.push(month); }

    const byStatus = await dbAll(
      `SELECT status, COUNT(*) AS n FROM sales_plans WHERE ${where} GROUP BY status`, params
    );
    const role = await resolveEmployeeRole(empCode);
    const nameRes = await resolveEmployeeName(empCode, role);

    const inboxParams = [empCode];
    let inboxWhere = "UPPER(TRIM(l1_approver_emp_code)) = UPPER(TRIM(?)) AND status = 'SUBMITTED'";
    if (month) { inboxWhere += ' AND period_month = ?'; inboxParams.push(month); }
    const inbox = await dbGet(`SELECT COUNT(*) AS n FROM sales_plans WHERE ${inboxWhere}`, inboxParams);

    res.json({
      emp_code: empCode,
      emp_name: nameRes?.name || null,
      role,
      month: month || 'ALL',
      my_plans: Object.fromEntries(byStatus.map(r => [r.status, Number(r.n)])),
      awaiting_my_approval: Number(inbox?.n || 0),
      action_required: Number(
        (byStatus.find(r => r.status === 'DRAFT')?.n || 0)
      ) + Number(
        (byStatus.find(r => r.status === 'RECTIFY')?.n || 0)
      )
    });
  } catch (err) {
    console.error('[getMySummary]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// detail view (shared by agent and approver)
// GET /api/app/officers/:empCode/plans/:planId
// GET /api/app/approvers/:empCode/plans/:planId
// ─────────────────────────────────────────────────────────────────────────────
async function buildDetail(plan, viewerIsOwner) {
  // 1. Resolve employee and approver metadata on the plan if missing
  if (!plan.emp_name) {
    const resEmp = await resolveEmployeeName(plan.emp_code, plan.emp_role);
    if (resEmp?.name) plan.emp_name = resEmp.name;
  }
  if (!plan.emp_role) {
    plan.emp_role = await resolveEmployeeRole(plan.emp_code);
  }
  if (!plan.l1_approver_emp_code && plan.emp_role !== 'ZH') {
    const l1 = await resolveL1Approver(plan.emp_code, plan.emp_role);
    if (l1?.empCode) {
      plan.l1_approver_emp_code = l1.empCode;
      plan.l1_approver_name = l1.name;
      plan.l1_approver_role = l1.role;
      dbRun(
        `UPDATE sales_plans SET emp_role = ?, l1_approver_emp_code = ?, l1_approver_name = ?, l1_approver_role = ? WHERE id = ?`,
        [plan.emp_role, l1.empCode, l1.name, l1.role, plan.id]
      ).catch(() => {});
    } else if (l1?.role) {
      plan.l1_approver_role = l1.role;
      if (l1.role === 'ADMIN') plan.l1_approver_name = 'Admin';
    }
  } else if (plan.emp_role === 'ZH') {
    plan.l1_approver_role = 'ADMIN';
    plan.l1_approver_name = plan.l1_approver_name || 'Admin';
  } else if (plan.l1_approver_emp_code && !plan.l1_approver_name) {
    const resAppr = await resolveEmployeeName(plan.l1_approver_emp_code, plan.l1_approver_role);
    if (resAppr?.name) {
      plan.l1_approver_name = resAppr.name;
      dbRun(`UPDATE sales_plans SET l1_approver_name = ? WHERE id = ?`, [resAppr.name, plan.id]).catch(() => {});
    }
  }

  // 2. Resolve canonical period & cycle in dealer_visit_targets
  const targetPeriodCheck = await dbGet(
    `SELECT period_month FROM dealer_visit_targets WHERE period_month = ? LIMIT 1`,
    [plan.period_month]
  );
  const targetPeriod = targetPeriodCheck?.period_month || (
    await dbGet(`SELECT period_month FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1`)
  )?.period_month || plan.period_month;

  const targetCycleCheck = await dbGet(
    `SELECT cycle_code FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ? LIMIT 1`,
    [targetPeriod, plan.cycle_code]
  );
  const targetCycle = targetCycleCheck?.cycle_code || 'C1';

  const visits = await dbAll(
    `SELECT
       d.id            AS detail_id,
       d.visit_date,
       d.sequence,
       COALESCE(d.dealer_id, md.id, dvt.dealer_id) AS dealer_id,
       COALESCE(d.dealer_sap_code, md.sap_code, dvt.sap_code, md.sfa_code, dvt.sfa_code) AS dealer_sap_code,
       COALESCE(d.dealer_name, md.dealer_name, dvt.dealer_name) AS dealer_name,
       COALESCE(d.dealer_type, md.dealer_type, 'DEALER') AS dealer_type,
       d.purpose_of_visit,
       COALESCE(d.visit_status, 'ACTIVE') AS visit_status,
       COALESCE(d.source, 'AUTO')         AS source,
       COALESCE(dvt.dealer_status, dvt.category) AS final_category,
       COALESCE(dvt.category, dvt.grade) AS grade,
       COALESCE(dvt.priority, 0) AS priority_score,
       COALESCE(dvt.area, md.area, m.area) AS area,
       COALESCE(dvt.zone, md.zone, m.region) AS zone,
       COALESCE(md.block, dvt.block, dvt.sbg_block, m.block) AS block,
       COALESCE(md.sfa_code, dvt.sfa_code) AS sfa_code
     FROM sales_plan_details d
     LEFT JOIN master_dealers md 
            ON (d.dealer_id IS NOT NULL AND md.id = d.dealer_id)
            OR (d.dealer_sap_code IS NOT NULL AND (
                 UPPER(TRIM(md.sap_code)) = UPPER(TRIM(d.dealer_sap_code))
              OR UPPER(TRIM(md.sfa_code)) = UPPER(TRIM(d.dealer_sap_code))
            ))
     LEFT JOIN dealer_visit_targets dvt
            ON (
                 (d.dealer_sap_code IS NOT NULL AND (
                      UPPER(TRIM(dvt.sap_code)) = UPPER(TRIM(d.dealer_sap_code))
                   OR UPPER(TRIM(dvt.sfa_code)) = UPPER(TRIM(d.dealer_sap_code))
                 ))
              OR (d.dealer_id IS NOT NULL AND dvt.dealer_id = d.dealer_id)
              OR (md.sap_code IS NOT NULL AND UPPER(TRIM(dvt.sap_code)) = UPPER(TRIM(md.sap_code)))
              OR (md.sfa_code IS NOT NULL AND UPPER(TRIM(dvt.sfa_code)) = UPPER(TRIM(md.sfa_code)))
            )
           AND dvt.period_month = ?
           AND dvt.cycle_code   = ?
     LEFT JOIN master_dealer_so_mapping m
            ON (d.dealer_sap_code IS NOT NULL AND UPPER(TRIM(m.sap_code)) = UPPER(TRIM(d.dealer_sap_code)))
            OR (md.sap_code IS NOT NULL AND UPPER(TRIM(m.sap_code)) = UPPER(TRIM(md.sap_code)))
     WHERE d.plan_id = ?
     ORDER BY d.visit_date ASC, d.sequence ASC`,
    [targetPeriod, targetCycle, plan.id]
  );

  for (const v of visits) {
    if (!v.final_category || !v.grade) {
      const parsed = extractGradeAndCategory(v.purpose_of_visit);
      if (!v.grade && parsed.grade) v.grade = parsed.grade;
      if (!v.final_category && parsed.category) v.final_category = parsed.category;
    }
    if (!v.grade) v.grade = 'A';
    if (!v.final_category) v.final_category = 'Growing';
    if (!v.area) v.area = 'AGARTALA';
    if (!v.zone) v.zone = 'NE2';
    if (!v.block) v.block = v.area || 'AGARTALA';
    if (!v.sfa_code && v.dealer_sap_code && !/^\d+$/.test(v.dealer_sap_code)) {
      v.sfa_code = v.dealer_sap_code;
    }
  }

  const byDay = new Map();
  for (const v of visits) {
    const k = String(v.visit_date).slice(0, 10);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(v);
  }

  // Which of these visits has actually been made. One query for the whole plan rather
  // than one per visit; matched on (day, customer code) exactly as the SFA report is,
  // and on either code because a prospect is logged under its SFA code.
  const executed = await dbAll(
    `SELECT visit_date, customer_code, check_in_time, check_out_time, visit_status
       FROM visit_execution_logs
      WHERE employee_code = ?
        AND visit_date BETWEEN ? AND ?`,
    [plan.emp_code, `${plan.period_month}-01`, `${plan.period_month}-31`]
  ).catch(() => []);
  const executedBy = new Map();
  for (const e of executed) {
    executedBy.set(`${String(e.visit_date).slice(0, 10)}|${norm(e.customer_code).toUpperCase()}`, e);
  }
  const executionFor = v => executedBy.get(
      `${String(v.visit_date).slice(0, 10)}|${norm(v.dealer_sap_code).toUpperCase()}`)
    || executedBy.get(
      `${String(v.visit_date).slice(0, 10)}|${norm(v.sfa_code).toUpperCase()}`)
    || null;

  // SELECT * on purpose: the timestamp column is action_date in schema.sql but
  // created_at on installs built by the workflow migration. Naming either one in
  // the SELECT throws on the other half of the estate, and the .catch() below
  // turns that into a silently empty approval trail. Read the row, normalise here.
  const historyRows = await dbAll(
    `SELECT * FROM plan_approvals WHERE plan_id = ? ORDER BY id ASC`,
    [plan.id]
  ).catch(() => []);
  const history = historyRows.map(h => ({
    action_by: h.action_by,
    action_type: h.action_type,
    approver_role: h.approver_role ?? null,
    remarks: h.remarks ?? null,
    created_at: h.created_at ?? h.action_date ?? null
  }));

  const categoryMix = visits.reduce((acc, v) => {
    const k = v.final_category || 'Unclassified';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  // Every day this plan may legally hold a visit — not only the days that already
  // have one. Without it the app can only offer days that are already in use, so an
  // officer can never open a new day, even though the API would accept it.
  const cycles = await loadCycleWindow();
  const win = cycles[plan.cycle_code] || cycles.C1;
  const [wy, wm] = String(plan.period_month).split('-').map(Number);
  const lastDayOfMonth = new Date(Date.UTC(wy, wm, 0)).getUTCDate();
  const allowedDays = [];
  for (let d = win.start; d <= Math.min(win.end, lastDayOfMonth); d++) {
    allowedDays.push(`${plan.period_month}-${String(d).padStart(2, '0')}`);
  }
  const dailyCap = Math.min(
    cycles.capacity[plan.emp_role || 'SO'] ?? HARD_DAILY_CAP, HARD_DAILY_CAP);

  return {
    ...shapeSummary({ ...plan,
      total_visits: visits.length,
      total_dealers: new Set(visits.map(v => v.dealer_sap_code)).size,
      total_days: byDay.size,
      first_visit_date: visits[0]?.visit_date || null,
      last_visit_date: visits[visits.length - 1]?.visit_date || null
    }, viewerIsOwner),
    category_mix: categoryMix,
    cycle_window: {
      from: allowedDays[0] || null,
      to: allowedDays[allowedDays.length - 1] || null,
      daily_cap: dailyCap,
      days: allowedDays.map(date => ({
        visit_date: date,
        visit_count: (byDay.get(date) || []).length,
        full: (byDay.get(date) || []).length >= dailyCap
      }))
    },
    days: [...byDay.entries()].map(([date, list]) => ({
      visit_date: date,
      visit_count: list.length,
      visits: list.map(v => ({
        detail_id: v.detail_id,
        sequence: v.sequence,
        dealer: {
          dealer_id: v.dealer_id,
          sap_code: v.dealer_sap_code,
          sfa_code: v.sfa_code,
          name: v.dealer_name,
          type: v.dealer_type,
          area: v.area,
          zone: v.zone,
          block: v.block,
          is_unmapped: v.source === 'UNMAPPED'
        },
        final_category: v.final_category,
        grade: v.grade,
        priority_score: v.priority_score,
        purpose_of_visit: v.purpose_of_visit,
        visit_status: v.visit_status,
        is_unmapped: v.source === 'UNMAPPED',
        // The SFA side of this visit: has the officer actually punched it?
        executed: !!executionFor(v),
        execution: executionFor(v) ? {
          check_in_time:  executionFor(v).check_in_time,
          check_out_time: executionFor(v).check_out_time,
          visit_status:   executionFor(v).visit_status
        } : null,
        source: v.source
      }))
    })),
    history
  };
}

export async function getMyPlanDetail(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [req.params.planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    if (!same(plan.emp_code, empCode)) {
      return res.status(403).json({ error: `Plan ${plan.id} does not belong to ${empCode}.` });
    }
    res.json({ plan: await buildDetail(plan, true) });
  } catch (err) {
    console.error('[getMyPlanDetail]', err);
    res.status(500).json({ error: err.message });
  }
}

export async function getPlanForApproval(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [req.params.planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const check = await canApprove(plan, empCode);
    if (!check.ok) return res.status(403).json({ error: check.reason });

    res.json({ plan: await buildDetail(plan, false), approving_as: check.approverRole, via: check.via });
  } catch (err) {
    console.error('[getPlanForApproval]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT — edit
// ─────────────────────────────────────────────────────────────────────────────

async function guardEditable(planId, empCode) {
  const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
  const verdict = canEdit(plan, empCode);
  return { plan, verdict };
}

async function touch(planId, empCode) {
  await dbRun(
    'UPDATE sales_plans SET last_edited_by = ?, last_edited_at = CURRENT_TIMESTAMP WHERE id = ?',
    [empCode, planId]
  );
}

/**
 * Validate a proposed visit date against the plan's own cycle window.
 * A C1 plan cannot hold a day-20 visit, and neither cycle can cross months.
 */
async function validateVisitDate(plan, visitDate) {
  const cycles = await loadCycleWindow();
  const win = cycles[plan.cycle_code] || cycles.C1;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(visitDate))) {
    return `visitDate must be YYYY-MM-DD, received '${visitDate}'.`;
  }
  if (monthOf(visitDate) !== plan.period_month) {
    return `Visit date ${visitDate} is outside the plan month ${plan.period_month}.`;
  }
  const d = dayOf(visitDate);
  if (d < win.start || d > win.end) {
    return `Visit date ${visitDate} (day ${d}) is outside cycle ${plan.cycle_code} (days ${win.start}-${win.end}).`;
  }
  return null;
}

/**
 * Daily capacity + one-visit-per-dealer-per-day, the same two rules the
 * generator enforces. Without this an agent could hand-build a day the
 * generator would never have produced.
 */
async function validateDayCapacity(plan, visitDate, dealerSapCode, excludeDetailId = null) {
  const cycles = await loadCycleWindow();
  const cap = Math.min(cycles.capacity[plan.emp_role || 'SO'] ?? HARD_DAILY_CAP, HARD_DAILY_CAP);

  const existing = await dbAll(
    `SELECT id, dealer_sap_code FROM sales_plan_details
     WHERE plan_id = ? AND visit_date = ? ${excludeDetailId ? 'AND id != ?' : ''}`,
    excludeDetailId ? [plan.id, visitDate, excludeDetailId] : [plan.id, visitDate]
  );

  if (existing.length >= cap) {
    return `${visitDate} already has ${existing.length} visits — the daily cap for a ${plan.emp_role || 'SO'} is ${cap}.`;
  }
  if (existing.some(e => same(e.dealer_sap_code, dealerSapCode))) {
    return `${dealerSapCode} is already scheduled on ${visitDate}. A dealer can only be visited once a day.`;
  }
  return null;
}

/**
 * POST /api/app/officers/:empCode/plans/:planId/visits
 * Body: { visitDate, dealerSapCode, purposeOfVisit? }
 */
export async function addVisit(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const { plan, verdict } = await guardEditable(req.params.planId, empCode);
    if (!verdict.ok) return res.status(plan ? 409 : 404).json({ error: verdict.reason });

    const visitDate = norm(req.body.visitDate);
    // A PROSPECT has no SAP code — it has not been appointed, so SAP has never issued
    // one; dealer_visit_targets carries sap_code = NULL and only an SFA code. The
    // generator already plans prospects (it keys them `sap_code || sfa_code`), so
    // insisting on a SAP code here made them the one kind of target an officer could
    // never add back after removing. Either code is accepted and resolved below.
    const dealerCode = norm(req.body.dealerSapCode) || norm(req.body.dealerSfaCode) || norm(req.body.dealerCode);
    if (!visitDate || !dealerCode) {
      return res.status(400).json({ error: 'visitDate and dealerSapCode (or dealerSfaCode for a prospect) are required.' });
    }

    const dateErr = await validateVisitDate(plan, visitDate);
    if (dateErr) return res.status(400).json({ error: dateErr });

    // 1. Check if the dealer is in this employee's targets for the period.
    const roleCol = { SO: 'so_emp_code', ASM: 'asm_code', RSM: 'rsm_code', ZH: 'zh_code' }[plan.emp_role || 'SO'];
    let target = await dbGet(
      `SELECT dvt.*, md.id AS md_id, md.dealer_type
       FROM dealer_visit_targets dvt
       LEFT JOIN master_dealers md
              ON md.sap_code = dvt.sap_code
              OR (dvt.sap_code IS NULL AND md.sfa_code = dvt.sfa_code)
       WHERE (dvt.sap_code = ? OR (dvt.sap_code IS NULL AND dvt.sfa_code = ?))
         AND dvt.period_month = ? AND dvt.cycle_code = ? AND dvt.${roleCol} = ?
       LIMIT 1`,
      [dealerCode, dealerCode, plan.period_month, plan.cycle_code, plan.emp_code]
    );

    let isUnmapped = false;
    if (!target) {
      // Provision to add unmapped dealers: check master_dealers first
      const md = await dbGet(
        `SELECT md.* FROM master_dealers md
         WHERE (UPPER(TRIM(md.sap_code)) = UPPER(TRIM(?))
             OR UPPER(TRIM(md.sfa_code)) = UPPER(TRIM(?))
             OR UPPER(TRIM(md.dealer_id)) = UPPER(TRIM(?)))
         LIMIT 1`,
        [dealerCode, dealerCode, dealerCode]
      );

      if (md) {
        isUnmapped = true;
        target = {
          dealer_id: md.id,
          sap_code: md.sap_code,
          sfa_code: md.sfa_code,
          dealer_name: md.dealer_name,
          dealer_type: md.dealer_type || 'DEALER',
          category: md.counter_strategy || 'Unmapped',
          dealer_status: 'Unmapped',
          area: md.area,
          zone: md.zone,
          block: md.block
        };
      } else if (req.body.dealerName || req.body.isUnmapped) {
        // Provision to add custom/prospective unmapped dealer
        isUnmapped = true;
        target = {
          dealer_id: null,
          sap_code: norm(req.body.dealerSapCode) || null,
          sfa_code: norm(req.body.dealerSfaCode) || (dealerCode !== 'UNMAPPED' ? dealerCode : null),
          dealer_name: norm(req.body.dealerName) || dealerCode,
          dealer_type: norm(req.body.dealerType) || 'PROSPECTIVE',
          category: 'Unmapped',
          dealer_status: 'Unmapped',
          area: norm(req.body.area) || null,
          zone: norm(req.body.zone) || null,
          block: norm(req.body.block) || null
        };
      } else {
        return res.status(400).json({
          error: `${dealerCode} is not in target list or master records. To add an unmapped counter, select from master dealers or provide dealerName.`,
          hint: 'Use GET /api/app/officers/:empCode/dealers?scope=unmapped to search available unmapped dealers.'
        });
      }
    }

    // Store the same identifier the generator stores: SAP where there is one, SFA for a prospect.
    const dealerSapCode = norm(target.sap_code) || norm(target.sfa_code) || dealerCode;

    const capErr = await validateDayCapacity(plan, visitDate, dealerSapCode);
    if (capErr) return res.status(409).json({ error: capErr });

    const seqRow = await dbGet(
      'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM sales_plan_details WHERE plan_id = ? AND visit_date = ?',
      [plan.id, visitDate]
    );

    const defaultPurpose = isUnmapped
      ? `Unmapped Dealer Visit (${target.dealer_name})`
      : `Agent added (${target.category || '-'} - ${target.dealer_status || 'Routine'})`;

    const result = await dbRun(
      `INSERT INTO sales_plan_details
       (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, visit_status, source, added_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`,
      [
        plan.id, visitDate, target.dealer_id || target.md_id || null, dealerSapCode,
        target.dealer_name, target.dealer_type || 'DEALER',
        norm(req.body.purposeOfVisit) || defaultPurpose,
        seqRow?.next || 1, isUnmapped ? 'UNMAPPED' : 'AGENT', empCode
      ]
    );
    await touch(plan.id, empCode);

    res.json({
      success: true,
      message: `${target.dealer_name} ${isUnmapped ? '(Unmapped) ' : ''}added to ${visitDate}.`,
      detail_id: result.insertId || result.lastID,
      plan_id: plan.id,
      is_unmapped: isUnmapped
    });
  } catch (err) {
    console.error('[addVisit]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/app/officers/:empCode/plans/:planId/visits/:detailId
 */
export async function removeVisit(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const { plan, verdict } = await guardEditable(req.params.planId, empCode);
    if (!verdict.ok) return res.status(plan ? 409 : 404).json({ error: verdict.reason });

    const detail = await dbGet(
      'SELECT * FROM sales_plan_details WHERE id = ? AND plan_id = ?',
      [req.params.detailId, plan.id]
    );
    if (!detail) return res.status(404).json({ error: 'Visit not found on this plan.' });

    await dbRun('DELETE FROM sales_plan_details WHERE id = ?', [req.params.detailId]);
    await touch(plan.id, empCode);

    res.json({
      success: true,
      message: `${detail.dealer_name} removed from ${String(detail.visit_date).slice(0, 10)}.`,
      plan_id: plan.id
    });
  } catch (err) {
    console.error('[removeVisit]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * PUT /api/app/officers/:empCode/plans/:planId/visits/:detailId
 * Body: { visitDate?, sequence?, purposeOfVisit? }
 */
export async function moveVisit(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const { plan, verdict } = await guardEditable(req.params.planId, empCode);
    if (!verdict.ok) return res.status(plan ? 409 : 404).json({ error: verdict.reason });

    const detail = await dbGet(
      'SELECT * FROM sales_plan_details WHERE id = ? AND plan_id = ?',
      [req.params.detailId, plan.id]
    );
    if (!detail) return res.status(404).json({ error: 'Visit not found on this plan.' });

    const newDate = norm(req.body.visitDate) || String(detail.visit_date).slice(0, 10);
    const dateErr = await validateVisitDate(plan, newDate);
    if (dateErr) return res.status(400).json({ error: dateErr });

    if (newDate !== String(detail.visit_date).slice(0, 10)) {
      const capErr = await validateDayCapacity(plan, newDate, detail.dealer_sap_code, detail.id);
      if (capErr) return res.status(409).json({ error: capErr });
    }

    const seq = req.body.sequence != null
      ? parseInt(req.body.sequence, 10)
      : (await dbGet(
          'SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM sales_plan_details WHERE plan_id = ? AND visit_date = ? AND id != ?',
          [plan.id, newDate, detail.id]
        ))?.next || 1;

    await dbRun(
      `UPDATE sales_plan_details
       SET visit_date = ?, sequence = ?, purpose_of_visit = COALESCE(?, purpose_of_visit)
       WHERE id = ?`,
      [newDate, seq, norm(req.body.purposeOfVisit) || null, detail.id]
    );
    await touch(plan.id, empCode);

    res.json({
      success: true,
      message: `${detail.dealer_name} moved to ${newDate}.`,
      plan_id: plan.id,
      detail_id: Number(req.params.detailId)
    });
  } catch (err) {
    console.error('[moveVisit]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/app/officers/:empCode/dealers?month=&cycle=
 * The dealer pool this employee may add from, with the ones already on the plan flagged.
 */
export async function getMyDealers(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const month = norm(req.query.month);
    const cycle = norm(req.query.cycle).toUpperCase() || 'C1';
    const scope = norm(req.query.scope).toLowerCase() || (req.query.unmapped === 'true' || req.query.includeUnmapped === 'true' ? 'all' : 'mapped');
    const search = norm(req.query.search);
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 1000);
    const offset = parseInt(req.query.offset || '0', 10);

    if (!month) return res.status(400).json({ error: 'month (YYYY-MM) is required.' });

    let role = await resolveEmployeeRole(empCode);
    if (!['SO', 'ASM', 'RSM', 'ZH'].includes(role)) role = 'SO';

    const roleCol  = { SO: 'so_emp_code', ASM: 'asm_code', RSM: 'rsm_code', ZH: 'zh_code' }[role];
    const visitCol = { SO: 'so_visits',   ASM: 'asm_visits', RSM: 'rsm_visits', ZH: 'zh_visits' }[role];

    // Check if dealer_visit_targets has targets for month
    const targetPeriodCheck = await dbGet(
      `SELECT period_month FROM dealer_visit_targets WHERE period_month = ? AND ${visitCol} > 0 LIMIT 1`,
      [month]
    );
    const targetPeriod = targetPeriodCheck?.period_month || (
      await dbGet(`SELECT period_month FROM dealer_visit_targets WHERE ${visitCol} > 0 ORDER BY period_month DESC LIMIT 1`)
    )?.period_month || month;

    const targetCycleCheck = await dbGet(
      `SELECT cycle_code FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ? AND ${visitCol} > 0 LIMIT 1`,
      [targetPeriod, cycle]
    );
    const targetCycle = targetCycleCheck?.cycle_code || 'C1';

    let mappedDealers = [];
    if (scope !== 'unmapped') {
      let mappedWhere = `
        UPPER(TRIM(dvt.${roleCol})) = UPPER(TRIM(?)) 
        AND dvt.period_month = ? 
        AND dvt.cycle_code = ? 
        AND dvt.${visitCol} > 0
      `;
      const mappedParams = [empCode, month, cycle, empCode, targetPeriod, targetCycle];
      if (search) {
        mappedWhere += ` AND (dvt.dealer_name LIKE ? OR dvt.sap_code LIKE ? OR dvt.sfa_code LIKE ? OR dvt.area LIKE ? OR md.block LIKE ?)`;
        const q = `%${search}%`;
        mappedParams.push(q, q, q, q, q);
      }

      mappedDealers = await dbAll(
        `SELECT dvt.sap_code, dvt.sfa_code, dvt.dealer_name, 
                COALESCE(dvt.area, md.area, m.area) AS area, 
                COALESCE(dvt.zone, md.zone, m.region) AS zone,
                COALESCE(dvt.dealer_status, 'Routine') AS final_category, 
                COALESCE(dvt.category, 'A') AS grade,
                COALESCE(dvt.priority, 0) AS priority_score, 
                dvt.${visitCol} AS required_visits,
                COALESCE(md.block, dvt.block, dvt.sbg_block, m.block) AS block,
                (SELECT COUNT(*) FROM sales_plan_details d
                   JOIN sales_plans p ON p.id = d.plan_id
                  WHERE UPPER(TRIM(p.emp_code)) = UPPER(TRIM(?)) AND p.period_month = ? AND p.cycle_code = ?
                    AND (
                         (dvt.sap_code IS NOT NULL AND d.dealer_sap_code = dvt.sap_code)
                      OR (dvt.sfa_code IS NOT NULL AND d.dealer_sap_code = dvt.sfa_code)
                    )) AS already_planned,
                0 AS is_unmapped
         FROM dealer_visit_targets dvt
         LEFT JOIN master_dealers md 
                ON (dvt.sap_code IS NOT NULL AND md.sap_code = dvt.sap_code)
                OR (dvt.sap_code IS NULL AND dvt.sfa_code IS NOT NULL AND md.sfa_code = dvt.sfa_code)
         LEFT JOIN master_dealer_so_mapping m
                ON (dvt.sap_code IS NOT NULL AND m.sap_code = dvt.sap_code)
         WHERE ${mappedWhere}
         ORDER BY block ASC, dvt.priority DESC, dvt.dealer_name ASC`,
        mappedParams
      );
    }

    let unmappedDealers = [];
    if (scope === 'unmapped' || scope === 'all') {
      let unmappedWhere = `
        md.sap_code NOT IN (
          SELECT dvt.sap_code FROM dealer_visit_targets dvt 
          WHERE dvt.period_month = ? AND dvt.cycle_code = ? AND UPPER(TRIM(dvt.${roleCol})) = UPPER(TRIM(?)) 
            AND dvt.${visitCol} > 0 AND dvt.sap_code IS NOT NULL
        )
      `;
      const unmappedParams = [targetPeriod, targetCycle, empCode];
      if (search) {
        unmappedWhere += ` AND (md.dealer_name LIKE ? OR md.sap_code LIKE ? OR md.sfa_code LIKE ? OR md.area LIKE ? OR md.block LIKE ?)`;
        const q = `%${search}%`;
        unmappedParams.push(q, q, q, q, q);
      }
      unmappedParams.push(empCode, month, cycle);

      const unmappedLimit = scope === 'unmapped' ? limit : Math.min(limit, 100);
      unmappedParams.push(unmappedLimit, offset);

      unmappedDealers = await dbAll(
        `SELECT md.sap_code, md.sfa_code, md.dealer_name,
                COALESCE(md.area, m.area) AS area,
                COALESCE(md.zone, m.region) AS zone,
                'Unmapped' AS final_category,
                COALESCE(md.counter_strategy, 'C') AS grade,
                0 AS priority_score,
                0 AS required_visits,
                COALESCE(md.block, m.block) AS block,
                (SELECT COUNT(*) FROM sales_plan_details d
                   JOIN sales_plans p ON p.id = d.plan_id
                  WHERE UPPER(TRIM(p.emp_code)) = UPPER(TRIM(?)) AND p.period_month = ? AND p.cycle_code = ?
                    AND (
                         (md.sap_code IS NOT NULL AND d.dealer_sap_code = md.sap_code)
                      OR (md.sfa_code IS NOT NULL AND d.dealer_sap_code = md.sfa_code)
                    )) AS already_planned,
                1 AS is_unmapped
         FROM master_dealers md
         LEFT JOIN master_dealer_so_mapping m
                ON (md.sap_code IS NOT NULL AND m.sap_code = md.sap_code)
         WHERE ${unmappedWhere}
         ORDER BY md.dealer_name ASC
         LIMIT ? OFFSET ?`,
        unmappedParams
      );
    }

    const dealers = scope === 'unmapped'
      ? unmappedDealers
      : (scope === 'all' ? [...mappedDealers, ...unmappedDealers] : mappedDealers);

    res.json({
      emp_code: empCode,
      role,
      month,
      cycle,
      scope,
      count: dealers.length,
      dealers: dealers.map(d => ({ ...d, is_unmapped: Boolean(d.is_unmapped) }))
    });
  } catch (err) {
    console.error('[getMyDealers]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT — submit
// POST /api/app/officers/:empCode/plans/:planId/submit
// ─────────────────────────────────────────────────────────────────────────────
export async function submitMyPlan(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [req.params.planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    const verdict = canEdit(plan, empCode);
    if (!verdict.ok) return res.status(409).json({ error: verdict.reason });

    const count = await dbGet('SELECT COUNT(*) AS n FROM sales_plan_details WHERE plan_id = ?', [plan.id]);
    if (!count || Number(count.n) === 0) {
      return res.status(400).json({ error: 'Cannot submit an empty plan — add at least one visit first.' });
    }

    // Re-resolve routing at submit time; the hierarchy may have changed since generation.
    const routing = await stampPlanRouting(plan.id, { roleHint: plan.emp_role });
    if (!routing.l1ApproverEmpCode && routing.l1ApproverRole !== 'ADMIN') {
      return res.status(409).json({
        error: `No L1 approver could be resolved for ${empCode} (${routing.empRole}). The plan cannot be submitted until the hierarchy is corrected.`,
        routing
      });
    }

    const isResubmit = plan.status === 'RECTIFY';
    await dbRun(
      `UPDATE sales_plans
       SET status = 'SUBMITTED',
           submitted_at   = COALESCE(submitted_at, CURRENT_TIMESTAMP),
           resubmitted_at = ${isResubmit ? 'CURRENT_TIMESTAMP' : 'resubmitted_at'}
       WHERE id = ?`,
      [plan.id]
    );
    await dbRun(
      'INSERT INTO plan_approvals (plan_id, action_by, action_type, remarks) VALUES (?, ?, ?, ?)',
      [plan.id, empCode, isResubmit ? 'RESUBMITTED' : 'SUBMITTED', norm(req.body?.remarks) || null]
    ).catch(e => console.warn('[submitMyPlan] audit log skipped:', e.message));

    res.json({
      success: true,
      message: isResubmit
        ? `Plan ${plan.id} re-submitted after rectification. ${routing.l1ApproverName || routing.l1ApproverRole} must now approve it — it cannot be sent back again.`
        : `Plan ${plan.id} submitted to ${routing.l1ApproverName || routing.l1ApproverRole} for approval.`,
      plan_id: plan.id,
      status: 'SUBMITTED',
      is_resubmission: isResubmit,
      visits_submitted: Number(count.n),
      approver: {
        emp_code: routing.l1ApproverEmpCode,
        name: routing.l1ApproverName,
        role: routing.l1ApproverRole
      },
      rectification_remaining: Math.max(0, MAX_RECTIFICATIONS - Number(plan.rectification_count || 0))
    });
  } catch (err) {
    console.error('[submitMyPlan]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// L1 — inbox
// GET /api/app/approvers/:empCode/inbox?month=&status=
// ─────────────────────────────────────────────────────────────────────────────
export async function getApprovalInbox(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const month = norm(req.query.month);
    const status = norm(req.query.status).toUpperCase() || 'SUBMITTED';

    const role = await resolveEmployeeRole(empCode);
    const isAdmin = role === 'ADMIN';

    let where = isAdmin
      ? "(UPPER(TRIM(sp.l1_approver_emp_code)) = UPPER(TRIM(?)) OR sp.l1_approver_role = 'ADMIN')"
      : 'UPPER(TRIM(sp.l1_approver_emp_code)) = UPPER(TRIM(?))';
    const params = [empCode];

    if (status !== 'ALL') { where += ' AND sp.status = ?'; params.push(status); }
    if (month)            { where += ' AND sp.period_month = ?'; params.push(month); }

    const rows = await planSummaryRows(where, params);

    for (const r of rows) {
      if (!r.emp_name) {
        const resEmp = await resolveEmployeeName(r.emp_code, r.emp_role);
        if (resEmp?.name) r.emp_name = resEmp.name;
      }
      if (!r.l1_approver_name && r.l1_approver_emp_code) {
        const resAppr = await resolveEmployeeName(r.l1_approver_emp_code, r.l1_approver_role);
        if (resAppr?.name) r.l1_approver_name = resAppr.name;
      }
    }

    res.json({
      approver: {
        emp_code: empCode,
        name: (await resolveEmployeeName(empCode, role))?.name || null,
        role
      },
      filter: { status, month: month || 'ALL' },
      count: rows.length,
      plans: rows.map(p => shapeSummary(p, false))
    });
  } catch (err) {
    console.error('[getApprovalInbox]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// L1 — decision
// POST /api/app/approvers/:empCode/plans/:planId/decision
// Body: { action: 'APPROVE' | 'RECTIFY', remarks? }
// ─────────────────────────────────────────────────────────────────────────────
export async function decidePlan(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const action = norm(req.body.action).toUpperCase();
    const remarks = norm(req.body.remarks);

    if (!['APPROVE', 'APPROVED', 'RECTIFY'].includes(action)) {
      return res.status(400).json({ error: "action must be 'APPROVE' or 'RECTIFY'." });
    }
    const isApprove = action !== 'RECTIFY';

    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [req.params.planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });

    if (plan.status !== 'SUBMITTED') {
      return res.status(409).json({
        error: `Only a SUBMITTED plan can be acted on. Plan ${plan.id} is ${plan.status}.`
      });
    }

    const check = await canApprove(plan, empCode);
    if (!check.ok) return res.status(403).json({ error: check.reason });

    // ── rectify-once ─────────────────────────────────────────────────────────
    if (!isApprove) {
      const used = Number(plan.rectification_count || 0);
      if (used >= MAX_RECTIFICATIONS) {
        return res.status(409).json({
          error: `Plan ${plan.id} has already been sent back for rectification once. The only remaining action is Approve.`,
          rectification_count: used,
          allowed_actions: ['APPROVE']
        });
      }
      if (!remarks) {
        return res.status(400).json({ error: 'remarks are required when sending a plan back — the agent needs to know what to fix.' });
      }

      await dbRun(
        `UPDATE sales_plans
         SET status = 'RECTIFY',
             rectification_count  = rectification_count + 1,
             rectify_requested_by = ?, rectify_requested_at = CURRENT_TIMESTAMP,
             rectify_remarks      = ?
         WHERE id = ?`,
        [empCode, remarks, plan.id]
      );
      await dbRun(
        'INSERT INTO plan_approvals (plan_id, action_by, action_type, remarks, approver_role) VALUES (?, ?, ?, ?, ?)',
        [plan.id, empCode, 'RECTIFY', remarks, check.approverRole || null]
      ).catch(e => console.warn('[decidePlan] audit log skipped:', e.message));

      return res.json({
        success: true,
        message: `Plan ${plan.id} sent back to ${plan.emp_name} for rectification. This was the only send-back available — the next submission must be approved.`,
        plan_id: plan.id,
        status: 'RECTIFY',
        rectification_count: used + 1,
        rectification_remaining: 0,
        remarks
      });
    }

    // ── approve ──────────────────────────────────────────────────────────────
    await dbRun(
      `UPDATE sales_plans
       SET status = 'APPROVED', approved_by = ?, approver_emp_code = ?,
           approved_at = CURRENT_TIMESTAMP, remarks = COALESCE(NULLIF(?, ''), remarks)
       WHERE id = ?`,
      [empCode, empCode, remarks, plan.id]
    );
    await dbRun(
      'INSERT INTO plan_approvals (plan_id, action_by, action_type, remarks, approver_role) VALUES (?, ?, ?, ?, ?)',
      [plan.id, empCode, 'APPROVED', remarks || null, check.approverRole || null]
    ).catch(e => console.warn('[decidePlan] audit log skipped:', e.message));

    res.json({
      success: true,
      message: `Plan ${plan.id} approved by ${empCode}.`,
      plan_id: plan.id,
      status: 'APPROVED',
      approved_by: empCode,
      approver_role: check.approverRole,
      via: check.via
    });
  } catch (err) {
    console.error('[decidePlan]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — which months actually have plans
// GET /api/app/admin/plan-periods
//
// A month picker that lets you type any month is a trap in a demo: pick a month
// nothing was generated for and the screen goes blank, which looks like a broken
// app rather than an empty month. This answers what exists — newest first, with
// the per-cycle and per-status counts — so the picker can only offer real months
// and can say what is in each one before you open it.
// ─────────────────────────────────────────────────────────────────────────────
export async function listPlanPeriods(req, res) {
  try {
    const rows = await dbAll(
      `SELECT
         sp.period_month,
         sp.cycle_code,
         sp.status,
         COUNT(*)                        AS plans,
         COUNT(DISTINCT sp.emp_code)     AS officers,
         (SELECT COUNT(*) FROM sales_plan_details d
           JOIN sales_plans p2 ON p2.id = d.plan_id
          WHERE p2.period_month = sp.period_month
            AND p2.cycle_code  = sp.cycle_code) AS cycle_visits
       FROM sales_plans sp
       GROUP BY sp.period_month, sp.cycle_code, sp.status
       ORDER BY sp.period_month DESC, sp.cycle_code ASC`
    );

    const byMonth = new Map();
    for (const r of rows) {
      const m = r.period_month;
      if (!byMonth.has(m)) {
        byMonth.set(m, {
          month: m,
          plans: 0,
          officers: 0,
          cycles: {},          // { C1: { plans, visits, by_status } }
          by_status: {}
        });
      }
      const entry = byMonth.get(m);
      const cycle = r.cycle_code || 'C1';
      entry.plans += Number(r.plans || 0);
      entry.by_status[r.status] = (entry.by_status[r.status] || 0) + Number(r.plans || 0);

      if (!entry.cycles[cycle]) {
        entry.cycles[cycle] = { plans: 0, visits: Number(r.cycle_visits || 0), by_status: {} };
      }
      entry.cycles[cycle].plans += Number(r.plans || 0);
      entry.cycles[cycle].by_status[r.status] =
        (entry.cycles[cycle].by_status[r.status] || 0) + Number(r.plans || 0);
    }

    // officers is a distinct count per (month, cycle, status) row, so it cannot be
    // summed — count them once per month instead.
    const officerRows = await dbAll(
      `SELECT period_month, COUNT(DISTINCT emp_code) AS officers
         FROM sales_plans GROUP BY period_month`
    );
    for (const r of officerRows) {
      const entry = byMonth.get(r.period_month);
      if (entry) entry.officers = Number(r.officers || 0);
    }

    const periods = [...byMonth.values()];
    res.json({
      count: periods.length,
      latest: periods[0]?.month || null,
      periods
    });
  } catch (err) {
    console.error('[listPlanPeriods]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — every officer's plan in one list
// GET /api/app/admin/plans?month=&cycle=&status=&role=&search=&limit=&offset=
// ─────────────────────────────────────────────────────────────────────────────
export async function listAllPlans(req, res) {
  try {
    const { month, cycle, status, role, search } = req.query;
    const limit  = Math.min(parseInt(req.query.limit || '500', 10), 2000);
    const offset = parseInt(req.query.offset || '0', 10);

    // Every filter EXCEPT cycle is applied in SQL. Cycle is applied afterwards in JS
    // so the C1 / C2 switch can carry live counts that stay correct while one cycle
    // is selected — otherwise selecting C1 would zero the C2 count.
    let where = '1=1';
    const params = [];
    if (month)  { where += ' AND sp.period_month = ?'; params.push(month); }
    if (status && status !== 'ALL') { where += ' AND sp.status = ?';     params.push(String(status).toUpperCase()); }
    if (role   && role   !== 'ALL') { where += ' AND sp.emp_role = ?';   params.push(String(role).toUpperCase()); }
    if (search) {
      where += ' AND (sp.emp_name LIKE ? OR sp.emp_code LIKE ? OR sp.l1_approver_name LIKE ?)';
      const q = `%${search}%`;
      params.push(q, q, q);
    }

    const allRows = await planSummaryRows(where, params);

    const cycleCounts = allRows.reduce((acc, p) => {
      acc[p.cycle_code] = (acc[p.cycle_code] || 0) + 1;
      acc.ALL += 1;
      return acc;
    }, { ALL: 0, C1: 0, C2: 0 });

    const wantCycle = cycle && cycle !== 'ALL' ? String(cycle).toUpperCase() : null;
    const rows = wantCycle ? allRows.filter(p => p.cycle_code === wantCycle) : allRows;
    const page = rows.slice(offset, offset + limit);

    for (const p of page) {
      if (!p.emp_name) {
        p.emp_name = await resolveEmployeeName(p.emp_code);
        if (p.emp_name) {
          dbRun('UPDATE sales_plans SET emp_name = ? WHERE id = ?', [p.emp_name, p.id]).catch(() => {});
        }
      }
      if (!p.l1_approver_role || !p.l1_approver_name) {
        const apprv = await resolveL1Approver(p.emp_code, p.emp_role);
        if (apprv) {
          p.l1_approver_emp_code = p.l1_approver_emp_code || apprv.emp_code;
          p.l1_approver_name = p.l1_approver_name || apprv.name;
          p.l1_approver_role = p.l1_approver_role || apprv.role;
          dbRun('UPDATE sales_plans SET l1_approver_emp_code = ?, l1_approver_name = ?, l1_approver_role = ? WHERE id = ?', 
            [p.l1_approver_emp_code, p.l1_approver_name, p.l1_approver_role, p.id]).catch(() => {});
        }
      }
    }

    // Roll-up tiles for the top of the screen
    const totals = rows.reduce((acc, p) => {
      acc.plans += 1;
      acc.visits += Number(p.total_visits || 0);
      acc.by_status[p.status] = (acc.by_status[p.status] || 0) + 1;
      acc.by_role[p.emp_role || 'SO'] = (acc.by_role[p.emp_role || 'SO'] || 0) + 1;
      if (!p.l1_approver_emp_code && p.l1_approver_role !== 'ADMIN') acc.unrouted += 1;
      if (Number(p.total_visits || 0) === 0) acc.empty += 1;
      return acc;
    }, { plans: 0, visits: 0, by_status: {}, by_role: {}, unrouted: 0, empty: 0 });

    res.json({
      filter: { month: month || 'ALL', cycle: cycle || 'ALL', status: status || 'ALL', role: role || 'ALL' },
      cycleCounts,
      totals,
      count: rows.length,
      returned: page.length,
      plans: page.map(p => shapeSummary(p, false))
    });
  } catch (err) {
    console.error('[listAllPlans]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/app/admin/plans/:planId — detail view with no ownership check.
 */
export async function getPlanDetailAdmin(req, res) {
  try {
    const plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [req.params.planId]);
    if (!plan) return res.status(404).json({ error: 'Plan not found.' });
    res.json({ plan: await buildDetail(plan, false) });
  } catch (err) {
    console.error('[getPlanDetailAdmin]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// APP — punch a visit
// POST /api/app/officers/:empCode/visits/punch
//   { visitDate, dealerCode, checkInTime?, checkOutTime?, duration?,
//     visitStatus?, purposeOfVisit?, remarks? }
//
// This is the officer saying "I went". It writes ONE row to visit_execution_logs —
// the same table, the same columns and the same vocabulary the SFA report upload
// writes, so a punched visit and an uploaded one are indistinguishable downstream:
// adherence counts them the same way, and the C2 regeneration reads them the same way.
//
// batch_code is stamped APP-PUNCH-<month> rather than an upload batch, so a punched
// visit can always be told apart from an imported one when auditing, without changing
// how it behaves.
//
// Refusals are deliberate:
//   - a day outside the plan month is rejected, as it is on the plan side
//   - the same dealer on the same day by the same officer is a 409, because that is
//     what the SFA system itself would treat as one visit
// A visit that is NOT on the officer's plan is still accepted — unplanned visits
// happen, the adherence engine already reports them separately — but the response
// says so plainly rather than pretending it was planned.
// ─────────────────────────────────────────────────────────────────────────────

const PUNCH_STATUSES = ['Productive', 'Non productive'];

/** "10:05" / "10:05:00" / a Date → "10:05:00". Anything unusable → null. */
function normalisePunchTime(v) {
  const t = norm(v);
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = String(Math.min(23, parseInt(m[1], 10))).padStart(2, '0');
  return `${hh}:${m[2]}:${m[3] || '00'}`;
}

/** Minutes between two HH:MM:SS times, in the client's own "34 Minute(s)" wording. */
function punchDuration(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null;
  const mins = t => {
    const [h, m, sec] = t.split(':').map(Number);
    return h * 60 + m + (sec || 0) / 60;
  };
  const d = Math.round(mins(checkOut) - mins(checkIn));
  if (!(d > 0)) return null;
  return `${d} Minute(s)`;
}

export async function punchVisit(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const visitDate = norm(req.body.visitDate);
    const dealerCode = norm(req.body.dealerCode) ||
                       norm(req.body.dealerSapCode) || norm(req.body.dealerSfaCode);

    if (!empCode || !visitDate || !dealerCode) {
      return res.status(400).json({ error: 'visitDate and dealerCode are required.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(visitDate)) {
      return res.status(400).json({ error: `visitDate must be YYYY-MM-DD, received '${visitDate}'.` });
    }
    const month = monthOf(visitDate);

    const employee = await dbGet(
      `SELECT emp_code, emp_name FROM master_employees WHERE emp_code = ?`, [empCode]
    ).catch(() => null);
    const fromPlan = await dbGet(
      `SELECT emp_name FROM sales_plans WHERE emp_code = ? ORDER BY id DESC LIMIT 1`, [empCode]
    ).catch(() => null);
    const empName = employee?.emp_name || fromPlan?.emp_name || empCode;

    // Is this visit on one of his plans that day? Either code identifies the dealer.
    const planned = await dbGet(
      `SELECT d.id AS detail_id, d.dealer_name, d.dealer_sap_code, d.purpose_of_visit,
              p.id AS plan_id, p.cycle_code, p.period_month
         FROM sales_plan_details d
         JOIN sales_plans p ON p.id = d.plan_id
        WHERE p.emp_code = ? AND d.visit_date = ?
          AND UPPER(TRIM(d.dealer_sap_code)) = UPPER(TRIM(?))
        LIMIT 1`,
      [empCode, visitDate, dealerCode]
    ).catch(() => null);

    // The dealer's own record, for the customer name, type and branch the SFA
    // report carries. Prospects have no SAP code, so match on either.
    let target = await dbGet(
      `SELECT dealer_name, sap_code, sfa_code, cust_type, branch, block, sbg_block,
              area, dm_area, territory_name
         FROM dealer_visit_targets
        WHERE period_month = ?
          AND (UPPER(TRIM(sap_code)) = UPPER(TRIM(?)) OR UPPER(TRIM(sfa_code)) = UPPER(TRIM(?)))
        LIMIT 1`,
      [month, dealerCode, dealerCode]
    ).catch(() => null);

    if (!target) {
      // Look up master_dealers for unmapped dealer
      const md = await dbGet(
        `SELECT dealer_name, sap_code, sfa_code, dealer_type AS cust_type, branch, block, sbg_block,
                area, dm_area, territory_name
           FROM master_dealers
          WHERE (UPPER(TRIM(sap_code)) = UPPER(TRIM(?)) OR UPPER(TRIM(sfa_code)) = UPPER(TRIM(?)))
          LIMIT 1`,
        [dealerCode, dealerCode]
      ).catch(() => null);
      if (md) target = md;
    }

    if (!target && planned) {
      target = {
        dealer_name: planned.dealer_name,
        sap_code: planned.dealer_sap_code,
        sfa_code: planned.dealer_sap_code,
        cust_type: 'Dealer',
        area: 'Unmapped',
        branch: null
      };
    }

    if (!planned && !target) {
      return res.status(404).json({
        error: `${dealerCode} is not on ${empCode}'s plan for ${visitDate}, and is not a ` +
               `counter in master or target records for ${month}. Check the code.`
      });
    }

    // The SFA report keys on the customer code; use the dealer's SFA code where there
    // is one, which is what a real SFA log would carry.
    const customerCode = norm(target?.sfa_code) || norm(target?.sap_code) || dealerCode;

    const already = await dbGet(
      `SELECT id, check_in_time FROM visit_execution_logs
        WHERE employee_code = ? AND visit_date = ?
          AND UPPER(TRIM(customer_code)) IN (UPPER(TRIM(?)), UPPER(TRIM(?)))
        LIMIT 1`,
      [empCode, visitDate, customerCode, dealerCode]
    ).catch(() => null);
    if (already) {
      return res.status(409).json({
        error: `${customerCode} is already punched for ${visitDate}. ` +
               `A dealer counts once a day, the same way the SFA system counts it.`
      });
    }

    const checkIn  = normalisePunchTime(req.body.checkInTime)  || '10:05:00';
    const checkOut = normalisePunchTime(req.body.checkOutTime) || '10:39:00';
    const duration = norm(req.body.duration) || punchDuration(checkIn, checkOut);
    const statusIn = norm(req.body.visitStatus);
    const visitStatus = PUNCH_STATUSES.find(v => same(v, statusIn)) || 'Productive';
    const purpose = norm(req.body.purposeOfVisit) ||
                    norm(planned?.purpose_of_visit) || 'Routine Visit';
    const remarks = norm(req.body.remarks) || null;

    const row = {
      visit_date: visitDate,
      customer_code: customerCode,
      customer_name: target?.dealer_name || planned?.dealer_name || '',
      customer_type: custTypeForSfa(target?.cust_type),
      route: target?.territory_name || target?.dm_area || target?.area || null,
      branch: target?.branch || target?.sbg_block || target?.block || null,
      employee_code: empCode,
      employee_name: empName,
      check_in_time: checkIn,
      check_out_time: checkOut,
      duration,
      visit_status: visitStatus,
      purpose_of_visit: purpose,
      remarks,
      batch_code: `APP-PUNCH-${month}`
    };

    await dbRun(
      `INSERT INTO visit_execution_logs
         (visit_date, customer_code, customer_name, customer_type, route, branch,
          employee_code, employee_name, check_in_time, check_out_time, duration,
          visit_status, purpose_of_visit, remarks, batch_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.visit_date, row.customer_code, row.customer_name, row.customer_type,
       row.route, row.branch, row.employee_code, row.employee_name,
       row.check_in_time, row.check_out_time, row.duration, row.visit_status,
       row.purpose_of_visit, row.remarks, row.batch_code]
    );

    res.status(201).json({
      message: planned
        ? `Punched ${row.customer_name} on ${visitDate}.`
        : `Punched ${row.customer_name} on ${visitDate} — this visit was NOT on the plan, ` +
          `so it counts as an unplanned visit.`,
      planned: !!planned,
      cycle_code: planned?.cycle_code || null,
      // Exactly the fields the SFA report carries, under its own column names, so what
      // was written here and what an upload would have written are the same thing.
      sfa_row: {
        'Date of Visit': row.visit_date,
        'Customer Code': row.customer_code,
        'Customer Name': row.customer_name,
        'Type': row.customer_type,
        'Route': row.route,
        'Branch': row.branch,
        'Employee Code': row.employee_code,
        'Employee Name': row.employee_name,
        'Check In Time': row.check_in_time,
        'Check Out Time': row.check_out_time,
        'Duration': row.duration,
        'Visit Status(Productive / Non productive)': row.visit_status,
        'Purpose Of Visit': row.purpose_of_visit,
        'Remarks': row.remarks
      }
    });
  } catch (err) {
    console.error('[punchVisit]', err);
    res.status(500).json({ error: err.message });
  }
}

/** The SFA report's Type vocabulary. */
function custTypeForSfa(raw) {
  const v = norm(raw).toUpperCase();
  if (v === 'NON_STAR' || v === 'NON-STAR' || v === 'NON STAR') return 'NON STAR';
  if (v === 'PROSPECTIVE') return 'Prospective';
  if (!v || v === 'STAR' || v === 'DEALER') return 'Dealer';
  return raw;
}

// ─────────────────────────────────────────────────────────────────────────────
// APP — "how am I doing?"
// GET /api/app/officers/:empCode/adherence?month=YYYY-MM&cycle=C1|C2&asOn=YYYY-MM-DD
// GET /api/app/approvers/:empCode/team-adherence?month=…&cycle=…&asOn=…
//
// The admin report answers for the whole company at once, which is the wrong shape
// for a phone: an officer wants his own number and the list of counters he still
// owes, and his manager wants one line per person reporting to him.
//
// Both read the SAME engine as the admin report (sfa-adherence.engine.js), so the
// figure an officer sees on his phone is the figure his manager sees in the admin
// panel — there is no second calculation to drift.
// ─────────────────────────────────────────────────────────────────────────────

/** Run the shared engine once and hand back the pieces both views need. */
async function runAdherence(query) {
  const month = norm(query.month);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return { error: 'month (YYYY-MM) is required.' };
  }
  const cycle = norm(query.cycle).toUpperCase();
  const asOn  = norm(query.asOn);
  if (asOn && !/^\d{4}-\d{2}-\d{2}$/.test(asOn)) {
    return { error: `asOn must be YYYY-MM-DD, received '${asOn}'.` };
  }
  const { analyseAdherence } = await import('../engines/sfa-adherence.engine.js');
  const a = await analyseAdherence({
    periodMonth: month,
    cycleCode: cycle && cycle !== 'ALL' ? cycle : null,
    asOnDate: asOn || null,
    productiveOnly: query.productiveOnly === '1' || query.productiveOnly === 'true'
  });
  return { month, cycle: cycle || 'ALL', a };
}

/**
 * The elapsed fraction for ONE cycle.
 *
 * The engine returns elapsedFraction as an OBJECT keyed by cycle ({C1: 1, C2: 0}),
 * because it can analyse both at once. Reading it as a number gives NaN, which then
 * displays as "0% of the cycle elapsed" on a cycle that has finished.
 */
function fractionFor(a, cycleCode) {
  const f = a.elapsedFraction;
  if (typeof f === 'number') return f;
  if (f && typeof f === 'object') {
    if (cycleCode && cycleCode !== 'ALL' && f[cycleCode] != null) return f[cycleCode];
    const vals = Object.values(f).filter(v => typeof v === 'number');
    return vals.length ? Math.max(...vals) : 0;
  }
  return 0;
}

const pct1 = n => Math.round((n || 0) * 1000) / 10;

/**
 * One officer's adherence, plus the counter-by-counter detail behind it.
 *
 * A bare percentage is not actionable on a phone. What makes it useful is the list
 * underneath: which counters are done, which are still owed, and — for the ones he
 * has missed — the day the plan said to go.
 */
export async function getMyAdherence(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const r = await runAdherence(req.query);
    if (r.error) return res.status(400).json({ error: r.error });
    const { month, cycle, a } = r;

    const mine = a.byEmployee.find(e => same(e.emp_code, empCode));
    const dealers = a.byDealer
      .filter(d => same(d.emp_code, empCode))
      .map(d => ({
        sap_code: d.dealer_sap_code,
        dealer_name: d.dealer_name,
        cycle: d.cycle_code,
        planned: d.planned,
        adhered: d.adhered,
        adhered_capped: d.adhered_capped,
        pending: Math.round(d.pending * 100) / 100,
        planned_dates: d.planned_dates || [],
        visit_dates: d.visit_dates || [],
        // What the row is coloured by: done, partly done, or not yet touched.
        state: d.adhered_capped >= d.planned ? 'DONE'
             : (d.adhered > 0 ? 'PARTIAL' : 'PENDING')
      }))
      .sort((x, y) =>
        (x.state === 'PENDING' ? 0 : x.state === 'PARTIAL' ? 1 : 2) -
        (y.state === 'PENDING' ? 0 : y.state === 'PARTIAL' ? 1 : 2) ||
        String(x.planned_dates[0] || '').localeCompare(String(y.planned_dates[0] || '')) ||
        String(x.dealer_name).localeCompare(String(y.dealer_name)));

    res.json({
      emp_code: empCode,
      emp_name: mine?.emp_name || null,
      role: mine?.role || await resolveEmployeeRole(empCode),
      month,
      cycle,
      as_on_date: a.asOnDate,
      elapsed_fraction: Math.round(fractionFor(a, cycle) * 1000) / 1000,
      has_plan: !!mine,
      totals: mine ? {
        dealers_on_plan: mine.dealers,
        dealers_visited: mine.dealers_visited,
        dealers_missed:  mine.dealers_missed,
        planned_visits:  mine.planned,
        mtd_due:         Math.round(mine.mtd_planned * 100) / 100,
        adhered:         mine.adhered,
        adhered_capped:  mine.adhered_capped,
        pending:         Math.round(mine.pending * 100) / 100
      } : null,
      adherence: mine ? {
        capped_pct: pct1(mine.adherence_pct_capped),
        raw_pct:    pct1(mine.adherence_pct),
        over_visited: mine.adhered > mine.mtd_planned
      } : null,
      dealers,
      method: 'MTD due = planned x elapsed fraction of the cycle; capped adherence never exceeds 100%'
    });
  } catch (err) {
    console.error('[getMyAdherence]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * One line per person who reports to this approver — his team's adherence.
 * Membership comes from the same routing the inbox uses (l1_approver_emp_code), so a
 * manager sees exactly the people whose plans he approves, and nobody else's.
 */
export async function getTeamAdherence(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const r = await runAdherence(req.query);
    if (r.error) return res.status(400).json({ error: r.error });
    const { month, cycle, a } = r;

    const params = [empCode, month];
    let where = 'l1_approver_emp_code = ? AND period_month = ?';
    if (cycle && cycle !== 'ALL') { where += ' AND cycle_code = ?'; params.push(cycle); }
    const team = await dbAll(
      `SELECT DISTINCT emp_code, emp_name, emp_role FROM sales_plans WHERE ${where}`, params
    ).catch(() => []);

    const rows = team.map(t => {
      const e = a.byEmployee.find(x => same(x.emp_code, t.emp_code));
      return {
        emp_code: t.emp_code,
        emp_name: t.emp_name,
        role: t.emp_role || e?.role || 'SO',
        has_plan: !!e,
        dealers_on_plan: e?.dealers || 0,
        dealers_visited: e?.dealers_visited || 0,
        dealers_missed:  e?.dealers_missed || 0,
        planned_visits:  e?.planned || 0,
        mtd_due:         e ? Math.round(e.mtd_planned * 100) / 100 : 0,
        adhered:         e?.adhered || 0,
        pending:         e ? Math.round(e.pending * 100) / 100 : 0,
        capped_pct:      e ? pct1(e.adherence_pct_capped) : 0
      };
    }).sort((x, y) => x.capped_pct - y.capped_pct ||
                      String(x.emp_name).localeCompare(String(y.emp_name)));

    const totals = rows.reduce((acc, r2) => {
      acc.planned_visits += r2.planned_visits;
      acc.mtd_due += r2.mtd_due;
      acc.adhered += r2.adhered;
      return acc;
    }, { planned_visits: 0, mtd_due: 0, adhered: 0 });
    totals.mtd_due = Math.round(totals.mtd_due * 100) / 100;
    totals.capped_pct = totals.mtd_due >= 1
      ? Math.round((totals.adhered / totals.mtd_due) * 1000) / 10
      : 0;

    res.json({
      approver_emp_code: empCode,
      month, cycle,
      as_on_date: a.asOnDate,
      team_size: rows.length,
      totals,
      team: rows
    });
  } catch (err) {
    console.error('[getTeamAdherence]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DAILY ADHERENCE — the running total, day by day
// GET /api/app/admin/adherence/daily?month=&cycle=&asOn=&role=&empCode=
// GET /api/app/approvers/:empCode/adherence/daily?month=&cycle=&asOn=
//
// The headline adherence figure prorates: MTD due = planned x the elapsed fraction of
// the cycle. That is the client's own method and it stays the headline. But it answers
// "how are we doing overall", not "what happened on the 4th", and a manager reviewing
// his patch daily needs the second question answered too.
//
// So this reports, for every day of the cycle:
//
//   planned        visits scheduled that day
//   logged         SFA rows that day (punched or uploaded), in scope
//   same_day       planned visits that day that were visited THAT day
//   cum_planned    every visit due on or before that day
//   cum_adhered    of those, how many have been made on or before that day — capped
//                  per counter, so a counter visited three times against one planned
//                  visit counts once
//   cum_pct        cum_adhered / cum_planned
//   unplanned      logged visits that day against a counter not on anyone's plan
//
// cum_pct is the accumulating number: it uses the visits actually DUE by that date
// rather than a prorated share of the cycle, so it is exact rather than an estimate,
// and a visit made a day late still counts once it happens. The two figures answer
// different questions and will not match; both are reported so neither is mistaken
// for the other.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both codes of every counter in the month, mapped to one canonical code.
 * A plan stores the SAP code; an SFA log usually carries the SFA code. Without this
 * the same visit reads as two different counters and adherence undercounts.
 */
async function dealerCodeAliases(periodMonth) {
  const rows = await dbAll(
    `SELECT sap_code, sfa_code FROM dealer_visit_targets WHERE period_month = ?`,
    [periodMonth]
  ).catch(() => []);
  const canon = new Map();
  for (const r of rows) {
    const sap = norm(r.sap_code).toUpperCase();
    const sfa = norm(r.sfa_code).toUpperCase();
    const key = sap || sfa;
    if (!key) continue;
    if (sap) canon.set(sap, key);
    if (sfa) canon.set(sfa, key);
  }
  return code => {
    const c = norm(code).toUpperCase();
    return canon.get(c) || c;
  };
}

async function buildDailyAdherence({ periodMonth, cycleCode, empCodes = null, asOnDate = null }) {
  const cycles = await loadCycleWindow();
  const win = cycles[cycleCode] || cycles.C1;
  const [y, m] = periodMonth.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const days = [];
  for (let d = win.start; d <= Math.min(win.end, lastDay); d++) {
    days.push(`${periodMonth}-${String(d).padStart(2, '0')}`);
  }
  const asOn = asOnDate || days[days.length - 1];
  const canon = await dealerCodeAliases(periodMonth);

  // null means "everybody"; an EMPTY ARRAY means "nobody" — an approver with no team
  // must get an empty series, not the whole company. Testing .length conflated the two.
  const scope = Array.isArray(empCodes) ? empCodes.map(c => norm(c).toUpperCase()) : null;
  const inScope = code => !scope || scope.includes(norm(code).toUpperCase());

  const plannedRows = await dbAll(
    `SELECT p.emp_code, d.dealer_sap_code, d.visit_date
       FROM sales_plan_details d
       JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month = ? AND p.cycle_code = ?`,
    [periodMonth, cycleCode]
  ).catch(() => []);

  const logRows = await dbAll(
    `SELECT employee_code, customer_code, visit_date
       FROM visit_execution_logs
      WHERE visit_date BETWEEN ? AND ?`,
    [days[0], days[days.length - 1]]
  ).catch(() => []);

  // pair = one officer and one counter. Both sides indexed the same way.
  const pairs = new Map();
  const pairOf = (emp, code) => `${norm(emp).toUpperCase()}|${canon(code)}`;

  for (const r of plannedRows) {
    if (!inScope(r.emp_code)) continue;
    const k = pairOf(r.emp_code, r.dealer_sap_code);
    if (!pairs.has(k)) pairs.set(k, { planned: [], logged: [] });
    pairs.get(k).planned.push(String(r.visit_date).slice(0, 10));
  }
  // One counter, one officer, one day = ONE visit. The SFA system treats a second
  // check-in at the same counter the same day as the same visit, and punchVisit refuses
  // it outright — so counting both rows here would let a duplicate log inflate
  // adherence. De-duplicate on (pair, day) before anything is counted.
  const seenLog = new Set();
  for (const r of logRows) {
    if (!inScope(r.employee_code)) continue;
    const k = pairOf(r.employee_code, r.customer_code);
    const day = String(r.visit_date).slice(0, 10);
    if (seenLog.has(`${k}|${day}`)) continue;
    seenLog.add(`${k}|${day}`);
    if (!pairs.has(k)) pairs.set(k, { planned: [], logged: [] });
    pairs.get(k).logged.push(day);
  }
  for (const v of pairs.values()) { v.planned.sort(); v.logged.sort(); }

  const series = days.map(date => {
    let planned = 0, logged = 0, sameDay = 0, unplanned = 0;
    let cumPlanned = 0, cumAdhered = 0;

    for (const v of pairs.values()) {
      const pToday = v.planned.filter(d => d === date).length;
      const lToday = v.logged.filter(d => d === date).length;
      planned += pToday;
      logged  += lToday;
      if (pToday && lToday) sameDay += Math.min(pToday, lToday);
      if (!v.planned.length) unplanned += lToday;

      const pTo = v.planned.filter(d => d <= date).length;
      const lTo = v.logged.filter(d => d <= date).length;
      cumPlanned += pTo;
      cumAdhered += Math.min(lTo, pTo);      // capped: extra visits do not inflate
    }

    return {
      date,
      is_future: date > asOn,
      planned,
      logged,
      same_day: sameDay,
      unplanned,
      cum_planned: cumPlanned,
      cum_adhered: cumAdhered,
      cum_pct: cumPlanned > 0 ? Math.round((cumAdhered / cumPlanned) * 1000) / 10 : 0
    };
  });

  const upto = series.filter(r => !r.is_future);
  const last = upto[upto.length - 1] || null;

  return {
    period_month: periodMonth,
    cycle_code: cycleCode,
    as_on_date: asOn,
    cycle_window: { from: days[0], to: days[days.length - 1] },
    officers_in_scope: scope ? scope.length : null,
    totals: {
      planned_in_cycle: [...pairs.values()].reduce((n, v) => n + v.planned.length, 0),
      logged_in_cycle:  [...pairs.values()].reduce((n, v) => n + v.logged.length, 0),
      log_rows_read: logRows.filter(r => inScope(r.employee_code)).length,
      cum_planned: last?.cum_planned || 0,
      cum_adhered: last?.cum_adhered || 0,
      cum_pct:     last?.cum_pct || 0
    },
    method: 'cum_pct = visits made on or before the date / visits due on or before it, ' +
            'capped per counter. Not the prorated MTD figure — this one is exact to the date.',
    days: series
  };
}

function parseDailyQuery(query) {
  const month = norm(query.month);
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: 'month (YYYY-MM) is required.' };
  const cycle = norm(query.cycle).toUpperCase() || 'C1';
  if (!['C1', 'C2'].includes(cycle)) return { error: `cycle must be C1 or C2, received '${cycle}'.` };
  const asOn = norm(query.asOn);
  if (asOn && !/^\d{4}-\d{2}-\d{2}$/.test(asOn)) {
    return { error: `asOn must be YYYY-MM-DD, received '${asOn}'.` };
  }
  return { month, cycle, asOn: asOn || null };
}

/** Company-wide, or narrowed to one role or one officer. */
export async function getDailyAdherence(req, res) {
  try {
    const q = parseDailyQuery(req.query);
    if (q.error) return res.status(400).json({ error: q.error });

    let empCodes = null;
    const only = norm(req.query.empCode);
    const role = norm(req.query.role).toUpperCase();
    if (only) {
      empCodes = [only];
    } else if (role && role !== 'ALL') {
      const rows = await dbAll(
        `SELECT DISTINCT emp_code FROM sales_plans
          WHERE period_month = ? AND cycle_code = ? AND emp_role = ?`,
        [q.month, q.cycle, role]
      ).catch(() => []);
      empCodes = rows.map(r => r.emp_code);
    }

    const out = await buildDailyAdherence({
      periodMonth: q.month, cycleCode: q.cycle, empCodes, asOnDate: q.asOn
    });
    res.json({ scope: only ? `officer ${only}` : (role && role !== 'ALL' ? `role ${role}` : 'all officers'), ...out });
  } catch (err) {
    console.error('[getDailyAdherence]', err);
    res.status(500).json({ error: err.message });
  }
}

/** The same series, for the people this approver signs off. */
export async function getTeamDailyAdherence(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const q = parseDailyQuery(req.query);
    if (q.error) return res.status(400).json({ error: q.error });

    const team = await dbAll(
      `SELECT DISTINCT emp_code, emp_name FROM sales_plans
        WHERE l1_approver_emp_code = ? AND period_month = ? AND cycle_code = ?`,
      [empCode, q.month, q.cycle]
    ).catch(() => []);

    const out = await buildDailyAdherence({
      periodMonth: q.month, cycleCode: q.cycle,
      empCodes: team.map(t => t.emp_code), asOnDate: q.asOn
    });
    res.json({
      approver_emp_code: empCode,
      scope: `${team.length} officer(s) reporting to ${empCode}`,
      team: team.map(t => ({ emp_code: t.emp_code, emp_name: t.emp_name })),
      ...out
    });
  } catch (err) {
    console.error('[getTeamDailyAdherence]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTER-LEVEL ADHERENCE — the client's "Target vs Adhe SO_ASM_RSM_ZM" sheet
// GET /api/app/admin/adherence/counters?month=&cycle=&asOn=&empCode=&role=&search=
// GET /api/app/approvers/:empCode/adherence/counters?month=&cycle=&asOn=
//
// Their tracker is one row per counter with four role blocks side by side, each block
// carrying five figures. Transcribed from the workbook (row 4 headers, row 5 formulas):
//
//   No. of visits Planned by <ROLE> in (DJP)        full-cycle plan
//   MTD No. of visits Planned by <ROLE> in (DJP)    the plan prorated to the as-on date
//   No. of visits Adhered by <ROLE>                 what the SFA log shows
//   <ROLE> Adherence %      = IFERROR(adhered / IF(mtd < 1, planned, mtd), 0)
//   <ROLE> Pending to visit = mtd - adhered
//
// Two details of theirs that are easy to get wrong and are reproduced exactly:
//
//   1. The denominator falls back to the FULL plan when MTD rounds below 1. Early in a
//      cycle MTD is a fraction, and dividing by 0.4 would read as 250% for one visit.
//   2. Pending is MTD - adhered and is allowed to go NEGATIVE. A negative pending is
//      not an error; it is the sheet saying someone is ahead of schedule.
//
// Both already live in sfa-adherence.engine.js, which is what this reads — so the app,
// the admin report and their spreadsheet all compute adherence one way.
//
// The dimension columns are theirs too: Zone, Region, Cust Type, Area, Block, the four
// hierarchy names, Dealer Name, SFA, Counter strategy, Customer CODE, Category.
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_BLOCKS = ['SO', 'ASM', 'RSM', 'ZH'];

/** An empty role block — a counter no one of that role is scheduled to visit. */
const emptyBlock = () => ({
  planned: 0, mtd_planned: 0, adhered: 0, adherence_pct: 0, pending: 0,
  emp_code: null, emp_name: null, planned_dates: [], visit_dates: []
});

async function counterDimensions(periodMonth, cycleCode) {
  const rows = await dbAll(
    `SELECT dvt.sap_code, dvt.sfa_code, dvt.dealer_name, dvt.zone, dvt.region,
            dvt.cust_type, dvt.area, dvt.dm_area, dvt.block, dvt.sbg_block,
            dvt.category, dvt.dealer_status, dvt.priority,
            dvt.so_name, dvt.asm_name, dvt.rsm_name, dvt.zh_name,
            md.counter_strategy
       FROM dealer_visit_targets dvt
       LEFT JOIN master_dealers md
              ON md.sap_code = dvt.sap_code
              OR (dvt.sap_code IS NULL AND md.sfa_code = dvt.sfa_code)
      WHERE dvt.period_month = ? AND dvt.cycle_code = ?`,
    [periodMonth, cycleCode]
  ).catch(() => []);

  const byCode = new Map();
  for (const r of rows) {
    for (const code of [norm(r.sap_code).toUpperCase(), norm(r.sfa_code).toUpperCase()]) {
      if (code && !byCode.has(code)) byCode.set(code, r);
    }
  }
  return byCode;
}

async function buildCounterAdherence({ periodMonth, cycleCode, asOnDate, empCodes = null, search = '' }) {
  const { analyseAdherence } = await import('../engines/sfa-adherence.engine.js');
  const a = await analyseAdherence({
    periodMonth,
    cycleCode: cycleCode && cycleCode !== 'ALL' ? cycleCode : null,
    asOnDate: asOnDate || null
  });

  const dims = await counterDimensions(periodMonth, cycleCode || 'C1');
  const scope = Array.isArray(empCodes) ? empCodes.map(c => norm(c).toUpperCase()) : null;
  const needle = norm(search).toUpperCase();

  const counters = new Map();
  for (const d of a.byDealer) {
    if (scope && !scope.includes(norm(d.emp_code).toUpperCase())) continue;
    const code = norm(d.dealer_sap_code).toUpperCase();
    if (!code) continue;

    if (!counters.has(code)) {
      const dim = dims.get(code) || {};
      counters.set(code, {
        customer_code: dim.sap_code || d.dealer_sap_code,
        sfa_code: dim.sfa_code || null,
        dealer_name: dim.dealer_name || d.dealer_name,
        zone: dim.zone || null,
        region: dim.region || null,
        cust_type: custTypeForSfa(dim.cust_type),
        area: dim.dm_area || dim.area || null,
        block: dim.sbg_block || dim.block || null,
        zsh_name: dim.zh_name || null,
        rsm_name: dim.rsm_name || null,
        asm_name: dim.asm_name || null,
        so_name: dim.so_name || null,
        counter_strategy: dim.counter_strategy || null,
        grade: dim.category || null,
        category: dim.dealer_status || null,
        priority: dim.priority ?? null,
        by_role: Object.fromEntries(ROLE_BLOCKS.map(r => [r, emptyBlock()]))
      });
    }

    const c = counters.get(code);
    const role = ROLE_BLOCKS.includes(d.role) ? d.role : 'SO';
    const b = c.by_role[role];
    b.planned      += d.planned;
    b.mtd_planned  += d.mtd_planned;
    b.adhered      += d.adhered;
    b.emp_code      = b.emp_code || d.emp_code;
    b.emp_name      = b.emp_name || d.emp_name;
    b.planned_dates = [...new Set([...b.planned_dates, ...(d.planned_dates || [])])].sort();
    b.visit_dates   = [...new Set([...b.visit_dates, ...(d.visit_dates || [])])].sort();
  }

  // Their two formulas, applied after the blocks are complete so a counter visited by
  // two people of the same role is scored once on the combined figures.
  const round2 = n => Math.round(n * 100) / 100;
  for (const c of counters.values()) {
    for (const role of ROLE_BLOCKS) {
      const b = c.by_role[role];
      const denom = b.mtd_planned < 1 ? b.planned : b.mtd_planned;   // their IF(MTD<1, ...)
      b.adherence_pct = denom > 0 ? Math.round((b.adhered / denom) * 1000) / 10 : 0;
      b.pending = round2(b.mtd_planned - b.adhered);                 // may be negative
      b.mtd_planned = round2(b.mtd_planned);
    }
  }

  let rows = [...counters.values()];
  if (needle) {
    rows = rows.filter(r =>
      [r.dealer_name, r.customer_code, r.sfa_code, r.so_name, r.area, r.block, r.category]
        .some(v => norm(v).toUpperCase().includes(needle)));
  }
  rows.sort((x, y) =>
    (y.by_role.SO.pending - x.by_role.SO.pending) ||
    String(x.dealer_name).localeCompare(String(y.dealer_name)));

  // The footer the sheet's own totals row would show, one per role block.
  const totals = Object.fromEntries(ROLE_BLOCKS.map(role => {
    const planned = rows.reduce((s2, r) => s2 + r.by_role[role].planned, 0);
    const mtd     = rows.reduce((s2, r) => s2 + r.by_role[role].mtd_planned, 0);
    const adhered = rows.reduce((s2, r) => s2 + r.by_role[role].adhered, 0);
    const denom   = mtd < 1 ? planned : mtd;
    return [role, {
      planned,
      mtd_planned: round2(mtd),
      adhered,
      adherence_pct: denom > 0 ? Math.round((adhered / denom) * 1000) / 10 : 0,
      pending: round2(mtd - adhered),
      counters: rows.filter(r => r.by_role[role].planned > 0).length
    }];
  }));

  return {
    period_month: periodMonth,
    cycle_code: cycleCode,
    as_on_date: a.asOnDate,
    elapsed_fraction: Math.round(fractionFor(a, cycleCode) * 1000) / 1000,
    count: rows.length,
    columns: {
      dimensions: ['Zone', 'Region', 'Cust Type', 'Area', 'Block', 'ZSH NAME', 'RSM NAME',
                   'ASM NAME', 'SO/SE NAME', 'DEALER NAME', 'SFA', 'Counter strategy',
                   'Customer CODE', 'Category'],
      per_role: ['No. of visits Planned in (DJP)', 'MTD No. of visits Planned in (DJP)',
                 'No. of visits Adhered', 'Adherence %', 'Pending to visit as per DJP']
    },
    method: 'Adherence % = adhered / IF(MTD planned < 1, planned, MTD planned). ' +
            'Pending = MTD planned - adhered, and is negative when ahead of schedule.',
    totals,
    counters: rows
  };
}

export async function getCounterAdherence(req, res) {
  try {
    const q = parseDailyQuery(req.query);
    if (q.error) return res.status(400).json({ error: q.error });

    let empCodes = null;
    const only = norm(req.query.empCode);
    const role = norm(req.query.role).toUpperCase();
    if (only) {
      empCodes = [only];
    } else if (role && role !== 'ALL') {
      const rows = await dbAll(
        `SELECT DISTINCT emp_code FROM sales_plans
          WHERE period_month = ? AND cycle_code = ? AND emp_role = ?`,
        [q.month, q.cycle, role]
      ).catch(() => []);
      empCodes = rows.map(r => r.emp_code);
    }

    const out = await buildCounterAdherence({
      periodMonth: q.month, cycleCode: q.cycle, asOnDate: q.asOn,
      empCodes, search: req.query.search
    });
    res.json({ scope: only ? `officer ${only}` : (role && role !== 'ALL' ? `role ${role}` : 'all officers'), ...out });
  } catch (err) {
    console.error('[getCounterAdherence]', err);
    res.status(500).json({ error: err.message });
  }
}

export async function getTeamCounterAdherence(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const q = parseDailyQuery(req.query);
    if (q.error) return res.status(400).json({ error: q.error });

    const team = await dbAll(
      `SELECT DISTINCT emp_code, emp_name FROM sales_plans
        WHERE l1_approver_emp_code = ? AND period_month = ? AND cycle_code = ?`,
      [empCode, q.month, q.cycle]
    ).catch(() => []);

    const out = await buildCounterAdherence({
      periodMonth: q.month, cycleCode: q.cycle, asOnDate: q.asOn,
      empCodes: team.map(t => t.emp_code), search: req.query.search
    });
    res.json({
      approver_emp_code: empCode,
      scope: `${team.length} officer(s) reporting to ${empCode}`,
      team: team.map(t => ({ emp_code: t.emp_code, emp_name: t.emp_name })),
      ...out
    });
  } catch (err) {
    console.error('[getTeamCounterAdherence]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CYCLE HANDOVER — what changes after the 15th
// GET /api/app/admin/cycle-handover?month=YYYY-MM&empCode=&asOn=
//
// C1 runs days 1-15, C2 runs 16 to month end. On the 15th the month does not simply
// continue: C2 is REBUILT from what C1 actually achieved. Counters visited in C1 drop
// down the order; counters missed in C1 are carried forward and scheduled earlier.
//
// That is the single hardest thing to explain in a demo, because it happens inside a
// regeneration run. This answers it directly, counter by counter:
//
//   was it planned in C1?   was it visited?   is it in C2, and on what day?
//
// Read-only. It regenerates nothing — it reports the state as it stands, so it can be
// called BEFORE the rebuild (to show what is about to carry forward) and AFTER
// (to show what did).
// ─────────────────────────────────────────────────────────────────────────────
export async function getCycleHandover(req, res) {
  try {
    const month = norm(req.query.month);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month (YYYY-MM) is required.' });
    }
    const only = norm(req.query.empCode);
    const canon = await dealerCodeAliases(month);

    const rows = await dbAll(
      `SELECT p.cycle_code, p.emp_code, p.emp_name, p.emp_role, p.status,
              d.dealer_sap_code, d.dealer_name, d.visit_date
         FROM sales_plan_details d
         JOIN sales_plans p ON p.id = d.plan_id
        WHERE p.period_month = ?` + (only ? ' AND p.emp_code = ?' : ''),
      only ? [month, only] : [month]
    ).catch(() => []);

    const logs = await dbAll(
      `SELECT employee_code, customer_code, visit_date FROM visit_execution_logs
        WHERE visit_date BETWEEN ? AND ?`, [`${month}-01`, `${month}-31`]
    ).catch(() => []);

    const visited = new Set();
    for (const l of logs) {
      if (only && !same(l.employee_code, only)) continue;
      visited.add(`${norm(l.employee_code).toUpperCase()}|${canon(l.customer_code)}|` +
                  `${String(l.visit_date).slice(0, 10) <= `${month}-15` ? 'C1' : 'C2'}`);
    }

    const counters = new Map();
    for (const r of rows) {
      const code = canon(r.dealer_sap_code);
      const key = `${norm(r.emp_code).toUpperCase()}|${code}`;
      if (!counters.has(key)) {
        counters.set(key, {
          emp_code: r.emp_code, emp_name: r.emp_name, role: r.emp_role || 'SO',
          customer_code: r.dealer_sap_code, dealer_name: r.dealer_name,
          c1_planned: 0, c1_dates: [], c1_visited: false,
          c2_planned: 0, c2_dates: []
        });
      }
      const c = counters.get(key);
      const day = String(r.visit_date).slice(0, 10);
      if (r.cycle_code === 'C1') { c.c1_planned++; c.c1_dates.push(day); }
      else                       { c.c2_planned++; c.c2_dates.push(day); }
    }
    for (const [key, c] of counters) {
      c.c1_visited = visited.has(`${key}|C1`);
      c.c1_dates = [...new Set(c.c1_dates)].sort();
      c.c2_dates = [...new Set(c.c2_dates)].sort();
      c.c2_first_day = c.c2_dates[0] || null;
      // What the handover did with this counter.
      c.outcome =
        c.c1_planned && !c.c1_visited && c.c2_planned ? 'CARRIED_FORWARD' :
        c.c1_planned && !c.c1_visited && !c.c2_planned ? 'MISSED_AND_DROPPED' :
        c.c1_planned && c.c1_visited && c.c2_planned ? 'VISITED_AND_REPEATED' :
        c.c1_planned && c.c1_visited ? 'VISITED_AND_DONE' :
        !c.c1_planned && c.c2_planned ? 'NEW_IN_C2' : 'OTHER';
    }

    const list = [...counters.values()];
    const c2Exists = list.some(c => c.c2_planned > 0);
    const by = o => list.filter(c => c.outcome === o);
    const carried = by('CARRIED_FORWARD');

    // How much earlier the carried-forward counters sit in C2. A counter that was
    // missed should not be scheduled on the last day of the cycle.
    const c2Days = list.filter(c => c.c2_first_day).map(c => c.c2_first_day).sort();
    const medianC2Day = c2Days.length ? c2Days[Math.floor(c2Days.length / 2)] : null;
    const carriedEarly = carried.filter(c => c.c2_first_day && medianC2Day &&
                                             c.c2_first_day <= medianC2Day).length;

    res.json({
      period_month: month,
      scope: only ? `officer ${only}` : 'all officers',
      windows: { C1: `${month}-01 → ${month}-15`, C2: `${month}-16 → month end` },
      c2_exists: c2Exists,
      summary: {
        c1_counters: list.filter(c => c.c1_planned > 0).length,
        c1_visited:  list.filter(c => c.c1_planned > 0 && c.c1_visited).length,
        c1_missed:   list.filter(c => c.c1_planned > 0 && !c.c1_visited).length,
        carried_forward: carried.length,
        missed_and_dropped: by('MISSED_AND_DROPPED').length,
        visited_and_repeated: by('VISITED_AND_REPEATED').length,
        new_in_c2: by('NEW_IN_C2').length,
        carried_in_first_half_of_c2: carriedEarly,
        c2_median_first_day: medianC2Day
      },
      explains: c2Exists
        ? 'C2 has been rebuilt. Counters missed in C1 were carried forward; the rest of ' +
          'C2 is the normal plan for the second half of the month.'
        : 'C2 has not been generated for this month yet. The counters listed as missed ' +
          'are the ones a rebuild would carry forward.',
      counters: list.sort((a, b) => {
        const rank = { CARRIED_FORWARD: 0, MISSED_AND_DROPPED: 1, NEW_IN_C2: 2,
                       VISITED_AND_REPEATED: 3, VISITED_AND_DONE: 4, OTHER: 5 };
        return (rank[a.outcome] - rank[b.outcome]) ||
               String(a.c2_first_day || '~').localeCompare(String(b.c2_first_day || '~')) ||
               String(a.dealer_name).localeCompare(String(b.dealer_name));
      })
    });
  } catch (err) {
    console.error('[getCycleHandover]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HIERARCHY ANALYSIS — the funnel, scoped to who is asking
// GET /api/app/hierarchy/:empCode/analysis?month=&cycle=&asOn=&depth=&include=
//
// Everyone sees themselves and everyone BELOW them, and nobody above or sideways:
//
//   ZH   → RSM → ASM → SO        (his whole zone)
//   RSM  → ASM → SO              (his region)
//   ASM  → SO                    (his area)
//   SO   → himself
//
// The scope is derived from the Dealer / SO Mapping hierarchy — the same source the
// approval routing uses — not from anything the caller sends, so a client cannot widen
// its own view by asking for someone else's code: it gets that person's subtree only if
// that person is inside the caller's own.
//
// TWO FUNNELS, and they are different questions:
//
//   the ORG funnel     ZH → RSM → ASM → SO, each level rolled up and drillable
//   the EXECUTION funnel  counters targeted → visits planned → due so far → made
//                          → counters actually covered
//
// Every node carries three sets of figures, because conflating them is the usual way
// this kind of report misleads:
//
//   own    this person's own plan (an ASM has his own counters to visit)
//   team   everyone beneath him, rolled up
//   total  own + team
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_RANK  = { ZH: 0, RSM: 1, ASM: 2, SO: 3 };
const BELOW      = { ZH: ['RSM', 'ASM', 'SO'], RSM: ['ASM', 'SO'], ASM: ['SO'], SO: [] };
const OWN_COLUMN = { ZH: 'zh_code', RSM: 'rsm_code', ASM: 'asm_code', SO: 'so_emp_code' };
const NAME_COLUMN = { ZH: 'zh_name', RSM: 'rsm_name', ASM: 'asm_name', SO: 'so_name' };

/**
 * Every (ZH, RSM, ASM, SO) chain in the hierarchy, deduplicated.
 * Dealer / SO Mapping is authoritative; the per-cycle DJP snapshot is the fallback for
 * a database where the mapping has not been uploaded yet.
 */
async function hierarchyChains() {
  for (const table of ['master_dealer_so_mapping', 'dealer_visit_targets']) {
    try {
      const rows = await dbAll(
        `SELECT DISTINCT zh_code, zh_name, rsm_code, rsm_name,
                         asm_code, asm_name, so_emp_code, so_name
           FROM ${table}
          WHERE so_emp_code IS NOT NULL AND TRIM(so_emp_code) <> ''`
      );
      if (rows && rows.length) return { rows, source: table };
    } catch { continue; }
  }
  return { rows: [], source: null };
}

/** The subtree under one person, as a nested tree plus a flat index by role. */
function buildSubtree(chains, viewerRole, viewerCode) {
  const mine = viewerRole === 'ADMIN'
    ? chains
    : chains.filter(c => same(c[OWN_COLUMN[viewerRole]], viewerCode));

  // Only roles STRICTLY BELOW the viewer. A chain row carries his superiors' codes too,
  // and indexing those would put his own RSM inside an ASM's "scope" — the report would
  // then tell an ASM he oversees the man who oversees him.
  const flat = { ZH: new Map(), RSM: new Map(), ASM: new Map(), SO: new Map() };
  const visibleRoles = viewerRole === 'ADMIN'
    ? ['ZH', 'RSM', 'ASM', 'SO']
    : (BELOW[viewerRole] || []);
  for (const c of mine) {
    for (const role of visibleRoles) {
      const code = norm(c[OWN_COLUMN[role]]);
      if (!code) continue;
      if (same(code, viewerCode)) continue;              // he is the viewer, not his own report
      if (!flat[role].has(code.toUpperCase())) {
        flat[role].set(code.toUpperCase(), { emp_code: code, emp_name: norm(c[NAME_COLUMN[role]]) || code, role });
      }
    }
  }

  // Nest, starting at the level directly below the viewer.
  const childRole = { ZH: 'RSM', RSM: 'ASM', ASM: 'SO', SO: null };
  const build = (role, code) => {
    const next = childRole[role];
    if (!next) return [];
    const kids = new Map();
    for (const c of mine) {
      if (code && !same(c[OWN_COLUMN[role]], code)) continue;
      const kidCode = norm(c[OWN_COLUMN[next]]);
      if (!kidCode) continue;
      if (!kids.has(kidCode.toUpperCase())) {
        kids.set(kidCode.toUpperCase(), {
          emp_code: kidCode, emp_name: norm(c[NAME_COLUMN[next]]) || kidCode, role: next
        });
      }
    }
    return [...kids.values()].map(k => ({ ...k, reports: build(next, k.emp_code) }));
  };

  return { flat, children: build(viewerRole, viewerCode) };
}

const ZERO = () => ({
  counters: 0, counters_visited: 0, counters_missed: 0,
  planned: 0, mtd_due: 0, adhered: 0, pending: 0, adherence_pct: 0, coverage_pct: 0
});

const roundTo = (n, p = 2) => Math.round(n * 10 ** p) / 10 ** p;

/** Their formula, applied to a set of already-summed figures. */
function score(s) {
  const denom = s.mtd_due < 1 ? s.planned : s.mtd_due;
  return {
    counters: s.counters,
    counters_visited: s.counters_visited,
    counters_missed: s.counters_missed,
    planned: s.planned,
    mtd_due: roundTo(s.mtd_due),
    adhered: s.adhered,
    pending: roundTo(s.mtd_due - s.adhered),
    adherence_pct: denom > 0 ? Math.round((s.adhered / denom) * 1000) / 10 : 0,
    coverage_pct: s.counters > 0 ? Math.round((s.counters_visited / s.counters) * 1000) / 10 : 0
  };
}

function addInto(acc, s) {
  acc.counters += s.counters; acc.counters_visited += s.counters_visited;
  acc.counters_missed += s.counters_missed; acc.planned += s.planned;
  acc.mtd_due += s.mtd_due; acc.adhered += s.adhered;
  return acc;
}

export async function getHierarchyAnalysis(req, res) {
  try {
    const empCode = norm(req.params.empCode);
    const q = parseDailyQuery(req.query);
    if (q.error) return res.status(400).json({ error: q.error });
    const wantVisits = req.query.include === 'visits' || req.query.include === 'all';
    const maxDepth = Math.max(1, Math.min(4, parseInt(req.query.depth || '4', 10)));

    const viewerRole = same(empCode, 'ADMIN')
      ? 'ADMIN'
      : await resolveEmployeeRole(empCode);
    const { rows: chains, source } = await hierarchyChains();
    if (!chains.length) {
      return res.status(409).json({
        error: 'No hierarchy is loaded. Upload the Dealer / SO Mapping file, or run a ' +
               'generation so dealer_visit_targets carries the hierarchy.'
      });
    }
    const { flat, children } = buildSubtree(chains, viewerRole, empCode);

    // ── the numbers, once, for everybody in scope ────────────────────────────
    const { analyseAdherence } = await import('../engines/sfa-adherence.engine.js');
    const a = await analyseAdherence({
      periodMonth: q.month,
      cycleCode: q.cycle && q.cycle !== 'ALL' ? q.cycle : null,
      asOnDate: q.asOn || null
    });
    const statOf = new Map();
    for (const e of a.byEmployee) {
      statOf.set(norm(e.emp_code).toUpperCase(), {
        counters: e.dealers,
        counters_visited: e.dealers_visited,
        counters_missed: e.dealers_missed,
        planned: e.planned,
        mtd_due: e.mtd_planned,
        adhered: e.adhered
      });
    }

    const planRows = await dbAll(
      `SELECT emp_code, emp_role, status, cycle_code,
              (SELECT COUNT(*) FROM sales_plan_details d WHERE d.plan_id = sales_plans.id) AS visits
         FROM sales_plans WHERE period_month = ?` +
      (q.cycle && q.cycle !== 'ALL' ? ' AND cycle_code = ?' : ''),
      q.cycle && q.cycle !== 'ALL' ? [q.month, q.cycle] : [q.month]
    ).catch(() => []);
    const planOf = new Map();
    for (const p of planRows) {
      const k = norm(p.emp_code).toUpperCase();
      if (!planOf.has(k)) planOf.set(k, { plans: 0, visits: 0, statuses: {} });
      const v = planOf.get(k);
      v.plans += 1;
      v.visits += Number(p.visits || 0);
      v.statuses[p.status] = (v.statuses[p.status] || 0) + 1;
    }

    // ── decorate the tree, rolling up as we come back out ────────────────────
    const decorate = (node, depth) => {
      const key = norm(node.emp_code).toUpperCase();
      const own = statOf.get(key) || { counters: 0, counters_visited: 0, counters_missed: 0,
                                       planned: 0, mtd_due: 0, adhered: 0 };
      const teamAcc = { counters: 0, counters_visited: 0, counters_missed: 0,
                        planned: 0, mtd_due: 0, adhered: 0 };
      const reports = (node.reports || []).map(r => decorate(r, depth + 1));
      for (const r of reports) addInto(teamAcc, r._raw_total);
      const totalAcc = addInto(addInto({ counters: 0, counters_visited: 0, counters_missed: 0,
                                         planned: 0, mtd_due: 0, adhered: 0 }, own), teamAcc);

      const plan = planOf.get(key) || { plans: 0, visits: 0, statuses: {} };
      const out = {
        emp_code: node.emp_code,
        emp_name: node.emp_name,
        role: node.role,
        depth,
        plan: { plans: plan.plans, visits_scheduled: plan.visits, by_status: plan.statuses },
        own: score(own),
        team: score(teamAcc),
        total: score(totalAcc),
        reports_count: reports.length,
        reports: depth < maxDepth ? reports.map(r => { const { _raw_total, ...rest } = r; return rest; }) : []
      };
      out._raw_total = totalAcc;
      return out;
    };

    const tree = children.map(c => decorate(c, 1));

    // The viewer's own line, and the whole scope rolled up.
    const viewerKey = norm(empCode).toUpperCase();
    const viewerOwn = statOf.get(viewerKey) || { counters: 0, counters_visited: 0, counters_missed: 0,
                                                planned: 0, mtd_due: 0, adhered: 0 };
    const scopeAcc = { counters: 0, counters_visited: 0, counters_missed: 0,
                       planned: 0, mtd_due: 0, adhered: 0 };
    addInto(scopeAcc, viewerOwn);
    for (const t of tree) addInto(scopeAcc, t._raw_total);
    for (const t of tree) delete t._raw_total;

    // ── level bands: one row per person, per role, flat ──────────────────────
    const levels = BELOW[viewerRole] || ['RSM', 'ASM', 'SO'];
    const byLevel = levels.map(role => {
      const people = [...flat[role].values()]
        .map(p => {
          const k = norm(p.emp_code).toUpperCase();
          const s = statOf.get(k);
          const plan = planOf.get(k) || { plans: 0, visits: 0 };
          return {
            emp_code: p.emp_code, emp_name: p.emp_name, role,
            has_plan: !!s,
            plans: plan.plans,
            visits_scheduled: plan.visits,
            ...score(s || { counters: 0, counters_visited: 0, counters_missed: 0,
                            planned: 0, mtd_due: 0, adhered: 0 })
          };
        })
        .sort((x, y) => x.adherence_pct - y.adherence_pct ||
                        String(x.emp_name).localeCompare(String(y.emp_name)));
      const acc = { counters: 0, counters_visited: 0, counters_missed: 0,
                    planned: 0, mtd_due: 0, adhered: 0 };
      for (const p of people) {
        addInto(acc, { counters: p.counters, counters_visited: p.counters_visited,
                       counters_missed: p.counters_missed, planned: p.planned,
                       mtd_due: p.mtd_due, adhered: p.adhered });
      }
      return {
        role,
        people_count: people.length,
        with_a_plan: people.filter(p => p.has_plan).length,
        totals: score(acc),
        people
      };
    });

    // ── the execution funnel, for the whole scope ────────────────────────────
    const scope = score(scopeAcc);
    const funnel = [
      { stage: 'Counters targeted', value: scope.counters, of_previous_pct: 100,
        note: 'counters on a plan in this scope' },
      { stage: 'Visits planned',    value: scope.planned,
        of_previous_pct: scope.counters ? Math.round((scope.planned / scope.counters) * 1000) / 10 : 0,
        note: 'visits scheduled across those counters' },
      { stage: 'Due so far',        value: scope.mtd_due,
        of_previous_pct: scope.planned ? Math.round((scope.mtd_due / scope.planned) * 1000) / 10 : 0,
        note: 'planned x elapsed fraction of the cycle' },
      { stage: 'Visits made',       value: scope.adhered,
        of_previous_pct: scope.mtd_due >= 1 ? Math.round((scope.adhered / scope.mtd_due) * 1000) / 10 : 0,
        note: 'from the SFA visit log' },
      { stage: 'Counters covered',  value: scope.counters_visited,
        of_previous_pct: scope.counters ? Math.round((scope.counters_visited / scope.counters) * 1000) / 10 : 0,
        note: 'counters visited at least once' }
    ];

    // ── optional: every visit, for the officers in scope ─────────────────────
    let visits = null;
    if (wantVisits) {
      const codes = [...new Set([
        empCode,
        ...['ZH', 'RSM', 'ASM', 'SO'].flatMap(r => [...flat[r].values()].map(p => p.emp_code))
      ])].filter(Boolean);
      if (codes.length) {
        const marks = codes.map(() => '?').join(',');
        visits = await dbAll(
          `SELECT p.emp_code, p.emp_name, p.emp_role AS role, p.cycle_code, p.status AS plan_status,
                  d.visit_date, d.dealer_sap_code, d.dealer_name, d.sequence, d.purpose_of_visit,
                  COALESCE(d.source, 'AUTO') AS source
             FROM sales_plan_details d
             JOIN sales_plans p ON p.id = d.plan_id
            WHERE p.period_month = ? AND UPPER(TRIM(p.emp_code)) IN (${marks})` +
          (q.cycle && q.cycle !== 'ALL' ? ' AND p.cycle_code = ?' : '') +
          ` ORDER BY d.visit_date ASC, p.emp_code ASC, d.sequence ASC`,
          q.cycle && q.cycle !== 'ALL'
            ? [q.month, ...codes.map(c => c.toUpperCase()), q.cycle]
            : [q.month, ...codes.map(c => c.toUpperCase())]
        ).catch(() => []);
      }
    }

    res.json({
      viewer: {
        emp_code: empCode,
        // resolveEmployeeName returns { name, source } — taking it as a string prints
        // "[object Object]" where the person's name should be.
        emp_name: (await resolveEmployeeName(empCode, viewerRole === 'ADMIN' ? null : viewerRole))?.name
                  || empCode,
        role: viewerRole,
        sees: BELOW[viewerRole] || ['RSM', 'ASM', 'SO']
      },
      period: { month: q.month, cycle: q.cycle, as_on_date: a.asOnDate },
      hierarchy_source: source,
      scope: {
        people: ['ZH', 'RSM', 'ASM', 'SO'].reduce((n, r) => n + flat[r].size, 0),
        by_role: Object.fromEntries(
          ['ZH', 'RSM', 'ASM', 'SO'].filter(r => flat[r].size).map(r => [r, flat[r].size]))
      },
      totals: { own: score(viewerOwn), scope },
      funnel,
      levels: byLevel,
      tree,
      visits,
      method: 'Adherence % = adhered / IF(MTD due < 1, planned, MTD due). ' +
              'own = this person\'s own plan; team = everyone beneath him; total = own + team.'
    });
  } catch (err) {
    console.error('[getHierarchyAnalysis]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OFFICER DRILL-DOWN — his visits, one by one, adhered or not
// GET /api/app/hierarchy/:viewerCode/officer/:empCode/visits?month=&cycle=&asOn=
//
// The level above can click a name and see the actual diary: every visit the plan
// asked for, and whether it happened. The manager's question is never "what is his
// percentage" — it is "which counters did he not get to".
//
// ACCESS: the officer must be inside the viewer's own subtree, checked against the
// hierarchy, not against anything the caller sends. An ASM asking for an SO who does
// not report to him gets 403. A person may always drill into himself.
//
// MATCHING a planned visit to a logged one is the interesting part. A counter planned
// twice, visited once, must read as one adhered and one missed — not two of either. So
// for each (officer, counter) pair:
//
//   1. same-day matches first     plan 06 Jun + log 06 Jun  → ADHERED
//   2. leftover logs then fill leftover planned slots, in date order
//                                 plan 06 Jun + log 09 Jun  → ADHERED_LATE (shows both)
//   3. planned slots still unfilled → MISSED
//   4. logs still unused           → EXTRA (a visit nobody planned)
//
// Counting any other way is how a report ends up claiming more adherence than there
// were visits.
// ─────────────────────────────────────────────────────────────────────────────
export async function getOfficerVisitDrill(req, res) {
  try {
    const viewerCode = norm(req.params.viewerCode);
    const empCode    = norm(req.params.empCode);
    const q = parseDailyQuery(req.query);
    if (q.error) return res.status(400).json({ error: q.error });

    // ── may this viewer see this officer? ────────────────────────────────────
    const viewerRole = same(viewerCode, 'ADMIN') ? 'ADMIN' : await resolveEmployeeRole(viewerCode);
    let allowed = same(viewerCode, empCode) || viewerRole === 'ADMIN';
    let officerRole = null;
    if (!allowed) {
      const { rows: chains } = await hierarchyChains();
      const { flat } = buildSubtree(chains, viewerRole, viewerCode);
      for (const role of ['ZH', 'RSM', 'ASM', 'SO']) {
        if (flat[role].has(empCode.toUpperCase())) { allowed = true; officerRole = role; break; }
      }
      if (!allowed) {
        return res.status(403).json({
          error: `${empCode} does not report to ${viewerCode}. A ${viewerRole} can only open ` +
                 `the people beneath them in the Dealer / SO Mapping hierarchy.`
        });
      }
    }
    officerRole = officerRole || await resolveEmployeeRole(empCode);

    // ── what was planned, and what was logged ────────────────────────────────
    const canon = await dealerCodeAliases(q.month);
    const cycleFilter = q.cycle && q.cycle !== 'ALL' ? ' AND p.cycle_code = ?' : '';
    const params = q.cycle && q.cycle !== 'ALL' ? [q.month, empCode, q.cycle] : [q.month, empCode];

    const planned = await dbAll(
      `SELECT d.id AS detail_id, d.visit_date, d.dealer_sap_code, d.dealer_name, d.sequence,
              d.purpose_of_visit, COALESCE(d.source, 'AUTO') AS source,
              p.cycle_code, p.status AS plan_status, p.id AS plan_id, p.emp_name
         FROM sales_plan_details d
         JOIN sales_plans p ON p.id = d.plan_id
        WHERE p.period_month = ? AND UPPER(TRIM(p.emp_code)) = UPPER(TRIM(?))${cycleFilter}
        ORDER BY d.visit_date ASC, d.sequence ASC`,
      params
    ).catch(() => []);

    const logs = await dbAll(
      `SELECT visit_date, customer_code, customer_name, check_in_time, check_out_time,
              duration, visit_status, purpose_of_visit, batch_code
         FROM visit_execution_logs
        WHERE UPPER(TRIM(employee_code)) = UPPER(TRIM(?))
          AND visit_date BETWEEN ? AND ?
        ORDER BY visit_date ASC`,
      [empCode, `${q.month}-01`, `${q.month}-31`]
    ).catch(() => []);

    // Dealer-level buckets, so a counter planned twice is matched twice.
    const byPair = new Map();
    for (const d of planned) {
      const k = canon(d.dealer_sap_code);
      if (!byPair.has(k)) byPair.set(k, { planned: [], logs: [] });
      byPair.get(k).planned.push({ ...d, day: String(d.visit_date).slice(0, 10) });
    }
    for (const l of logs) {
      const k = canon(l.customer_code);
      if (!byPair.has(k)) byPair.set(k, { planned: [], logs: [] });
      byPair.get(k).logs.push({ ...l, day: String(l.visit_date).slice(0, 10) });
    }

    const rows = [];
    const extras = [];
    for (const [code, pair] of byPair) {
      const unusedLogs = [...pair.logs].sort((a, b) => a.day.localeCompare(b.day));
      const slots = pair.planned.map(p => ({ plan: p, log: null, how: null }));

      // 1. same day
      for (const s of slots) {
        const i = unusedLogs.findIndex(l => l.day === s.plan.day);
        if (i >= 0) { s.log = unusedLogs.splice(i, 1)[0]; s.how = 'ADHERED'; }
      }
      // 2. leftover logs fill leftover slots, earliest first
      for (const s of slots) {
        if (s.log || !unusedLogs.length) continue;
        s.log = unusedLogs.shift();
        s.how = s.log.day > s.plan.day ? 'ADHERED_LATE' : 'ADHERED_EARLY';
      }
      for (const s of slots) {
        const p = s.plan;
        rows.push({
          detail_id: p.detail_id,
          plan_id: p.plan_id,
          cycle_code: p.cycle_code,
          plan_status: p.plan_status,
          planned_date: p.day,
          sequence: p.sequence,
          customer_code: code,
          dealer_name: p.dealer_name,
          purpose_of_visit: p.purpose_of_visit,
          source: p.source,
          status: s.how || 'MISSED',
          adhered: !!s.log,
          visited_date: s.log ? s.log.day : null,
          days_late: s.log ? Math.round(
            (Date.parse(s.log.day + 'T00:00:00Z') - Date.parse(p.day + 'T00:00:00Z')) / 86400000) : null,
          check_in_time: s.log?.check_in_time || null,
          check_out_time: s.log?.check_out_time || null,
          duration: s.log?.duration || null,
          visit_status: s.log?.visit_status || null,
          logged_via: s.log?.batch_code || null
        });
      }
      // 3. logs nobody planned
      for (const l of unusedLogs) {
        extras.push({
          customer_code: code,
          dealer_name: l.customer_name,
          visited_date: l.day,
          check_in_time: l.check_in_time,
          check_out_time: l.check_out_time,
          duration: l.duration,
          visit_status: l.visit_status,
          purpose_of_visit: l.purpose_of_visit,
          logged_via: l.batch_code,
          status: 'EXTRA'
        });
      }
    }

    rows.sort((a, b) => a.planned_date.localeCompare(b.planned_date) ||
                        (a.sequence || 0) - (b.sequence || 0));
    extras.sort((a, b) => a.visited_date.localeCompare(b.visited_date));

    // Grouped by day, which is how the screen reads.
    const byDay = new Map();
    for (const r of rows) {
      if (!byDay.has(r.planned_date)) byDay.set(r.planned_date, []);
      byDay.get(r.planned_date).push(r);
    }

    const adhered = rows.filter(r => r.adhered).length;
    const missed  = rows.length - adhered;
    const counters = new Set(rows.map(r => r.customer_code));
    const countersDone = new Set(rows.filter(r => r.adhered).map(r => r.customer_code));

    res.json({
      viewer: { emp_code: viewerCode, role: viewerRole },
      officer: {
        emp_code: empCode,
        emp_name: planned[0]?.emp_name ||
                  (await resolveEmployeeName(empCode, officerRole))?.name || empCode,
        role: officerRole
      },
      period: { month: q.month, cycle: q.cycle, as_on_date: q.asOn || null },
      totals: {
        planned_visits: rows.length,
        adhered: adhered,
        adhered_same_day: rows.filter(r => r.status === 'ADHERED').length,
        adhered_other_day: rows.filter(r => r.status === 'ADHERED_LATE' || r.status === 'ADHERED_EARLY').length,
        missed: missed,
        extra_visits: extras.length,
        counters: counters.size,
        counters_visited: countersDone.size,
        adherence_pct: rows.length ? Math.round((adhered / rows.length) * 1000) / 10 : 0
      },
      legend: {
        ADHERED: 'visited on the planned day',
        ADHERED_LATE: 'visited, but after the planned day',
        ADHERED_EARLY: 'visited before the planned day',
        MISSED: 'no visit logged against this planned slot',
        EXTRA: 'a visit that was not on the plan at all'
      },
      days: [...byDay.entries()].map(([date, visits]) => ({
        visit_date: date,
        planned: visits.length,
        adhered: visits.filter(v => v.adhered).length,
        visits
      })),
      visits: rows,
      extra_visits: extras,
      method: 'Each planned visit is matched to at most one logged visit — same day first, ' +
              'then any remaining logs in date order. A counter planned twice and visited ' +
              'once reads as one adhered and one missed.'
    });
  } catch (err) {
    console.error('[getOfficerVisitDrill]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — read-only adherence report
// GET /api/app/admin/adherence?month=YYYY-MM&cycle=C1|C2&asOn=YYYY-MM-DD&productiveOnly=1
//
// Uses the method taken from the client's own workbook: MTD due is the planned
// visit count prorated by how much of the cycle has elapsed at the as-on date,
// adherence is adhered ÷ MTD due, and pending goes negative when someone
// over-visits. Capped and uncapped are both reported because the client keeps both.
//
// Read-only. Nothing is regenerated.
// ─────────────────────────────────────────────────────────────────────────────
export async function getAdherenceReport(req, res) {
  try {
    const month = norm(req.query.month);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'month (YYYY-MM) is required.' });
    }
    const cycle = norm(req.query.cycle).toUpperCase();
    const asOn  = norm(req.query.asOn);
    if (asOn && !/^\d{4}-\d{2}-\d{2}$/.test(asOn)) {
      return res.status(400).json({ error: `asOn must be YYYY-MM-DD, received '${asOn}'.` });
    }

    const { analyseAdherence } = await import('../engines/sfa-adherence.engine.js');
    const a = await analyseAdherence({
      periodMonth: month,
      cycleCode: cycle && cycle !== 'ALL' ? cycle : null,
      asOnDate: asOn || null,
      productiveOnly: req.query.productiveOnly === '1' || req.query.productiveOnly === 'true'
    });

    const pct = n => Math.round(n * 1000) / 10;   // one decimal, as a percentage

    res.json({
      period_month: month,
      cycles: a.cycles,
      as_on_date: a.asOnDate,
      cycle_windows: a.windows,
      elapsed_fraction: a.elapsedFraction,
      method: 'MTD due = planned x elapsed fraction of the cycle; adherence = adhered / MTD due, falling back to full planned when MTD due < 1',

      totals: {
        dealers_on_plan: a.totals.dealers,
        dealers_visited: a.totals.dealers_visited,
        dealers_missed:  a.totals.dealers_missed,
        planned_visits:  a.totals.planned,
        mtd_due:         Math.round(a.totals.mtd_planned * 100) / 100,
        adhered:         a.totals.adhered,
        adhered_capped:  a.totals.adhered_capped,
        pending:         Math.round(a.totals.pending * 100) / 100,
        sfa_visits_in_window: a.diagnostics.sfa_visits_in_window
      },

      adherence: {
        capped_pct:   pct(a.totals.adherence_pct_capped),
        raw_pct:      pct(a.totals.adherence_pct),
        coverage_pct: pct(a.totals.coverage_pct),
        over_visited: a.totals.adhered > a.totals.mtd_planned,
        note: 'capped is MIN(actual, planned) per dealer — it never exceeds 100%. raw can, and negative pending means over-visiting.'
      },

      by_cycle: Object.fromEntries(Object.entries(a.byCycle).map(([c, v]) => [c, {
        elapsed_fraction: Math.round(v.elapsed_fraction * 1000) / 1000,
        dealers: v.dealers, planned: v.planned,
        mtd_due: Math.round(v.mtd_planned * 100) / 100,
        adhered: v.adhered, adhered_capped: v.adhered_capped,
        capped_pct: pct(v.adherence_pct_capped), raw_pct: pct(v.adherence_pct),
        pending: Math.round(v.pending * 100) / 100
      }])),

      by_role: Object.fromEntries(Object.entries(a.byRole).map(([r, v]) => [r, {
        dealers: v.dealers, planned: v.planned,
        mtd_due: Math.round(v.mtd_planned * 100) / 100,
        adhered: v.adhered, adhered_capped: v.adhered_capped,
        capped_pct: pct(v.adherence_pct_capped), raw_pct: pct(v.adherence_pct),
        pending: Math.round(v.pending * 100) / 100,
        coverage_pct: pct(v.coverage_pct)
      }])),

      by_employee: a.byEmployee.map(e => ({
        emp_code: e.emp_code, emp_name: e.emp_name, role: e.role, cycles: e.cycles,
        planned_dealers: e.dealers, visited: e.dealers_visited, missed: e.dealers_missed,
        planned_visits: e.planned,
        mtd_due: Math.round(e.mtd_planned * 100) / 100,
        adhered: e.adhered, adhered_capped: e.adhered_capped,
        capped_pct: pct(e.adherence_pct_capped), raw_pct: pct(e.adherence_pct),
        pending: Math.round(e.pending * 100) / 100,
        adherence_pct: pct(e.adherence_pct_capped),   // what the UI bar reads
        missed_dealers: e.missed_dealers.map(d => ({
          sap_code: d.sap_code, name: d.name, planned_date: d.planned_dates?.[0] || null
        }))
      })),

      by_dealer: a.byDealer.map(d => ({
        cycle: d.cycle_code, role: d.role,
        emp_code: d.emp_code, emp_name: d.emp_name,
        sap_code: d.dealer_sap_code, dealer_name: d.dealer_name,
        planned: d.planned,
        mtd_due: Math.round(d.mtd_planned * 100) / 100,
        adhered: d.adhered, adhered_capped: d.adhered_capped, adhered_days: d.adhered_days,
        capped_pct: pct(d.adherence_pct_capped), raw_pct: pct(d.adherence_pct),
        pending: Math.round(d.pending * 100) / 100,
        planned_dates: d.planned_dates, visit_dates: d.visit_dates
      })),

      diagnostics: {
        resolved_via_sfa_code: a.diagnostics.resolved_via_sfa_code,
        resolved_via_sfa_code_note: 'visits logged with the SFA customer code and resolved to the SAP code the plan uses — these used to read as missed',
        unresolved_visits: a.diagnostics.unresolved_visits,
        unresolved_detail: a.diagnostics.unresolved_detail,
        unplanned_visits: a.diagnostics.unplanned_visits,
        unplanned_detail: a.diagnostics.unplanned_detail
      }
    });
  } catch (err) {
    console.error('[getAdherenceReport]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — C2 regeneration review
//
// GET /api/app/admin/c2-regenerations?month=          list the runs
// GET /api/app/admin/c2-regenerations/:id             one run, with the full diff
//
// Answers the question the plan list cannot: what did the adherence result actually
// change? Regeneration deletes the previous C2, so the comparison is made against the
// snapshot taken either side of the purge rather than against live tables.
// ─────────────────────────────────────────────────────────────────────────────
export async function listC2Regenerations(req, res) {
  try {
    const month = norm(req.query.month);
    const params = [];
    let where = '1=1';
    if (month) { where += ' AND period_month = ?'; params.push(month); }

    let runs;
    try {
      runs = await dbAll(
        `SELECT * FROM c2_regenerations WHERE ${where} ORDER BY started_at DESC LIMIT 50`,
        params
      );
    } catch (e) {
      return res.status(409).json({
        error: 'C2 regeneration history is not set up yet.',
        fix: 'Run: node src/scripts/migrate-c2-review.js, then regenerate C2 once.'
      });
    }

    res.json({
      month: month || 'ALL',
      count: runs.length,
      regenerations: runs.map(r => ({
        id: r.id,
        generation_code: r.generation_code,
        period_month: r.period_month,
        status: r.status,
        started_at: r.started_at,
        completed_at: r.completed_at,
        adherence: {
          as_on: r.adherence_as_on,
          planned: r.adherence_planned,
          adhered: r.adherence_adhered,
          missed: r.adherence_missed,
          pct: r.adherence_pct
        },
        before: { plans: r.plans_before, visits: r.visits_before },
        after:  { plans: r.plans_after,  visits: r.visits_after },
        visit_delta: (r.visits_after || 0) - (r.visits_before || 0),
        first_run: (r.visits_before || 0) === 0
      }))
    });
  } catch (err) {
    console.error('[listC2Regenerations]', err);
    res.status(500).json({ error: err.message });
  }
}

export async function getC2Regeneration(req, res) {
  try {
    const run = await dbGet('SELECT * FROM c2_regenerations WHERE id = ?', [req.params.id])
      .catch(() => null);
    if (!run) return res.status(404).json({ error: 'Regeneration not found.' });

    const lines = await dbAll(
      'SELECT * FROM c2_regeneration_lines WHERE regeneration_id = ? ORDER BY emp_code, visit_date, sequence',
      [run.id]
    );
    const before = lines.filter(l => l.phase === 'BEFORE');
    const after  = lines.filter(l => l.phase === 'AFTER');

    let missedCodes = [];
    try { missedCodes = JSON.parse(run.missed_dealer_codes || '[]'); } catch (e) { /* ignore */ }

    const { diffLines } = await import('../services/c2Snapshot.service.js');
    const { changes, summary } = diffLines(before, after, missedCodes);

    // Group the new plan by officer so the screen can show each schedule in full,
    // with the carried-over dealers marked in place.
    const missedSet = new Set(missedCodes.map(c => norm(c).toUpperCase()));
    const byOfficer = new Map();
    for (const l of after) {
      const k = norm(l.emp_code);
      if (!byOfficer.has(k)) {
        byOfficer.set(k, {
          emp_code: l.emp_code, emp_name: l.emp_name, role: l.emp_role,
          visits: 0, dealers: new Set(), days: new Set(), lines: []
        });
      }
      const o = byOfficer.get(k);
      o.visits += 1;
      o.dealers.add(norm(l.dealer_sap_code));
      o.days.add(String(l.visit_date).slice(0, 10));
      o.lines.push({
        visit_date: String(l.visit_date).slice(0, 10),
        sequence: l.sequence,
        dealer_sap_code: l.dealer_sap_code,
        dealer_name: l.dealer_name,
        carried_over: missedSet.has(norm(l.dealer_sap_code).toUpperCase())
      });
    }

    const changesByOfficer = changes.reduce((acc, c) => {
      const k = norm(c.emp_code);
      (acc[k] = acc[k] || []).push(c);
      return acc;
    }, {});

    res.json({
      regeneration: {
        id: run.id,
        generation_code: run.generation_code,
        period_month: run.period_month,
        status: run.status,
        started_at: run.started_at,
        completed_at: run.completed_at,
        adherence: {
          as_on: run.adherence_as_on,
          planned: run.adherence_planned,
          adhered: run.adherence_adhered,
          missed: run.adherence_missed,
          pct: run.adherence_pct
        },
        before: { plans: run.plans_before, visits: run.visits_before },
        after:  { plans: run.plans_after,  visits: run.visits_after },
        first_run: (run.visits_before || 0) === 0
      },
      summary,
      changes,
      officers: [...byOfficer.values()]
        .map(o => ({
          emp_code: o.emp_code, emp_name: o.emp_name, role: o.role,
          visits: o.visits, dealers: o.dealers.size, days: o.days.size,
          carried_over: o.lines.filter(l => l.carried_over).length,
          changes: changesByOfficer[norm(o.emp_code)] || [],
          lines: o.lines.sort((a, b) => a.visit_date.localeCompare(b.visit_date) || a.sequence - b.sequence)
        }))
        .sort((a, b) => (b.carried_over - a.carried_over) || String(a.emp_code).localeCompare(String(b.emp_code)))
    });
  } catch (err) {
    console.error('[getC2Regeneration]', err);
    res.status(500).json({ error: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN — re-run routing for a period without regenerating plans
// POST /api/app/routing/restamp   Body: { periodMonth, cycleCode? }
// ─────────────────────────────────────────────────────────────────────────────
export async function restampRouting(req, res) {
  try {
    const { periodMonth, cycleCode } = req.body || {};
    if (!periodMonth) return res.status(400).json({ error: 'periodMonth (YYYY-MM) is required.' });

    const { stampPlanRoutingForPeriod } = await import('../services/planRouting.service.js');
    const result = await stampPlanRoutingForPeriod(periodMonth, cycleCode || null);

    res.json({
      success: true,
      message: `Routing re-stamped for ${result.stamped} plan(s).`,
      ...result
    });
  } catch (err) {
    console.error('[restampRouting]', err);
    res.status(500).json({ error: err.message });
  }
}
