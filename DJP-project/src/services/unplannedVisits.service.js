import { dbRun, dbGet, dbAll } from '../config/database.js';
import ExcelJS from 'exceljs';

const norm = v => String(v ?? '').trim();
const key  = v => norm(v).toUpperCase();
const normName = v => key(v).replace(/[^A-Z0-9]/g, '');

/**
 * Extract parenthesized code (e.g. RSSB758, RSSD102, SDNE123) from customer name
 */
export function extractCodeFromName(name) {
  if (!name) return null;
  const match = String(name).match(/\((RSS[BD]?\w+|SDNE\w+|\d{6,}|[A-Z0-9_-]{4,})\)/i);
  return match ? match[1].trim() : null;
}

/**
 * Ensure is_unplanned and is_unmapped columns exist on visit_execution_logs
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

  try {
    const cols = await dbAll(`SHOW COLUMNS FROM visit_execution_logs LIKE 'is_unmapped'`);
    if (!cols || cols.length === 0) {
      await dbRun(`ALTER TABLE visit_execution_logs ADD COLUMN is_unmapped TINYINT(1) DEFAULT 0 COMMENT '0=Mapped, 1=Unmapped customer'`);
    }
  } catch (e) {
    try {
      await dbRun(`ALTER TABLE visit_execution_logs ADD COLUMN is_unmapped TINYINT(1) DEFAULT 0`);
    } catch (_) {}
  }

  // Create helper indexes if possible
  try {
    await dbRun(`CREATE INDEX idx_vel_unplanned_date ON visit_execution_logs (is_unplanned, visit_date)`);
  } catch (_) {}
  try {
    await dbRun(`CREATE INDEX idx_vel_unmapped_date ON visit_execution_logs (is_unmapped, visit_date)`);
  } catch (_) {}
}

/**
 * Build dealer code index: Customer code (SAP/SFA/RSSD/Name) -> canonical SAP code + info
 */
export async function buildDealerLookupIndex() {
  const index = new Map();
  const nameIndex = new Map();

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
      const codeInName = extractCodeFromName(d.dealer_name);
      if (codeInName && !index.has(key(codeInName))) {
        index.set(key(codeInName), info);
      }
      const nKey = normName(d.dealer_name);
      if (nKey && !nameIndex.has(nKey)) {
        nameIndex.set(nKey, info);
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
        rssd_code: norm(d.rssd_code) || null,
        name: d.dealer_name,
        area: d.area || d.branch || '',
        zone: d.zone || ''
      };
      for (const c of [d.sap_code, d.sfa_code, d.rssd_code]) {
        const k = key(c);
        if (k && !index.has(k)) index.set(k, info);
      }
      const codeInName = extractCodeFromName(d.dealer_name);
      if (codeInName && !index.has(key(codeInName))) {
        index.set(key(codeInName), info);
      }
      const nKey = normName(d.dealer_name);
      if (nKey && !nameIndex.has(nKey)) {
        nameIndex.set(nKey, info);
      }
    }
  } catch (_) {}

  return { index, nameIndex };
}

/**
 * Reconcile SFA visit execution logs against planned visits and master dealers.
 * Marks:
 *  - is_unplanned = 1: dealer is known, but was NOT on the officer's plan for that period
 *  - is_unmapped = 1: customer code matches no dealer in master or target lists
 *  - is_unplanned = 0, is_unmapped = 0: planned visit adhered to
 *
 * @param {Object} opts
 * @param {string} [opts.startDate] 'YYYY-MM-DD'
 * @param {string} [opts.endDate]   'YYYY-MM-DD'
 * @param {string} [opts.periodMonth] 'YYYY-MM'
 * @param {string} [opts.batchCode]
 */
export async function reconcileUnplannedVisits(opts = {}) {
  await ensureVisitExecutionLogsSchema();

  let { startDate, endDate, periodMonth, batchCode } = opts;

  // Derive periodMonth from dates or batchCode if not explicitly supplied
  if (!periodMonth) {
    if (startDate) {
      periodMonth = startDate.slice(0, 7);
    } else if (batchCode) {
      const sample = await dbGet(`SELECT SUBSTRING(visit_date, 1, 7) as pm FROM visit_execution_logs WHERE batch_code = ? AND visit_date IS NOT NULL LIMIT 1`, [batchCode]).catch(() => null);
      if (sample?.pm) periodMonth = sample.pm;
    }
  }

  // 1. Build dealer code index
  const { index: dealerIndex, nameIndex } = await buildDealerLookupIndex();

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
    if (periodMonth) {
      logSql += ' AND visit_date LIKE ?';
      logParams.push(`${periodMonth}%`);
    }
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
  const unmappedVisits = [];
  const plannedVisits = [];
  const unplannedIds = [];
  const unmappedIds = [];
  const plannedIds = [];

  for (const l of logs) {
    const empC = key(l.employee_code);
    const empN = key(l.employee_name);
    const custC = key(l.customer_code);
    const vDate = String(l.visit_date || '').slice(0, 10);

    // Resolve dealer identity via code, paren code in name, or clean name
    let dealer = dealerIndex.get(custC);
    if (!dealer && l.customer_name) {
      const codeFromName = extractCodeFromName(l.customer_name);
      if (codeFromName) {
        dealer = dealerIndex.get(key(codeFromName));
      }
    }
    if (!dealer && l.customer_name) {
      dealer = nameIndex.get(normName(l.customer_name));
    }

    if (!dealer) {
      // Unmapped visit: customer is not known to master dealers or targets
      const item = {
        id: l.id,
        visit_date: vDate,
        customer_code: l.customer_code,
        mapped_sap_code: null,
        customer_name: l.customer_name || 'Unknown Customer',
        customer_type: l.customer_type || 'PROSPECT',
        route: l.route || '-',
        branch: l.branch || '-',
        employee_code: l.employee_code,
        employee_name: l.employee_name || l.employee_code,
        check_in_time: l.check_in_time,
        check_out_time: l.check_out_time,
        duration: l.duration,
        visit_status: l.visit_status || 'Completed',
        purpose_of_visit: l.purpose_of_visit,
        remarks: l.remarks,
        is_unmapped: 1,
        is_unplanned: 0,
        reason: 'Customer code not found in any dealer master'
      };
      unmappedVisits.push(item);
      unmappedIds.push(l.id);
      continue;
    }

    // Dealer IS mapped. Now check if officer was scheduled / planned for this dealer.
    const canonical = key(dealer.canonical);
    const sapCode = key(dealer.sap_code);
    const sfaCode = key(dealer.sfa_code);
    const rssdCode = key(dealer.rssd_code);

    const dealerCodes = [custC, canonical, sapCode, sfaCode, rssdCode].filter(Boolean);

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
      is_unmapped: 0,
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

  // 6. Update flags in database in chunks
  try {
    const CHUNK_SIZE = 500;
    if (unplannedIds.length > 0) {
      for (let i = 0; i < unplannedIds.length; i += CHUNK_SIZE) {
        const slice = unplannedIds.slice(i, i + CHUNK_SIZE);
        const placeholders = slice.map(() => '?').join(',');
        await dbRun(`UPDATE visit_execution_logs SET is_unplanned = 1, is_unmapped = 0 WHERE id IN (${placeholders})`, slice);
      }
    }
    if (unmappedIds.length > 0) {
      for (let i = 0; i < unmappedIds.length; i += CHUNK_SIZE) {
        const slice = unmappedIds.slice(i, i + CHUNK_SIZE);
        const placeholders = slice.map(() => '?').join(',');
        await dbRun(`UPDATE visit_execution_logs SET is_unplanned = 0, is_unmapped = 1 WHERE id IN (${placeholders})`, slice);
      }
    }
    if (plannedIds.length > 0) {
      for (let i = 0; i < plannedIds.length; i += CHUNK_SIZE) {
        const slice = plannedIds.slice(i, i + CHUNK_SIZE);
        const placeholders = slice.map(() => '?').join(',');
        await dbRun(`UPDATE visit_execution_logs SET is_unplanned = 0, is_unmapped = 0 WHERE id IN (${placeholders})`, slice);
      }
    }
  } catch (err) {
    console.warn('[RECONCILE_UNPLANNED] DB update warning:', err.message);
  }

  return {
    totalVisits: logs.length,
    plannedVisitsCount: plannedVisits.length,
    unplannedVisitsCount: unplannedVisits.length,
    unmappedVisitsCount: unmappedVisits.length,
    unplannedVisits,
    unmappedVisits
  };
}

/**
 * Get unplanned visits with optional filtering & pagination
 */
export async function getUnplannedVisits(opts = {}) {
  await ensureVisitExecutionLogsSchema();

  const { startDate, endDate, periodMonth, employeeCode, search, limit = 100, offset = 0 } = opts;

  // Auto-reconcile once if current month has never been reconciled
  if (periodMonth) {
    try {
      const check = await dbGet(
        `SELECT COUNT(*) as cnt FROM visit_execution_logs WHERE (is_unplanned = 1 OR is_unmapped = 1) AND visit_date LIKE ?`,
        [`${periodMonth}%`]
      );
      if (!check || check.cnt === 0) {
        const totalInMonth = await dbGet(
          `SELECT COUNT(*) as cnt FROM visit_execution_logs WHERE visit_date LIKE ?`,
          [`${periodMonth}%`]
        );
        if (totalInMonth?.cnt > 0) {
          await reconcileUnplannedVisits({ periodMonth });
        }
      }
    } catch (_) {}
  }

  let sql = `
    SELECT 
      v.id,
      v.visit_date,
      v.customer_code,
      COALESCE(d.sap_code, d_rssd.sap_code, v.customer_code) AS mapped_sap_code,
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
    LEFT JOIN master_dealers d ON d.sfa_code = v.customer_code OR d.sap_code = v.customer_code
    LEFT JOIN master_dealers d_rssd ON d_rssd.rssd_code = v.customer_code
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
    sql += ' AND (v.employee_code = ? OR v.employee_name = ?)';
    countSql += ' AND (v.employee_code = ? OR v.employee_name = ?)';
    params.push(employeeCode, employeeCode);
    countParams.push(employeeCode, employeeCode);
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

/**
 * Get unmapped visits — SFA visits whose customer_code matches no dealer in master_dealers
 * or dealer_visit_targets. These visits cannot be credited to anyone and represent unmapped counters/dealers.
 */
export async function getUnmappedVisits(opts = {}) {
  await ensureVisitExecutionLogsSchema();

  const { startDate, endDate, periodMonth, employeeCode, search, limit = 100, offset = 0 } = opts;

  // Auto-reconcile once if current month has never been reconciled
  if (periodMonth) {
    try {
      const check = await dbGet(
        `SELECT COUNT(*) as cnt FROM visit_execution_logs WHERE (is_unplanned = 1 OR is_unmapped = 1) AND visit_date LIKE ?`,
        [`${periodMonth}%`]
      );
      if (!check || check.cnt === 0) {
        const totalInMonth = await dbGet(
          `SELECT COUNT(*) as cnt FROM visit_execution_logs WHERE visit_date LIKE ?`,
          [`${periodMonth}%`]
        );
        if (totalInMonth?.cnt > 0) {
          await reconcileUnplannedVisits({ periodMonth });
        }
      }
    } catch (_) {}
  }

  let sql = `
    SELECT 
      v.id,
      v.visit_date,
      v.customer_code,
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
      v.remarks
    FROM visit_execution_logs v
    WHERE v.is_unmapped = 1
  `;
  let countSql = `SELECT COUNT(*) as total FROM visit_execution_logs v WHERE v.is_unmapped = 1`;
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
    sql += ' AND (v.employee_code = ? OR v.employee_name = ?)';
    countSql += ' AND (v.employee_code = ? OR v.employee_name = ?)';
    params.push(employeeCode, employeeCode);
    countParams.push(employeeCode, employeeCode);
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
      reason: 'Customer code not in dealer master or targets'
    }))
  };
}

/**
 * Export all matching unplanned visits to an ExcelJS Workbook
 */
export async function exportUnplannedVisitsToWorkbook(opts = {}) {
  await ensureVisitExecutionLogsSchema();
  const { startDate, endDate, periodMonth, employeeCode, search } = opts;

  let sql = `
    SELECT 
      v.id,
      v.visit_date,
      v.customer_code,
      COALESCE(d.sap_code, d_rssd.sap_code, v.customer_code) AS mapped_sap_code,
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
    LEFT JOIN master_dealers d ON d.sfa_code = v.customer_code OR d.sap_code = v.customer_code
    LEFT JOIN master_dealers d_rssd ON d_rssd.rssd_code = v.customer_code
    WHERE v.is_unplanned = 1
  `;
  const params = [];

  if (startDate) {
    sql += ' AND v.visit_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sql += ' AND v.visit_date <= ?';
    params.push(endDate);
  }
  if (periodMonth) {
    sql += ' AND v.visit_date LIKE ?';
    params.push(`${periodMonth}%`);
  }
  if (employeeCode && employeeCode !== 'ALL') {
    sql += ' AND (v.employee_code = ? OR v.employee_name = ?)';
    params.push(employeeCode, employeeCode);
  }
  if (search) {
    sql += ' AND (v.customer_name LIKE ? OR v.customer_code LIKE ? OR v.employee_name LIKE ? OR v.employee_code LIKE ? OR v.branch LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  sql += ' ORDER BY v.visit_date DESC, v.id DESC';
  const rows = await dbAll(sql, params);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Star Cement PJP/DJP';
  wb.created = new Date();

  const ws = wb.addWorksheet('Unplanned Visits', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  const columns = [
    { header: 'Visit Date', key: 'visit_date', width: 14 },
    { header: 'Employee Code', key: 'employee_code', width: 16 },
    { header: 'Employee Name', key: 'employee_name', width: 26 },
    { header: 'Customer Code', key: 'customer_code', width: 16 },
    { header: 'Mapped SAP Code', key: 'mapped_sap_code', width: 16 },
    { header: 'Customer Name', key: 'customer_name', width: 32 },
    { header: 'Customer Type', key: 'customer_type', width: 16 },
    { header: 'Area / Branch', key: 'branch', width: 20 },
    { header: 'Route', key: 'route', width: 24 },
    { header: 'Check In', key: 'check_in_time', width: 12 },
    { header: 'Check Out', key: 'check_out_time', width: 12 },
    { header: 'Duration', key: 'duration', width: 12 },
    { header: 'Visit Status', key: 'visit_status', width: 14 },
    { header: 'Plan Classification', key: 'plan_classification', width: 18 },
    { header: 'Reason', key: 'reason', width: 30 },
    { header: 'Remarks', key: 'remarks', width: 36 }
  ];

  ws.columns = columns;

  const headerRow = ws.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF991B1B' }
    };
    cell.font = {
      name: 'Calibri',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF7F1D1D' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  });

  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
  };

  rows.forEach((r, idx) => {
    const isEven = idx % 2 === 0;
    const row = ws.addRow({
      visit_date: String(r.visit_date || '').slice(0, 10),
      employee_code: r.employee_code || '',
      employee_name: r.employee_name || '',
      customer_code: r.customer_code || '',
      mapped_sap_code: r.mapped_sap_code || '',
      customer_name: r.customer_name || '',
      customer_type: r.customer_type || '',
      branch: r.branch || '',
      route: r.route || '',
      check_in_time: r.check_in_time || '',
      check_out_time: r.check_out_time || '',
      duration: r.duration || '',
      visit_status: r.visit_status || '',
      plan_classification: 'Unplanned',
      reason: "Dealer not on officer's plan",
      remarks: r.remarks || ''
    });

    row.height = 20;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 9.5 };
      cell.border = thinBorder;
      if (isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }
        };
      }
      if ([1, 2, 4, 5, 10, 11, 12, 13, 14].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    });
  });

  return wb;
}

/**
 * Export all matching unmapped visits to an ExcelJS Workbook
 */
export async function exportUnmappedVisitsToWorkbook(opts = {}) {
  await ensureVisitExecutionLogsSchema();
  const { startDate, endDate, periodMonth, employeeCode, search } = opts;

  let sql = `
    SELECT 
      v.id,
      v.visit_date,
      v.customer_code,
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
      v.remarks
    FROM visit_execution_logs v
    WHERE v.is_unmapped = 1
  `;
  const params = [];

  if (startDate) {
    sql += ' AND v.visit_date >= ?';
    params.push(startDate);
  }
  if (endDate) {
    sql += ' AND v.visit_date <= ?';
    params.push(endDate);
  }
  if (periodMonth) {
    sql += ' AND v.visit_date LIKE ?';
    params.push(`${periodMonth}%`);
  }
  if (employeeCode && employeeCode !== 'ALL') {
    sql += ' AND (v.employee_code = ? OR v.employee_name = ?)';
    params.push(employeeCode, employeeCode);
  }
  if (search) {
    sql += ' AND (v.customer_name LIKE ? OR v.customer_code LIKE ? OR v.employee_name LIKE ? OR v.employee_code LIKE ? OR v.branch LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }

  sql += ' ORDER BY v.visit_date DESC, v.id DESC';
  const rows = await dbAll(sql, params);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Star Cement PJP/DJP';
  wb.created = new Date();

  const ws = wb.addWorksheet('Unmapped Visits', {
    views: [{ state: 'frozen', ySplit: 1 }]
  });

  const columns = [
    { header: 'Visit Date', key: 'visit_date', width: 14 },
    { header: 'Employee Code', key: 'employee_code', width: 16 },
    { header: 'Employee Name', key: 'employee_name', width: 26 },
    { header: 'Customer Code', key: 'customer_code', width: 16 },
    { header: 'Customer Name', key: 'customer_name', width: 32 },
    { header: 'Customer Type', key: 'customer_type', width: 16 },
    { header: 'Area / Branch', key: 'branch', width: 20 },
    { header: 'Route', key: 'route', width: 24 },
    { header: 'Check In', key: 'check_in_time', width: 12 },
    { header: 'Check Out', key: 'check_out_time', width: 12 },
    { header: 'Duration', key: 'duration', width: 12 },
    { header: 'Visit Status', key: 'visit_status', width: 14 },
    { header: 'Classification', key: 'classification', width: 18 },
    { header: 'Reason', key: 'reason', width: 35 },
    { header: 'Remarks', key: 'remarks', width: 36 }
  ];

  ws.columns = columns;

  const headerRow = ws.getRow(1);
  headerRow.height = 26;
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF991B1B' }
    };
    cell.font = {
      name: 'Calibri',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true
    };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF7F1D1D' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
    };
  });

  const thinBorder = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
  };

  rows.forEach((r, idx) => {
    const isEven = idx % 2 === 0;
    const row = ws.addRow({
      visit_date: String(r.visit_date || '').slice(0, 10),
      employee_code: r.employee_code || '',
      employee_name: r.employee_name || '',
      customer_code: r.customer_code || '',
      customer_name: r.customer_name || '',
      customer_type: r.customer_type || '',
      branch: r.branch || '',
      route: r.route || '',
      check_in_time: r.check_in_time || '',
      check_out_time: r.check_out_time || '',
      duration: r.duration || '',
      visit_status: r.visit_status || '',
      classification: 'Unmapped',
      reason: 'Customer code not in dealer master or targets',
      remarks: r.remarks || ''
    });

    row.height = 20;
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      cell.font = { name: 'Calibri', size: 9.5 };
      cell.border = thinBorder;
      if (isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }
        };
      }
      if ([1, 2, 4, 9, 10, 11, 12, 13].includes(colNumber)) {
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      }
    });
  });

  return wb;
}
