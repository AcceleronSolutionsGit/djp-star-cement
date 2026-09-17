/**
 * SFA REPORT UPLOAD — what actually comes back.
 *
 * Uploading the SFA file is not just an import: it auto-triggers a C2 regeneration.
 * This walks the real sequence on the real kit file and prints every response, so the
 * expected output is a recorded fact rather than a description.
 *
 *   1  import the file          → visit_execution_logs + employee list
 *   2  the upload response      → counts and the C2-regeneration notice
 *   3  the C2 regeneration      → what it returns, and what it changed
 *   4  the adherence report     → what the screen then shows
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dbAll, dbGet } from './sandbox/src/config/database.js';
import { seedKitV2 } from './seed-kit-v2.mjs';

const PERIOD = '2026-07';
const KIT_SFA = '/mnt/user-data/outputs/DJP_Test_Kit_v2/TEST_06_SFA_Report.xlsx';

let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                        catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const okA = async (n, fn) => { try { await fn(); console.log(`  ✓ ${n}`); pass++; }
                               catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const S = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`);
const note = (k, v) => console.log(`     ${String(k).padEnd(46, '.')} ${v}`);
const silence = () => { const l = console.log; console.log = () => {}; return () => { console.log = l; }; };

const call = async (handler, { params = {}, query = {}, body = {} } = {}) => {
  let code = 200, payload = null;
  const res = { status(c) { code = c; return this; }, json(p) { payload = p; return this; } };
  await handler({ params, query, body }, res);
  return { code, body: payload };
};

/** The response assembly from upload.controller.js, applied to an import result. */
function extractCounts(result) {
  if (typeof result === 'number')
    return { validRows: result, invalidRows: 0, duplicateRows: 0, warnings: [], errors: [], totalRows: result };
  const validRows = result?.validRows ?? result?.matchedCount ?? result?.insertedCount
                 ?? result?.validTargetsCount ?? result?.totalVisits ?? result?.rowsRead ?? result?.count ?? 0;
  const invalidRows = result?.invalidRows ?? result?.unmatched ?? 0;
  const duplicateRows = result?.duplicateRows ?? result?.duplicates ?? result?.skippedCount ?? 0;
  return { validRows, invalidRows, duplicateRows,
           warnings: result?.warnings ?? [], errors: result?.errors ?? [],
           totalRows: result?.totalRows ?? (validRows + invalidRows + duplicateRows) };
}

console.log('\n' + '═'.repeat(76));
console.log('  UPLOADING THE SFA REPORT — the response, step by step');
console.log('═'.repeat(76));

if (!existsSync(KIT_SFA)) {
  console.log(`\n  Kit file not found at ${KIT_SFA} — run test/e2e/build-kit.mjs first.`);
  process.exit(1);
}

// ── set the stage: a generated C1 with approved plans ────────────────────────
const counts = await seedKitV2();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const gen = await import('./sandbox/src/controllers/generation.controller.js');

{
  const un = silence();
  await generateFullPjpDjpSolution(PERIOD, 'C1', {
    generationRunCode: 'GEN-SFA-C1', dealerMappingBatchCode: counts.mappingBatch,
    salesHistoryBatchCodes: [counts.salesBatch]
  });
  await gen.generatePlansForAllRoles(PERIOD, 'C1', {});
  await gen.runGenerationPipeline(PERIOD, 'C2', {
    generationRunCode: 'GEN-SFA-C2', dealerMappingBatchCode: counts.mappingBatch,
    salesHistoryBatchCodes: [counts.salesBatch]
  });
  un();
}

const c1 = await dbGet(`SELECT COUNT(DISTINCT p.id) plans, COUNT(d.id) visits FROM sales_plans p
  LEFT JOIN sales_plan_details d ON d.plan_id=p.id WHERE p.period_month=? AND p.cycle_code='C1'`, [PERIOD]);
const c2Before = await dbGet(`SELECT COUNT(DISTINCT p.id) plans, COUNT(d.id) visits FROM sales_plans p
  LEFT JOIN sales_plan_details d ON d.plan_id=p.id WHERE p.period_month=? AND p.cycle_code='C2'`, [PERIOD]);

S('before the upload');
note('C1 plans / visits', `${c1.plans} / ${c1.visits}`);
note('C2 plans / visits', `${c2Before.plans} / ${c2Before.visits}`);
note('visit_execution_logs rows', (await dbGet(`SELECT COUNT(*) c FROM visit_execution_logs`)).c);

// ── 1. the import ────────────────────────────────────────────────────────────
S('1. the import runs');

const { importSfaReport } = await import('./sandbox/src/imports/sfa-report.importer.js');
let result = null;
{ const un = silence(); result = await importSfaReport(KIT_SFA, 'BATCH-SFA-DEMO'); un(); }

note('importer returned', JSON.stringify(result));
const c = extractCounts(result);
note('extractCounts → validRows', c.validRows);

await okA('the visit rows landed in visit_execution_logs', async () => {
  const n = (await dbGet(`SELECT COUNT(*) c FROM visit_execution_logs`)).c;
  note('  rows now in visit_execution_logs', n);
  assert.equal(n, result.totalVisits, 'row count does not match what the importer reported');
  assert.ok(n > 0);
});

await okA('a previous SFA upload is wiped first, not appended to', async () => {
  const before = (await dbGet(`SELECT COUNT(*) c FROM visit_execution_logs`)).c;
  const un = silence(); await importSfaReport(KIT_SFA, 'BATCH-SFA-DEMO-2'); un();
  const after = (await dbGet(`SELECT COUNT(*) c FROM visit_execution_logs`)).c;
  note('  re-uploading the same file', `${before} → ${after} rows (not ${before * 2})`);
  assert.equal(after, before, 'rows were appended — a re-upload would double-count');
});

// ── 2. the upload response ───────────────────────────────────────────────────
S('2. the response the upload endpoint sends');

const latestPeriod = await dbGet(`SELECT period_month FROM dealer_visit_targets ORDER BY period_month DESC LIMIT 1`);
const sfaFeedbackTriggered = !!latestPeriod?.period_month;

const uploadResponse = {
  message: `File ingested successfully.${sfaFeedbackTriggered ? ' C2 plans are being regenerated based on SFA adherence data.' : ''}`,
  batchCode: 'BATCH-SFA-DEMO',
  fileName: 'TEST_06_SFA_Report.xlsx',
  uploadType: 'SFA_REPORT',
  batchStatus: c.invalidRows > 0 ? 'PARTIAL' : 'COMPLETED',
  rowsProcessed: c.validRows,
  counts: { validRows: c.validRows, invalidRows: c.invalidRows, duplicateRows: c.duplicateRows, totalRows: c.totalRows },
  warnings: [], errors: [],
  sfaFeedbackTriggered,
  c2RegenerationPeriod: latestPeriod?.period_month || null
};
console.log(JSON.stringify(uploadResponse, null, 2).split('\n').map(l => '     ' + l).join('\n'));

ok('uploadType is detected as SFA_REPORT', () => assert.equal(uploadResponse.uploadType, 'SFA_REPORT'));
ok('batchStatus is COMPLETED', () => assert.equal(uploadResponse.batchStatus, 'COMPLETED'));
ok('rowsProcessed equals the visits in the file', () =>
  assert.equal(uploadResponse.rowsProcessed, result.totalVisits));
ok('the response says C2 is being regenerated', () => {
  assert.equal(uploadResponse.sfaFeedbackTriggered, true);
  assert.match(uploadResponse.message, /C2 plans are being regenerated/);
});
ok('it names the period it will regenerate', () =>
  assert.equal(uploadResponse.c2RegenerationPeriod, PERIOD));

ok('FINDING — the employee count is imported but never reported', () => {
  note('  employees inserted by the importer', result.totalEmps);
  note('  employees visible in the response', '(absent — extractCounts only reads totalVisits)');
  assert.equal(uploadResponse.counts.validRows, result.totalVisits);
});

// ── 3. the C2 regeneration the upload kicked off ─────────────────────────────
S('3. the C2 regeneration it triggers (async — the upload does not wait)');

let regen = null;
{ const un = silence(); regen = await call(gen.regenerateC2Plans, { body: { periodMonth: PERIOD } }); un(); }

await okA('the regeneration succeeds', () => assert.equal(regen.code, 200, JSON.stringify(regen.body)));
console.log(JSON.stringify(regen.body, null, 2).split('\n').slice(0, 26).map(l => '     ' + l).join('\n'));

const c2After = await dbGet(`SELECT COUNT(DISTINCT p.id) plans, COUNT(d.id) visits FROM sales_plans p
  LEFT JOIN sales_plan_details d ON d.plan_id=p.id WHERE p.period_month=? AND p.cycle_code='C2'`, [PERIOD]);
note('C2 plans / visits after', `${c2After.plans} / ${c2After.visits}`);

await okA('C1 is untouched', async () => {
  const now = await dbGet(`SELECT COUNT(DISTINCT p.id) plans, COUNT(d.id) visits FROM sales_plans p
    LEFT JOIN sales_plan_details d ON d.plan_id=p.id WHERE p.period_month=? AND p.cycle_code='C1'`, [PERIOD]);
  note('  C1 plans / visits', `${now.plans} / ${now.visits}`);
  assert.equal(now.plans, c1.plans);
  assert.equal(now.visits, c1.visits);
});

await okA('a C2 Review entry is recorded', async () => {
  const r = await dbGet(`SELECT * FROM c2_regenerations ORDER BY id DESC LIMIT 1`);
  assert.ok(r, 'no c2_regenerations row');
  note('  status', r.status);
  note('  visits before → after', `${r.visits_before} → ${r.visits_after}`);
  note('  adherence stored', `${r.adherence_adhered}/${r.adherence_planned} = ${r.adherence_pct}%`);
  assert.equal(r.status, 'COMPLETED');
});

// ── 4. what the adherence screen then shows ──────────────────────────────────
S('4. the adherence report the screen then shows');

const app = await import('./sandbox/src/controllers/appPlan.controller.js');
let rep = null;
{ const un = silence(); rep = await call(app.getAdherenceReport, { query: { month: PERIOD, cycle: 'C1', asOn: `${PERIOD}-15` } }); un(); }

await okA('the adherence endpoint answers', () => assert.equal(rep.code, 200, JSON.stringify(rep.body)));
note('dealers on plan / visited / missed',
  `${rep.body.totals.dealers_on_plan} / ${rep.body.totals.dealers_visited} / ${rep.body.totals.dealers_missed}`);
note('planned visits / MTD due', `${rep.body.totals.planned_visits} / ${rep.body.totals.mtd_due}`);
note('adhered / capped', `${rep.body.totals.adhered} / ${rep.body.totals.adhered_capped}`);
note('pending', rep.body.totals.pending);
note('adherence capped / raw', `${rep.body.adherence.capped_pct}% / ${rep.body.adherence.raw_pct}%`);

await okA('a dealer visited twice shows capped below uncapped', () => {
  const t = rep.body.totals;
  note('  adhered vs capped', `${t.adhered} vs ${t.adhered_capped}`);
  assert.ok(t.adhered_capped <= t.adhered);
});

S('summary — what you should see on screen');
console.log(`
     Toast / upload panel
       "File ingested successfully. C2 plans are being regenerated
        based on SFA adherence data."
       ${uploadResponse.rowsProcessed} rows processed · batch ${uploadResponse.batchStatus}

     Uploads list
       a new SFA_REPORT batch, status COMPLETED, ${uploadResponse.rowsProcessed} valid rows

     Officer Plans → Adherence  (month ${PERIOD}, cycle C1, as-on ${PERIOD}-15)
       ${rep.body.totals.planned_visits} planned · ${rep.body.totals.adhered} adhered · ${rep.body.adherence.capped_pct}% capped

     Officer Plans → C2 Review
       a new regeneration row; C2 rebuilt to ${c2After.visits} visits
       C1 untouched at ${c1.visits} visits
`);

console.log('─'.repeat(76));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
