import { dbRun, dbAll, dbGet } from '../config/database.js';

const SFA_EMPLOYEE_MASTER_URL = process.env.SFA_EMPLOYEE_MASTER_URL || 'http://52.66.31.108/star-one-sfa/misreport/api_employee_master.php';

let syncInProgress = false;

/**
 * Fetch employee master raw data from SFA API endpoint.
 *
 * @param {Object} [params] - Optional query parameters (e.g. { emp_code: 'E1194' })
 * @returns {Promise<Array<Object>>}
 */
export async function fetchEmployeeMasterFromApi(params = {}) {
  const url = new URL(SFA_EMPLOYEE_MASTER_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  console.log(`[EmployeeMaster] Fetching from SFA API: ${url.toString()}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'StarCement-PJP-DJP/1.0'
      },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`SFA API responded with HTTP ${response.status} ${response.statusText}`);
    }

    const payload = await response.json();
    clearTimeout(timeoutId);

    if (payload.status !== 'success' && payload.process_status !== 'YES') {
      throw new Error(`SFA API returned non-success response: ${payload.process_message || payload.status}`);
    }

    const records = Array.isArray(payload.data) ? payload.data : (payload.employee ? [payload.employee] : []);
    console.log(`[EmployeeMaster] Successfully fetched ${records.length} employee records from SFA API.`);
    return records;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error('[EmployeeMaster] Error fetching from SFA API:', err.message);
    throw err;
  }
}

/**
 * Sync all employee master records from SFA API into the employee_master database table.
 * Also mirrors relevant active employees into master_employees.
 *
 * @param {Object} [options]
 * @param {boolean} [options.force=false]
 * @returns {Promise<Object>}
 */
export async function syncEmployeeMasterFromApi(options = {}) {
  if (syncInProgress) {
    return {
      success: false,
      message: 'Employee master synchronization is already in progress.'
    };
  }

  syncInProgress = true;
  const startTime = Date.now();

  try {
    const records = await fetchEmployeeMasterFromApi();
    if (!records || records.length === 0) {
      return {
        success: true,
        totalFetched: 0,
        upsertedCount: 0,
        message: 'No employee records returned from SFA API.'
      };
    }

    let upsertedCount = 0;
    const CHUNK_SIZE = 200;

    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const placeholders = [];
      const values = [];

      for (const item of chunk) {
        if (!item.emp_code || String(item.emp_code).trim() === '') continue;

        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())');
        values.push(
          String(item.emp_code).trim(),
          item.dns_emp_code ? String(item.dns_emp_code).trim() : null,
          item.emp_name ? String(item.emp_name).trim() : null,
          item.dob ? String(item.dob).trim() : null,
          item.acedns ? String(item.acedns).trim() : null,
          item.branch_code ? String(item.branch_code).trim() : null,
          item.DOJ ? String(item.DOJ).trim() : null,
          item.lower_leaves ? String(item.lower_leaves).trim() : null,
          item.reporting_to ? String(item.reporting_to).trim() : null,
          item.vertical_value ? String(item.vertical_value).trim() : null,
          item.email ? String(item.email).trim() : null,
          item.phone_no ? String(item.phone_no).trim() : null,
          item.HQ ? String(item.HQ).trim() : null,
          item.sale_access ? String(item.sale_access).trim() : null,
          item.designation ? String(item.designation).trim() : null,
          item.District ? String(item.District).trim() : null,
          item.state ? String(item.state).trim() : null,
          item.zone ? String(item.zone).trim() : null,
          item.region ? String(item.region).trim() : null,
          item.app_access ? String(item.app_access).trim() : null,
          item.functionality ? String(item.functionality).trim() : null,
          item.functionality_rel_val ? String(item.functionality_rel_val).trim() : null,
          item.level ? String(item.level).trim() : null,
          item.acedns_changed_date ? String(item.acedns_changed_date).trim() : null,
          item.download_time ? String(item.download_time).trim() : null
        );
      }

      if (placeholders.length > 0) {
        const sql = `
          INSERT INTO employee_master (
            emp_code, dns_emp_code, emp_name, dob, acedns,
            branch_code, doj, lower_leaves, reporting_to, vertical_value,
            email, phone_no, hq, sale_access, designation,
            district, state, zone, region, app_access,
            functionality, functionality_rel_val, level, acedns_changed_date, download_time,
            updated_at
          ) VALUES ${placeholders.join(', ')}
          ON DUPLICATE KEY UPDATE
            dns_emp_code = VALUES(dns_emp_code),
            emp_name = VALUES(emp_name),
            dob = VALUES(dob),
            acedns = VALUES(acedns),
            branch_code = VALUES(branch_code),
            doj = VALUES(doj),
            lower_leaves = VALUES(lower_leaves),
            reporting_to = VALUES(reporting_to),
            vertical_value = VALUES(vertical_value),
            email = VALUES(email),
            phone_no = VALUES(phone_no),
            hq = VALUES(hq),
            sale_access = VALUES(sale_access),
            designation = VALUES(designation),
            district = VALUES(district),
            state = VALUES(state),
            zone = VALUES(zone),
            region = VALUES(region),
            app_access = VALUES(app_access),
            functionality = VALUES(functionality),
            functionality_rel_val = VALUES(functionality_rel_val),
            level = VALUES(level),
            acedns_changed_date = VALUES(acedns_changed_date),
            download_time = VALUES(download_time),
            updated_at = NOW()
        `;
        await dbRun(sql, values);
        upsertedCount += placeholders.length;
      }
    }

    console.log(`[EmployeeMaster] Upserted ${upsertedCount} records to employee_master.`);

    // Reconcile and enrich master_employees from employee_master
    const enrichedRes = await syncMasterEmployeesFromEmployeeMaster();

    const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(1);

    return {
      success: true,
      totalFetched: records.length,
      upsertedCount,
      masterEmployeesEnriched: enrichedRes.affectedRows,
      durationSeconds: parseFloat(durationSeconds),
      message: `Successfully synchronized ${upsertedCount} employee master records in ${durationSeconds}s.`
    };
  } catch (err) {
    console.error('[EmployeeMaster] Error syncing employee master:', err);
    throw err;
  } finally {
    syncInProgress = false;
  }
}

/**
 * Propagate / enrich master_employees with active employee records from employee_master.
 */
export async function syncMasterEmployeesFromEmployeeMaster() {
  try {
    // 1. Update existing master_employees where dns_emp_code matches or emp_code matches
    const res1 = await dbRun(`
      UPDATE master_employees me
      JOIN employee_master em 
        ON (me.emp_code IS NOT NULL AND me.emp_code != '' AND (me.emp_code = em.dns_emp_code OR me.emp_code = em.emp_code))
      SET
        me.emp_name = COALESCE(NULLIF(em.emp_name, ''), me.emp_name),
        me.designation = COALESCE(NULLIF(em.designation, ''), me.designation),
        me.zone = COALESCE(NULLIF(em.zone, ''), me.zone),
        me.region = COALESCE(NULLIF(em.region, ''), me.region)
    `);

    // 2. Insert active sales & field employees from employee_master into master_employees if not already present
    const res2 = await dbRun(`
      INSERT INTO master_employees (emp_code, emp_name, designation, zone, region, role, created_at)
      SELECT 
        COALESCE(NULLIF(em.dns_emp_code, ''), em.emp_code) as emp_code,
        em.emp_name,
        em.designation,
        em.zone,
        em.region,
        CASE
          WHEN UPPER(em.designation) LIKE '%RSM%' OR UPPER(em.designation) LIKE '%REGIONAL%' THEN 'RSM'
          WHEN UPPER(em.designation) LIKE '%ASM%' OR UPPER(em.designation) LIKE '%AREA%' THEN 'ASM'
          WHEN UPPER(em.designation) LIKE '%SO%' OR UPPER(em.designation) LIKE '%OFFICER%' OR UPPER(em.designation) LIKE '%ENGINEER%' THEN 'SO'
          WHEN UPPER(em.designation) LIKE '%ZH%' OR UPPER(em.designation) LIKE '%ZONAL%' OR UPPER(em.designation) LIKE '%GM%' THEN 'ZH'
          ELSE 'SO'
        END as role,
        NOW() as created_at
      FROM employee_master em
      LEFT JOIN master_employees me 
        ON (COALESCE(NULLIF(em.dns_emp_code, ''), em.emp_code) = me.emp_code)
      WHERE me.id IS NULL
        AND em.emp_name IS NOT NULL AND em.emp_name != ''
        AND (em.acedns = 'Y' OR em.acedns IS NULL OR em.app_access = 'Y')
    `);

    const affected = (res1.affectedRows || res1.changes || 0) + (res2.affectedRows || res2.changes || 0);
    console.log(`[EmployeeMaster] Synced ${affected} records into master_employees.`);
    return { affectedRows: affected };
  } catch (err) {
    console.warn('[EmployeeMaster] Warning during master_employees sync:', err.message);
    return { affectedRows: 0 };
  }
}

/**
 * Get status and statistics of employee_master table.
 */
export async function getEmployeeMasterStatus() {
  const totalRow = await dbGet('SELECT COUNT(*) as cnt FROM employee_master');
  const activeRow = await dbGet("SELECT COUNT(*) as cnt FROM employee_master WHERE acedns = 'Y'");
  const appAccessRow = await dbGet("SELECT COUNT(*) as cnt FROM employee_master WHERE app_access = 'Y'");
  const desigRow = await dbGet('SELECT COUNT(DISTINCT designation) as cnt FROM employee_master WHERE designation IS NOT NULL AND designation != ""');
  const zonesRow = await dbGet('SELECT COUNT(DISTINCT zone) as cnt FROM employee_master WHERE zone IS NOT NULL AND zone != ""');
  const lastSyncRow = await dbGet('SELECT MAX(updated_at) as last_updated FROM employee_master');

  const meCountRow = await dbGet('SELECT COUNT(*) as cnt FROM master_employees');

  return {
    totalEmployeesInMaster: totalRow?.cnt || 0,
    activeInAcedns: activeRow?.cnt || 0,
    activeAppAccess: appAccessRow?.cnt || 0,
    distinctDesignations: desigRow?.cnt || 0,
    distinctZones: zonesRow?.cnt || 0,
    masterEmployeesEnrichedCount: meCountRow?.cnt || 0,
    lastUpdated: lastSyncRow?.last_updated || null,
    syncInProgress
  };
}

/**
 * Search and list employees from employee_master with pagination.
 */
export async function searchEmployeesFromMaster(filters = {}) {
  const {
    search = '',
    empCode = '',
    dnsEmpCode = '',
    designation = '',
    zone = '',
    state = '',
    acedns = '',
    reportingTo = '',
    limit = 50,
    offset = 0
  } = filters;

  const conditions = [];
  const params = [];

  if (search && search.trim() !== '') {
    const s = `%${search.trim()}%`;
    conditions.push('(emp_name LIKE ? OR emp_code LIKE ? OR dns_emp_code LIKE ? OR email LIKE ? OR phone_no LIKE ?)');
    params.push(s, s, s, s, s);
  }

  if (empCode && empCode.trim() !== '') {
    conditions.push('emp_code = ?');
    params.push(empCode.trim());
  }

  if (dnsEmpCode && dnsEmpCode.trim() !== '') {
    conditions.push('dns_emp_code = ?');
    params.push(dnsEmpCode.trim());
  }

  if (designation && designation.trim() !== '') {
    conditions.push('designation LIKE ?');
    params.push(`%${designation.trim()}%`);
  }

  if (zone && zone.trim() !== '') {
    conditions.push('zone = ?');
    params.push(zone.trim());
  }

  if (state && state.trim() !== '') {
    conditions.push('state = ?');
    params.push(state.trim());
  }

  if (acedns && acedns.trim() !== '') {
    conditions.push('acedns = ?');
    params.push(acedns.trim().toUpperCase());
  }

  if (reportingTo && reportingTo.trim() !== '') {
    conditions.push('reporting_to LIKE ?');
    params.push(`%${reportingTo.trim()}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRow = await dbGet(`SELECT COUNT(*) as total FROM employee_master ${whereClause}`, params);
  const total = countRow?.total || 0;

  const parsedLimit = Math.max(1, Math.min(parseInt(limit, 10) || 50, 1000));
  const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

  const rows = await dbAll(
    `SELECT 
       id, emp_code, dns_emp_code, emp_name, dob, acedns,
       branch_code, doj, lower_leaves, reporting_to, vertical_value,
       email, phone_no, hq, sale_access, designation,
       district, state, zone, region, app_access,
       functionality, functionality_rel_val, level,
       acedns_changed_date, download_time, updated_at
     FROM employee_master
     ${whereClause}
     ORDER BY emp_name ASC, emp_code ASC
     LIMIT ? OFFSET ?`,
    [...params, parsedLimit, parsedOffset]
  );

  return {
    total,
    limit: parsedLimit,
    offset: parsedOffset,
    count: rows.length,
    employees: rows
  };
}

/**
 * Get single employee by code (checks both emp_code and dns_emp_code).
 */
export async function getEmployeeByCode(code) {
  if (!code) return null;
  const cleanCode = String(code).trim();
  const row = await dbGet(
    `SELECT * FROM employee_master 
     WHERE emp_code = ? OR dns_emp_code = ? 
     LIMIT 1`,
    [cleanCode, cleanCode]
  );
  return row || null;
}

