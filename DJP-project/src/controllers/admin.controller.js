import { dbAll, dbGet, dbRun } from '../config/database.js';

/**
 * Get aggregate counters for admin dashboard header stats
 */
export async function getDashboardStats(req, res) {
  try {
    const totalDealersObj = await dbGet('SELECT COUNT(*) as count FROM master_dealers WHERE status = "ACTIVE" OR status IS NULL');
    const totalAreasObj = await dbGet('SELECT COUNT(DISTINCT area) as count FROM master_dealer_so_mapping WHERE area IS NOT NULL AND area != ""');

    const visitsObj = await dbGet(`
      SELECT 
        SUM(so_visits) as total_so,
        SUM(asm_visits) as total_asm,
        SUM(rsm_visits) as total_rsm,
        SUM(zh_visits) as total_zh,
        COUNT(DISTINCT dealer_name) as target_dealers
      FROM dealer_visit_targets
    `);

    const latestPeriodObj = await dbGet('SELECT period_month FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1');
    const latestPeriod = latestPeriodObj ? latestPeriodObj.period_month : new Date().toISOString().slice(0, 7);

    res.json({
      latestPeriod,
      stats: {
        totalDealers: visitsObj?.target_dealers || totalDealersObj?.count || 0,
        totalAreas: totalAreasObj?.count || 0,
        soVisits: Math.round((visitsObj?.total_so || 0) * 10) / 10,
        asmVisits: Math.round((visitsObj?.total_asm || 0) * 10) / 10,
        rsmVisits: Math.round((visitsObj?.total_rsm || 0) * 10) / 10,
        zhVisits: Math.round((visitsObj?.total_zh || 0) * 10) / 10
      }
    });
  } catch (err) {
    console.error('Error fetching dashboard stats:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get distinct filter dropdown options for Zone, Area, SO, Category
 */
export async function getFilterOptions(req, res) {
  try {
    const zones = await dbAll(`
      SELECT DISTINCT zone FROM (
        SELECT zone FROM dealer_visit_targets WHERE zone IS NOT NULL AND zone != ""
        UNION
        SELECT region as zone FROM master_dealer_so_mapping WHERE region IS NOT NULL AND region != ""
      ) AS zone_subquery ORDER BY zone ASC
    `);

    const areas = await dbAll(`
      SELECT DISTINCT area FROM (
        SELECT area FROM dealer_visit_targets WHERE area IS NOT NULL AND area != ""
        UNION
        SELECT area FROM master_dealer_so_mapping WHERE area IS NOT NULL AND area != ""
      ) AS area_subquery ORDER BY area ASC
    `);

    const sos = await dbAll(`
      SELECT DISTINCT so_name FROM (
        SELECT so_name FROM dealer_visit_targets WHERE so_name IS NOT NULL AND so_name != ""
        UNION
        SELECT so_name FROM master_dealer_so_mapping WHERE so_name IS NOT NULL AND so_name != ""
      ) AS so_subquery ORDER BY so_name ASC
    `);

    const statuses = await dbAll(`
      SELECT DISTINCT dealer_status as name FROM dealer_visit_targets WHERE dealer_status IS NOT NULL ORDER BY dealer_status ASC
    `);

    res.json({
      zones: zones.map(z => z.zone),
      areas: areas.map(a => a.area),
      salesOfficers: sos.map(s => s.so_name),
      dealerStatuses: statuses.map(s => s.name)
    });
  } catch (err) {
    console.error('Error fetching filter options:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Batch update business rules
 */
export async function updateRulesBatch(req, res) {
  try {
    const { rules } = req.body;
    if (!Array.isArray(rules) || rules.length === 0) {
      return res.status(400).json({ error: 'Array of rules is required' });
    }

    for (const rule of rules) {
      const { rule_key, rule_value, rule_name, data_type, description } = rule;
      if (rule_key && rule_value !== undefined) {
        // Check if exists
        const existing = await dbGet('SELECT id FROM business_rules WHERE rule_key = ?', [rule_key]);
        if (existing) {
          await dbRun(
            'UPDATE business_rules SET rule_value = ?, updated_at = CURRENT_TIMESTAMP WHERE rule_key = ?',
            [String(rule_value), rule_key]
          );
        } else {
          await dbRun(
            'INSERT INTO business_rules (rule_key, rule_name, rule_value, data_type, description) VALUES (?, ?, ?, ?, ?)',
            [rule_key, rule_name || rule_key, String(rule_value), data_type || 'STRING', description || '']
          );
        }
      }
    }

    const updatedRules = await dbAll('SELECT * FROM business_rules ORDER BY id ASC');
    res.json({ message: 'Rules batch updated successfully', rules: updatedRules });
  } catch (err) {
    console.error('Error updating rules batch:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get aggregate summary counts for all uploaded master data
 */
export async function getMasterSummary(req, res) {
  try {
    const [dealers, prospects, employees, sales, logs, mappings, targets, batches, perf] = await Promise.all([
      dbGet('SELECT COUNT(*) as cnt FROM master_dealers WHERE dealer_type != "PROSPECTIVE"'),
      dbGet('SELECT COUNT(*) as cnt FROM master_dealers WHERE dealer_type = "PROSPECTIVE" OR counter_strategy = "PROSPECT"'),
      dbGet('SELECT COUNT(*) as cnt FROM master_employees'),
      dbGet('SELECT COUNT(*) as cnt FROM sales_history'),
      dbGet('SELECT COUNT(*) as cnt FROM visit_execution_logs'),
      dbGet('SELECT COUNT(*) as cnt FROM master_dealer_so_mapping'),
      dbGet('SELECT COUNT(*) as cnt FROM dealer_visit_targets'),
      dbGet('SELECT COUNT(*) as cnt FROM upload_batches'),
      dbGet('SELECT COUNT(*) as cnt FROM dealer_performance_history')
    ]);

    res.json({
      summary: {
        totalDealers: dealers?.cnt || 0,
        totalProspects: prospects?.cnt || 0,
        totalEmployees: employees?.cnt || 0,
        totalSalesRecords: sales?.cnt || 0,
        totalVisitLogs: logs?.cnt || 0,
        totalMappings: mappings?.cnt || 0,
        totalTargets: targets?.cnt || 0,
        totalBatches: batches?.cnt || 0,
        totalDealerPerformance: perf?.cnt || 0
      }
    });
  } catch (err) {
    console.error('Error fetching master summary:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get distinct filter options across all master tables
 */
export async function getMasterFilterOptions(req, res) {
  try {
    const [
      dealerZones,
      dealerRegions,
      dealerAreas,
      dealerTypes,
      dealerStatuses,
      salesPeriods,
      salesZones,
      logBranches,
      logRoutes,
      logEmployees,
      logStatuses,
      logVisitDates,
      logCustomerTypes,
      mappingAreas,
      mappingRegions,
      mappingSos,
      pjpZones,
      pjpAreas,
      pjpSos,
      pjpCategories,
      pjpStatuses,
      dpPeriods
    ] = await Promise.all([
      dbAll('SELECT DISTINCT zone FROM master_dealers WHERE zone IS NOT NULL AND zone != "" ORDER BY zone ASC'),
      dbAll('SELECT DISTINCT region FROM master_dealers WHERE region IS NOT NULL AND region != "" ORDER BY region ASC'),
      dbAll('SELECT DISTINCT area FROM master_dealers WHERE area IS NOT NULL AND area != "" ORDER BY area ASC'),
      dbAll('SELECT DISTINCT dealer_type FROM master_dealers WHERE dealer_type IS NOT NULL AND dealer_type != "" ORDER BY dealer_type ASC'),
      dbAll('SELECT DISTINCT status FROM master_dealers WHERE status IS NOT NULL AND status != "" ORDER BY status ASC'),
      dbAll('SELECT DISTINCT period_year_month FROM sales_history WHERE period_year_month IS NOT NULL ORDER BY period_year_month DESC'),
      dbAll('SELECT DISTINCT zone FROM sales_history WHERE zone IS NOT NULL AND zone != "" ORDER BY zone ASC'),
      dbAll('SELECT DISTINCT branch FROM visit_execution_logs WHERE branch IS NOT NULL AND branch != "" ORDER BY branch ASC'),
      dbAll('SELECT DISTINCT route FROM visit_execution_logs WHERE route IS NOT NULL AND route != "" ORDER BY route ASC'),
      dbAll('SELECT DISTINCT employee_name FROM visit_execution_logs WHERE employee_name IS NOT NULL AND employee_name != "" ORDER BY employee_name ASC'),
      dbAll('SELECT DISTINCT visit_status FROM visit_execution_logs WHERE visit_status IS NOT NULL AND visit_status != "" ORDER BY visit_status ASC'),
      dbAll('SELECT DISTINCT visit_date FROM visit_execution_logs WHERE visit_date IS NOT NULL AND visit_date != "0000-00-00" ORDER BY visit_date DESC'),
      dbAll('SELECT DISTINCT customer_type FROM visit_execution_logs WHERE customer_type IS NOT NULL AND customer_type != "" ORDER BY customer_type ASC'),
      dbAll('SELECT DISTINCT area FROM master_dealer_so_mapping WHERE area IS NOT NULL AND area != "" ORDER BY area ASC'),
      dbAll('SELECT DISTINCT region FROM master_dealer_so_mapping WHERE region IS NOT NULL AND region != "" ORDER BY region ASC'),
      dbAll('SELECT DISTINCT so_name FROM master_dealer_so_mapping WHERE so_name IS NOT NULL AND so_name != "" ORDER BY so_name ASC'),
      dbAll('SELECT DISTINCT zone FROM dealer_visit_targets WHERE zone IS NOT NULL AND zone != "" ORDER BY zone ASC'),
      dbAll('SELECT DISTINCT area FROM dealer_visit_targets WHERE area IS NOT NULL AND area != "" ORDER BY area ASC'),
      dbAll('SELECT DISTINCT so_name FROM dealer_visit_targets WHERE so_name IS NOT NULL AND so_name != "" ORDER BY so_name ASC'),
      dbAll('SELECT DISTINCT category FROM dealer_visit_targets WHERE category IS NOT NULL AND category != "" ORDER BY category ASC'),
      dbAll('SELECT DISTINCT dealer_status FROM dealer_visit_targets WHERE dealer_status IS NOT NULL AND dealer_status != "" ORDER BY dealer_status ASC'),
      dbAll('SELECT DISTINCT period_year_month FROM dealer_performance_history WHERE period_year_month IS NOT NULL AND period_year_month != "6M_AVG" ORDER BY period_year_month DESC')
    ]);

    res.json({
      dealerZones: dealerZones.map(r => r.zone),
      dealerRegions: dealerRegions.map(r => r.region),
      dealerAreas: dealerAreas.map(r => r.area),
      dealerTypes: dealerTypes.map(r => r.dealer_type),
      dealerStatuses: dealerStatuses.map(r => r.status),
      salesPeriods: salesPeriods.map(r => r.period_year_month),
      salesZones: salesZones.map(r => r.zone),
      dpPeriods: dpPeriods.map(r => r.period_year_month),
      logBranches: logBranches.map(r => r.branch),
      logRoutes: logRoutes.map(r => r.route),
      logEmployees: logEmployees.map(r => r.employee_name),
      logStatuses: logStatuses.map(r => r.visit_status),
      logVisitDates: logVisitDates.map(r => r.visit_date),
      logCustomerTypes: logCustomerTypes.map(r => r.customer_type),
      mappingAreas: mappingAreas.map(r => r.area),
      mappingRegions: mappingRegions.map(r => r.region),
      mappingSos: mappingSos.map(r => r.so_name),
      pjpZones: pjpZones.map(r => r.zone),
      pjpAreas: pjpAreas.map(r => r.area),
      pjpSos: pjpSos.map(r => r.so_name),
      pjpCategories: pjpCategories.map(r => r.category),
      pjpStatuses: pjpStatuses.map(r => r.dealer_status)
    });
  } catch (err) {
    console.error('Error fetching master filter options:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get Dealer to SO territory hierarchy mapping with rich field filters
 */
export async function getTerritoryMapping(req, res) {
  try {
    const { search, area, region, soName, strategy, custType, limit = 50, offset = 0 } = req.query;
    let sql = "SELECT m.*, d.dealer_type, d.sfa_code FROM master_dealer_so_mapping m LEFT JOIN master_dealers d ON m.dealer_id = d.id WHERE 1=1";
    let countSql = "SELECT COUNT(*) as total FROM master_dealer_so_mapping m LEFT JOIN master_dealers d ON m.dealer_id = d.id WHERE 1=1";
    const params = [];
    const countParams = [];

    if (custType && custType !== 'ALL') {
      if (custType === 'NON-STAR' || custType === 'NON_STAR') {
        sql += " AND (d.dealer_type = 'NON_STAR' OR d.dealer_type = 'NON-STAR')";
        countSql += " AND (d.dealer_type = 'NON_STAR' OR d.dealer_type = 'NON-STAR')";
      } else {
        sql += " AND d.dealer_type = ?";
        countSql += " AND d.dealer_type = ?";
        params.push(custType);
        countParams.push(custType);
      }
    }
    if (area && area !== 'ALL') {
      sql += ' AND m.area = ?';
      countSql += ' AND m.area = ?';
      params.push(area);
      countParams.push(area);
    }
    if (region && region !== 'ALL') {
      sql += ' AND m.region = ?';
      countSql += ' AND m.region = ?';
      params.push(region);
      countParams.push(region);
    }
    if (soName && soName !== 'ALL') {
      sql += ' AND m.so_name = ?';
      countSql += ' AND m.so_name = ?';
      params.push(soName);
      countParams.push(soName);
    }
    if (search) {
      sql += ' AND (m.dealer_name LIKE ? OR m.sap_code LIKE ? OR m.so_name LIKE ? OR m.so_emp_code LIKE ?)';
      countSql += ' AND (m.dealer_name LIKE ? OR m.sap_code LIKE ? OR m.so_name LIKE ? OR m.so_emp_code LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s);
      countParams.push(s, s, s, s);
    }

    sql += ' ORDER BY dealer_name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows, countObj] = await Promise.all([
      dbAll(sql, params),
      dbGet(countSql, countParams)
    ]);

    res.json({
      total: countObj?.total || 0,
      mappings: rows
    });
  } catch (err) {
    console.error('Error fetching territory mapping:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get Master Dealers list with rich field filters & pagination
 */
export async function getMasterDealers(req, res) {
  try {
    const { search, dealerType, status, area, region, zone, counterStrategy, limit = 50, offset = 0 } = req.query;
    let sql = `
      SELECT m.*, sm.so_name 
      FROM master_dealers m 
      LEFT JOIN (
        SELECT dealer_id, MAX(so_name) as so_name 
        FROM master_dealer_so_mapping 
        GROUP BY dealer_id
      ) sm ON m.id = sm.dealer_id 
      WHERE 1=1
    `;
    let countSql = 'SELECT COUNT(*) as total FROM master_dealers m WHERE 1=1';
    const params = [];
    const countParams = [];

    if (counterStrategy && counterStrategy !== 'ALL') {
      if (counterStrategy === 'PROSPECT') {
        sql += ' AND (m.counter_strategy = ? OR m.dealer_type = "PROSPECTIVE")';
        countSql += ' AND (m.counter_strategy = ? OR m.dealer_type = "PROSPECTIVE")';
      } else {
        sql += ' AND m.counter_strategy = ?';
        countSql += ' AND m.counter_strategy = ?';
      }
      params.push(counterStrategy);
      countParams.push(counterStrategy);
    }
    if (dealerType && dealerType !== 'ALL') {
      sql += ' AND dealer_type = ?';
      countSql += ' AND dealer_type = ?';
      params.push(dealerType);
      countParams.push(dealerType);
    }
    if (status && status !== 'ALL') {
      sql += ' AND status = ?';
      countSql += ' AND status = ?';
      params.push(status);
      countParams.push(status);
    }
    if (zone && zone !== 'ALL') {
      sql += ' AND zone = ?';
      countSql += ' AND zone = ?';
      params.push(zone);
      countParams.push(zone);
    }
    if (region && region !== 'ALL') {
      sql += ' AND region = ?';
      countSql += ' AND region = ?';
      params.push(region);
      countParams.push(region);
    }
    if (area && area !== 'ALL') {
      sql += ' AND area = ?';
      countSql += ' AND area = ?';
      params.push(area);
      countParams.push(area);
    }
    if (search) {
      sql += ' AND (dealer_name LIKE ? OR sap_code LIKE ? OR sfa_code LIKE ? OR rssd_code LIKE ? OR taluka LIKE ?)';
      countSql += ' AND (dealer_name LIKE ? OR sap_code LIKE ? OR sfa_code LIKE ? OR rssd_code LIKE ? OR taluka LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
      countParams.push(s, s, s, s, s);
    }

    sql += ' ORDER BY dealer_name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows, countObj] = await Promise.all([
      dbAll(sql, params),
      dbGet(countSql, countParams)
    ]);

    res.json({
      total: countObj?.total || 0,
      dealers: rows
    });
  } catch (err) {
    console.error('Error fetching master dealers:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get Sales History list with rich field filters & pagination
 */
export async function getSalesHistory(req, res) {
  try {
    const { search, period, zone, limit = 50, offset = 0 } = req.query;
    let sql = 'SELECT * FROM sales_history WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM sales_history WHERE 1=1';
    const params = [];
    const countParams = [];

    if (period && period !== 'ALL') {
      sql += ' AND period_year_month = ?';
      countSql += ' AND period_year_month = ?';
      params.push(period);
      countParams.push(period);
    }
    if (zone && zone !== 'ALL') {
      sql += ' AND zone = ?';
      countSql += ' AND zone = ?';
      params.push(zone);
      countParams.push(zone);
    }
    if (search) {
      sql += ' AND (sub_dealer_name LIKE ? OR linked_dealer_name LIKE ? OR sap_code LIKE ? OR rssd_code LIKE ? OR linked_dealer_code LIKE ?)';
      countSql += ' AND (sub_dealer_name LIKE ? OR linked_dealer_name LIKE ? OR sap_code LIKE ? OR rssd_code LIKE ? OR linked_dealer_code LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s);
      countParams.push(s, s, s, s, s);
    }

    sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows, countObj] = await Promise.all([
      dbAll(sql, params),
      dbGet(countSql, countParams)
    ]);

    res.json({
      total: countObj?.total || 0,
      sales: rows
    });
  } catch (err) {
    console.error('Error fetching sales history:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get SFA Visit Execution Logs with rich field filters & pagination
 */
export async function getVisitExecutionLogs(req, res) {
  try {
    const { search, visitDate, employeeName, branch, route, visitStatus, customerType, limit = 50, offset = 0 } = req.query;
    let sql = 'SELECT * FROM visit_execution_logs WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM visit_execution_logs WHERE 1=1';
    const params = [];
    const countParams = [];

    if (visitDate && visitDate !== 'ALL') {
      sql += ' AND visit_date = ?';
      countSql += ' AND visit_date = ?';
      params.push(visitDate);
      countParams.push(visitDate);
    }
    if (employeeName && employeeName !== 'ALL') {
      sql += ' AND employee_name = ?';
      countSql += ' AND employee_name = ?';
      params.push(employeeName);
      countParams.push(employeeName);
    }
    if (branch && branch !== 'ALL') {
      sql += ' AND branch = ?';
      countSql += ' AND branch = ?';
      params.push(branch);
      countParams.push(branch);
    }
    if (route && route !== 'ALL') {
      sql += ' AND route = ?';
      countSql += ' AND route = ?';
      params.push(route);
      countParams.push(route);
    }
    if (visitStatus && visitStatus !== 'ALL') {
      sql += ' AND visit_status = ?';
      countSql += ' AND visit_status = ?';
      params.push(visitStatus);
      countParams.push(visitStatus);
    }
    if (customerType && customerType !== 'ALL') {
      sql += ' AND customer_type = ?';
      countSql += ' AND customer_type = ?';
      params.push(customerType);
      countParams.push(customerType);
    }
    if (search) {
      sql += ' AND (customer_name LIKE ? OR customer_code LIKE ? OR employee_name LIKE ? OR employee_code LIKE ? OR branch LIKE ? OR route LIKE ?)';
      countSql += ' AND (customer_name LIKE ? OR customer_code LIKE ? OR employee_name LIKE ? OR employee_code LIKE ? OR branch LIKE ? OR route LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s, s, s, s);
      countParams.push(s, s, s, s, s, s);
    }

    sql += ' ORDER BY visit_date DESC, id DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows, countObj] = await Promise.all([
      dbAll(sql, params),
      dbGet(countSql, countParams)
    ]);

    res.json({
      total: countObj?.total || 0,
      logs: rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get Dealer Performance (Dynamic Pivot)
 */
export async function getDealerPerformance(req, res) {
  try {
    const { search, zone, region, area, limit = 50, offset = 0 } = req.query;
    const requestedPeriod = req.query.period;
    const isAll = requestedPeriod === 'ALL';

    const maxRow = await dbGet('SELECT MAX(period_year_month) as m FROM dealer_performance_history WHERE period_year_month != "6M_AVG"');
    let latestPeriod = maxRow?.m;
    if (!latestPeriod) {
      const maxSales = await dbGet('SELECT MAX(period_year_month) as m FROM sales_history WHERE period_year_month != "6M_AVG"');
      if (maxSales?.m) {
        latestPeriod = maxSales.m;
      } else {
        const now = new Date();
        latestPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      }
    }

    const currentPeriod = isAll ? latestPeriod : (requestedPeriod || latestPeriod);

    const mDate = new Date(`${currentPeriod}-01T00:00:00Z`);
    
    const m1Date = new Date(mDate);
    m1Date.setUTCMonth(mDate.getUTCMonth() - 1);
    const m1 = `${m1Date.getUTCFullYear()}-${String(m1Date.getUTCMonth() + 1).padStart(2, '0')}`;

    const lysmDate = new Date(mDate);
    lysmDate.setUTCFullYear(mDate.getUTCFullYear() - 1);
    const lysm = `${lysmDate.getUTCFullYear()}-${String(lysmDate.getUTCMonth() + 1).padStart(2, '0')}`;

    const now = new Date();
    const currentCalMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const isCurrentOrFuture = !isAll && currentPeriod >= currentCalMonth;

    let targetPeriod = currentPeriod;
    let salesPeriod = currentPeriod;
    let salesM1 = m1;
    let salesLysm = lysm;

    if (isCurrentOrFuture) {
      // For current/future month (e.g. September), sales calculations use previous month data (August)
      salesPeriod = m1;
      const m2Date = new Date(`${salesPeriod}-01T00:00:00Z`);
      m2Date.setUTCMonth(m2Date.getUTCMonth() - 1);
      salesM1 = `${m2Date.getUTCFullYear()}-${String(m2Date.getUTCMonth() + 1).padStart(2, '0')}`;
      
      const salesLysmDate = new Date(`${salesPeriod}-01T00:00:00Z`);
      salesLysmDate.setUTCFullYear(salesLysmDate.getUTCFullYear() - 1);
      salesLysm = `${salesLysmDate.getUTCFullYear()}-${String(salesLysmDate.getUTCMonth() + 1).padStart(2, '0')}`;
    }

    let sql;
    let params;

    if (isAll) {
      sql = `
        SELECT 
          d.region, 
          d.area, 
          d.sfa_code, 
          d.sap_code, 
          d.dealer_name, 
          d.doa, 
          d.counter_strategy as targeted_dealer, 
          '-' as exclusive_dealer,
          COALESCE(dp_all.total_target, 0) as tgt_m,
          COALESCE(dp_all.total_prorata, 0) as prorata_tgt,
          COALESCE(dp_all.total_sale, 0) as sale_m,
          COALESCE(dp_m1.quantity_mt, 0) as sale_m1,
          COALESCE(dp_lysm.quantity_mt, 0) as sale_lysm,
          COALESCE(dp_avg.quantity_mt, 0) as sale_6m_avg
        FROM master_dealers d
        LEFT JOIN (
          SELECT sap_code, 
                 SUM(quantity_mt) as total_sale,
                 SUM(target_mt) as total_target,
                 SUM(prorata_target_mt) as total_prorata
          FROM dealer_performance_history
          WHERE period_year_month != '6M_AVG'
          GROUP BY sap_code
        ) dp_all ON d.sap_code = dp_all.sap_code COLLATE utf8mb4_unicode_ci
        LEFT JOIN dealer_performance_history dp_m1 ON d.sap_code = dp_m1.sap_code COLLATE utf8mb4_unicode_ci AND dp_m1.period_year_month = ?
        LEFT JOIN dealer_performance_history dp_lysm ON d.sap_code = dp_lysm.sap_code COLLATE utf8mb4_unicode_ci AND dp_lysm.period_year_month = ?
        LEFT JOIN dealer_performance_history dp_avg ON d.sap_code = dp_avg.sap_code COLLATE utf8mb4_unicode_ci AND dp_avg.period_year_month = '6M_AVG'
        WHERE d.sap_code IS NOT NULL AND d.sap_code != ''
      `;
      params = [m1, lysm];
    } else {
      sql = `
        SELECT 
          d.region, 
          d.area, 
          d.sfa_code, 
          d.sap_code, 
          d.dealer_name, 
          d.doa, 
          d.counter_strategy as targeted_dealer, 
          '-' as exclusive_dealer,
          COALESCE(dp_tgt.target_mt, 0) as tgt_m,
          COALESCE(dp_tgt.prorata_target_mt, 0) as prorata_tgt,
          COALESCE(dp_m.quantity_mt, 0) as sale_m,
          COALESCE(dp_m1.quantity_mt, 0) as sale_m1,
          COALESCE(dp_lysm.quantity_mt, 0) as sale_lysm,
          COALESCE(dp_avg.quantity_mt, 0) as sale_6m_avg
        FROM master_dealers d
        LEFT JOIN dealer_performance_history dp_tgt ON d.sap_code = dp_tgt.sap_code COLLATE utf8mb4_unicode_ci AND dp_tgt.period_year_month = ?
        LEFT JOIN dealer_performance_history dp_m ON d.sap_code = dp_m.sap_code COLLATE utf8mb4_unicode_ci AND dp_m.period_year_month = ?
        LEFT JOIN dealer_performance_history dp_m1 ON d.sap_code = dp_m1.sap_code COLLATE utf8mb4_unicode_ci AND dp_m1.period_year_month = ?
        LEFT JOIN dealer_performance_history dp_lysm ON d.sap_code = dp_lysm.sap_code COLLATE utf8mb4_unicode_ci AND dp_lysm.period_year_month = ?
        LEFT JOIN dealer_performance_history dp_avg ON d.sap_code = dp_avg.sap_code COLLATE utf8mb4_unicode_ci AND dp_avg.period_year_month = '6M_AVG'
        WHERE d.sap_code IS NOT NULL AND d.sap_code != ''
      `;
      params = [targetPeriod, salesPeriod, salesM1, salesLysm];
    }

    let countSql = `
      SELECT COUNT(*) as total 
      FROM master_dealers d 
      WHERE d.sap_code IS NOT NULL AND d.sap_code != ''
    `;
    const countParams = [];

    if (zone && zone !== 'ALL') {
      sql += ' AND d.zone = ?'; countSql += ' AND d.zone = ?';
      params.push(zone); countParams.push(zone);
    }
    if (region && region !== 'ALL') {
      sql += ' AND d.region = ?'; countSql += ' AND d.region = ?';
      params.push(region); countParams.push(region);
    }
    if (area && area !== 'ALL') {
      sql += ' AND d.area = ?'; countSql += ' AND d.area = ?';
      params.push(area); countParams.push(area);
    }
    if (search) {
      sql += ' AND (d.dealer_name LIKE ? OR d.sap_code LIKE ? OR d.sfa_code LIKE ?)';
      countSql += ' AND (d.dealer_name LIKE ? OR d.sap_code LIKE ? OR d.sfa_code LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s); countParams.push(s, s, s);
    }

    sql += ' ORDER BY d.dealer_name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows, countObj, distinctPeriods] = await Promise.all([
      dbAll(sql, params),
      dbGet(countSql, countParams),
      dbAll('SELECT DISTINCT period_year_month FROM dealer_performance_history WHERE period_year_month != "6M_AVG" ORDER BY period_year_month DESC')
    ]);

    const availablePeriods = distinctPeriods.map(p => p.period_year_month);

    // Calculate derived analytical metrics dynamically
    const computedRows = rows.map(r => {
      const tgt_m = Number(r.tgt_m || 0); 
      const prorata_tgt = Number(r.prorata_tgt || 0); 
      const sale_m = Number(r.sale_m || 0);
      const sale_m1 = Number(r.sale_m1 || 0);
      const sale_lysm = Number(r.sale_lysm || 0);

      const shortfall = tgt_m > 0 ? (tgt_m - sale_m) : (prorata_tgt > 0 ? (prorata_tgt - sale_m) : 0);
      const prorata_achv = prorata_tgt > 0 ? ((sale_m / prorata_tgt) * 100).toFixed(1) : (tgt_m > 0 ? ((sale_m / tgt_m) * 100).toFixed(1) : 0);
      
      const variance_m1 = sale_m - sale_m1;
      const growth_m1 = sale_m1 > 0 ? ((variance_m1 / sale_m1) * 100).toFixed(1) : (sale_m > 0 ? 100 : 0);
      
      const variance_lysm = sale_m - sale_lysm;
      const growth_lysm = sale_lysm > 0 ? ((variance_lysm / sale_lysm) * 100).toFixed(1) : (sale_m > 0 ? 100 : 0);

      return {
        ...r,
        tgt_m,
        prorata_tgt,
        shortfall,
        prorata_achv,
        variance_m1,
        growth_m1,
        variance_lysm,
        growth_lysm,
        period_m: isAll ? 'ALL' : targetPeriod,
        period_sale: isAll ? 'ALL' : salesPeriod,
        period_m1: isAll ? m1 : salesM1,
        period_lysm: isAll ? lysm : salesLysm
      };
    });

    res.json({
      total: countObj?.total || 0,
      periodInfo: {
        isAll,
        current: isAll ? 'ALL' : targetPeriod,
        salesPeriod: isAll ? null : salesPeriod,
        latestMonth: latestPeriod,
        m1: isAll ? m1 : salesM1,
        lysm: isAll ? lysm : salesLysm,
        availablePeriods
      },
      performance: computedRows
    });
  } catch (err) {
    console.error('Error fetching dealer performance:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get Master Employees list with rich field filters & pagination
 */
export async function getMasterEmployees(req, res) {
  try {
    const { search, zone, region, limit = 50, offset = 0 } = req.query;
    let sql = 'SELECT * FROM master_employees WHERE 1=1';
    let countSql = 'SELECT COUNT(*) as total FROM master_employees WHERE 1=1';
    const params = [];
    const countParams = [];

    if (zone && zone !== 'ALL') {
      sql += ' AND zone = ?';
      countSql += ' AND zone = ?';
      params.push(zone);
      countParams.push(zone);
    }
    if (region && region !== 'ALL') {
      sql += ' AND region = ?';
      countSql += ' AND region = ?';
      params.push(region);
      countParams.push(region);
    }
    if (search) {
      sql += ' AND (emp_name LIKE ? OR emp_code LIKE ? OR designation LIKE ?)';
      countSql += ' AND (emp_name LIKE ? OR emp_code LIKE ? OR designation LIKE ?)';
      const s = `%${search}%`;
      params.push(s, s, s);
      countParams.push(s, s, s);
    }

    sql += ' ORDER BY emp_name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [rows, countObj] = await Promise.all([
      dbAll(sql, params),
      dbGet(countSql, countParams)
    ]);

    res.json({
      total: countObj?.total || 0,
      employees: rows
    });
  } catch (err) {
    console.error('Error fetching master employees:', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Purge old data from the database
 */
export async function purgeOldData(req, res) {
  try {
    const tablesToPurge = [
      'plan_approvals',
      'sales_plan_details',
      'sales_plans',
      'djp_recommendations',
      'dealer_visit_targets',
      'visit_execution_logs',
      'dealer_performance_history',
      'sales_history',
      'master_dealer_so_mapping',
      'master_dealers',
      'master_employees',
      'upload_batches'
    ];

    await dbRun('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of tablesToPurge) {
      try {
        await dbRun(`TRUNCATE TABLE ${table}`);
      } catch (truncErr) {
        await dbRun(`DELETE FROM ${table}`);
      }
    }
    await dbRun('SET FOREIGN_KEY_CHECKS = 1');

    res.json({
      success: true,
      message: 'All master data, sales history, mappings and targets purged successfully.',
      deletedTargets: 0,
      deletedMappings: 0,
      deletedProspects: 0
    });
  } catch (err) {
    try { await dbRun('SET FOREIGN_KEY_CHECKS = 1'); } catch (_) {}
    console.error('Error purging data:', err);
    res.status(500).json({ error: err.message });
  }
}
