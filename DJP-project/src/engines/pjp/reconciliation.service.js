import { dbAll, dbGet } from '../../config/database.js';
import { normalizeCode } from '../normalization.engine.js';

/**
 * Multi-Source Reconciliation & Canonical Dealer Universe Builder
 * 
 * SOURCE SEPARATION RULES (enforced here):
 *   Area     = d.dm_area       (Dealer Mapping authoritative)
 *   Block    = d.sbg_block     (SBG authoritative, NULL if not found)
 *   Potential = d.sbg_potential (SBG authoritative, NULL if not found)
 *
 * UNIVERSE RULE:
 *   The Master Dealer Universe = ALL dealers in master_dealers (from Dealer Mapping).
 *   Dealers absent from SBG: sbg_potential=NULL, sbg_block=NULL, sbg_status=SBG_NOT_FOUND.
 *   Dealers without SAP code: still included if SFA code or name is available.
 *
 * NULL vs ZERO (critical):
 *   potential = NULL  → SBG data missing (unknown)
 *   potential = 0     → SBG explicitly says zero potential
 *   These must NOT be conflated.
 */
export async function reconcileUniverse(options = {}) {
  const { reportMonth = '2026-06', cycleCode = 'C1' } = options;

  console.log(`[RECONCILIATION] Starting for reportMonth=${reportMonth}, cycleCode=${cycleCode}`);

  // ── Fetch ALL Dealer Mapping dealers ──
  // CRITICAL: No sap_code IS NOT NULL filter — all DM dealers belong in the universe
  const rawDealers = await dbAll(`
    SELECT 
      d.id,
      d.dealer_id,
      d.sap_code,
      d.sfa_code,
      d.dealer_name,
      d.dealer_type,
      d.status,
      d.doa,
      d.zone,
      d.region,

      -- Dealer Mapping authoritative area
      d.dm_area,
      d.area,

      -- SBG authoritative fields (NULL if SBG not found)
      d.sbg_potential,
      d.sbg_block,
      d.sbg_status,

      -- Source statuses
      d.prospect_status,
      d.rsar_status,
      d.dp_status,

      -- Legacy fields
      d.counter_potential,
      d.branch,
      d.block,
      d.territory_code,
      d.territory_name,
      d.so_name,
      d.so_emp_code,
      d.asm_name,
      d.asm_code,
      d.rsm_name,
      d.rsm_code,
      d.zh_name,
      d.zh_code
    FROM master_dealers d
    WHERE (d.status = 'ACTIVE' OR d.status = 'Active in SAP' OR d.status IS NULL)
    ORDER BY d.id ASC
  `);

  // ── Fetch mappings ──
  const rawMappings = await dbAll(`
    SELECT 
      m.dealer_id,
      m.sap_code,
      m.dealer_name,
      m.area,
      m.block,
      m.branch,
      m.region as zone,
      m.region,
      m.territory_code,
      m.territory_name,
      m.so_name,
      m.so_emp_code,
      m.asm_name,
      m.asm_code,
      m.rsm_name,
      m.rsm_code,
      m.zh_name,
      m.zh_code
    FROM master_dealer_so_mapping m
  `);

  const mappingByDealerId = new Map();
  for (const m of rawMappings) {
    if (m.dealer_id) {
      if (!mappingByDealerId.has(m.dealer_id)) mappingByDealerId.set(m.dealer_id, []);
      mappingByDealerId.get(m.dealer_id).push(m);
    }
  }

  // ── Fetch RSAR sales records (by linked_dealer_code → canonical) ──
  const salesRows = await dbAll(`
    SELECT 
      COALESCE(NULLIF(TRIM(linked_dealer_code), ''), NULLIF(TRIM(sap_code), ''), NULLIF(TRIM(rssd_code), '')) as canonical_code,
      period_year_month,
      SUM(quantity_mt) as quantity_mt
    FROM sales_history
    GROUP BY canonical_code, period_year_month
  `);

  const salesByCode = new Map();
  for (const s of salesRows) {
    if (!s.canonical_code) continue;
    const code = normalizeCode(s.canonical_code);
    if (!salesByCode.has(code)) salesByCode.set(code, new Map());
    salesByCode.get(code).set(s.period_year_month, s.quantity_mt);
  }

  const issues = [];
  const canonicalDealers = [];
  const seenDealerCodes = new Set();

  let totalReceived = rawDealers.length;
  let normalizedCount = 0;
  let rejectedCount = 0;
  let unmatchedCount = 0;
  let missingHierarchyCount = 0;
  let sbgNotFoundCount = 0;

  for (const d of rawDealers) {
    // Use SAP code first, then SFA code, then dealer ID as canonical code
    const code = normalizeCode(d.sap_code || d.sfa_code || String(d.id));
    if (!code) {
      rejectedCount++;
      issues.push({
        dealerId: d.id,
        dealerName: d.dealer_name,
        type: 'MISSING_IDENTIFIER',
        reason: 'Dealer has no valid SAP code, SFA code, or ID',
        severity: 'ERROR'
      });
      continue;
    }

    if (seenDealerCodes.has(code)) {
      rejectedCount++;
      issues.push({
        code,
        dealerName: d.dealer_name,
        type: 'DUPLICATE_IDENTITY',
        reason: `Duplicate canonical dealer code ${code}`,
        severity: 'WARNING'
      });
      continue;
    }

    seenDealerCodes.add(code);

    // Merge hierarchy with explicit source precedence:
    // Dealer Mapping record > dealer master record
    const mappings = mappingByDealerId.get(d.id) || [];
    const m = mappings[0] || {};

    if (mappings.length > 1) {
      issues.push({
        code,
        dealerName: d.dealer_name,
        type: 'CONFLICTING_MAPPINGS',
        reason: `Dealer ${code} has ${mappings.length} mapping records. Using primary.`,
        severity: 'WARNING'
      });
    }

    const territoryCode = m.territory_code || d.territory_code || null;
    const territoryName = m.territory_name || d.territory_name || null;
    const soCode = m.so_emp_code || d.so_emp_code || null;
    const soName = m.so_name || d.so_name || null;
    const asmCode = m.asm_code || d.asm_code || null;
    const asmName = m.asm_name || d.asm_name || null;
    const rsmCode = m.rsm_code || d.rsm_code || null;
    const rsmName = m.rsm_name || d.rsm_name || null;
    const zhCode = m.zh_code || d.zh_code || null;
    const zhName = m.zh_name || d.zh_name || null;

    // Check hierarchy completeness
    const isHierarchyComplete = Boolean(soCode && soName && asmCode && asmName && rsmCode && rsmName && zhCode && zhName);
    if (!isHierarchyComplete) {
      missingHierarchyCount++;
      issues.push({
        code,
        dealerName: d.dealer_name,
        type: 'MISSING_HIERARCHY',
        reason: `Missing: ${[!soCode && 'SO Code', !asmCode && 'ASM Code', !rsmCode && 'RSM Code', !zhCode && 'ZH Code'].filter(Boolean).join(', ')}`,
        severity: 'WARNING'
      });
    }

    // ── SOURCE-AUTHORITATIVE FIELD RESOLUTION ──

    // Area: Dealer Mapping authoritative (dm_area)
    // Falls back to d.area (which may have been set by DM importer)
    const area = d.dm_area || d.area || m.area || null;

    // Block: SBG authoritative (sbg_block) — if absent and PROSPECTIVE, fallback to d.block
    let block = (d.sbg_block !== undefined && d.sbg_block !== null && d.sbg_block !== '')
      ? d.sbg_block
      : null;
    if (!block && (d.dealer_type === 'PROSPECTIVE' || d.prospect_status === 'PROSPECT_MATCHED')) {
      block = d.block || null;
    }

    // Potential: SBG authoritative (sbg_potential) — if absent and PROSPECTIVE, fallback to d.counter_potential
    let sbgPotential = (d.sbg_potential !== undefined && d.sbg_potential !== null)
      ? parseFloat(d.sbg_potential)
      : null;
    if (sbgPotential === null && (d.dealer_type === 'PROSPECTIVE' || d.prospect_status === 'PROSPECT_MATCHED')) {
      sbgPotential = (d.counter_potential !== undefined && d.counter_potential !== null)
        ? parseFloat(d.counter_potential)
        : null;
    }

    const sbgStatus = d.sbg_status || 'SBG_NOT_FOUND';
    if (sbgStatus === 'SBG_NOT_FOUND') {
      sbgNotFoundCount++;
      issues.push({
        code,
        dealerName: d.dealer_name,
        type: 'SBG_NOT_FOUND',
        reason: `Dealer ${code} not found in SBG. sbg_potential=NULL, sbg_block=NULL`,
        severity: 'INFO'
      });
    }

    // RSAR sales for diagnostics
    const dealerSalesMap = salesByCode.get(code) || new Map();
    const hasRsarSales = dealerSalesMap.size > 0;
    const rsarStatus = hasRsarSales ? 'RSAR_MATCHED' : 'RSAR_NOT_FOUND';

    if (!hasRsarSales && d.dealer_type !== 'PROSPECTIVE') {
      issues.push({
        code,
        dealerName: d.dealer_name,
        type: 'MISSING_SALES_RECORDS',
        reason: `Dealer ${code} has no RSAR sales records`,
        severity: 'INFO'
      });
    }

    normalizedCount++;

    canonicalDealers.push({
      id: d.id,
      dealer_id: d.id,
      dealerId: d.id,
      dealerCode: code,
      sap_code: d.sap_code,
      sfa_code: d.sfa_code,
      dealer_name: d.dealer_name,
      dealerName: d.dealer_name,
      dealer_type: d.dealer_type || 'STAR',
      dealerType: d.dealer_type || 'STAR',
      status: d.status || 'ACTIVE',
      doa: d.doa,
      zone: d.zone || m.zone || m.region || d.region || null,
      region: d.region || m.region || d.zone || null,

      // Area: Dealer Mapping authoritative
      area,
      dm_area: area,

      // Block: SBG authoritative (NULL if not found)
      block,
      sbg_block: block,

      branch: d.branch || m.branch || null,
      cust_type: d.dealer_type || 'RSAR',
      custType: d.dealer_type || 'RSAR',
      territory_code: territoryCode,
      territoryCode,
      territory_name: territoryName || area,
      territoryName: territoryName || area,

      so_emp_code: soCode,
      soCode,
      so_name: soName,
      soName,
      asm_code: asmCode,
      asmCode,
      asm_name: asmName,
      asmName,
      rsm_code: rsmCode,
      rsmCode,
      rsm_name: rsmName,
      rsmName,
      zh_code: zhCode,
      zhCode,
      zh_name: zhName,
      zhName,

      // SBG authoritative (potential may be NULL)
      sbg_potential: sbgPotential,
      potential: sbgPotential,   // canonical potential = SBG potential
      counter_potential: d.counter_potential,  // kept for reference only

      // Source statuses
      sbg_status: sbgStatus,
      sbgStatus,
      rsar_status: rsarStatus,
      rsarStatus,
      prospect_status: d.prospect_status || 'PROSPECT_NOT_FOUND',
      dp_status: d.dp_status || 'DP_NOT_FOUND',

      // RSAR sales map for diagnostics
      salesMap: dealerSalesMap,

      // Current sales (will be overridden by RSAR aggregation in PJP engine)
      current_sales: 0,
      currentSales: 0
    });
  }

  const reconciliationReport = {
    reportMonth,
    cycleCode,
    totalReceived,
    normalizedCount,
    rejectedCount,
    unmatchedCount,
    missingHierarchyCount,
    sbgNotFoundCount,
    canonicalDealerCount: canonicalDealers.length,
    issues
  };

  console.log(`[RECONCILIATION] Complete: universe=${canonicalDealers.length}, sbgNotFound=${sbgNotFoundCount}, issues=${issues.length}`);
  console.log(`[RECONCILIATION] Dealer count: DM total=${totalReceived}, normalized=${normalizedCount}, rejected=${rejectedCount}`);

  return {
    reconciliationReport,
    canonicalDealers
  };
}
