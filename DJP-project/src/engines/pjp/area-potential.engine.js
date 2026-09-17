/**
 * PJP Area Potential Engine
 *
 * Population-level area calculations:
 * - Area Potential = SUM(potential of all dealers in area)
 * - Area Potential Rank = competition ranking within area by potential
 * - Area Potential Percentile = cumulative Pareto-style percentile
 * - Need to Grow determination
 */

/**
 * Normalize area name for consistent grouping.
 * Trims whitespace and converts to uppercase for comparison.
 * Does NOT merge genuinely different area names.
 * @param {string} area
 * @returns {string} normalized area key
 */
export function normalizeArea(area) {
  if (!area || typeof area !== 'string') return '__UNKNOWN_AREA__';
  return area.trim().toUpperCase();
}

const pot = d => d.potential ?? 0;

/**
 * Calculate Area Potential, Area Potential Rank, and Area Potential Percentile
 * for all dealers.
 *
 * PERFORMANCE — this used to be O(N³) per area group. Rank was recomputed with a
 * full scan for every dealer, and the percentile then recomputed that rank again
 * for every dealer inside a filter over every dealer. On the real population
 * (60 areas, ~29k dealers, the largest area holding ~1,380) that measured at about
 * 2.4 minutes per cycle — 4.7 minutes for C1 + C2 — in this function alone, which
 * pushed the first generate past Node's 5-minute request timeout and left the
 * browser with a dead socket instead of a JSON response.
 *
 * It now sorts once and walks suffix sums, the same technique already used in
 * area-grade.engine.js. Same numbers, O(N log N).
 *
 * @param {Array<Object>} dealers - array of dealer objects with { dealerCode, area, potential }
 * @returns {Map<string, Object>} dealerCode -> { areaPotential, areaPotentialRank, areaPotentialPercentile }
 */
export function calculateAreaPotentialMetrics(dealers) {
  const result = new Map();

  // Group dealers by normalized area
  const areaGroups = new Map();
  for (const d of dealers) {
    // Area grouping uses dm_area (Dealer Mapping authoritative Area)
    // d.area is always set to dm_area by the PJP engine before calling this function
    const areaKey = normalizeArea(d.area || d.dm_area);
    if (!areaGroups.has(areaKey)) areaGroups.set(areaKey, []);
    areaGroups.get(areaKey).push(d);
  }

  for (const [, group] of areaGroups.entries()) {
    // Area Potential = sum of all dealer SBG potential in area
    // d.potential is set to d.sbg_potential by the PJP engine
    // Dealers with NULL sbg_potential contribute 0 to area potential sum
    // (NULL = SBG not found; not the same as zero potential)
    const areaPotential = group.reduce((sum, d) => sum + pot(d), 0);

    // Sort descending by potential so rank and suffix sums fall out of one pass
    const sorted = [...group].sort((a, b) => pot(b) - pot(a));

    // Area Potential Rank: COUNTIFS(Area = current, Potential > current) + 1
    // Higher potential = rank 1 (best). Ties share the rank of the first of their value,
    // which is exactly what "count of strictly greater, plus one" produces.
    const ranks = new Array(sorted.length);
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && pot(sorted[i]) < pot(sorted[i - 1])) currentRank = i + 1;
      ranks[i] = currentRank;
    }

    // suffixSums[i] = total potential from index i to the end of the sorted group
    const suffixSums = new Array(sorted.length);
    let running = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      running += pot(sorted[i]);
      suffixSums[i] = running;
    }

    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i];
      const areaPotentialRank = ranks[i];

      // Area Potential Percentile (cumulative Pareto-style):
      // SUM(Potential for dealers whose rank >= current rank) / Area Potential
      // rank >= current rank means all dealers with equal or lower potential
      // (i.e., current dealer + all dealers ranked after it).
      // Since rank = (count strictly greater) + 1, the first dealer holding this
      // rank sits at index (rank - 1), so the suffix sum from there is that total.
      const sumForRankGte = suffixSums[areaPotentialRank - 1] ?? 0;
      const areaPotentialPercentile = areaPotential > 0 ? sumForRankGte / areaPotential : 0;

      result.set(d.dealerCode, {
        areaPotential,
        areaPotentialRank,
        areaPotentialPercentile
      });
    }
  }

  return result;
}

/**
 * Determine Need to Grow for a dealer.
 *
 * Need to Grow = YES if:
 *   Area Potential Percentile > 60% (0.60)
 *   AND Counter Share < 20% (0.20)
 *   AND dealer is NOT New (DOA != New / not Prospective)
 *
 * @param {number} areaPotentialPercentile - 0 to 1
 * @param {number} counterShare - 0 to 1
 * @param {boolean} isNew - whether dealer is new/prospective
 * @param {Object} thresholds - { ntgMinPercentile: 0.60, ntgMaxShare: 0.20 }
 * @returns {boolean}
 */
export function determineNeedToGrow(areaPotentialPercentile, counterShare, isNew, thresholds = {}) {
  const minPercentile = thresholds.ntgMinPercentile ?? 0.60;
  const maxShare = thresholds.ntgMaxShare ?? 0.20;

  if (isNew) return false;

  // Safely handle nulls
  const percentile = areaPotentialPercentile ?? 0;
  const share = counterShare ?? 0;

  return percentile > minPercentile && share < maxShare;
}
