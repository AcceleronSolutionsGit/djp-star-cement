/**
 * What does ignoring DOA actually cost?
 *
 * Runs the real PJP engine on the test kit, then lists every dealer classified
 * Churn alongside its date of appointment and the visits it was given.
 */
import { dbAll } from './sandbox/src/config/database.js';
import { seed } from './seed.mjs';

const PERIOD = '2026-09';
const ANCHOR = new Date(`${PERIOD}-01T00:00:00Z`);
const counts = await seed();

const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const log = console.log; console.log = () => {};
await generateFullPjpDjpSolution(PERIOD, 'C1', {
  generationRunCode: 'GEN-DOA', dealerMappingBatchCode: counts.mappingBatch,
  salesHistoryBatchCodes: [counts.salesBatch]
});
console.log = log;

const rows = await dbAll(
  `SELECT sap_code, dealer_name, doa, dealer_status, category,
          so_visits, asm_visits, rsm_visits, zh_visits
     FROM dealer_visit_targets
    WHERE period_month=? AND cycle_code='C1' AND dealer_status='Churn'
    ORDER BY doa DESC`, [PERIOD]);

const days = d => d ? Math.round((ANCHOR - new Date(`${d}T00:00:00Z`)) / 86400000) : null;

console.log(`\nDealers classified CHURN on the ${PERIOD} run — and how old they actually are\n`);
console.log('  SAP CODE     DEALER                     DOA          AGE AT ANCHOR   VISITS (SO/ASM/RSM/ZH)');
console.log('  ' + '─'.repeat(94));
for (const r of rows) {
  const age = days(r.doa);
  const flag = age !== null && age <= 180 ? '  ← NOT old enough to be churn' : '';
  console.log(`  ${String(r.sap_code).padEnd(12)} ${String(r.dealer_name).slice(0, 26).padEnd(27)}` +
              `${String(r.doa || '(blank)').padEnd(13)}${String(age === null ? '?' : age + ' days').padEnd(16)}` +
              `${r.so_visits}/${r.asm_visits}/${r.rsm_visits}/${r.zh_visits}${flag}`);
}

const young = rows.filter(r => days(r.doa) !== null && days(r.doa) <= 180);
console.log(`\n  ${rows.length} dealer(s) classified Churn; ${young.length} of them opened within the last 180 days.`);
console.log(`  Under the client's column U rule, a DOA newer than the anchor minus 180 days cannot`);
console.log(`  reach the Churn branch at all — and within 15 days it is forced to Growing.\n`);

const totalLost = young.reduce((a, r) =>
  a + (+r.so_visits || 0) + (+r.asm_visits || 0) + (+r.rsm_visits || 0) + (+r.zh_visits || 0), 0);
console.log(`  Visits those ${young.length} dealer(s) currently receive: ${totalLost}.`);
process.exit(0);
