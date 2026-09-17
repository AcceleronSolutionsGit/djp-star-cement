/**
 * PJP Validator Engine
 * 
 * Validates the complete PJP output before persistence.
 * Returns validation errors; empty array = valid.
 */

import { VALID_CATEGORIES } from './classification.engine.js';
import { VALID_GRADES } from './area-grade.engine.js';

/**
 * Validate a single PJP result record.
 * @param {Object} record - canonical PJP result object
 * @returns {Array<Object>} array of { field, value, reason } error objects
 */
export function validatePjpRecord(record) {
  const errors = [];

  // Dealer identity
  if (!record.dealerCode) {
    errors.push({ field: 'dealerCode', value: record.dealerCode, reason: 'Missing dealer code' });
  }
  if (!record.area) {
    errors.push({ field: 'area', value: record.area, reason: 'Missing area' });
  }
  if (!record.soEmpCode && !record.soName) {
    errors.push({ field: 'soEmpCode', value: record.soEmpCode, reason: 'Missing SO Name & Code' });
  }

  // Numeric validity
  const numericFields = [
    'potential', 'currentSales', 'previousMonthSales', 'sameMonthLastYearSales',
    'sixMonthAverage', 'counterShare', 'areaPotential', 'areaPotentialRank',
    'areaPotentialPercentile', 'finalVolume', 'areaVolume', 'areaVolumeRank',
    'areaVolumePercentile', 'scoreA', 'scoreB', 'scoreC', 'totalScore',
    'priorityRank', 'soVisits', 'asmVisits', 'rsmVisits', 'zhVisits'
  ];

  for (const field of numericFields) {
    const val = record[field];
    if (val !== undefined && val !== null) {
      if (typeof val !== 'number' || isNaN(val) || !isFinite(val)) {
        errors.push({ field, value: val, reason: `Invalid numeric value: ${val}` });
      }
    }
  }

  // Counter Share must be 0-1 range (or slightly above due to sales > potential)
  if (record.counterShare != null && (record.counterShare < 0)) {
    errors.push({ field: 'counterShare', value: record.counterShare, reason: 'Negative counter share' });
  }

  // Percentiles should be 0-1
  for (const pField of ['areaPotentialPercentile', 'areaVolumePercentile']) {
    if (record[pField] != null && (record[pField] < 0 || record[pField] > 1.001)) {
      errors.push({ field: pField, value: record[pField], reason: `Percentile out of range [0, 1]` });
    }
  }

  // Category validation
  if (!record.finalCategory) {
    errors.push({ field: 'finalCategory', value: record.finalCategory, reason: 'Missing final category' });
  } else if (!VALID_CATEGORIES.includes(record.finalCategory)) {
    errors.push({ field: 'finalCategory', value: record.finalCategory, reason: `Invalid category. Valid: ${VALID_CATEGORIES.join(', ')}` });
  }

  // Grade validation
  if (!record.grade) {
    errors.push({ field: 'grade', value: record.grade, reason: 'Missing grade' });
  } else if (!VALID_GRADES.includes(record.grade)) {
    errors.push({ field: 'grade', value: record.grade, reason: `Invalid grade. Valid: ${VALID_GRADES.join(', ')}` });
  }

  // Ranks must be positive integers
  for (const rField of ['areaPotentialRank', 'areaVolumeRank', 'priorityRank', 'potentialRank']) {
    if (record[rField] != null && (record[rField] < 1 || !Number.isInteger(record[rField]))) {
      errors.push({ field: rField, value: record[rField], reason: 'Rank must be a positive integer' });
    }
  }

  // Visit frequency validation
  for (const vField of ['soVisits', 'asmVisits', 'rsmVisits', 'zhVisits']) {
    if (record[vField] != null && record[vField] < 0) {
      errors.push({ field: vField, value: record[vField], reason: 'Visit count cannot be negative' });
    }
  }

  return errors;
}

/**
 * Validate the entire PJP result set.
 * @param {Array<Object>} results - array of canonical PJP result objects
 * @returns {Object} { valid: boolean, totalErrors: number, errors: [{dealer, field, value, reason}], duplicates: [] }
 */
export function validatePjpResults(results) {
  const allErrors = [];
  const duplicateCheck = new Set();
  const duplicates = [];

  for (const record of results) {
    // Per-record validation
    const recordErrors = validatePjpRecord(record);
    for (const err of recordErrors) {
      allErrors.push({
        dealer: record.dealerCode || 'UNKNOWN',
        dealerName: record.dealerName || 'UNKNOWN',
        ...err
      });
    }

    // Duplicate check (dealerCode + soEmpCode)
    const key = `${record.dealerCode}_${record.soEmpCode || 'NOSO'}`;
    if (duplicateCheck.has(key)) {
      duplicates.push({
        dealer: record.dealerCode,
        soEmpCode: record.soEmpCode,
        reason: 'Duplicate dealer/SO combination'
      });
    }
    duplicateCheck.add(key);
  }

  return {
    valid: allErrors.length === 0 && duplicates.length === 0,
    totalErrors: allErrors.length,
    totalDuplicates: duplicates.length,
    errors: allErrors,
    duplicates
  };
}

/**
 * Generate a debug trace for a single dealer.
 * @param {Object} record - canonical PJP result
 * @returns {string} human-readable trace
 */
export function generateDealerTrace(record) {
  return `
Dealer: ${record.dealerCode} (${record.dealerName || 'N/A'})
Area: ${record.area || 'N/A'}
SO: ${record.soName || 'N/A'} (${record.soEmpCode || 'N/A'})

Potential: ${record.potential ?? 'N/A'}
Current Sales: ${record.currentSales ?? 'N/A'}
6M Average: ${record.sixMonthAverage ?? 'N/A'}
Previous Month: ${record.previousMonthSales ?? 'N/A'}
Same Month Last Year: ${record.sameMonthLastYearSales ?? 'N/A'}

Counter Share: ${record.counterShare != null ? (record.counterShare * 100).toFixed(2) + '%' : 'N/A'}
Area Potential: ${record.areaPotential ?? 'N/A'}
Area Potential Rank: ${record.areaPotentialRank ?? 'N/A'}
Area Potential Percentile: ${record.areaPotentialPercentile != null ? (record.areaPotentialPercentile * 100).toFixed(2) + '%' : 'N/A'}

Need to Grow: ${record.needToGrow ? 'Yes' : 'No'}

Final Category: ${record.finalCategory || 'N/A'}
Final Volume: ${record.finalVolume ?? 'N/A'}

Area Volume: ${record.areaVolume ?? 'N/A'}
Area Volume Rank: ${record.areaVolumeRank ?? 'N/A'}
Area Volume Percentile: ${record.areaVolumePercentile != null ? (record.areaVolumePercentile * 100).toFixed(2) + '%' : 'N/A'}
Grade: ${record.grade || 'N/A'}

SO Potential Rank: ${record.potentialRank ?? 'N/A'}
Score A: ${record.scoreA ?? 'N/A'}
Score B: ${record.scoreB ?? 'N/A'}
Score C: ${record.scoreC ?? 'N/A'}
Total Score: ${record.totalScore ?? 'N/A'}
Priority Rank: ${record.priorityRank ?? 'N/A'}

SO Visits: ${record.soVisits ?? 'N/A'}
ASM Visits: ${record.asmVisits ?? 'N/A'}
RSM Visits: ${record.rsmVisits ?? 'N/A'}
ZH Visits: ${record.zhVisits ?? 'N/A'}
`.trim();
}
