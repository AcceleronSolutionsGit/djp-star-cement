import { dbRun, dbGet, dbAll } from '../config/database.js';

const norm = v => String(v ?? '').trim();
const key  = v => norm(v).toUpperCase();

/**
 * Ensure is_unplanned column exists on visit_execution_logs
 */
export async function ensureVisitExecutionLogsSchema() {
  try {
    const cols = await dbAll(`SHOW COLUMNS FROM visit_execution_logs LIKE 'is_unplanned'`);
    if (!cols || cols.length === 0) {
      await dbRun(`ALTER TABLE visit_execution_logs ADD COLUMN is_unplanned TINYINT(1) DEFAULT 0 COMMENT '0=Planned, 1=Unplanned'`);
    }
  } catch (e) {
    try {
      await dbRun(`ALTER TABLE visit_execution_logs ADD COLUMN is_unplanned TINYINT(1) DEFAULT 0`);
    } catch (_) {}
  }
}

/**
 * Build dealer code index: Customer code (SAP/SFA/RSSD) -> canonical SAP code + info
 */
export async function buildDealerLookupIndex() {
  const index = new Map();

  // 1. From dealer_visit_targets
  try {
    const targetRows = await dbAll(`SELECT sap_code, sfa_code, dealer_name, area, branch, zone FROM dealer_visit_targets`);
    for (const d of targetRows) {
      const canonical = norm(d.sap_code) || norm(d.sfa_code);
      if (!canonical) continue;
      const info = {
        canonical,
        sap_code: norm(d.sap_code) || canonical,
        sfa_code: norm(d.sfa_code) || null,
        name: d.dealer_name,
        area: d.area || d.branch || '',
        zone: d.zone || ''
      };
      for (const c of [d.sap_code, d.sfa_code]) {
        const k = key(c);
        if (k && !index.has(k)) index.set(k, info);
      }
    }
  } catch (_) {}

  // 2. From master_dealers fallback
  try {
    const masterRows = await dbAll(`SELECT sap_code, sfa_code, rssd_code, dealer_name, area, branch, zone FROM master_dealers`);
    for (const d of masterRows) {
      const canonical = norm(d.sap_code) || norm(d.sfa_code);
      if (!canonical) continue;
      const info = {
        canonical,
        sap_code: norm(d.sap_code) || canonical,
        sfa_code: norm(d.sfa_code) || null,
        name: d.dealer_name,
        area: d.area || d.branch || '',
        zone: d.zone || ''
      };
      for (const c of [d.sap_code, d.sfa_code, d.rssd_code]) {
        const k = key(c);
        if (k && !index.has(k)) index.set(k, info);
      }
    }
  } catch (_) {}

  return index;
}

/**
 * Reconcile SFA visit execution logs against planned visits.
 * Marks is_unplanned = 1 for visits made by officers to dealers not on their plan
 * or not scheduled on that date.
 *
 * @param {Object} opts
 * @param {string} [opts.startDate] 'YYYY-MM-DD'
 * @param {string} [opts.endDate]   'YYYY-MM-DD'
 * @param {string} [opts.periodMonth] 'YYYY-MM'
 * @param {string} [opts.batchCode]
 */
export async function reconcileUnplannedVisits(opts = {}) {
  await ensureVisitExecutionLogsSchema();

  const { startDate, endDate, periodMonth, batchCode } = opts;

  // 1. Build dealer code index
  const dealerIndex = await buildDealerLookupIndex();

  // 2. Query planned visits from sales_plan_details + sales_plans
  let planSql = `
    SELECT
      sp.emp_code,
      sp.emp_name,
      sp.period_month,
      sp.cycle_code,
      spd.visit_date,
      spd.dealer_sap_code,
      spd.dealer_name
    FROM sales_plan_details spd
    JOIN sales_plans sp ON sp.id = spd.plan_id
    WHERE 1=1
  `;
  const planParams = [];
  if (periodMonth) {
    planSql += ' AND sp.period_month = ?';
    planParams.push(periodMonth);
  } else if (startDate && endDate) {
    planSql += ' AND spd.visit_date >= ? AND spd.visit_date <= ?';
    planParams.push(startDate, endDate);
  }

  const plannedRows = await dbAll(planSql, planParams).catch(() => []);

  // 3. Query dealer visit targets for assigned roles (SO, ASM, RSM, ZH)
  let targetSql = `
    SELECT
      period_month,
      cycle_code,
      sap_code,
      sfa_code,
      dealer_name,
      so_emp_code,
      so_name,
      asm_code,
      asm_name,
      rsm_code,
      zh_code
    FROM dealer_visit_targets
    WHERE 1=1
  `;
  const targetParams = [];
  if (periodMonth) {
    targetSql += ' AND period_month = ?';
    targetParams.push(periodMonth);
  }
  const targetRows = await dbAll(targetSql, targetParams).catch(() => []);

  // 4. Build lookup sets for planned visits:
  // a) plannedOfficerDealers: (emp_code/name, dealer_code) in plan
  const plannedOfficerDealers = new Set();
  // b) plannedOfficerSchedule: (emp_code/name, dealer_code, visit_date)
  const plannedOfficerSchedule = new Set();

  for (const r of plannedRows) {
    const dealerCode = key(r.dealer_sap_code);
    const vDate = String(r.visit_date || '').slice(0, 10);
    const empC = key(r.emp_code);
    const empN = key(r.emp_name);

    if (empC && dealerCode) {
      plannedOfficerDealers.add(`${empC}|${dealerCode}`);
      if (vDate) plannedOfficerSchedule.add(`${empC}|${dealerCode}|${vDate}`);
    }
    if (empN && dealerCode) {
      plannedOfficerDealers.add(`${empN}|${dealerCode}`);
      if (vDate) plannedOfficerSchedule.add(`${empN}|${dealerCode}|${vDate}`);
    }
  }

  for (const t of targetRows) {
    const sapCode = key(t.sap_code);
    const sfaCode = key(t.sfa_code);

    const addTarget = (empC, empN) => {
      const c = key(empC);
      const n = key(empN);
      for (const dCode of [sapCode, sfaCode]) {
        if (!dCode) continue;
        if (c) plannedOfficerDealers.add(`${c}|${dCode}`);
        if (n) plannedOfficerDealers.add(`${n}|${dCode}`);
      }
    };

    if (t.so_emp_code) addTarget(t.so_emp_code, t.so_name);
    if (t.asm_code) addTarget(t.asm_code, t.asm_name);
    if (t.rsm_code) addTarget(t.rsm_code, t.rsm_name);
    if (t.zh_code) addTarget(t.zh_code, t.zh_name);
  }

  // 5. Query visit_execution_logs to evaluate
  let logSql = `
    SELECT 
      id,
      visit_date,
      customer_code,
      customer_name,
      customer_type,
      route,
      branch,
      employee_code,
      employee_name,
      check_in_time,
      check_out_time,
      duration,
      visit_status,
      purpose_of_visit,
      remarks,
      batch_code
    FROM visit_execution_logs
    WHERE 1=1
  `;
  const logParams = [];
  if (batchCode) {
    logSql += ' AND batch_code = ?';
    logParams.push(batchCode);
  } else {
    if (startDate) {
      logSql += ' AND visit_date >= ?';
      logParams.push(startDate);
    }
    if (endDate) {
      logSql += ' AND visit_date <= ?';
      logParams.push(endDate);
    }
  }
  logSql += ' ORDER BY visit_date DESC, id DESC';

  const logs = await dbAll(logSql, logParams).catch(() => []);

  const unplannedVisits = [];
  const plannedVisits = [];
  const unplannedIds = [];
  const plannedIds = [];

  for (const l of logs) {
    const empC = key(l.employee_code);
    const empN = key(l.employee_name);
    const custC = key(l.customer_code);
    const vDate = String(l.visit_date || '').slice(0, 10);

    const dealer = dealerIndex.get(custC);
    const canonical = dealer ? key(dealer.canonical) : custC;
    const sapCode = dealer ? key(dealer.sap_code) : custC;
    const sfaCode = dealer ? key(dealer.sfa_code) : custC;

    const dealerCodes = [custC, canonical, sapCode, sfaCode].filter(Boolean);

    // Check if dealer was planned for this officer
    let dealerPlanned = false;
    let dateScheduled = false;

    for (const dCode of dealerCodes) {
      if (plannedOfficerDealers.has(`${empC}|${dCode}`) || plannedOfficerDealers.has(`${empN}|${dCode}`)) {
        dealerPlanned = true;
      }
      if (plannedOfficerSchedule.has(`${empC}|${dCode}|${vDate}`) || plannedOfficerSchedule.has(`${empN}|${dCode}|${vDate}`)) {
        dateScheduled = true;
      }
    }

    let isUnplanned = false;
    let reason = 'Planned';
    let unplannedType = 'PLANNED';

    if (!dealerPlanned) {
      isUnplanned = true;
      unplannedType = 'DEALER_NOT_ON_PLAN';
      reason = "Dealer not on officer's plan";
    } else if (plannedOfficerSchedule.size > 0 && !dateScheduled) {
      // Officer had dealer in plan, but visited on an unscheduled date
      isUnplanned = true;
      unplannedType = 'UNSCHEDULED_DATE';
      reason = 'Visit on unscheduled date';
    }

    const item = {
      id: l.id,
      visit_date: vDate,
      customer_code: l.customer_code,
      mapped_sap_code: dealer?.sap_code || l.customer_code,
      customer_name: l.customer_name || dealer?.name || 'Unknown Customer',
      customer_type: l.customer_type || 'DEALER',
      route: l.route || dealer?.area || '-',
      branch: l.branch || dealer?.branch || dealer?.area || '-',
      employee_code: l.employee_code,
      employee_name: l.employee_name || l.employee_code,
      check_in_time: l.check_in_time,
      check_out_time: l.check_out_time,
      duration: l.duration,
      visit_status: l.visit_status || 'Completed',
      purpose_of_visit: l.purpose_of_visit,
      remarks: l.remarks,
      is_unplanned: isUnplanned ? 1 : 0,
      unplanned_type: unplannedType,
      reason
    };

    if (isUnplanned) {
      unplannedVisits.push(item);
      unplannedIds.push(l.id);
    } else {
      plannedVisits.push(item);
      plannedIds.push(l.id);
    }
  }

  // 6. Update is_unplanned flag in database in chunks
  try {
    if (unplannedIds.length > 0) {
      const CHUNK_SIZE = 500;
      for (let i = 0; i < unplannedIds.length; i += CHUNK_SIZE) {
        const slice = unplannedIds.slice(i, i + CHUNK_SIZE);
        const placeholders = slice.map(() => '?').join(',');
        await dbRun(`UPDATE visit_execution_logs SET is_unplanned = 1 WHERE id IN (${placeholders})`, slice);
      }
    }
    if (plannedIds.length > 0) {
      const CHUNK_SIZE = 500;
      for (let i = 0; i < plannedIds.length; i += CHUNK_SIZE) {
        const slice = plannedIds.slice(i, i + CHUNK_SIZE);
        const placeholders = slice.map(() => '?').join(',');
        await dbRun(`UPDATE visit_execution_logs SET is_unplanned = 0 WHERE id IN (${placeholders})`, slice);
      }
    }
  } catch (err) {
    console.warn('[RECONCILE_UNPLANNED] DB update warning:', err.message);
  }

  return {
    totalVisits: logs.length,
    plannedVisitsCount: plannedVisits.length,
    unplannedVisitsCount: unplannedVisits.length,
    unplannedVisits
  };
}

/**
 * Get unplanned visits with optional filtering
 */
export async function getUnplannedVisits(opts = {}) {
  await ensureVisitExecutionLogsSchema();

  const { startDate, endDate, periodMonth, employeeCode, search, limit = 100, offset = 0 } = opts;

  let sql = `
    SELECT 
      v.id,
      v.visit_date,
      v.customer_code,
      d.sap_code AS mapped_sap_code,
      v.customer_name,
      v.customer_type,
      v.route,
      v.branch,
      v.employee_code,
      v.employee_name,
      v.check_in_time,
      v.check_out_time,
      v.duration,
      v.visit_status,
      v.purpose_of_visit,
      v.remarks,
      v.is_unplanned
    FROM visit_execution_logs v
    LEFT JOIN master_dealers d ON d.sfa_code = v.customer_code
    WHERE v.is_unplanned = 1
  `;
  let countSql = `SELECT COUNT(*) as total FROM visit_execution_logs v WHERE v.is_unplanned = 1`;
  const params = [];
  const countParams = [];

  if (startDate) {
    sql += ' AND v.visit_date >= ?';
    countSql += ' AND v.visit_date >= ?';
    params.push(startDate);
    countParams.push(startDate);
  }
  if (endDate) {
    sql += ' AND v.visit_date <= ?';
    countSql += ' AND v.visit_date <= ?';
    params.push(endDate);
    countParams.push(endDate);
  }
  if (periodMonth) {
    sql += ' AND v.visit_date LIKE ?';
    countSql += ' AND v.visit_date LIKE ?';
    const p = `${periodMonth}%`;
    params.push(p);
    countParams.push(p);
  }
  if (employeeCode && employeeCode !== 'ALL') {
    sql += ' AND v.employee_code = ?';
    countSql += ' AND v.employee_code = ?';
    params.push(employeeCode);
    countParams.push(employeeCode);
  }
  if (search) {
    sql += ' AND (v.customer_name LIKE ? OR v.customer_code LIKE ? OR v.employee_name LIKE ? OR v.employee_code LIKE ? OR v.branch LIKE ?)';
    countSql += ' AND (v.customer_name LIKE ? OR v.customer_code LIKE ? OR v.employee_name LIKE ? OR v.employee_code LIKE ? OR v.branch LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
    countParams.push(s, s, s, s, s);
  }

  sql += ' ORDER BY v.visit_date DESC, v.id DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const [rows, countObj] = await Promise.all([
    dbAll(sql, params).catch(() => []),
    dbGet(countSql, countParams).catch(() => ({ total: 0 }))
  ]);

  return {
    total: countObj?.total || 0,
    visits: rows.map(r => ({
      ...r,
      visit_date: String(r.visit_date || '').slice(0, 10),
      reason: "Dealer not on officer's plan"
    }))
  };
}
