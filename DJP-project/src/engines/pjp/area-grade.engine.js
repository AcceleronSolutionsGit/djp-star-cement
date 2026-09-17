/**
 * PJP Area Grade Engine
 * 
 * Calculates Area Volume metrics and assigns A/B/C/D Grade:
 * - Area Volume = SUM(Final Volume of all dealers in Area)
 * - Area Volume Rank = competition ranking within Area by Final Volume
 * - Area Volume Percentile = cumulative Pareto-style (SUMIFS of rank >= current / total)
 * - Grade: AJ > 60% → A, AJ > 40% → B, AJ >= 20% → C, AJ < 20% → D
 */

import { normalizeArea } from './area-potential.engine.js';

/**
 * Calculate Area Volume, Area Volume Rank, Area Volume Percentile, and Grade
 * for all dealers.
 * 
 * @param {Array<Object>} dealers - array with { dealerCode, area, finalVolume }
 * @param {Object} thresholds - { catAMin: 0.60, catBMin: 0.40, catCMin: 0.20 }
 * @returns {Map<string, Object>} dealerCode -> { areaVolume, areaVolumeRank, areaVolumePercentile, grade }
 */
export function calculateAreaGradeMetrics(dealers, thresholds = {}) {
  const catAMin = thresholds.catAMin ?? 0.60;
  const catBMin = thresholds.catBMin ?? 0.40;
  const catCMin = thresholds.catCMin ?? 0.20;

  const result = new Map();

  // Group dealers by normalized area
  const areaGroups = new Map();
  for (const d of dealers) {
    const areaKey = normalizeArea(d.area);
    if (!areaGroups.has(areaKey)) areaGroups.set(areaKey, []);
    areaGroups.get(areaKey).push(d);
  }

  for (const [areaKey, group] of areaGroups.entries()) {
    // Area Volume = sum of all dealer final volume in area
    const areaVolume = group.reduce((sum, d) => sum + (d.finalVolume || 0), 0);

    // Sort descending by finalVolume for ranking
    const sorted = [...group].sort((a, b) => (b.finalVolume || 0) - (a.finalVolume || 0));

    // Precalculate ranks and suffix sums for O(N log N) performance instead of O(N^3)
    const ranks = new Map();
    let currentRank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && (sorted[i].finalVolume || 0) < (sorted[i-1].finalVolume || 0)) {
        currentRank = i + 1;
      }
      ranks.set(sorted[i], currentRank);
    }

    const suffixSums = new Array(sorted.length);
    let runningSum = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      runningSum += (sorted[i].finalVolume || 0);
      suffixSums[i] = runningSum;
    }

    for (let i = 0; i < sorted.length; i++) {
      const d = sorted[i];
      const areaVolumeRank = ranks.get(d);
      
      // sumForRankGte corresponds to suffix sum starting from the first element with this rank.
      // Since rank = (number of items strictly greater) + 1, the first element with this rank is at index (rank - 1).
      const sumForRankGte = suffixSums[areaVolumeRank - 1] || 0;
      const areaVolumePercentile = areaVolume > 0 ? sumForRankGte / areaVolume : 0;

      // Grade from Area Volume Percentile
      let grade;
      if (areaVolumePercentile > catAMin) {
        grade = 'A';
      } else if (areaVolumePercentile > catBMin) {
        grade = 'B';
      } else if (areaVolumePercentile >= catCMin) {
        grade = 'C';
      } else {
        grade = 'D';
      }

      result.set(d.dealerCode, {
        areaVolume,
        areaVolumeRank,
        areaVolumePercentile,
        grade
      });
    }
  }

  return result;
}

/**
 * Valid grades for validation
 */
export const VALID_GRADES = ['A', 'B', 'C', 'D'];
