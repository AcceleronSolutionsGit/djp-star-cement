/**
 * Verifies that "Run DJP" and "regenerate after adherence" go down the SAME path.
 *
 * The DJP solver, the per-employee plan builder and the SFA adherence analyser are
 * stubbed, so what is under test is the orchestration itself: which roles get asked
 * for plans, in what order the stages run, whether adherence context is forwarded,
 * and whether routing is stamped afterwards.
 */
import assert from 'node:assert/strict';
import { db, dbRun, dbAll, dbGet } from './sandbox/src/config/database.js';
import { calls, reset } from './sandbox/src/engines/__stub_state.js';
import {
  runGenerationPipeline,
  generatePlansForAllRoles,
  regenerateC2Plans
} from './sandbox/src/controllers/generation.controller.js';

const PERIOD = '2026-09';

db.exec(`
CREATE TABLE sales_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, emp_code TEXT, emp_name TEXT,
  period_month TEXT, cycle_code TEXT, status TEXT DEFAULT 'DRAFT',
  submitted_at TEXT, approved_by TEXT, approved_at TEXT, remarks TEXT,
  created_at TEXT DEFAULT (datetime('now')), emp_role TEXT DEFAULT 'SO',
  required_approver_role TEXT, approver_emp_code TEXT,
  l1_approver_emp_code TEXT, l1_approver_name TEXT, l1_approver_role TEXT,
  rectification_count INTEGER DEFAULT 0, rectify_requested_by TEXT,
  rectify_requested_at TEXT, rectify_remarks TEXT, resubmitted_at TEXT,
  last_edited_by TEXT, last_edited_at TEXT
);
CREATE TABLE sales_plan_details (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER, visit_date TEXT, dealer_sap_code TEXT, dealer_name TEXT, sequence INTEGER, visit_status TEXT, source TEXT);
CREATE TABLE djp_recommendations (id INTEGER PRIMARY KEY AUTOINCREMENT, period_month TEXT, cycle_code TEXT);
CREATE TABLE generation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, generation_code TEXT, report_month TEXT, cycle_code TEXT,
  dealer_mapping_batch_code TEXT, sales_history_batch_codes TEXT, prospect_batch_code TEXT,
  sfa_feedback_batch_code TEXT, rules_snapshot TEXT, status TEXT,
  pjp_dealer_count INTEGER, pjp_visit_requirement INTEGER, djp_scheduled_count INTEGER,
  djp_unallocated_count INTEGER, capacity_violated INTEGER, validation_errors TEXT,
  started_at TEXT DEFAULT (datetime('now')), completed_at TEXT
);
CREATE TABLE upload_batches (id INTEGER PRIMARY KEY AUTOINCREMENT, batch_code TEXT, file_type TEXT, status TEXT, uploaded_at TEXT DEFAULT (datetime('now')));
CREATE TABLE business_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_key TEXT, rule_value TEXT);
CREATE TABLE approval_matrix (id INTEGER PRIMARY KEY AUTOINCREMENT, submitter_role TEXT, required_approver_role TEXT, is_active INTEGER DEFAULT 1);
CREATE TABLE master_employees (id INTEGER PRIMARY KEY AUTOINCREMENT, emp_code TEXT, emp_name TEXT, designation TEXT, role TEXT);
CREATE TABLE dealer_visit_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period_month TEXT, cycle_code TEXT, sap_code TEXT, dealer_name TEXT,
  so_emp_code TEXT, so_name TEXT, asm_code TEXT, asm_name TEXT,
  rsm_code TEXT, rsm_name TEXT, zh_code TEXT, zh_name TEXT,
  so_visits REAL, asm_visits REAL, rsm_visits REAL, zh_visits REAL
);
`);

for (const [s, a] of [['SO','ASM'],['ASM','RSM'],['RSM','ZH'],['ZH','ADMIN']])
  db.prepare('INSERT INTO approval_matrix (submitter_role, required_approver_role) VALUES (?,?)').run(s, a);
db.prepare("INSERT INTO upload_batches (batch_code, file_type, status) VALUES ('B-DM','DEALER_MAPPING','VALIDATED')").run();
db.prepare("INSERT INTO upload_batches (batch_code, file_type, status) VALUES ('B-SH','SALES_HISTORY','VALIDATED')").run();

// one dealer per cycle carrying the full SO → ASM → RSM → ZH chain
for (const cycle of ['C1', 'C2']) {
  db.prepare(`INSERT INTO dealer_visit_targets
    (period_month, cycle_code, sap_code, dealer_name, so_emp_code, so_name, asm_code, asm_name,
     rsm_code, rsm_name, zh_code, zh_name, so_visits, asm_visits, rsm_visits, zh_visits)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(PERIOD, cycle, '1000001153', 'R P ENTERPRISE',
         '11001774', 'DEBABRATA CHAKRABORTY- FKT', '11001393', 'DEBABRATA GHOSH',
         '11001813', 'RITWICK CHATTERJEE', '11002257', 'GIRIDHARI MUKHERJEE', 2, 2, 1, 1);
}
for (const [c, n, d] of [['11001774','DEBABRATA CHAKRABORTY- FKT','SO/SE'],['11001393','DEBABRATA GHOSH','ASM'],
                         ['11001813','RITWICK CHATTERJEE','RSM'],['11002257','GIRIDHARI MUKHERJEE','ZH']])
  db.prepare('INSERT INTO master_employees (emp_code, emp_name, designation) VALUES (?,?,?)').run(c, n, d);

function call(handler, body = {}) {
  return new Promise(resolve => {
    let code = 200;
    const res = { status(c) { code = c; return this; }, json(payload) { resolve({ code, body: payload }); } };
    handler({ body, params: {}, query: {} }, res).catch(e => resolve({ code: 500, body: { error: e.message } }));
  });
}

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ── 1. the pipeline asks every role for a plan ───────────────────────────────
reset();
const run = await runGenerationPipeline(PERIOD, 'C1', { dealerMappingBatchCode: 'B-DM' });

check('the DJP solver runs before any plan is built', () => {
  assert.equal(calls.order[0], 'djp:C1');
  assert.ok(calls.order.slice(1).every(c => c.startsWith('plan:')));
});
check('all four roles are asked for a plan — SO, ASM, RSM and ZH', () => {
  assert.deepEqual([...new Set(calls.plans.map(p => p.role))], ['SO', 'ASM', 'RSM', 'ZH']);
});
check('each role is asked using its CODE, not its name', () => {
  const byRole = Object.fromEntries(calls.plans.map(p => [p.role, p.empCode]));
  assert.equal(byRole.SO,  '11001774');
  assert.equal(byRole.ASM, '11001393');
  assert.equal(byRole.RSM, '11001813');   // regression: was looked up by rsm_name
  assert.equal(byRole.ZH,  '11002257');   // regression: was looked up by zh_name
});
check('the pipeline reports what it built, per role', () => {
  assert.equal(run.plans.totalPlans, 4);
  assert.equal(run.plans.byRole.RSM.plansCreated, 1);
  assert.equal(run.plans.byRole.ZH.plansCreated, 1);
  assert.equal(run.plans.errors.length, 0);
});
check('routing is stamped after the plans exist', () => {
  assert.equal(run.plans.routing.stamped, 4);
  assert.equal(run.plans.routing.unrouted, 0);
});
const soPlan = await dbGet("SELECT * FROM sales_plans WHERE emp_code = '11001774' AND cycle_code = 'C1'");
check('a generated plan is immediately routable by the app', () => {
  assert.equal(soPlan.emp_role, 'SO');
  assert.equal(soPlan.l1_approver_emp_code, '11001393');
  assert.equal(soPlan.status, 'DRAFT');
});

// ── 2. no adherence context on a plain DJP run ───────────────────────────────
check('a plain DJP run carries no adherence context', () => {
  assert.ok(calls.plans.every(p => p.opts.sfaAdherenceByEmployee === undefined));
});

// ── 3. regenerating after adherence uses the same path ───────────────────────
reset();
const regen = await call(regenerateC2Plans, { periodMonth: PERIOD });

check('regenerate-c2 succeeds', () => assert.equal(regen.code, 200));
check('adherence is analysed BEFORE anything is regenerated', () => {
  assert.equal(calls.order[0], 'adherence:2026-09');
  assert.equal(calls.order[1], 'djp:C2');
});
check('it runs the identical pipeline — DJP, then all four roles', () => {
  assert.deepEqual([...new Set(calls.plans.map(p => p.role))], ['SO', 'ASM', 'RSM', 'ZH']);
  assert.equal(regen.body.officerPlans.totalPlans, 4);
});
check('the adherence context is forwarded to every plan built', () => {
  assert.ok(calls.plans.length > 0);
  assert.ok(calls.plans.every(p => p.opts.sfaAdherenceByEmployee instanceof Map),
    'missed C1 dealers must be available to the C2 scheduler');
});
check('only C2 is touched — C1 is the record adherence was measured against', () => {
  assert.ok(calls.order.every(c => !c.endsWith(':C1')));
});
check('the response reports the plans it generated, not just the adherence', () => {
  assert.equal(regen.body.officerPlans.byRole.SO.plansCreated, 1);
  assert.match(regen.body.message, /4 officer plan\(s\) generated across 4 roles/);
});
check('both adherence percentages are reported', () => {
  assert.ok('adherencePct' in regen.body.adherenceSummary);
  assert.ok('dealerLevelPct' in regen.body.adherenceSummary);
});

// ── 4. the regeneration is recorded and the purge is real ────────────────────
const runRow = await dbGet("SELECT * FROM generation_runs WHERE cycle_code = 'C2' ORDER BY id DESC LIMIT 1");
check('the regeneration appears in the run history', () => {
  assert.ok(runRow, 'a generation_runs row must exist — the old code never inserted one');
  assert.match(runRow.generation_code, /C2REGEN/);
  assert.equal(runRow.status, 'COMPLETED');
});
check('stale C2 visit targets are purged, not merged', () => {
  assert.ok(calls.purged.includes('dealer_visit_targets:C2'),
    'the old code deleted plans and recommendations but left dealer_visit_targets behind');
});

// ── 5. a role with no targets is reported, not silently skipped ──────────────
reset();
await dbRun("DELETE FROM dealer_visit_targets WHERE cycle_code = 'C1' ");
const empty = await generatePlansForAllRoles(PERIOD, 'C1');
check('a cycle with no targets produces no plans and no errors', () => {
  assert.equal(empty.totalPlans, 0);
  assert.equal(empty.errors.length, 0);
  assert.equal(empty.byRole.SO.employees, 0);
});

console.log('\n' + '─'.repeat(72));
let pass = 0, fail = 0;
for (const r of results) {
  if (r[0] === 'PASS') { pass++; console.log(`  ✓ ${r[1]}`); }
  else { fail++; console.log(`  ✗ ${r[1]}\n      ${r[2]}`); }
}
console.log('─'.repeat(72));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
