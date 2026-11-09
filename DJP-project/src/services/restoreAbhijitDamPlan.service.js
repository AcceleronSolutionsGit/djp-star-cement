/**
 * Automatic Restoration Service for Abhijit Dam (ASM) C1 Plan
 * 
 * Ensures Abhijit Dam's ASM C1 plan contains all 74 canonical DJP engine visits.
 * If the plan was previously overridden or deleted, this service restores all
 * canonical visits into sales_plan_details without removing any visits submitted
 * by the officer.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbAll, dbRun, dbGet } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

export async function restoreAbhijitDamC1Plan(options = {}) {
  const targetEmpCode = '11001643';
  const targetPeriod = options.periodMonth || '2026-10';

  // 1. Locate or create Abhijit Dam's ASM C1 Plan
  let plan = await dbGet(
    `SELECT * FROM sales_plans 
     WHERE (emp_code = ? OR UPPER(emp_name) LIKE '%ABHIJIT%DAM%') 
       AND cycle_code = 'C1' 
       AND (period_month = ? OR ? = 'ALL')
     ORDER BY id DESC LIMIT 1`,
    [targetEmpCode, targetPeriod, targetPeriod]
  );

  if (!plan) {
    // Also check if any C1 plan exists for Abhijit Dam in any period
    plan = await dbGet(
      `SELECT * FROM sales_plans 
       WHERE (emp_code = ? OR UPPER(emp_name) LIKE '%ABHIJIT%DAM%') 
         AND cycle_code = 'C1'
       ORDER BY id DESC LIMIT 1`,
      [targetEmpCode]
    );
  }

  if (!plan) {
    console.log('[RestoreDam] Plan not found for Abhijit Dam C1. Creating plan header...');
    const insertRes = await dbRun(
      `INSERT INTO sales_plans (
         emp_code, emp_name, period_month, cycle_code, status, emp_role,
         required_approver_role, l1_approver_emp_code, l1_approver_name, l1_approver_role
       ) VALUES (?, ?, ?, 'C1', 'PENDING_ROLLOUT', 'ASM', 'RSM', 'RSM001', 'RSM 001', 'RSM')`,
      [targetEmpCode, 'ABHIJIT DAM', targetPeriod]
    );
    const planId = insertRes.insertId || insertRes.lastID;
    plan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [planId]);
  }

  const planId = plan.id;
  console.log(`[RestoreDam] Processing Plan #${planId} for ${plan.emp_name} (${plan.emp_code}) ${plan.period_month} ${plan.cycle_code} [Status: ${plan.status}]`);

  // 2. Fetch existing visits for this plan
  const existingVisits = await dbAll(
    'SELECT id, visit_date, dealer_id, dealer_sap_code, dealer_name, sequence, source FROM sales_plan_details WHERE plan_id = ?',
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

  // 3. Load canonical 74 visits for Abhijit Dam ASM C1
  const visitsJsonPath = path.resolve(__dirname, '../data/abhijitDamC1Visits.json');
  if (!fs.existsSync(visitsJsonPath)) {
    throw new Error(`Canonical visits dataset not found at: ${visitsJsonPath}`);
  }

  const canonicalVisits = JSON.parse(fs.readFileSync(visitsJsonPath, 'utf8'));

  let insertedCount = 0;
  let skippedCount = 0;

  for (const cv of canonicalVisits) {
    // If plan month differs from 2026-10, adapt the year-month of the visit date
    let targetDateStr = toDateStr(cv.visit_date);
    if (plan.period_month && !targetDateStr.startsWith(plan.period_month)) {
      const dayPart = targetDateStr.slice(8);
      targetDateStr = `${plan.period_month}-${dayPart}`;
    }

    const sap = cv.dealer_sap_code ? String(cv.dealer_sap_code).trim().toUpperCase() : '';
    const name = cv.dealer_name ? String(cv.dealer_name).trim().toUpperCase() : '';
    const id = cv.dealer_id ? String(cv.dealer_id) : '';

    const sapKey = sap ? `${targetDateStr}#SAP#${sap}` : null;
    const idKey = id ? `${targetDateStr}#ID#${id}` : null;
    const nameKey = name ? `${targetDateStr}#NAME#${name}` : null;

    const alreadyExists = (sapKey && existingKeys.has(sapKey)) ||
                          (idKey && existingKeys.has(idKey)) ||
                          (nameKey && existingKeys.has(nameKey));

    if (alreadyExists) {
      skippedCount++;
      continue;
    }

    const nextSeq = (maxSeqByDate.get(targetDateStr) || 0) + 1;
    maxSeqByDate.set(targetDateStr, nextSeq);

    await dbRun(
      `INSERT INTO sales_plan_details (
         plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type,
         purpose_of_visit, sequence, latitude, longitude, distance_from_prev_km,
         route_name, source, visit_status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUTO', 'ACTIVE')`,
      [
        planId,
        targetDateStr,
        cv.dealer_id || null,
        cv.dealer_sap_code || null,
        cv.dealer_name,
        cv.dealer_type || 'PROSPECTIVE',
        cv.purpose_of_visit || 'PJP Scheduled Visit (Prospective)',
        nextSeq,
        cv.latitude || null,
        cv.longitude || null,
        cv.distance_from_prev_km || 0,
        cv.route_name || null
      ]
    );

    if (sapKey) existingKeys.add(sapKey);
    if (idKey) existingKeys.add(idKey);
    if (nameKey) existingKeys.add(nameKey);
    insertedCount++;
  }

  const finalCount = await dbGet('SELECT COUNT(*) as n FROM sales_plan_details WHERE plan_id = ?', [planId]);
  const totalVisits = Number(finalCount?.n || 0);

  console.log(`[RestoreDam] Plan #${planId} updated: Restored ${insertedCount} visits, skipped ${skippedCount} already present. Total visits now: ${totalVisits}.`);

  return {
    success: true,
    planId,
    empCode: targetEmpCode,
    empName: plan.emp_name,
    periodMonth: plan.period_month,
    cycleCode: plan.cycle_code,
    status: plan.status,
    previouslyExistingVisits: existingVisits.length,
    restoredVisits: insertedCount,
    skippedDuplicates: skippedCount,
    totalVisits
  };
}

