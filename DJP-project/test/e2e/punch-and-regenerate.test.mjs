/**
 * PUNCH A VISIT, THEN REBUILD C2 FROM IT.
 *
 * The loop the demo needs to show end to end:
 *
 *   officer punches a visit  →  it lands in the SFA visit log, in SFA report shape
 *                            →  his adherence moves, and his manager's team number with it
 *                            →  C2 is regenerated, and what he MISSED is scheduled first
 *
 * The thing worth protecting is that a punched visit is not a special kind of visit.
 * It goes into the same table, under the same column vocabulary, as a row uploaded
 * from the client's SFA report — so adherence and the C2 rebuild cannot tell them
 * apart. These checks assert exactly that, rather than trusting it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAll, dbGet, dbRun } from './sandbox/src/config/database.js';
import { seedAgartala, KIT } from './seed-agartala.mjs';

const here   = dirname(fileURLToPath(import.meta.url));
const PERIOD = KIT.plan;
const CYCLE  = 'C1';

let pass = 0, fail = 0;
const okA = async (n, fn) => { try { await fn(); console.log(`  ✓ ${n}`); pass++; }
                               catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const S = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`);
const note = (k, v) => console.log(`     ${String(k).padEnd(46, '.')} ${v}`);
const silence = () => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {};
                        return () => { console.log = l; console.warn = w; }; };

const call = async (handler, { params = {}, query = {}, body = {} } = {}) => {
  let code = 200, payload = null;
  const res = { status(c) { code = c; return this; }, json(p) { payload = p; return this; } };
  await handler({ params, query, body }, res);
  return { code, body: payload };
};

const PAGE = readFileSync(join(here, '..', '..', 'public', 'simulator.html'), 'utf8');

console.log('\n' + '═'.repeat(76));
console.log('  PUNCH → ADHERENCE → C2 REGENERATION');
console.log('═'.repeat(76));

await seedAgartala();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const gen = await import('./sandbox/src/controllers/generation.controller.js');
{
  const un = silence();
  await generateFullPjpDjpSolution(PERIOD, CYCLE, { generationRunCode: 'GEN-PUNCH' });
  await gen.generatePlansForAllRoles(PERIOD, CYCLE, {});
  un();
}
const app = await import('./sandbox/src/controllers/appPlan.controller.js');

const soRow = await dbGet(
  `SELECT p.id, p.emp_code, p.emp_name, p.l1_approver_emp_code,
          (SELECT COUNT(*) FROM sales_plan_details d WHERE d.plan_id = p.id) visits
     FROM sales_plans p
    WHERE p.period_month=? AND p.cycle_code=? AND p.emp_role='SO'
      AND p.l1_approver_emp_code IS NOT NULL
    ORDER BY visits DESC LIMIT 1`, [PERIOD, CYCLE]);
const SO = soRow.emp_code, L1 = soRow.l1_approver_emp_code, PLAN = soRow.id;
note('officer', `${soRow.emp_name} (${SO}) — ${soRow.visits} visits`);

const firstVisit = await dbGet(
  `SELECT d.visit_date, d.dealer_sap_code, d.dealer_name
     FROM sales_plan_details d WHERE d.plan_id = ? ORDER BY d.visit_date, d.sequence LIMIT 1`,
  [PLAN]);
const DAY = String(firstVisit.visit_date).slice(0, 10);
note('first visit on his plan', `${firstVisit.dealer_name} on ${DAY}`);

// ─────────────────────────────────────────────────────────────────────────────
S('1. the endpoint, and the button that calls it');

await okA('the punch route is on the API router and the page calls it', async () => {
  const routes = readFileSync(join(here, '..', '..', 'src', 'routes', 'api.routes.js'), 'utf8');
  assert.ok(routes.includes('/app/officers/:empCode/visits/punch'), 'not routed');
  assert.ok(PAGE.includes('/visits/punch'), 'the page never punches anything');
  assert.ok(PAGE.includes('openPunch('), 'there is no Punch button');
  assert.ok(PAGE.includes('/generation/regenerate-c2'), 'the page cannot regenerate C2');
});

// ─────────────────────────────────────────────────────────────────────────────
S('2. punching writes an SFA row, not a special one');

let punched = null;
await okA('a punch is accepted and answers in SFA report shape', async () => {
  const r = await call(app.punchVisit, {
    params: { empCode: SO },
    body: { visitDate: DAY, dealerCode: firstVisit.dealer_sap_code,
            checkInTime: '10:05', checkOutTime: '10:39', visitStatus: 'Productive' }
  });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  punched = r.body;
  assert.equal(punched.planned, true, 'a visit on his own plan came back as unplanned');
  note('  response', punched.message);
});

await okA('its fields are the SFA report columns, named exactly as the importer reads them', async () => {
  const src = readFileSync(join(here, '..', '..', 'src', 'imports', 'sfa-report.importer.js'), 'utf8');
  const keys = Object.keys(punched.sfa_row);
  note('  fields returned', keys.length);
  for (const k of keys)
    assert.ok(src.includes(`row['${k}']`), `the importer never reads "${k}"`);
  assert.equal(keys.length, 14);
});

await okA('the stored row is indistinguishable from an uploaded one', async () => {
  const row = await dbGet(
    `SELECT * FROM visit_execution_logs WHERE employee_code = ? AND visit_date = ?`,
    [SO, DAY]);
  assert.ok(row, 'nothing was written to the visit log');
  // Every column the importer fills must be filled here too — a half-written row
  // would still count for adherence but would export and audit as junk.
  for (const col of ['customer_code', 'customer_name', 'customer_type', 'employee_code',
                     'employee_name', 'check_in_time', 'check_out_time', 'duration',
                     'visit_status', 'purpose_of_visit'])
    assert.ok(row[col] !== null && row[col] !== '', `${col} was left empty`);
  assert.equal(row.visit_status, 'Productive');
  assert.equal(row.duration, '34 Minute(s)');
  note('  check in / out / duration', `${row.check_in_time} → ${row.check_out_time} · ${row.duration}`);
  note('  batch_code', row.batch_code);
  assert.match(row.batch_code, /^APP-PUNCH-/, 'a punch should be traceable as a punch');
});

await okA('the plan now shows that visit as done', async () => {
  const p = (await call(app.getMyPlanDetail, { params: { empCode: SO, planId: PLAN } })).body.plan;
  const day = p.days.find(d => d.visit_date === DAY);
  const v = day.visits.find(x =>
    String(x.dealer.sap_code || x.dealer.sfa_code).toUpperCase() ===
    String(firstVisit.dealer_sap_code).toUpperCase());
  assert.ok(v, 'the visit vanished from the plan');
  assert.equal(v.executed, true, 'the plan does not know the visit was punched');
  assert.equal(v.execution.check_in_time, '10:05:00');
  const others = p.days.flatMap(d => d.visits).filter(x => !x.executed).length;
  note('  punched / still to do', `1 / ${others}`);
});

await okA('the same dealer on the same day is refused', async () => {
  const r = await call(app.punchVisit, {
    params: { empCode: SO },
    body: { visitDate: DAY, dealerCode: firstVisit.dealer_sap_code }
  });
  assert.equal(r.code, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /already punched/i);
  const n = await dbGet(
    `SELECT COUNT(*) c FROM visit_execution_logs WHERE employee_code=? AND visit_date=?`,
    [SO, DAY]);
  assert.equal(Number(n.c), 1, 'the refused punch still wrote a row');
});

await okA('a code nobody has heard of is refused, not silently logged', async () => {
  const r = await call(app.punchVisit, {
    params: { empCode: SO }, body: { visitDate: DAY, dealerCode: 'NOT-A-DEALER' } });
  assert.equal(r.code, 404);
  assert.match(r.body.error, /not on|not a counter/i);
});

await okA('a malformed date is refused with a clear message', async () => {
  const r = await call(app.punchVisit, {
    params: { empCode: SO }, body: { visitDate: '01-06-2026', dealerCode: firstVisit.dealer_sap_code } });
  assert.equal(r.code, 400);
  assert.match(r.body.error, /YYYY-MM-DD/);
});

await okA('a visit that is not on the plan is allowed, but declared unplanned', async () => {
  // Unplanned visits are real. What matters is that the response says so rather than
  // letting it pass as adherence to a plan that never existed.
  const other = await dbGet(
    `SELECT sap_code, sfa_code, dealer_name FROM dealer_visit_targets
      WHERE period_month=? AND cycle_code=?
        AND sap_code NOT IN (SELECT dealer_sap_code FROM sales_plan_details WHERE plan_id=?)
      LIMIT 1`, [PERIOD, CYCLE, PLAN]);
  if (!other) { note('  (no unplanned counter available in this kit)', ''); return; }
  const r = await call(app.punchVisit, {
    params: { empCode: SO },
    body: { visitDate: DAY, dealerCode: other.sap_code || other.sfa_code } });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  assert.equal(r.body.planned, false);
  assert.match(r.body.message, /NOT on the plan/i);
  note('  unplanned punch', other.dealer_name);
});

// ─────────────────────────────────────────────────────────────────────────────
S('3. adherence moves — his, and his manager\'s');

await okA('his own adherence counts the punch', async () => {
  const un = silence();
  const a = await call(app.getMyAdherence, {
    params: { empCode: SO }, query: { month: PERIOD, cycle: CYCLE } });
  un();
  assert.ok(a.body.totals.adhered >= 1, 'the punched visit was not counted');
  const done = a.body.dealers.filter(d => d.visit_dates.length);
  note('  adherence / adhered', `${a.body.adherence.capped_pct}% / ${a.body.totals.adhered}`);
  note('  counters with a visit', done.length);
  assert.ok(done.some(d =>
    String(d.dealer_name).toUpperCase() === String(firstVisit.dealer_name).toUpperCase()),
    'the punched counter is not marked visited');
});

await okA('his manager sees the same movement', async () => {
  const un = silence();
  const t = await call(app.getTeamAdherence, {
    params: { empCode: L1 }, query: { month: PERIOD, cycle: CYCLE } });
  const own = await call(app.getMyAdherence, {
    params: { empCode: SO }, query: { month: PERIOD, cycle: CYCLE } });
  un();
  const line = t.body.team.find(m => m.emp_code === SO);
  assert.equal(line.capped_pct, own.body.adherence.capped_pct);
  assert.equal(line.adhered, own.body.totals.adhered);
  note('  team line vs his own view', `${line.capped_pct}% / ${own.body.adherence.capped_pct}%`);
});

await okA('punching more moves the number further, in the right direction', async () => {
  const un = silence();
  const before = (await call(app.getMyAdherence, {
    params: { empCode: SO }, query: { month: PERIOD, cycle: CYCLE } })).body;

  const more = await dbAll(
    `SELECT d.visit_date, d.dealer_sap_code FROM sales_plan_details d
      WHERE d.plan_id = ? AND d.dealer_sap_code <> ? LIMIT 4`,
    [PLAN, firstVisit.dealer_sap_code]);
  for (const m of more) {
    await call(app.punchVisit, { params: { empCode: SO },
      body: { visitDate: String(m.visit_date).slice(0, 10), dealerCode: m.dealer_sap_code } });
  }
  const after = (await call(app.getMyAdherence, {
    params: { empCode: SO }, query: { month: PERIOD, cycle: CYCLE } })).body;
  un();
  note('  adhered before / after', `${before.totals.adhered} → ${after.totals.adhered}`);
  note('  adherence before / after',
       `${before.adherence.capped_pct}% → ${after.adherence.capped_pct}%`);
  assert.ok(after.totals.adhered > before.totals.adhered, 'punching four visits changed nothing');
  assert.ok(after.adherence.capped_pct >= before.adherence.capped_pct);
  assert.ok(after.totals.dealers_missed <= before.totals.dealers_missed);
});

// ─────────────────────────────────────────────────────────────────────────────
S('4. C2 is rebuilt from what was actually visited');

const punchedCodes = (await dbAll(
  `SELECT DISTINCT UPPER(TRIM(customer_code)) AS code FROM visit_execution_logs
    WHERE employee_code = ?`, [SO])).map(r => r.code);
note('counters he punched', punchedCodes.length);

let regen = null;
await okA('regeneration reads the punches and rebuilds C2', async () => {
  const un = silence();
  const r = await call(gen.regenerateC2Plans, { body: { periodMonth: PERIOD } });
  un();
  assert.equal(r.code, undefined === r.code ? r.code : 200, JSON.stringify(r.body).slice(0, 300));
  regen = r.body;
  assert.ok(regen.adherenceSummary, 'no adherence summary came back');
  note('  C1 planned / completed',
       `${regen.adherenceSummary.plannedC1Visits} / ${regen.adherenceSummary.completedC1Visits}`);
  assert.ok(regen.adherenceSummary.completedC1Visits >= 1,
    'the regeneration did not see a single punched visit');
});

await okA('C1 is untouched by the rebuild', async () => {
  const c1 = await dbGet(
    `SELECT COUNT(*) AS plans FROM sales_plans WHERE period_month=? AND cycle_code='C1'`, [PERIOD]);
  const c1Visits = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code='C1'`, [PERIOD]);
  note('  C1 plans / visits after regeneration', `${c1.plans} / ${c1Visits.n}`);
  assert.ok(Number(c1.plans) > 0, 'the rebuild deleted C1');
  assert.equal(Number(c1Visits.n), Number(soRow.visits) + (await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code='C1' AND p.id <> ?`, [PERIOD, PLAN])).n);
});

await okA('a fresh C2 exists, with plans and visits', async () => {
  const c2 = await dbGet(
    `SELECT COUNT(*) AS plans FROM sales_plans WHERE period_month=? AND cycle_code='C2'`, [PERIOD]);
  const v = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code='C2'`, [PERIOD]);
  note('  C2 plans / visits', `${c2.plans} / ${v.n}`);
  assert.ok(Number(c2.plans) > 0, 'no C2 plans were produced');
  assert.ok(Number(v.n) > 0, 'C2 has no visits');
});

await okA('every C2 visit sits inside the C2 window — the rebuild did not spill into C1', async () => {
  const stray = await dbAll(
    `SELECT DISTINCT d.visit_date FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code='C2'
        AND CAST(substr(d.visit_date, 9, 2) AS INTEGER) < 16`, [PERIOD]).catch(() => []);
  assert.equal(stray.length, 0, `C2 visits on C1 days: ${stray.map(s => s.visit_date).join(', ')}`);
});

await okA('the counters he MISSED in C1 are scheduled in the new C2', async () => {
  // The whole point of regenerating: what he did not get to should come back round.
  const c1Dealers = await dbAll(
    `SELECT DISTINCT UPPER(TRIM(d.dealer_sap_code)) AS code, d.dealer_name
       FROM sales_plan_details d WHERE d.plan_id = ?`, [PLAN]);
  const missed = c1Dealers.filter(d => !punchedCodes.includes(d.code));
  const c2Codes = new Set((await dbAll(
    `SELECT DISTINCT UPPER(TRIM(d.dealer_sap_code)) AS code
       FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code='C2' AND p.emp_code=?`,
    [PERIOD, SO])).map(r => r.code));
  const carried = missed.filter(m => c2Codes.has(m.code));
  note('  missed in C1 / carried into C2', `${missed.length} / ${carried.length}`);
  assert.ok(missed.length > 0, 'he punched everything — nothing to carry');
  assert.ok(carried.length > 0, 'not one missed counter was carried into the new C2');
});

await okA('a punched counter is not given priority over one he never reached', async () => {
  // Not "never scheduled again" — a counter can legitimately be owed a second visit.
  // What must not happen is a visited counter being scheduled EARLIER than a missed one.
  const rows = await dbAll(
    `SELECT UPPER(TRIM(d.dealer_sap_code)) AS code, MIN(d.visit_date) AS first_day
       FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code='C2' AND p.emp_code=?
      GROUP BY UPPER(TRIM(d.dealer_sap_code))`, [PERIOD, SO]);
  const done = rows.filter(r => punchedCodes.includes(r.code));
  const notDone = rows.filter(r => !punchedCodes.includes(r.code));
  if (!done.length || !notDone.length) { note('  (not enough of both kinds to compare)', ''); return; }
  const earliestDone = done.map(r => String(r.first_day)).sort()[0];
  const earliestMissed = notDone.map(r => String(r.first_day)).sort()[0];
  note('  earliest missed / earliest already-visited', `${earliestMissed} / ${earliestDone}`);
  assert.ok(earliestMissed <= earliestDone,
    'a counter he already visited is scheduled before one he missed');
});

await okA('the regeneration is recorded, so the run history shows it happened', async () => {
  const run = await dbGet(
    `SELECT generation_code, cycle_code, status FROM generation_runs
      WHERE report_month = ? AND cycle_code = 'C2' ORDER BY id DESC LIMIT 1`, [PERIOD]);
  assert.ok(run, 'the rebuild left no run record');
  note('  run', `${run.generation_code} · ${run.status}`);
  assert.match(run.generation_code, /C2REGEN/);
});


// ─────────────────────────────────────────────────────────────────────────────
S('5. what changes after the 15th');

let hand = null;
await okA('the handover reports C1 against C2, counter by counter', async () => {
  const r = await call(app.getCycleHandover, { query: { month: PERIOD, empCode: SO } });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
  hand = r.body;
  note('  windows', `${hand.windows.C1} | ${hand.windows.C2}`);
  note('  C1 counters / visited / missed',
       `${hand.summary.c1_counters} / ${hand.summary.c1_visited} / ${hand.summary.c1_missed}`);
  note('  carried into C2', hand.summary.carried_forward);
  assert.equal(hand.c2_exists, true, 'C2 was regenerated above, so it must be seen');
  assert.ok(hand.summary.c1_counters > 0);
});

await okA('every counter is given exactly one outcome, and it follows from its own numbers', async () => {
  const seen = {};
  for (const c of hand.counters) {
    seen[c.outcome] = (seen[c.outcome] || 0) + 1;
    if (c.outcome === 'CARRIED_FORWARD') {
      assert.ok(c.c1_planned > 0 && !c.c1_visited && c.c2_planned > 0, `${c.dealer_name}`);
    } else if (c.outcome === 'MISSED_AND_DROPPED') {
      assert.ok(c.c1_planned > 0 && !c.c1_visited && !c.c2_planned, `${c.dealer_name}`);
    } else if (c.outcome === 'NEW_IN_C2') {
      assert.ok(!c.c1_planned && c.c2_planned > 0, `${c.dealer_name}`);
    } else if (c.outcome.startsWith('VISITED')) {
      assert.ok(c.c1_visited, `${c.dealer_name} is marked visited but has no visit`);
    }
  }
  note('  outcomes', Object.entries(seen).map(([k, v]) => `${k} ${v}`).join(' · '));
  assert.equal(hand.summary.carried_forward, seen.CARRIED_FORWARD || 0);
});

await okA('the summary counts match the counter rows', async () => {
  const c1 = hand.counters.filter(c => c.c1_planned > 0);
  assert.equal(hand.summary.c1_counters, c1.length);
  assert.equal(hand.summary.c1_visited, c1.filter(c => c.c1_visited).length);
  assert.equal(hand.summary.c1_missed, c1.filter(c => !c.c1_visited).length);
  assert.equal(hand.summary.c1_visited + hand.summary.c1_missed, hand.summary.c1_counters);
});

await okA('a counter he visited in C1 is not reported as carried forward', async () => {
  for (const code of punchedCodes) {
    const c = hand.counters.find(x =>
      String(x.customer_code).trim().toUpperCase() === code);
    if (!c || !c.c1_planned) continue;
    assert.notEqual(c.outcome, 'CARRIED_FORWARD',
      `${c.dealer_name} was visited in C1 but reads as carried forward`);
  }
  note('  punched counters checked', punchedCodes.length);
});

await okA('it answers before C2 exists too, and says so', async () => {
  // The panel has to work BEFORE the rebuild — that is when a manager wants to know
  // what is about to carry forward.
  const other = await dbGet(
    `SELECT period_month FROM sales_plans WHERE period_month <> ? LIMIT 1`, [PERIOD]);
  const r = await call(app.getCycleHandover, { query: { month: '2020-01' } });
  assert.equal(r.code, 200);
  assert.equal(r.body.c2_exists, false);
  assert.match(r.body.explains, /not been generated/i);
  assert.deepEqual(r.body.counters, []);
});

await okA('a bad month is refused', async () => {
  const r = await call(app.getCycleHandover, { query: { month: 'June' } });
  assert.equal(r.code, 400);
});

// ─────────────────────────────────────────────────────────────────────────────
S('6. a visit beyond the plan');

await okA('he can log a SECOND visit to a counter he already visited, on another day', async () => {
  // Officers do go back. Refusing would push the visit off the books entirely.
  const done = await dbGet(
    `SELECT customer_code, visit_date FROM visit_execution_logs
      WHERE employee_code = ? ORDER BY visit_date LIMIT 1`, [SO]);
  const another = `${PERIOD}-12`;
  const before = await dbGet(
    `SELECT COUNT(*) n FROM visit_execution_logs WHERE employee_code=? AND customer_code=?`,
    [SO, done.customer_code]);
  const r = await call(app.punchVisit, {
    params: { empCode: SO },
    body: { visitDate: another, dealerCode: done.customer_code, purposeOfVisit: 'Follow-up' } });
  assert.equal(r.code, 201, JSON.stringify(r.body));
  const after = await dbGet(
    `SELECT COUNT(*) n FROM visit_execution_logs WHERE employee_code=? AND customer_code=?`,
    [SO, done.customer_code]);
  note('  visits to that counter', `${before.n} → ${after.n}`);
  assert.equal(Number(after.n), Number(before.n) + 1);
});

await okA('the page offers a way to log one', async () => {
  assert.ok(PAGE.includes('openExtraVisit('), 'there is no way to log an unplanned visit');
  assert.ok(PAGE.includes('Log a visit'), 'the button is not labelled');
  assert.ok(PAGE.includes('/dealers'), 'the dialog cannot list his counters');
});

console.log('\n' + '─'.repeat(76));
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
