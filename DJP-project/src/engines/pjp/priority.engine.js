/**
 * PJP Priority Engine (Canonical)
 * 
 * SO-wise priority scoring:
 * - SO Counter Potential Rank
 * - Score A = (potentialRank / maxRank) × 40
 * - Score B = configurable category score
 * - Score C = inverted counter-share ranking × 20
 * - Total Score = A + B + C (max 100)
 * - SO-wise Priority Rank (higher score = higher priority = rank 1)
 */

/**
 * Calculate SO-wise priority scores and ranks for all dealers.
 * 
 * SOURCE RULES (per reference M.xlsx, Row 2 source attribution):
 *   - Score A potential rank uses sbg_potential (DLR Counter Potential from SBG / Market Mapping)
 *     Reference M.xlsx Row 2 shows 'MARKET MAPPING (SBG)' over 'DLR COUNTER POTENTIAL' column
 *     d.potential is an alias for d.sbg_potential set in data-loader.engine.js
 *   - Score B = 31 (fixed, from business rules)
 *   - Score C = based on current sales rank within SO (inverted: more sales = lower rank = lower score C)
 *     Formula: scoreC = ((COUNTIFS(same SO, currentSales > d.currentSales) + 1) / groupSize) * 20
 * 
 * @param {Array<Object>} dealers - array with { dealerCode, so_emp_code, potential/sbg_potential, currentSales, finalCategory }
 * @param {Object} scoreBConfig - { defaultValue: 31, score_b: 31 }
 * @returns {Map<string, Object>} dealerCode -> { potentialRank, scoreA, scoreB, scoreC, totalScore, priorityRank }
 */
export const DEFAULT_CATEGORY_SCORES = {
  'Zero lifter': 40,
  'Zero Lifter': 40,
  'Prospective': 30,
  'Need to Grow': 25,
  'De-growing': 20,
  'Growing': 10,
  'Churn': 0
};

export function calculateSOPriorityScores(dealers, scoreBConfig = {}) {
  const result = new Map();

  // Configured Score B (reference output demonstrates applicable value is 31)
  const defaultScoreBVal = typeof scoreBConfig === 'number' 
    ? scoreBConfig 
    : (scoreBConfig.score_b !== undefined ? Number(scoreBConfig.score_b) : (scoreBConfig.defaultValue !== undefined ? Number(scoreBConfig.defaultValue) : 31));

  // Group dealers by SO
  // Handles both camelCase (soEmpCode/soName) and snake_case (so_emp_code/so_name) field names
  const soGroups = new Map();
  for (const d of dealers) {
    const soKey = d.soEmpCode || d.so_emp_code || d.soName || d.so_name || '__UNKNOWN_SO__';
    if (!soGroups.has(soKey)) soGroups.set(soKey, []);
    soGroups.get(soKey).push(d);
  }

  for (const [soKey, group] of soGroups.entries()) {
    // Score A potential rank: uses sbg_potential = DLR Counter Potential from SBG (Market Mapping)
    // Reference column: 'Rank based on counter potential (SO wise)' derived from 'DLR COUNTER POTENTIAL'
    // Source per M.xlsx Row 2: MARKET MAPPING (SBG)
    // d.potential is set to d.sbg_potential in data-loader.engine.js
    // Formula: COUNTIFS(same SO, potential < d.potential) + 1
    for (const d of group) {
      // Use sbg_potential (d.potential alias) — authoritative SBG DLR counter potential
      const dPotential = parseFloat(d.potential ?? d.sbg_potential) || 0;
      const smallerPotentialCount = group.filter(x => (parseFloat(x.potential ?? x.sbg_potential) || 0) < dPotential).length;
      d._potentialRank = smallerPotentialCount + 1;
    }

    const maxPotentialRank = Math.max(...group.map(d => d._potentialRank), 1);

    for (const d of group) {
      // Score A: Potential Rank / Maximum Potential Rank * 40
      const sA = maxPotentialRank > 0 ? (d._potentialRank / maxPotentialRank) * 40 : 0;

      // Score B: configured Score B based on category (Out of 40)
      let sB = DEFAULT_CATEGORY_SCORES[d.finalCategory];
      if (sB === undefined) {
        if (typeof scoreBConfig === 'object' && scoreBConfig[d.finalCategory] !== undefined) {
          sB = Number(scoreBConfig[d.finalCategory]);
        } else {
          sB = defaultScoreBVal;
        }
      }

      // Score C: current-sales ranking per spec §18 & §29
      const higherSalesCount = group.filter(x => (x.currentSales || 0) > (d.currentSales || 0)).length;
      const sC = group.length > 0 ? ((higherSalesCount + 1) / group.length) * 20 : 0;

      const totalScore = sA + sB + sC;

      result.set(d.dealerCode, {
        potentialRank: d._potentialRank,
        scoreA: Math.round(sA * 100) / 100,
        scoreB: sB,
        scoreC: Math.round(sC * 100) / 100,
        totalScore: Math.round(totalScore * 100) / 100
      });
    }

    // SO-wise Priority Rank: higher totalScore = rank 1
    const dealerScores = group.map(d => ({
      dealerCode: d.dealerCode,
      totalScore: result.get(d.dealerCode).totalScore
    }));

    for (const ds of dealerScores) {
      const higherScoreCount = dealerScores.filter(x => x.totalScore > ds.totalScore).length;
      const entry = result.get(ds.dealerCode);
      entry.priorityRank = higherScoreCount + 1;
      entry.priorityLabel = getPriorityLabel(null, entry.priorityRank, ds.totalScore);
    }
  }

  return result;
}

/**
 * Determine priority tier label (High, Medium, Low) strictly from SO Priority Score/Rank.
 * Per Section 19 & 20: Priority must be calculated independently from Area Grade.
 */
export function getPriorityLabel(grade, priorityRank, totalScore, finalCategory = null, finalVolume = 0) {
  if (finalCategory === 'Churn') return 'Low';
  if (priorityRank <= 2 || totalScore >= 70) return 'High';
  if (priorityRank <= 5 || totalScore >= 50) return 'Medium';
  return 'Low';
}

