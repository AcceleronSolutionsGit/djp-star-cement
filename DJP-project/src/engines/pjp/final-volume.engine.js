/**
 * PJP Final Volume Engine
 * 
 * Calculates Final Volume based on Final Category:
 *   Prospective  → Potential × 0.4
 *   Need to Grow → Current Sales
 *   Churn        → 0
 *   Growing      → Current Sales
 *   De-growing   → Current Sales
 *   Zero Lifter  → 6-month average
 */

/**
 * Calculate Final Volume for a dealer based on their Final Category.
 * 
 * @param {string} finalCategory - one of: Prospective, Growing, De-growing, Need to Grow, Zero Lifter, Churn
 * @param {number} currentSales 
 * @param {number} potential - counter potential
 * @param {number} sixMonthAverage 
 * @returns {number} final volume (always >= 0, never NaN/Infinity)
 */
export function calculateFinalVolume(finalCategory, currentSales, potential, sixMonthAverage) {
  const current = currentSales ?? 0;
  const pot = potential ?? 0;
  const avg6m = sixMonthAverage ?? 0;

  let volume;

  switch (finalCategory) {
    case 'Prospective':
      volume = pot * 0.4;
      break;
    case 'Need to Grow':
    case 'Growing':
    case 'Stable':
    case 'Declining':
    case 'De-growing':
      volume = current;
      break;
    case 'Churn':
      volume = 0;
      break;
    case 'Zero Lifter':
      volume = avg6m;
      break;
    default:
      // Unknown category - this should have been caught by validation
      console.warn(`[FinalVolume] Unknown category: ${finalCategory}. Defaulting to current sales.`);
      volume = current;
  }

  // Protect against NaN/Infinity
  if (!isFinite(volume) || isNaN(volume)) {
    volume = 0;
  }

  return Math.max(0, volume);
}
