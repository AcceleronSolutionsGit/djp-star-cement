/**
 * PJP Data Loader Engine
 * 
 * Batch-loads all required data from the database in minimal queries.
 * Avoids N+1 query patterns by loading entire populations at once.
 *
 * SOURCE SEPARATION RULES (enforced here):
 *   d.dm_area         → Area    (Dealer Mapping authoritative)
 *   d.sbg_potential   → Potential (SBG authoritative, NULL if SBG not found)
 *   d.sbg_block       → Block   (SBG authoritative, NULL if SBG not found)
 *   d.sbg_status      → SBG match status
 *   sales_history     → RSAR sales only
 *   dealer_performance_history → DP sales only (separate)
 *
 * NULL vs ZERO:
 *   sbg_potential NULL  = dealer not found in SBG (potential UNKNOWN)
 *   sbg_potential 0     = dealer found in SBG with actual zero potential
 */

import { dbAll, dbGet } from '../../config/database.js';
import { normalizeCode } from '../normalization.engine.js';

/**
 * Load all active dealers with their SO mappings.
 * Returns enriched dealer objects with hierarchy info.
 * 
 * CRITICAL CHANGES vs old version:
 *   - Removed AND m.id IS NOT NULL (was silently INNER JOIN-ing, dropping dealers)
 *   - potential reads d.sbg_potential (not d.counter_potential)
 *   - block reads d.sbg_block (not d.block)
 *   - area reads d.dm_area (not d.territory_name which may come from SBG)
 * 
 * Feature 4 — PJP Guidelines:
 *   RSSD & Sub-Dealer customers are included for SO/SR/MT visits ONLY.
 *   When roleType is ASM, RSM, or ZH, these dealer types are excluded.
 * 
 * @param {Object} [options]
 * @param {string} [options.roleType] - 'SO'|'ASM'|'RSM'|'ZH'. Filters RSSD/Sub-Dealer for non-SO roles.
 * @returns {Array<Object>} dealers with mapping info
 */
export async function loadDealersWithMappings(options = {}) {
  const { roleType } = options;

  // Dealer types that are restricted to SO/SR/MT only (not for ASM/RSM/ZH)
  const SO_ONLY_TYPES = ['SUB-DEALER', 'RSAR', 'NON-STAR', 'NON_STAR'];
  const isManagerRole = roleType && ['ASM', 'RSM', 'ZH'].includes(roleType.toUpperCase());

  const typeExclusion = isManagerRole
    ? `AND d.dealer_type NOT IN (${SO_ONLY_TYPES.map(() => '?').join(', ')})`
    : '';

  const queryParams = isManagerRole ? SO_ONLY_TYPES : [];

  const dealers = await dbAll(`
    SELECT 
      d.id as dealer_id,
      d.dealer_type,
      d.sap_code,
      d.sfa_code,
      d.rssd_code,
      d.linked_dealer_code,
      d.dealer_name,
      d.zone,
      d.region,

      -- Dealer Mapping authoritative fields
      d.dm_area,
      d.dm_sap_code,
      d.dm_customer_code,
      d.dm_sfa_code,

      -- SBG authoritative fields (may be NULL)
      d.sbg_potential,
      d.sbg_block,
      d.sbg_status,

      -- Source match statuses
      d.prospect_status,
      d.rsar_status,
      d.dp_status,

      -- Other dealer fields
      d.counter_potential,
      d.block,
      d.taluka,
      d.expected_sale,
      d.current_sales,
      d.counter_strategy,
      d.status,
      d.doa,

      -- Hierarchy from mapping (preferred) or dealer record
      COALESCE(m.territory_code, d.territory_code) as territory_code,
      COALESCE(m.territory_name, d.territory_name) as territory_name,
      COALESCE(m.so_name, d.so_name) as so_name,
      COALESCE(m.so_emp_code, d.so_emp_code) as so_emp_code,
      COALESCE(m.asm_name, d.asm_name) as asm_name,
      COALESCE(m.asm_code, d.asm_code) as asm_code,
      COALESCE(m.rsm_name, d.rsm_name) as rsm_name,
      COALESCE(m.rsm_code, d.rsm_code) as rsm_code,
      COALESCE(m.zh_name, d.zh_name) as zh_name,
      COALESCE(m.zh_code, d.zh_code) as zh_code,
      m.linked_dealer_code as mapping_linked_code,
      m.branch as mapping_branch,
      d.branch
    FROM master_dealers d
    LEFT JOIN master_dealer_so_mapping m ON d.id = m.dealer_id
    WHERE (d.status = 'ACTIVE' OR d.status = 'Active in SAP' OR d.status IS NULL)
    ${typeExclusion}
    ORDER BY d.id ASC
  `, queryParams);

  return dealers.map(d => {
    const sapCode = normalizeCode(d.sap_code || d.dm_sap_code);
    const sfaCode = normalizeCode(d.sfa_code || d.dm_sfa_code);
    const linkedCode = normalizeCode(d.linked_dealer_code || d.mapping_linked_code);
    const rssdCode = normalizeCode(d.rssd_code);

    // Canonical dealer identifier: SAP Code preferred, then SFA, then linked, then rssd
    const dealerCode = sapCode || sfaCode || linkedCode || rssdCode || `DLR_${d.dealer_id}`;

    // ── SOURCE-AUTHORITATIVE FIELD RESOLUTION ──

    // Area: ALWAYS from Dealer Mapping (dm_area)
    // Never from SBG territory_name or other sources
    const area = d.dm_area || d.area || null;

    // Block: ALWAYS from SBG (sbg_block) — if absent and PROSPECTIVE, taluka/block from prospects
    let block = d.sbg_block || null;
    if (!block && (d.dealer_type === 'PROSPECTIVE' || d.prospect_status === 'PROSPECT_MATCHED')) {
      block = d.block || null;
    }

    // Potential: ALWAYS from SBG (sbg_potential) — NULL if SBG not found
    // If dealer is PROSPECTIVE and absent from SBG, use its prospect potential (counter_potential)
    let sbgPotential = (d.sbg_potential !== undefined && d.sbg_potential !== null)
      ? parseFloat(d.sbg_potential)
      : null;
    if (sbgPotential === null && (d.dealer_type === 'PROSPECTIVE' || d.prospect_status === 'PROSPECT_MATCHED')) {
      sbgPotential = (d.counter_potential !== undefined && d.counter_potential !== null)
        ? parseFloat(d.counter_potential)
        : null;
    }

    const region = d.region || d.zone || null;
    const territoryCode = d.territory_code || null;
    const territoryName = d.territory_name || area || null;
    const custType = d.dealer_type === 'PROSPECTIVE' ? 'NON STAR' : (d.dealer_type || 'DEALER');

    return {
      ...d,
      sap_code: sapCode,
      sfa_code: sfaCode,
      rssd_code: rssdCode,
      linked_dealer_code: linkedCode,
      cust_type: custType,

      // Authoritative source fields
      dm_area: area,
      sbg_block: block,
      sbg_potential: sbgPotential,
      sbg_status: d.sbg_status || 'SBG_NOT_FOUND',
      prospect_status: d.prospect_status || 'PROSPECT_NOT_FOUND',
      rsar_status: d.rsar_status || 'RSAR_NOT_FOUND',
      dp_status: d.dp_status || 'DP_NOT_FOUND',

      // Canonical resolved fields used by PJP engine
      area,        // = dm_area (Dealer Mapping)
      block,       // = sbg_block (SBG)
      region,
      territory_code: territoryCode,
      territory_name: territoryName,
      dealerCode,

      // potential is sbg_potential — can be NULL
      potential: sbgPotential,

      // currentSales from DB record (will be overridden by RSAR aggregation)
      currentSales: parseFloat(d.current_sales) || 0
    };
  });
}

/**
 * Load all RSAR sales history for the required periods, aggregated by canonical dealer identity.
 * 
 * RSAR RULES:
 *   - Primary aggregation key: linked_dealer_code (associates sub-dealer rows with canonical dealer)
 *   - Fallback: sap_code, then rssd_code
 *   - Multiple RSAR rows with same linked_dealer_code → SUM their monthly sales
 *
 * NOTE: This reads ONLY from sales_history (RSAR). Dealer Performance data is
 * in dealer_performance_history and is loaded separately by loadDealerPerformanceHistory().
 * 
 * @param {string[]} periods - array of YYYY-MM period strings
 * @returns {Map<string, Array>} canonicalDealerCode -> [{period_year_month, quantity_mt}]
 */
export async function loadSalesHistory(periods) {
  if (!periods || periods.length === 0) return new Map();

  const placeholders = periods.map(() => '?').join(',');
  
  // Aggregate RSAR rows by canonical dealer identity (linked_dealer_code primary key)
  const rows = await dbAll(
    `SELECT 
       COALESCE(NULLIF(TRIM(linked_dealer_code), ''), NULLIF(TRIM(sap_code), ''), NULLIF(TRIM(rssd_code), '')) as canonical_dealer_code,
       period_year_month, 
       SUM(quantity_mt) as quantity_mt
     FROM sales_history 
     WHERE period_year_month IN (${placeholders})
     GROUP BY canonical_dealer_code, period_year_month`,
    periods
  );

  const salesByDealer = new Map();

  for (const row of rows) {
    const code = normalizeCode(row.canonical_dealer_code);
    if (!code) continue;

    const item = {
      period_year_month: row.period_year_month,
      quantity_mt: parseFloat(row.quantity_mt) || 0
    };

    if (!salesByDealer.has(code)) {
      salesByDealer.set(code, []);
    }
    salesByDealer.get(code).push(item);
  }

  return salesByDealer;
}

/**
 * Load Dealer Performance monthly history for the required periods.
 * 
 * COMPLETELY SEPARATE from loadSalesHistory() / RSAR.
 * Reads from dealer_performance_history table ONLY.
 *
 * @param {string[]} periods - array of YYYY-MM period strings
 * @returns {Map<string, Array>} sapCode -> [{period_year_month, quantity_mt}]
 */
export async function loadDealerPerformanceHistory(periods) {
  if (!periods || periods.length === 0) return new Map();

  const placeholders = periods.map(() => '?').join(',');

  const rows = await dbAll(
    `SELECT 
       sap_code,
       period_year_month,
       SUM(quantity_mt) as quantity_mt
     FROM dealer_performance_history
     WHERE period_year_month IN (${placeholders})
       AND sap_code IS NOT NULL
     GROUP BY sap_code, period_year_month`,
    periods
  );

  const dpByDealer = new Map();

  for (const row of rows) {
    const code = normalizeCode(row.sap_code);
    if (!code) continue;

    if (!dpByDealer.has(code)) dpByDealer.set(code, []);
    dpByDealer.get(code).push({
      period_year_month: row.period_year_month,
      quantity_mt: parseFloat(row.quantity_mt) || 0
    });
  }

  return dpByDealer;
}

/**
 * Calculate Dealer Performance 6-month average for each dealer.
 * 
 * INDEPENDENT from RSAR. Uses dealer_performance_history exclusively.
 * 
 * @param {Map<string, Array>} dpByDealer - from loadDealerPerformanceHistory()
 * @param {string[]} sixMonthPeriods - the 6 periods to average
 * @param {string} [lysmPeriod] - LYSM period identifier (e.g. 2025-06 or 2025-09)
 * @returns {{ avgMap: Map<string, number>, lysmMap: Map<string, number> }}
 */
export function computeDpMetrics(
  dpByDealer,
  sixMonthPeriods,
  lysmPeriod = null,
  currentPeriod = null,
  prevPeriod = null
) {
  const avgMap = new Map();
  const lysmMap = new Map();
  const currentSalesMap = new Map();
  const prevSalesMap = new Map();

  for (const [code, records] of dpByDealer.entries()) {
    const periodMap = new Map();
    for (const rec of records) {
      periodMap.set(rec.period_year_month, (periodMap.get(rec.period_year_month) || 0) + rec.quantity_mt);
    }

    let total = 0;
    let count = 0;
    for (const p of sixMonthPeriods) {
      if (periodMap.has(p)) {
        total += periodMap.get(p);
        count++;
      }
    }

    let avg = 0;
    if (count > 0) {
      avg = total / sixMonthPeriods.length;
    } else if (periodMap.has('6M_AVG')) {
      avg = periodMap.get('6M_AVG');
    }
    avgMap.set(code, avg);

    if (lysmPeriod && periodMap.has(lysmPeriod)) {
      lysmMap.set(code, periodMap.get(lysmPeriod));
    }
    if (currentPeriod && periodMap.has(currentPeriod)) {
      currentSalesMap.set(code, periodMap.get(currentPeriod));
    }
    if (prevPeriod && periodMap.has(prevPeriod)) {
      prevSalesMap.set(code, periodMap.get(prevPeriod));
    }
  }

  return { avgMap, lysmMap, currentSalesMap, prevSalesMap };
}

export function computeDpSixMonthAverages(dpByDealer, sixMonthPeriods) {
  return computeDpMetrics(dpByDealer, sixMonthPeriods).avgMap;
}

/**
 * Load all business rules as a key-value map.
 * @returns {Object} { ruleKey: ruleValue, ... }
 */
export async function loadBusinessRules() {
  const rules = await dbAll('SELECT rule_key, rule_value, data_type FROM business_rules');
  const ruleMap = {};

  for (const r of rules) {
    if (r.data_type === 'INTEGER') {
      ruleMap[r.rule_key] = parseInt(r.rule_value, 10);
    } else if (r.data_type === 'FLOAT' || r.data_type === 'DOUBLE') {
      ruleMap[r.rule_key] = parseFloat(r.rule_value);
    } else if (r.data_type === 'BOOLEAN') {
      ruleMap[r.rule_key] = r.rule_value === 'true' || r.rule_value === '1';
    } else {
      ruleMap[r.rule_key] = r.rule_value;
    }
  }

  return ruleMap;
}

/**
 * Load raw business rules as array (for matrix parsing).
 * @returns {Array<Object>}
 */
export async function loadBusinessRulesRaw() {
  return await dbAll('SELECT rule_key, rule_value, data_type FROM business_rules');
}

/**
 * Retrieve the latest available RSAR sales period from sales_history.
 * If planningMonth is provided, returns the latest period on or before planningMonth.
 * 
 * @param {string|null} planningMonth - YYYY-MM
 * @returns {Promise<string|null>} YYYY-MM
 */
export async function getLatestAvailableSalesPeriod(planningMonth = null) {
  let row = null;
  if (planningMonth) {
    let prevMonth = planningMonth;
    const match = planningMonth.match(/^(\d{4})-(\d{2})$/);
    if (match) {
      let y = parseInt(match[1], 10);
      let m = parseInt(match[2], 10) - 1;
      if (m < 1) { m = 12; y--; }
      prevMonth = `${y}-${String(m).padStart(2, '0')}`;
    }
    row = await dbGet(
      'SELECT MAX(period_year_month) as max_period FROM sales_history WHERE period_year_month <= ?',
      [prevMonth]
    );
  }
  if (!row || !row.max_period) {
    row = await dbGet('SELECT MAX(period_year_month) as max_period FROM sales_history');
  }
  return row?.max_period || null;
}

/**
 * Verify that all 5 required Excel input documents have been uploaded and validated.
 */
export async function checkAllExcelInputsAvailable() {
  const requiredInputs = [
    { key: 'DEALER_MAPPING', label: 'Dealer - SO Territory Hierarchy Mapping (.xlsx)' },
    { key: 'SBG', label: 'SBG Dealer Master & Counter Potential (.xlsx)' },
    { key: 'SALES_HISTORY', label: 'Period Sales History (RSAR / ERP) (.xlsx)' },
    { key: 'DEALER_PERFORMANCE', label: 'Dealer Performance & Historical Trends (.xlsx)' },
    { key: 'PROSPECT_DEALERS', label: 'Prospect Dealer Intake (.xlsx)' }
  ];

  const batches = await dbAll(
    `SELECT file_type, COUNT(*) as cnt 
     FROM upload_batches 
     WHERE status != 'FAILED' 
     GROUP BY file_type`
  );

  const available = new Set(batches.filter(b => b.cnt > 0).map(b => b.file_type));
  if (available.has('RSAR_SALES')) available.add('SALES_HISTORY');

  const latestAvailableSalesPeriod = await getLatestAvailableSalesPeriod();

  const missing = requiredInputs.filter(req => !available.has(req.key));
  return {
    allAvailable: missing.length === 0,
    missing: missing.map(m => m.label),
    missingKeys: missing.map(m => m.key),
    available: Array.from(available),
    latestAvailableSalesPeriod,
    required: requiredInputs.map(r => ({
      ...r,
      uploaded: available.has(r.key)
    }))
  };
}
