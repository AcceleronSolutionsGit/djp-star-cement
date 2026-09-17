/**
 * PJP Engine — Canonical Top-Level Orchestrator
 * 
 * Single entry point: calculatePJP(reportMonth, cycleCode, options)
 * 
 * SOURCE SEPARATION (strictly enforced):
 *   potential        = sbg_potential (from SBG, may be NULL)
 *   block            = sbg_block     (from SBG, may be NULL)
 *   area             = dm_area       (from Dealer Mapping)
 *   grade            = from calculateAreaGradeMetrics (not ad-hoc inline logic)
 *   priority         = priorityRank (from calculateSOPriorityScores, independent of grade)
 *
 * SALES — TWO POPULATIONS, NOT TWO SOURCES FOR ONE NUMBER:
 *
 *   Dealer Performance (DLRWISE)  →  the DEALER's own sales.
 *   RSAR                          →  the SUB-DEALERS beneath that dealer, rows keyed
 *                                    by their own code and tied back through
 *                                    linked_dealer_code.
 *
 *   So everything that judges a dealer comes from Dealer Performance:
 *     currentSales (O), previousSales (R), lysmSales (Q), sixMonthAverage (S),
 *     counterShare (O / SBG potential) — and therefore Final Category, Final Volume,
 *     grade and need-to-grow.
 *
 *   RSAR is carried alongside as rsarCurrentSales / rsarSixMonthAverage for
 *   sub-dealer reporting and reconciliation. The two NEVER fall back to one another:
 *   a dealer with busy sub-dealers and no direct sales of its own must not read as
 *   healthy, and a missing Dealer Performance row means zero sales — which is a real
 *   signal, and is how Churn and Zero Lifter are reached.
 */

import { loadDealersWithMappings, loadSalesHistory, loadDealerPerformanceHistory, computeDpSixMonthAverages, computeDpMetrics, loadBusinessRules, loadBusinessRulesRaw, getLatestAvailableSalesPeriod } from './data-loader.engine.js';
import { calculatePeriods, buildCalculationContext, aggregateDealerSales, calculateCounterShare } from './sales-calculation.engine.js';
import { calculateAreaPotentialMetrics, determineNeedToGrow } from './area-potential.engine.js';
import { classifyDealer } from './classification.engine.js';
import { calculateFinalVolume } from './final-volume.engine.js';
import { calculateAreaGradeMetrics } from './area-grade.engine.js';
import { calculateSOPriorityScores, getPriorityLabel } from './priority.engine.js';
import { getVisitFrequencies, parseMatrixFromRules } from './visit-frequency.engine.js';
import { validatePjpResults } from './pjp-validator.engine.js';
import { validatePjpIntegrity } from './pjp-integrity.validator.js';
import { reconcileUniverse } from './reconciliation.service.js';
import { dbRun, dbGet } from '../../config/database.js';

/**
 * Run the complete canonical PJP calculation pipeline.
 * 
 * @param {string} reportMonth - YYYY-MM
 * @param {string} cycleCode - 'C1' or 'C2'
 * @param {Object} options - { debug: false, persist: true }
 * @returns {Object} { results: Array, validation: Object, stats: Object }
 */
export async function calculatePJP(reportMonth, cycleCode, options = {}) {
  const { debug = false, persist = true, generationRunCode = null, roleType = null } = options;
  const startTime = Date.now();

  if (!reportMonth || typeof reportMonth !== 'string') {
    throw new Error(`Invalid planMonth: '${reportMonth}'. Plan Month is required.`);
  }
  const match = reportMonth.match(/^(\d{4})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid planMonth format: '${reportMonth}'. Expected YYYY-MM.`);
  }
  const mNum = parseInt(match[2], 10);
  if (mNum < 1 || mNum > 12) {
    throw new Error(`Invalid planMonth: '${reportMonth}'. Month must be between 01 and 12.`);
  }

  // Authoritative separation of Planning Month and Sales Anchor Month
  const activeReportMonth = reportMonth;
  const latestAvailableSalesPeriod = await getLatestAvailableSalesPeriod(activeReportMonth);
  const calcContext = buildCalculationContext(activeReportMonth, latestAvailableSalesPeriod);

  console.log(`\n================================================================`);
  console.log(`CANONICAL PJP CALCULATION | Plan Month: ${calcContext.planningMonth} | Sales Anchor: ${calcContext.latestAvailableSalesPeriod} | Cycle: ${cycleCode}${roleType ? ` | Role: ${roleType}` : ''}`);
  console.log(`================================================================`);

  // ──────────────────────────────────────────────
  // STAGE 1: LOAD DATA
  // ──────────────────────────────────────────────
  console.log('[1/10] Loading data & reconciling universe...');

  // Reconcile multi-source canonical universe
  const reconciliation = await reconcileUniverse({ reportMonth: activeReportMonth, cycleCode });
  let allDealers = reconciliation.canonicalDealers;

  if (!allDealers || allDealers.length === 0) {
    // Feature 4: pass roleType so RSSD/Sub-Dealer types are excluded for ASM/RSM/ZH
    allDealers = await loadDealersWithMappings({ roleType });
  }

  if (allDealers.length === 0) {
    throw new Error('No active dealers found in the database. Cannot calculate PJP.');
  }

  // Load RSAR sales history (independent of DP)
  let [rsarSalesByDealer, rules] = await Promise.all([
    loadSalesHistory(calcContext.allRequiredPeriods),
    loadBusinessRules()
  ]);
  const rulesRaw = await loadBusinessRulesRaw();

  // Load Dealer Performance history (independent of RSAR)
  const dpSalesByDealer = await loadDealerPerformanceHistory(calcContext.allRequiredPeriods);
  const {
    avgMap: dpSixMonthAvgMap,
    lysmMap: dpLysmMap,
    currentSalesMap: dpCurrentMap,
    prevSalesMap: dpPrevMap
  } = computeDpMetrics(
    dpSalesByDealer,
    calcContext.sixMonthPeriods || calcContext.last6Periods || [],
    calcContext.lysmSalesPeriod,
    calcContext.currentSalesPeriod,
    calcContext.previousSalesPeriod
  );

  console.log(`  Loaded ${allDealers.length} dealers`);
  console.log(`  RSAR: ${rsarSalesByDealer.size} dealers with sales data (anchor: ${calcContext.latestAvailableSalesPeriod})`);
  console.log(`  DP: ${dpSalesByDealer.size} dealers with performance data (LYSM entries: ${dpLysmMap.size})`);
  console.log(`  SBG Not Found: ${allDealers.filter(d => (d.sbg_status || d.sbgStatus) === 'SBG_NOT_FOUND').length} dealers`);

  if (debug) {
    console.log('Sample dealers:', allDealers.slice(0, 3).map(d => ({
      code: d.dealerCode, name: d.dealer_name,
      area: d.area, block: d.block, sbg_potential: d.sbg_potential
    })));
  }

  // ──────────────────────────────────────────────
  // STAGE 2: RSAR SALES AGGREGATION + COUNTER SHARE
  // ──────────────────────────────────────────────
  console.log('[2/10] Calculating RSAR sales aggregation and counter share...');
  const dealerSalesAgg = aggregateDealerSales(rsarSalesByDealer, calcContext);

  for (const dealer of allDealers) {
    // Lookup RSAR sales by canonical codes (SAP > linked_dealer > SFA)
    const sales = dealerSalesAgg.get(dealer.dealerCode) ||
      dealerSalesAgg.get(dealer.sap_code) ||
      dealerSalesAgg.get(dealer.linked_dealer_code) ||
      dealerSalesAgg.get(dealer.rssd_code) ||
      dealerSalesAgg.get(dealer.sfa_code) ||
      null;

    // Lookup DP metrics (6M average, LYSM, current sales, previous sales)
    const dpSixMonthAvg = dpSixMonthAvgMap.get(dealer.dealerCode) ??
      dpSixMonthAvgMap.get(dealer.sap_code) ??
      dpSixMonthAvgMap.get(dealer.linked_dealer_code) ?? 0;

    const dpLysm = dpLysmMap.get(dealer.dealerCode) ??
      dpLysmMap.get(dealer.sap_code) ??
      dpLysmMap.get(dealer.linked_dealer_code) ?? null;

    const dpCurrent = dpCurrentMap.get(dealer.dealerCode) ??
      dpCurrentMap.get(dealer.sap_code) ??
      dpCurrentMap.get(dealer.linked_dealer_code) ?? null;

    const dpPrev = dpPrevMap.get(dealer.dealerCode) ??
      dpPrevMap.get(dealer.sap_code) ??
      dpPrevMap.get(dealer.linked_dealer_code) ?? null;

    dealer.dpSixMonthAverage = dpSixMonthAvg;

    // ── RSAR is recorded, but it is NOT this dealer's own performance ────────
    //
    // RSAR carries SUB-DEALER sales — rows keyed by their own code (1500001153A)
    // and tied to a dealer through linked_dealer_code. Dealer Performance carries
    // the DEALER's own sales. They describe two different populations, so they are
    // not two sources for one number and must never fall back to one another.
    //
    // Columns O / R / Q / S of the client master all come from Dealer Performance
    // (DLRWISE), per the row-3 annotations in M.xlsx. Classifying a dealer on RSAR
    // judges it by what its sub-dealers sold — a dealer with strong sub-dealers and
    // no direct sales of its own reads as healthy when it is not, and vice versa.
    if (sales) {
      dealer.rsarSixMonthTotal   = sales.sixMonthTotal || 0;
      dealer.rsarSixMonthAverage = sales.sixMonthAverage || 0;
      dealer.rsarCurrentSales    = sales.currentSales || 0;
      dealer.rsar_status = (sales.currentSales > 0 || sales.previousSales > 0 || sales.sixMonthAverage > 0)
        ? 'RSAR_MATCHED' : 'RSAR_NOT_FOUND';
    } else {
      dealer.rsarSixMonthTotal   = 0;
      dealer.rsarSixMonthAverage = 0;
      dealer.rsarCurrentSales    = 0;
      dealer.rsar_status = 'RSAR_NOT_FOUND';
    }

    // ── The dealer's own sales — Dealer Performance only ─────────────────────
    // Absence of a Dealer Performance record means no sales, which is a real
    // signal (it is how Churn and Zero Lifter are reached). It is not a reason to
    // substitute somebody else's numbers.
    dealer.currentSales  = dpCurrent ?? 0;
    dealer.previousSales = dpPrev ?? 0;

    // Q — same month last year. Dealer Performance, same reasoning as above.
    dealer.lysmSales = (dpLysm !== null && dpLysm !== undefined) ? dpLysm : 0;
    dealer.dp_status = (dpCurrent !== null || dpPrev !== null || dpLysm !== null || dpSixMonthAvg > 0)
      ? 'DP_MATCHED' : 'DP_NOT_FOUND';

    // Aliases the classification engine reads: O, R, Q, S — all Dealer Performance.
    dealer.previousMonthSales     = dealer.previousSales;
    dealer.sameMonthLastYearSales = dealer.lysmSales;
    dealer.sixMonthAverage        = dealer.dpSixMonthAverage;

    // Counter Share: currentSales / sbg_potential
    // sbg_potential may be NULL — calculateCounterShare handles this (returns 0 if potential is NULL/0)
    dealer.counterShare = calculateCounterShare(dealer.currentSales, dealer.sbg_potential);
  }

  // ──────────────────────────────────────────────
  // STAGE 3: AREA POTENTIAL / RANK / PERCENTILE
  // (Uses SBG potential via d.potential = d.sbg_potential)
  // ──────────────────────────────────────────────
  console.log('[3/10] Calculating area potential metrics (from SBG potential)...');
  const areaPotentialMetrics = calculateAreaPotentialMetrics(allDealers);

  for (const dealer of allDealers) {
    const apm = areaPotentialMetrics.get(dealer.dealerCode) || {};
    dealer.areaPotential = apm.areaPotential ?? 0;
    dealer.areaPotentialRank = apm.areaPotentialRank || 1;
    dealer.areaPotentialPercentile = apm.areaPotentialPercentile ?? 0;
  }

  // ──────────────────────────────────────────────
  // STAGE 4: NEED TO GROW
  // ──────────────────────────────────────────────
  console.log('[4/10] Determining Need to Grow...');
  const ntgThresholds = {
    ntgMinPercentile: (rules.ntg_min_percentile || 60) / 100,
    ntgMaxShare: (rules.ntg_max_share || 20) / 100
  };

  for (const dealer of allDealers) {
    const isNew = dealer.dealer_type === 'PROSPECTIVE';
    dealer.needToGrow = determineNeedToGrow(
      dealer.areaPotentialPercentile,
      dealer.counterShare,
      isNew,
      ntgThresholds
    );
  }

  // ──────────────────────────────────────────────
  // STAGE 5: FINAL CATEGORY (Classification)
  // Uses RSAR sales (currentSales, previousMonthSales, sameMonthLastYearSales, sixMonthAverage)
  // ──────────────────────────────────────────────
  console.log('[5/10] Classifying dealers (Final Category)...');
  for (const dealer of allDealers) {
    const classification = classifyDealer({
      dealerType: dealer.dealer_type || dealer.dealerType,
      custType: dealer.cust_type || dealer.custType,
      doa: dealer.doa,
      reportMonth,
      currentSales: dealer.currentSales,
      previousMonthSales: dealer.previousMonthSales,
      sameMonthLastYearSales: dealer.sameMonthLastYearSales,
      sixMonthAverage: dealer.dpSixMonthAverage,   // S — Dealer Performance (the dealer's own)
      needToGrow: dealer.needToGrow,
      status: dealer.status
    });
    dealer.finalCategory = classification.finalCategory;
    dealer.classificationReason = classification.reason;
    dealer.doaTier = classification.doaTier;
  }

  // ──────────────────────────────────────────────
  // STAGE 6: FINAL VOLUME
  // Prospective: SBG potential × 0.4 (may be 0 if sbg_potential=NULL)
  // Zero Lifter: S = the dealer's OWN 6-month average (Dealer Performance).
  // Using RSAR here would size a lapsed dealer by its sub-dealers' volume.
  // ──────────────────────────────────────────────
  console.log('[6/10] Calculating final volume...');
  for (const dealer of allDealers) {
    dealer.finalVolume = calculateFinalVolume(
      dealer.finalCategory,
      dealer.currentSales,
      dealer.sbg_potential,       // SBG potential — may be NULL (→ 0 in calculateFinalVolume)
      dealer.dpSixMonthAverage    // S — Dealer Performance
    );
  }

  // ──────────────────────────────────────────────
  // STAGE 7: AREA VOLUME / RANK / PERCENTILE / GRADE
  // Grade comes from calculateAreaGradeMetrics — NOT inline ad-hoc logic
  // ──────────────────────────────────────────────
  console.log('[7/10] Calculating area grade metrics...');
  const gradeThresholds = {
    catAMin: (rules.cat_a_min || 60) / 100,
    catBMin: (rules.cat_b_min || 40) / 100,
    catCMin: (rules.cat_c_min || 20) / 100
  };

  const areaGradeMetrics = calculateAreaGradeMetrics(allDealers, gradeThresholds);

  for (const dealer of allDealers) {
    const agm = areaGradeMetrics.get(dealer.dealerCode) || {};
    dealer.areaVolume = agm.areaVolume ?? 0;
    dealer.areaVolumeRank = agm.areaVolumeRank || 1;
    dealer.areaVolumePercentile = agm.areaVolumePercentile ?? 0;

    // Grade MUST come from areaGradeMetrics (Pareto percentile calculation)
    // NOT from ad-hoc inline rules like "if finalVolume >= 100 → A"
    // Churn dealers always get D (regardless of volume percentile)
    if (dealer.finalCategory === 'Churn') {
      dealer.grade = 'D';
    } else {
      dealer.grade = agm.grade || 'D';
    }
  }

  // ──────────────────────────────────────────────
  // STAGE 8: SO PRIORITY SCORING
  // Priority is INDEPENDENT of Area Grade
  // ──────────────────────────────────────────────
  console.log('[8/10] Calculating SO priority scores...');
  const scoreBVal = (rules && rules.score_b !== undefined) ? Number(rules.score_b) : 31;
  const scoreBConfig = { defaultValue: scoreBVal, score_b: scoreBVal };

  const priorityScores = calculateSOPriorityScores(allDealers, scoreBConfig);

  for (const dealer of allDealers) {
    const ps = priorityScores.get(dealer.dealerCode) || {};
    dealer.potentialRank = ps.potentialRank || 1;
    dealer.scoreA = ps.scoreA || 0;
    dealer.scoreB = ps.scoreB !== undefined ? ps.scoreB : scoreBVal;
    dealer.scoreC = ps.scoreC || 0;
    dealer.totalScore = ps.totalScore || (dealer.scoreA + dealer.scoreB + dealer.scoreC);
    dealer.priorityRank = ps.priorityRank || 1;
    // Priority label is derived from priorityRank and totalScore — independent of grade
    dealer.priorityLabel = getPriorityLabel(dealer.grade, dealer.priorityRank, dealer.totalScore, dealer.finalCategory, dealer.finalVolume);
  }

  // ──────────────────────────────────────────────
  // STAGE 9: VISIT FREQUENCIES
  // Visit matrix: A=4/2/1/0.5, B=3/1/0.5/0, C=3/1/0.5/0, D=2/0.5/0/0
  // Fractional values (0.5) are preserved exactly
  // ──────────────────────────────────────────────
  console.log('[9/10] Looking up visit frequencies...');
  const customMatrix = parseMatrixFromRules(rulesRaw);

  let visitErrors = 0;
  for (const dealer of allDealers) {
    try {
      const freq = getVisitFrequencies(dealer.finalCategory, dealer.grade, customMatrix);
      dealer.soVisits = freq.soVisits;    // may be 0.5
      dealer.asmVisits = freq.asmVisits;  // may be 0.5
      dealer.rsmVisits = freq.rsmVisits;  // may be 0.5
      dealer.zhVisits = freq.zhVisits;    // may be 0.5
    } catch (err) {
      visitErrors++;
      if (debug) console.warn(`  Visit freq error for ${dealer.dealerCode}: ${err.message}`);
      dealer.soVisits = 0;
      dealer.asmVisits = 0;
      dealer.rsmVisits = 0;
      dealer.zhVisits = 0;
    }
  }
  if (visitErrors > 0) {
    console.warn(`  ${visitErrors} dealers had visit frequency lookup errors`);
  }

  // ──────────────────────────────────────────────
  // STAGE 10: VALIDATION + BUILD RESULT OBJECTS
  // ──────────────────────────────────────────────
  console.log('[10/10] Validating results...');

  const results = allDealers.map(d => ({
    dealerCode: d.dealerCode,
    sap_code: d.sap_code,
    sfa_code: d.sfa_code,
    linked_dealer_code: d.linked_dealer_code,
    dealerName: d.dealerName || d.dealer_name,
    dealerId: d.dealerId || d.dealer_id || d.id,
    dealerType: d.dealerType || d.dealer_type,
    cust_type: d.cust_type || d.dealerType || d.dealer_type || 'RSAR',
    custType: d.cust_type || d.dealerType || d.dealer_type || 'RSAR',
    territoryCode: d.territory_code || d.territoryCode || null,
    territoryName: d.territory_name || d.territoryName || d.dm_area || null,

    // Authoritative source fields
    area: d.dm_area || d.area || null,        // Dealer Mapping Area
    dm_area: d.dm_area || d.area || null,
    block: d.sbg_block || null,               // SBG Block (NULL if not found)
    sbg_block: d.sbg_block || null,
    branch: d.branch || null,
    zone: d.zone || d.region || null,
    region: d.region || d.zone || null,

    // Hierarchy (from Dealer Mapping)
    soName: d.so_name,
    soEmpCode: d.so_emp_code,
    soCode: d.so_emp_code || d.soCode || null,
    asmName: d.asm_name,
    asmCode: d.asm_code,
    rsmName: d.rsm_name,
    rsmCode: d.rsm_code || null,
    zhName: d.zh_name,
    zhCode: d.zh_code || null,

    // Calculation context
    planningMonth: calcContext.planningMonth,
    salesAnchorPeriod: calcContext.salesAnchorPeriod,
    currentSalesPeriod: calcContext.currentSalesPeriod,
    previousSalesPeriod: calcContext.previousSalesPeriod,
    lysmSalesPeriod: calcContext.lysmSalesPeriod,
    sixMonthPeriods: calcContext.sixMonthPeriods,

    // SBG authoritative potential (may be NULL)
    potential: d.sbg_potential ?? null,
    sbg_potential: d.sbg_potential ?? null,

    // RSAR sales metrics (all from RSAR only)
    previousSales: d.previousSales || 0,
    currentSales: d.currentSales || 0,
    lysmSales: d.lysmSales || 0,
    previousMonthSales: d.previousSales || 0,
    sameMonthLastYearSales: d.lysmSales || 0,
    rsarSixMonthTotal: d.rsarSixMonthTotal || 0,
    rsarSixMonthAverage: d.rsarSixMonthAverage || 0,
    // Backward compatibility alias
    sixMonthTotal: d.rsarSixMonthTotal || 0,
    sixMonthAverage: d.dpSixMonthAverage || 0,

    // DP metrics (independent of RSAR)
    dpSixMonthAverage: d.dpSixMonthAverage || 0,

    // Source statuses
    sbg_status: d.sbg_status || d.sbgStatus || 'SBG_NOT_FOUND',
    rsar_status: d.rsar_status || d.rsarStatus || 'RSAR_NOT_FOUND',
    dp_status: d.dp_status || 'DP_NOT_FOUND',
    prospect_status: d.prospect_status || 'PROSPECT_NOT_FOUND',

    counterShare: d.counterShare,
    doa: d.doa || null,
    status: d.status || 'ACTIVE',

    areaPotential: d.areaPotential,
    areaPotentialRank: d.areaPotentialRank,
    areaPotentialPercentile: d.areaPotentialPercentile,

    needToGrow: d.needToGrow,

    finalCategory: d.finalCategory,
    classificationReason: d.classificationReason,
    finalVolume: d.finalVolume,

    areaVolume: d.areaVolume,
    areaVolumeRank: d.areaVolumeRank,
    areaVolumePercentile: d.areaVolumePercentile,
    grade: d.grade,

    potentialRank: d.potentialRank,
    scoreA: d.scoreA,
    scoreB: d.scoreB,
    scoreC: d.scoreC,
    totalScore: d.totalScore,
    priorityRank: d.priorityRank,
    priorityLabel: d.priorityLabel,

    soVisits: d.soVisits,    // fractional preserved (e.g. 0.5)
    asmVisits: d.asmVisits,
    rsmVisits: d.rsmVisits,
    zhVisits: d.zhVisits
  }));

  const validation = validatePjpResults(results);
  const integrity = validatePjpIntegrity(allDealers, results);

  // ──────────────────────────────────────────────
  // DIAGNOSTIC LOG (Section 25 — all required fields)
  // ──────────────────────────────────────────────
  const sampleDealers = results.slice(0, 15);
  const diagnosticRows = [];
  for (const d of sampleDealers) {
    diagnosticRows.push({
      'Dealer Code':    d.dealerCode,
      'Dealer Name':    d.dealerName,
      'DM Match':       d.sap_code ? 'YES' : 'NO',
      'SBG Match':      d.sbg_status === 'SBG_MATCHED' ? 'YES' : 'NO',
      'RSAR Match':     d.rsar_status === 'RSAR_MATCHED' ? 'YES' : 'NO',
      'DP Match':       d.dp_status === 'DP_MATCHED' ? 'YES' : 'NO',
      'Area Src':       'Dealer Mapping',
      'Area':           d.area,
      'Block Src':      d.sbg_status === 'SBG_MATCHED' ? 'SBG' : 'NULL',
      'Block':          d.block || 'NULL',
      'Pot Src':        d.sbg_status === 'SBG_MATCHED' ? 'SBG' : 'NULL',
      'SBG Potential':  d.sbg_potential !== null ? d.sbg_potential : 'NULL',
      'DP 6M Avg':      d.dpSixMonthAverage,
      'RSAR 6M Avg':    d.rsarSixMonthAverage,
      'Current Sales':  d.currentSales,
      'Prev Sales':     d.previousSales,
      'LYSM':           d.lysmSales,
      'Category':       d.finalCategory,
      'Final Volume':   d.finalVolume,
      'Grade':          d.grade,
      'Priority Rank':  d.priorityRank,
      'Priority Label': d.priorityLabel,
      'SO Visits':      d.soVisits,
      'ASM Visits':     d.asmVisits,
      'RSM Visits':     d.rsmVisits,
      'ZH Visits':      d.zhVisits,
    });
  }

  if (diagnosticRows.length > 0) {
    console.log('\n================================================================');
    console.log('CANONICAL PJP — FIELD-BY-FIELD DIAGNOSTIC (Section 25)');
    console.log('================================================================');
    console.table(diagnosticRows);
  }

  // ──────────────────────────────────────────────
  // PERSIST (optional)
  // ──────────────────────────────────────────────
  if (persist) {
    console.log('Persisting PJP results...');
    await persistPjpResults(results, reportMonth, cycleCode, generationRunCode);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

  const stats = {
    totalDealers: results.length,
    dealerMappingCount: results.length,
    sbgNotFoundCount: results.filter(r => r.sbg_status === 'SBG_NOT_FOUND').length,
    rsarNotFoundCount: results.filter(r => r.rsar_status === 'RSAR_NOT_FOUND').length,
    byCategory: {},
    byGrade: {},
    totalSoVisits: 0,
    totalAsmVisits: 0,
    totalRsmVisits: 0,
    totalZhVisits: 0,
    validationErrors: validation.totalErrors,
    duplicates: validation.totalDuplicates,
    elapsed: `${elapsed}s`
  };

  for (const r of results) {
    stats.byCategory[r.finalCategory] = (stats.byCategory[r.finalCategory] || 0) + 1;
    stats.byGrade[r.grade] = (stats.byGrade[r.grade] || 0) + 1;
    stats.totalSoVisits += r.soVisits || 0;
    stats.totalAsmVisits += r.asmVisits || 0;
    stats.totalRsmVisits += r.rsmVisits || 0;
    stats.totalZhVisits += r.zhVisits || 0;
  }

  console.log(`\n================================================================`);
  console.log(`PJP CALCULATION COMPLETE`);
  console.log(`  Dealers: ${stats.totalDealers} (from Dealer Mapping)`);
  console.log(`  SBG Not Found: ${stats.sbgNotFoundCount} (potential=NULL, block=NULL)`);
  console.log(`  RSAR Not Found: ${stats.rsarNotFoundCount}`);
  console.log(`  Categories: ${JSON.stringify(stats.byCategory)}`);
  console.log(`  Grades: ${JSON.stringify(stats.byGrade)}`);
  console.log(`  SO: ${stats.totalSoVisits} | ASM: ${stats.totalAsmVisits} | RSM: ${stats.totalRsmVisits} | ZH: ${stats.totalZhVisits}`);
  console.log(`  Validation errors: ${stats.validationErrors} | Duplicates: ${stats.duplicates}`);
  console.log(`  Time: ${stats.elapsed}`);
  console.log(`================================================================\n`);

  return { results, validation, stats, calcContext };
}

/**
 * Persist canonical PJP results to dealer_visit_targets.
 * Uses DELETE + INSERT for atomicity within this period/cycle.
 * 
 * Column mapping:
 *   category     → grade (A/B/C/D)
 *   dealer_status → finalCategory (Growing, De-growing, etc.)
 *   priority     → priorityRank (numeric rank)
 *   priority_label → priorityLabel (High/Medium/Low)
 *   dm_area      → authoritative Dealer Mapping area
 *   sbg_block    → authoritative SBG block
 *   sbg_potential → authoritative SBG potential
 */
async function persistPjpResults(results, reportMonth, cycleCode, generationRunCode = null) {
  await dbRun(
    'DELETE FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = ?',
    [reportMonth, cycleCode]
  );

  const processedKeys = new Set();
  let insertCount = 0;

  for (const r of results) {
    const key = `${reportMonth}_${cycleCode}_${r.dealerCode}`;
    if (processedKeys.has(key)) continue;
    processedKeys.add(key);

    const totalVisits = (r.soVisits || 0) + (r.asmVisits || 0) + (r.rsmVisits || 0) + (r.zhVisits || 0);
    const soVisitsPct = totalVisits > 0 ? Math.round((r.soVisits / totalVisits) * 10000) / 100 : 0;
    const asmVisitsPct = totalVisits > 0 ? Math.round((r.asmVisits / totalVisits) * 10000) / 100 : 0;
    const rsmVisitsPct = totalVisits > 0 ? Math.round((r.rsmVisits / totalVisits) * 10000) / 100 : 0;
    const zhVisitsPct = totalVisits > 0 ? Math.round((r.zhVisits / totalVisits) * 10000) / 100 : 0;

    await dbRun(
      `INSERT INTO dealer_visit_targets 
      (generation_run_code, period_month, cycle_code, dealer_id, dealer_name, sap_code, sfa_code,
       area, dm_area, block, sbg_block, branch, zone, region, cust_type,
       territory_code, territory_name, so_code, so_name, so_emp_code,
       asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code,
       potential, sbg_potential, previous_sales, current_sales, lysm_sales,
       rsar_six_month_avg, dp_six_month_avg, final_volume,
       counter_share, need_to_grow,
       area_potential, area_potential_rank, area_potential_percentile,
       area_volume, area_volume_rank, area_volume_percentile,
       potential_rank, doa,
       score_a, score_b, score_c, total_score,
       priority, priority_label,
       category, dealer_status, grade,
       sbg_status, rsar_status, dp_status, prospect_status,
       so_visits, asm_visits, rsm_visits, zh_visits, total_visits,
       so_visits_pct, asm_visits_pct, rsm_visits_pct, zh_visits_pct)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generationRunCode,
        reportMonth, cycleCode, r.dealerId, r.dealerName,
        r.sap_code || null, r.sfa_code || null,
        r.area || null,         // dm_area as area
        r.dm_area || null,      // dm_area dedicated column
        r.block || null,        // sbg_block as block
        r.sbg_block || null,    // sbg_block dedicated column
        r.branch || null,
        r.zone || null, r.region || null,
        r.cust_type || 'RSAR',
        r.territoryCode || null, r.territoryName || null,
        r.soCode || r.soEmpCode || null, r.soName || null, r.soEmpCode || null,
        r.asmName || null, r.asmCode || null,
        r.rsmName || null, r.rsmCode || null,
        r.zhName || null, r.zhCode || null,
        // Potential: sbg_potential (may be NULL — store as-is)
        r.sbg_potential !== null ? r.sbg_potential : null,
        r.sbg_potential !== null ? r.sbg_potential : null,
        r.previousSales || 0, r.currentSales || 0, r.lysmSales || 0,
        r.rsarSixMonthAverage || 0,  // RSAR 6M avg
        r.dpSixMonthAverage || 0,    // DP 6M avg (independent)
        r.finalVolume || 0,
        r.counterShare || 0,
        r.needToGrow ? 1 : 0,
        r.areaPotential || 0,
        r.areaPotentialRank || 1,
        r.areaPotentialPercentile || 0,
        r.areaVolume || 0,
        r.areaVolumeRank || 1,
        r.areaVolumePercentile || 0,
        r.potentialRank || 1,
        r.doa || null,
        r.scoreA ?? 0, r.scoreB ?? 0, r.scoreC ?? 0, r.totalScore ?? 0,
        r.priorityRank || 0,   // priority = numeric rank
        r.priorityLabel || 'Medium',  // priority_label = text label
        r.grade,               // category = grade (A/B/C/D)
        r.finalCategory,       // dealer_status = final category
        r.grade,               // grade column
        r.sbg_status || 'SBG_NOT_FOUND',
        r.rsar_status || 'RSAR_NOT_FOUND',
        r.dp_status || 'DP_NOT_FOUND',
        r.prospect_status || 'PROSPECT_NOT_FOUND',
        r.soVisits, r.asmVisits, r.rsmVisits, r.zhVisits, totalVisits,
        soVisitsPct, asmVisitsPct, rsmVisitsPct, zhVisitsPct
      ]
    );
    insertCount++;
  }

  console.log(`  Persisted ${insertCount} dealer visit targets.`);
}
