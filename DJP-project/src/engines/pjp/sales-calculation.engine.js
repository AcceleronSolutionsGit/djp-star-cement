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
export function buildCalculationContext(planningMonth, latestAvailableSalesPeriod = null) {
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

  // Previous closed month relative to the planning month (e.g. August for September plan)
  let planPrevYear = planYear;
  let planPrevMonth = planMonthNum - 1;
  if (planPrevMonth < 1) { planPrevMonth = 12; planPrevYear--; }
  const planPreviousMonth = `${planPrevYear}-${String(planPrevMonth).padStart(2, '0')}`;

  // Definitive Sales-Period Algorithm:
  // For the planning month (e.g. September), calculations are anchored on the previous closed month (August).
  // salesAnchorPeriod = min(planPreviousMonth, latestAvailableSalesPeriod)
  let salesAnchorPeriod;
  if (latestAvailableSalesPeriod) {
    const anchorMatch = String(latestAvailableSalesPeriod).match(/^(\d{4})-(\d{2})$/);
    if (!anchorMatch) {
      throw new Error(`Invalid latestAvailableSalesPeriod format: '${latestAvailableSalesPeriod}'. Expected YYYY-MM.`);
    }
    const formattedLatest = `${anchorMatch[1]}-${anchorMatch[2]}`;
    salesAnchorPeriod = formattedLatest < planPreviousMonth ? formattedLatest : planPreviousMonth;
  } else {
    salesAnchorPeriod = planPreviousMonth;
  }

  const [salesYear, salesMonthNum] = salesAnchorPeriod.split('-').map(Number);
  const currentSalesPeriod = salesAnchorPeriod;

  // Previous month relative to sales anchor
  let prevYear = salesYear;
  let prevMonth = salesMonthNum - 1;
  if (prevMonth < 1) { prevMonth = 12; prevYear--; }
  const previousSalesPeriod = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  // Same month last year (LYSM) relative to sales anchor
  const lysmSalesPeriod = `${salesYear - 1}-${String(salesMonthNum).padStart(2, '0')}`;

  // Last 6 consecutive months ending at salesAnchorPeriod
  const sixMonthPeriods = [];
  for (let i = 0; i < 6; i++) {
    let m = salesMonthNum - i;
    let y = salesYear;
    while (m < 1) { m += 12; y--; }
    sixMonthPeriods.push(`${y}-${String(m).padStart(2, '0')}`);
  }

  const allRequiredPeriods = new Set([
    currentSalesPeriod,
    previousSalesPeriod,
    lysmSalesPeriod,
    ...sixMonthPeriods
  ]);

  return {
    planningMonth: formattedPlanMonth,
    salesAnchorPeriod,
    latestAvailableSalesPeriod: salesAnchorPeriod,
    currentSalesPeriod,
    previousSalesPeriod,
    lysmSalesPeriod,
    sixMonthPeriods,
    allRequiredPeriods: [...allRequiredPeriods],
    // Backward compatibility aliases
    currentPeriod: currentSalesPeriod,
    previousMonthPeriod: previousSalesPeriod,
    lysmPeriod: lysmSalesPeriod,
    last6Periods: sixMonthPeriods
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
