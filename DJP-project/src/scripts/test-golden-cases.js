import { normalizeCode, normalizeString } from '../engines/normalization.engine.js';
import { determineNeedToGrow } from '../engines/pjp/area-potential.engine.js';
import { classifyDealer } from '../engines/pjp/classification.engine.js';
import { calculateFinalVolume } from '../engines/pjp/final-volume.engine.js';

console.log('--- RUNNING GOLDEN TEST CASES ---');

function assertEqual(actual, expected, testName) {
  if (actual === expected) {
    console.log(`✅ [PASS] ${testName}`);
  } else {
    console.error(`❌ [FAIL] ${testName}: Expected "${expected}", got "${actual}"`);
  }
}

// 1. Normalization Tests
assertEqual(normalizeCode(' 1234.0 '), '1234', 'Normalize Code: Remove decimal .0');
assertEqual(normalizeCode(' ABC-123 '), 'ABC-123', 'Normalize Code: Upper and trim');
assertEqual(normalizeString(' M/s.  R & B  ENTERPRISE '), 'M/S R AND B ENTERPRISE', 'Normalize String: Special chars & spaces');

// 2. Area Potential - Need to Grow condition
assertEqual(determineNeedToGrow(0.65, 0.15, false), true, 'NTG: High percentile, low share, established dealer');
assertEqual(determineNeedToGrow(0.65, 0.15, true), false, 'NTG: New dealer cannot be NTG');
assertEqual(determineNeedToGrow(0.50, 0.15, false), false, 'NTG: Percentile too low');
assertEqual(determineNeedToGrow(0.65, 0.25, false), false, 'NTG: Share too high');

// 3. Classification Tests
assertEqual(classifyDealer({
  dealerType: 'PROSPECTIVE',
}).finalCategory, 'Prospective', 'Classification: Explicit Prospect');

assertEqual(classifyDealer({
  doa: new Date(Date.now() + 86400000).toISOString(),
  reportMonth: '2026-06'
}).finalCategory, 'Prospective', 'Classification: Future DOA is Prospective');

assertEqual(classifyDealer({
  doa: '2020-01-01', // Old dealer
  reportMonth: '2026-06',
  sixMonthAverage: 0,
  currentSales: 0
}).finalCategory, 'Churn', 'Classification: Churn (Old, 0 avg, 0 current)');

assertEqual(classifyDealer({
  doa: '2020-01-01',
  reportMonth: '2026-06',
  sixMonthAverage: 10,
  currentSales: 0
}).finalCategory, 'Zero Lifter', 'Classification: Zero Lifter (Old, >0 avg, 0 current)');

assertEqual(classifyDealer({
  doa: '2020-01-01',
  reportMonth: '2026-06',
  sixMonthAverage: 10,
  currentSales: 5,
  sameMonthLastYearSales: 10
}).finalCategory, 'De-growing', 'Classification: De-growing (Old, current < lysm)');

assertEqual(classifyDealer({
  doa: '2020-01-01',
  reportMonth: '2026-06',
  sixMonthAverage: 10,
  currentSales: 15,
  sameMonthLastYearSales: 10
}).finalCategory, 'Growing', 'Classification: Growing (Old, current > lysm)');

// 4. Final Volume Tests
assertEqual(calculateFinalVolume('Prospective', 0, 100, 0), 40, 'Final Volume: Prospective = Pot * 0.4');
assertEqual(calculateFinalVolume('Need to Grow', 50, 100, 40), 50, 'Final Volume: Need to Grow = Current');
assertEqual(calculateFinalVolume('Churn', 0, 100, 0), 0, 'Final Volume: Churn = 0');
assertEqual(calculateFinalVolume('Zero Lifter', 0, 100, 25), 25, 'Final Volume: Zero Lifter = 6M Avg');

console.log('\nAll core logic assertions ran successfully.');
