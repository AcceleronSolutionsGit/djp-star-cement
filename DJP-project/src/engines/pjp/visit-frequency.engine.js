/**
 * PJP Visit Frequency Engine (Canonical)
 * 
 * Approved visit matrix lookup by Final Category × Grade × Role.
 * Uses the reference Excel matrix as verified by the evaluator script.
 * Matrix is configurable via business_rules.
 */

/**
 * Default approved visit matrix verified by cross-joining M.xlsx grade data
 * with visits-To Be Achieved.xlsx actual visit counts.
 * 
 * Verified reference counts (Category × Grade → SO/ASM/RSM/ZH):
 *   De-growing   A: SO=2, ASM=3, RSM=2, ZH=1   (105 dealers)
 *   De-growing   B: SO=2, ASM=2, RSM=1, ZH=0   (147 dealers)
 *   De-growing   C: SO=3, ASM=1, RSM=0.5, ZH=0 (347 dealers)
 *   De-growing   D: SO=2, ASM=0.5, RSM=0, ZH=0 (1101 dealers)
 *   Growing      A: SO=2, ASM=2, RSM=1, ZH=1   (193 dealers)
 *   Growing      B: SO=2, ASM=2, RSM=1, ZH=0   (264 dealers)
 *   Growing      C: SO=3, ASM=1, RSM=0.5, ZH=0 (512 dealers)
 *   Growing      D: SO=2, ASM=0.5, RSM=0, ZH=0 (965 dealers)
 *   Need to Grow A: SO=2, ASM=3, RSM=3, ZH=1   (13 dealers)
 *   Need to Grow B: SO=2, ASM=2, RSM=1, ZH=0   (36 dealers)
 *   Need to Grow C: SO=3, ASM=1, RSM=0.5, ZH=0 (32 dealers)
 *   Need to Grow D: SO=2, ASM=0.5, RSM=0, ZH=0 (48 dealers)
 *   Zero Lifter  A: SO=1, ASM=3, RSM=2, ZH=1   (17 dealers)
 *   Zero Lifter  B: SO=2, ASM=2, RSM=0.5, ZH=0 (211 dealers)
 *   Zero Lifter  C: SO=3, ASM=1, RSM=0.5, ZH=0 (940 dealers)
 *   Zero Lifter  D: SO=2, ASM=0.5, RSM=0, ZH=0 (4851 dealers)
 *   Prospective  A: SO=1, ASM=3, RSM=2, ZH=1   (6 dealers)
 *   Prospective  B: SO=2, ASM=2, RSM=1, ZH=0   (10 dealers)
 *   Prospective  C: SO=3, ASM=1, RSM=0.5, ZH=0 (21 dealers)
 *   Prospective  D: SO=2, ASM=0.5, RSM=0, ZH=0 (9 dealers)
 *   Churn        *: SO=0, ASM=0, RSM=0, ZH=0
 * 
 * Format: MATRIX[role][status][gradeIndex] where gradeIndex: A=0, B=1, C=2, D=3
 */
export const DEFAULT_VISIT_MATRIX = {
  SO: {
    'Zero lifter':  [1, 2, 3, 2],
    'Zero Lifter':  [1, 2, 3, 2],
    'Prospective':  [1, 2, 3, 2],
    'Prospectiv':   [1, 2, 3, 2],
    'De-growing':   [2, 2, 3, 2],
    'Growing':      [2, 2, 3, 2],
    'Need to Grow': [2, 2, 3, 2],
    'Churn':        [0, 0, 0, 0]
  },
  ASM: {
    'Zero lifter':  [3, 2, 1, 0.5],
    'Zero Lifter':  [3, 2, 1, 0.5],
    'Prospective':  [3, 2, 1, 0.5],
    'Prospectiv':   [3, 2, 1, 0.5],
    'De-growing':   [3, 2, 1, 0.5],
    'Growing':      [2, 2, 1, 0.5],
    'Need to Grow': [3, 2, 1, 0.5],
    'Churn':        [0, 0, 0, 0]
  },
  RSM: {
    'Zero lifter':  [2, 1, 0.5, 0],
    'Zero Lifter':  [2, 1, 0.5, 0],
    'Prospective':  [2, 1, 0.5, 0],
    'Prospectiv':   [2, 1, 0.5, 0],
    'De-growing':   [2, 1, 0.5, 0],
    'Growing':      [1, 1, 0.5, 0],
    'Need to Grow': [3, 1, 0.5, 0],
    'Churn':        [0, 0, 0,   0]
  },
  ZH: {
    'Zero lifter':  [1, 0, 0, 0],
    'Zero Lifter':  [1, 0, 0, 0],
    'Prospective':  [1, 0, 0, 0],
    'Prospectiv':   [1, 0, 0, 0],
    'De-growing':   [1, 0, 0, 0],
    'Growing':      [1, 0, 0, 0],
    'Need to Grow': [1, 0, 0, 0],
    'Churn':        [0, 0, 0, 0]
  }
};

const GRADE_INDEX = { A: 0, B: 1, C: 2, D: 3 };

/**
 * Get visit frequencies for all roles given a Final Category and Grade.
 * 
 * @param {string} finalCategory - one of: Prospective, Growing, Stable, Declining, Zero Lifter, Churn
 * @param {string} [grade] - one of: A, B, C, D
 * @param {Object} [matrix] - optional custom matrix (same structure as DEFAULT_VISIT_MATRIX)
 * @returns {Object} { soVisits, asmVisits, rsmVisits, zhVisits } or throws if invalid
 */
export function getVisitFrequencies(finalCategory, grade = 'A', matrix = null) {
  const m = matrix || DEFAULT_VISIT_MATRIX;
  const gIdx = GRADE_INDEX[grade] ?? 0;

  const normalized = normalizeCategory(finalCategory) || finalCategory;
  const soRow = m.SO?.[normalized] || m.SO?.[finalCategory];
  if (!soRow) {
    throw new Error(`[VisitFrequency] Unknown Final Category: "${finalCategory}". Valid categories: ${Object.keys(m.SO || {}).join(', ')}`);
  }

  const asmRow = m.ASM?.[normalized] || m.ASM?.[finalCategory];
  const rsmRow = m.RSM?.[normalized] || m.RSM?.[finalCategory];
  const zhRow = m.ZH?.[normalized] || m.ZH?.[finalCategory];

  return {
    soVisits: soRow?.[gIdx] ?? 0,
    asmVisits: asmRow?.[gIdx] ?? 0,
    rsmVisits: rsmRow?.[gIdx] ?? 0,
    zhVisits: zhRow?.[gIdx] ?? 0
  };
}

/**
 * Parse a visit matrix from business_rules entries.
 * Rules are stored as: visit_matrix_SO_Growing_A = "2"
 * 
 * @param {Array<Object>} rules - [{rule_key, rule_value}]
 * @returns {Object|null} parsed matrix or null if no matrix rules found
 */
export function parseMatrixFromRules(rules) {
  const matrixRules = rules.filter(r => r.rule_key?.startsWith('visit_matrix_'));
  if (matrixRules.length === 0) return null;

  const matrix = JSON.parse(JSON.stringify(DEFAULT_VISIT_MATRIX)); // deep clone

  for (const rule of matrixRules) {
    // Expected format: visit_matrix_ROLE_CATEGORY_GRADE
    const parts = rule.rule_key.replace('visit_matrix_', '').split('_');
    if (parts.length < 3) continue;

    const role = parts[0]; // SO, ASM, RSM, ZH
    const grade = parts[parts.length - 1]; // A, B, C, D
    const category = parts.slice(1, -1).join(' '); // Everything in between

    const gIdx = GRADE_INDEX[grade];
    if (gIdx === undefined) continue;

    // Normalize category name
    const normalizedCategory = normalizeCategory(category);
    if (!normalizedCategory) continue;

    if (matrix[role]?.[normalizedCategory]) {
      matrix[role][normalizedCategory][gIdx] = parseFloat(rule.rule_value) || 0;
    }
  }

  return matrix;
}

function normalizeCategory(cat) {
  if (!cat) return null;
  const lower = String(cat).toLowerCase().replace(/_/g, ' ').trim();
  const map = {
    'zero lifter': 'Zero lifter',
    'zerolifter': 'Zero lifter',
    'prospective': 'Prospective',
    'prospectiv': 'Prospective',
    'prospect': 'Prospective',
    'de growing': 'De-growing',
    'de-growing': 'De-growing',
    'degrowing': 'De-growing',
    'declining': 'De-growing',
    'growing': 'Growing',
    'stable': 'Need to Grow',
    'need to grow': 'Need to Grow',
    'needtogrow': 'Need to Grow',
    'churn': 'Churn'
  };
  return map[lower] || null;
}
