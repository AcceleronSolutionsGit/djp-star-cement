/**
 * PJP Sales Calculation Engine
 * 
 * Provides period utilities and sales aggregation.
 * Given a reportMonth (YYYY-MM), dynamically calculates comparison periods
 * and aggregates sales data per dealer.
 */

/**
 * Calculate all required period identifiers from a report month.
 * @param {string} reportMonth - Format YYYY-MM
 * @returns {Object} period identifiers
 */
export function calculatePeriods(reportMonth) {
  let [year, month] = reportMonth.split('-').map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error(`Invalid reportMonth: ${reportMonth}. Expected YYYY-MM format.`);
  }

  // All month-based calculations derive strictly relative to reportMonth
  const currentPeriod = `${year}-${String(month).padStart(2, '0')}`;

  // Previous month
  let prevYear = year;
  let prevMonth = month - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear--; }
  const previousMonthPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  // Same month last year (LYSM)
  const lysmPeriod = `${year - 1}-${String(month).padStart(2, '0')}`;

  // Last 6 months up to and including reportMonth (Jan-26 through Jun-26)
  const last6Periods = [];
  for (let i = 0; i < 6; i++) {
    let m = month - i;
    let y = year;
    while (m < 1) { m += 12; y--; }
    last6Periods.push(`${y}-${String(m).padStart(2, '0')}`);
  }

  // All periods needed for loading
  const allRequiredPeriods = new Set([
    currentPeriod,
    previousMonthPeriod,
    lysmPeriod,
    ...last6Periods
  ]);

  return {
    currentPeriod,
    previousMonthPeriod,
    lysmPeriod,
    last6Periods,
    allRequiredPeriods: [...allRequiredPeriods]
  };
}

/**
 * Build authoritative calculation context separating Planning Month from Sales Anchor Month.
 * 
 * @param {string} planningMonth - The month being planned/scheduled (YYYY-MM)
 * @param {string} salesAnchorMonth - The latest available sales month to anchor calculations on (YYYY-MM)
 * @returns {Object} authoritative calculation context
 */
export function buildCalculationContext(planningMonth, latestAvailableRsarPeriod = null) {
  if (!planningMonth || typeof planningMonth !== 'string') {
    throw new Error(`Invalid planningMonth: '${planningMonth}'. Expected YYYY-MM format.`);
  }
  const planMatch = planningMonth.match(/^(\d{4})-(\d{2})$/);
  if (!planMatch) {
    throw new Error(`Invalid planningMonth format: '${planningMonth}'. Expected YYYY-MM.`);
  }
  const planYear = parseInt(planMatch[1], 10);
  const planMonthNum = parseInt(planMatch[2], 10);
  if (planMonthNum < 1 || planMonthNum > 12) {
    throw new Error(`Invalid planningMonth: '${planningMonth}'. Month must be 01-12.`);
  }
  const formattedPlanMonth = `${planYear}-${String(planMonthNum).padStart(2, '0')}`;

  // Previous closed month relative to planning month (M - 1)
  let planPrevYear = planYear;
  let planPrevMonth = planMonthNum - 1;
  if (planPrevMonth < 1) { planPrevMonth = 12; planPrevYear--; }
  const planPreviousMonth = `${planPrevYear}-${String(planPrevMonth).padStart(2, '0')}`;

  // Penultimate closed month relative to planning month (M - 2)
  let planPenultYear = planPrevYear;
  let planPenultMonth = planPrevMonth - 1;
  if (planPenultMonth < 1) { planPenultMonth = 12; planPenultYear--; }
  const planPenultimateMonth = `${planPenultYear}-${String(planPenultMonth).padStart(2, '0')}`;

  // ─────────────────────────────────────────────────────────────────────────
  // 1. DEALER PERFORMANCE (DLRWISE / Direct Dealer Sales)
  // Direct Dealer Performance is ALWAYS anchored on the immediate previous month (M - 1).
  // Column O = M-1 Sales, Column R = M-2 Sales, Column Q = M-1 LYSM, Column S = 6M Avg ending at M-1.
  // ─────────────────────────────────────────────────────────────────────────
  const dpAnchorPeriod = planPreviousMonth;
  const dpCurrentSalesPeriod = dpAnchorPeriod;

  // Previous month relative to DP anchor (M - 2)
  let dpPrevYear = planPrevYear;
  let dpPrevM = planPrevMonth - 1;
  if (dpPrevM < 1) { dpPrevM = 12; dpPrevYear--; }
  const dpPreviousSalesPeriod = `${dpPrevYear}-${String(dpPrevM).padStart(2, '0')}`;

  // LYSM relative to DP anchor (M - 1 of prior year)
  const dpLysmSalesPeriod = `${planPrevYear - 1}-${String(planPrevMonth).padStart(2, '0')}`;

  // Last 6 consecutive months ending at dpAnchorPeriod (M - 1)
  const dpSixMonthPeriods = [];
  for (let i = 0; i < 6; i++) {
    let m = planPrevMonth - i;
    let y = planPrevYear;
    while (m < 1) { m += 12; y--; }
    dpSixMonthPeriods.push(`${y}-${String(m).padStart(2, '0')}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 2. RSAR (SUB-DEALER RETAIL SALES) CONTEXT
  // Only RSAR can have data till penultimate month (M - 2), or M - 1 if available.
  // ─────────────────────────────────────────────────────────────────────────
  let rsarAnchorPeriod;
  if (latestAvailableRsarPeriod) {
    const anchorMatch = String(latestAvailableRsarPeriod).match(/^(\d{4})-(\d{2})$/);
    if (!anchorMatch) {
      throw new Error(`Invalid latestAvailableRsarPeriod format: '${latestAvailableRsarPeriod}'. Expected YYYY-MM.`);
    }
    const formattedLatest = `${anchorMatch[1]}-${anchorMatch[2]}`;
    rsarAnchorPeriod = formattedLatest < planPreviousMonth ? formattedLatest : planPreviousMonth;
  } else {
    // Default RSAR anchor to penultimate month (M - 2)
    rsarAnchorPeriod = planPenultimateMonth;
  }

  const [rsarYear, rsarMonthNum] = rsarAnchorPeriod.split('-').map(Number);
  const rsarCurrentSalesPeriod = rsarAnchorPeriod;

  // Previous month relative to RSAR anchor
  let rsarPrevYear = rsarYear;
  let rsarPrevM = rsarMonthNum - 1;
  if (rsarPrevM < 1) { rsarPrevM = 12; rsarPrevYear--; }
  const rsarPreviousSalesPeriod = `${rsarPrevYear}-${String(rsarPrevM).padStart(2, '0')}`;

  // LYSM relative to RSAR anchor
  const rsarLysmSalesPeriod = `${rsarYear - 1}-${String(rsarMonthNum).padStart(2, '0')}`;

  // Last 6 consecutive months ending at rsarAnchorPeriod
  const rsarSixMonthPeriods = [];
  for (let i = 0; i < 6; i++) {
    let m = rsarMonthNum - i;
    let y = rsarYear;
    while (m < 1) { m += 12; y--; }
    rsarSixMonthPeriods.push(`${y}-${String(m).padStart(2, '0')}`);
  }

  // Union of all periods needed for loading both DP and RSAR
  const allRequiredPeriods = new Set([
    dpCurrentSalesPeriod,
    dpPreviousSalesPeriod,
    dpLysmSalesPeriod,
    ...dpSixMonthPeriods,
    rsarCurrentSalesPeriod,
    rsarPreviousSalesPeriod,
    rsarLysmSalesPeriod,
    ...rsarSixMonthPeriods
  ]);

  const dpContext = {
    anchorPeriod: dpAnchorPeriod,
    currentSalesPeriod: dpCurrentSalesPeriod,
    previousSalesPeriod: dpPreviousSalesPeriod,
    lysmSalesPeriod: dpLysmSalesPeriod,
    sixMonthPeriods: dpSixMonthPeriods,
    currentPeriod: dpCurrentSalesPeriod,
    previousMonthPeriod: dpPreviousSalesPeriod,
    lysmPeriod: dpLysmSalesPeriod,
    last6Periods: dpSixMonthPeriods
  };

  const rsarContext = {
    anchorPeriod: rsarAnchorPeriod,
    currentSalesPeriod: rsarCurrentSalesPeriod,
    previousSalesPeriod: rsarPreviousSalesPeriod,
    lysmSalesPeriod: rsarLysmSalesPeriod,
    sixMonthPeriods: rsarSixMonthPeriods,
    currentPeriod: rsarCurrentSalesPeriod,
    previousMonthPeriod: rsarPreviousSalesPeriod,
    lysmPeriod: rsarLysmSalesPeriod,
    last6Periods: rsarSixMonthPeriods
  };

  return {
    planningMonth: formattedPlanMonth,
    planPreviousMonth,
    planPenultimateMonth,

    // Dealer Performance context (anchored at M - 1)
    dpAnchorPeriod,
    dpCurrentSalesPeriod,
    dpPreviousSalesPeriod,
    dpLysmSalesPeriod,
    dpSixMonthPeriods,
    dpContext,

    // RSAR context (anchored at M - 2 or latest RSAR)
    rsarAnchorPeriod,
    rsarCurrentSalesPeriod,
    rsarPreviousSalesPeriod,
    rsarLysmSalesPeriod,
    rsarSixMonthPeriods,
    rsarContext,

    // Union of all periods needed for batch database loading
    allRequiredPeriods: [...allRequiredPeriods],

    // Primary dealer sales metrics come from Dealer Performance (DLRWISE)
    salesAnchorPeriod: dpAnchorPeriod,
    latestAvailableSalesPeriod: rsarAnchorPeriod,
    currentSalesPeriod: dpCurrentSalesPeriod,
    previousSalesPeriod: dpPreviousSalesPeriod,
    lysmSalesPeriod: dpLysmSalesPeriod,
    sixMonthPeriods: dpSixMonthPeriods,
    // Backward compatibility aliases
    currentPeriod: dpCurrentSalesPeriod,
    previousMonthPeriod: dpPreviousSalesPeriod,
    lysmPeriod: dpLysmSalesPeriod,
    last6Periods: dpSixMonthPeriods
  };
}

/**
 * Aggregate sales data for each dealer from raw sales history records.
 * @param {Map<string, Array>} salesByDealer - dealerCode -> [{period_year_month, quantity_mt}]
 * @param {Object} periods - from calculatePeriods() or buildCalculationContext()
 * @returns {Map<string, Object>} dealerCode -> aggregated sales object
 */
export function aggregateDealerSales(salesByDealer, periods) {
  const result = new Map();

  const currentKey = periods.currentSalesPeriod || periods.currentPeriod;
  const prevKey = periods.previousSalesPeriod || periods.previousMonthPeriod;
  const lysmKey = periods.lysmSalesPeriod || periods.lysmPeriod;
  const sixMonthList = periods.sixMonthPeriods || periods.last6Periods || [];

  for (const [dealerCode, records] of salesByDealer.entries()) {
    // Build period->quantity map
    const periodMap = new Map();
    for (const rec of records) {
      const existing = periodMap.get(rec.period_year_month) || 0;
      periodMap.set(rec.period_year_month, existing + (rec.quantity_mt || 0));
    }

    const currentSales = periodMap.get(currentKey) || 0;
    const previousSales = periodMap.get(prevKey) || 0;
    const lysmSales = periodMap.get(lysmKey) || 0;

    // 6-month total and average (ending at salesAnchorPeriod)
    let sixMonthTotal = 0;
    let sixMonthCount = 0;
    for (const p of sixMonthList) {
      const val = periodMap.get(p) || 0;
      sixMonthTotal += val;
      sixMonthCount++;
    }
    const sixMonthAverage = sixMonthCount > 0 ? sixMonthTotal / sixMonthCount : 0;

    result.set(dealerCode, {
      currentSales,
      previousSales,
      previousMonthSales: previousSales,
      lysmSales,
      sameMonthLastYearSales: lysmSales,
      sixMonthTotal,
      sixMonthAverage
    });
  }

  return result;
}

/**
 * Calculate Counter Share for a dealer.
 * Counter Share % = Current Sales / Counter Potential
 * @param {number} currentSales 
 * @param {number} potential 
 * @returns {number} counter share (0-1 scale, or 0 if potential is invalid)
 */
export function calculateCounterShare(currentSales, potential) {
  if (!potential || potential <= 0 || !isFinite(potential)) return 0;
  if (currentSales == null || !isFinite(currentSales) || currentSales < 0) return 0;
  const share = currentSales / potential;
  return isFinite(share) ? share : 0;
}
