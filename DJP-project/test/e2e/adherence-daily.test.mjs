/**
 * DAILY ADHERENCE — the running total an admin or an L1 reads each morning.
 *
 * The headline figure prorates (MTD due = planned x elapsed fraction of the cycle).
 * This series does not: for each day it asks how many visits were DUE by that date and
 * how many had been MADE by then. Exact to the day, and a visit made late still counts
 * once it happens.
 *
 * The two numbers answer different questions and will not match. What these checks
 * protect is that the daily one is internally honest: monotonic, capped, reconciling
 * with the database, scoped to the right people, and never counting a visit twice.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAll, dbGet, dbRun } from './sandbox/src/config/database.js';
import { seedAgartala, seedAgartalaSfa, KIT } from './seed-agartala.mjs';

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
console.log('  DAILY ADHERENCE — accumulating, day by day');
console.log('═'.repeat(76));

await seedAgartala();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const gen = await import('./sandbox/src/controllers/generation.controller.js');
{
  const un = silence();
  await generateFullPjpDjpSolution(PERIOD, CYCLE, { generationRunCode: 'GEN-DAILY' });
  await gen.generatePlansForAllRoles(PERIOD, CYCLE, {});
  un();
}
const sfaRows = await seedAgartalaSfa();
note('SFA visits logged', sfaRows);

const app = await import('./sandbox/src/controllers/appPlan.controller.js');

const soRow = await dbGet(
  `SELECT p.id, p.emp_code, p.emp_name, p.l1_approver_emp_code,
          (SELECT COUNT(*) FROM sales_plan_details d WHERE d.plan_id = p.id) visits
     FROM sales_plans p
    WHERE p.period_month=? AND p.cycle_code=? AND p.emp_role='SO'
      AND p.l1_approver_emp_code IS NOT NULL
    ORDER BY visits DESC LIMIT 1`, [PERIOD, CYCLE]);
const SO = soRow.emp_code, L1 = soRow.l1_approver_emp_code;
note('officer / his L1', `${soRow.emp_name} (${SO}) / ${L1}`);

// ─────────────────────────────────────────────────────────────────────────────
S('1. routed, and the panes read it');

await okA('both daily routes exist and the simulator renders the table', async () => {
  const routes = readFileSync(join(here, '..', '..', 'src', 'routes', 'api.routes.js'), 'utf8');
  assert.ok(routes.includes('/app/admin/adherence/daily'), 'admin daily not routed');
  assert.ok(routes.includes('/app/approvers/:empCode/adherence/daily'), 'team daily not routed');
  assert.ok(PAGE.includes('/adherence/daily'), 'the page never asks for the daily series');
  assert.ok(PAGE.includes('dailyTable('), 'the page cannot draw the daily table');
  for (const f of ['cum_pct', 'cum_adhered', 'cum_planned', 'is_future'])
    assert.ok(PAGE.includes(f), `the page never reads "${f}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
S('2. the shape of the series');

let all = null;
await okA('one row per day of the cycle, in order, none missing', async () => {
  const r = await call(app.getDailyAdherence, { query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  all = r.body;
  note('  window', `${all.cycle_window.from} → ${all.cycle_window.to}`);
  note('  rows', all.days.length);
  const dates = all.days.map(d => d.date);
  assert.deepEqual(dates, [...dates].sort(), 'days are out of order');
  assert.equal(new Set(dates).size, dates.length, 'a day appears twice');
  // C1 is days 1-15 by the seeded business rules.
  assert.equal(all.days[0].date, `${PERIOD}-01`);
  assert.equal(all.days[all.days.length - 1].date, `${PERIOD}-15`);
});

await okA('the planned counts add up to the plans in the database', async () => {
  const truth = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month = ? AND p.cycle_code = ?`, [PERIOD, CYCLE]);
  const summed = all.days.reduce((s, d) => s + d.planned, 0);
  note('  planned across the cycle', `${summed} (db says ${truth.n})`);
  assert.equal(summed, Number(truth.n));
  assert.equal(all.totals.planned_in_cycle, Number(truth.n));
});

await okA('each day\'s planned count matches that day\'s plans', async () => {
  const perDay = await dbAll(
    `SELECT d.visit_date AS day, COUNT(*) AS n
       FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month = ? AND p.cycle_code = ?
      GROUP BY d.visit_date`, [PERIOD, CYCLE]);
  const byDay = new Map(perDay.map(r => [String(r.day).slice(0, 10), Number(r.n)]));
  for (const row of all.days)
    assert.equal(row.planned, byDay.get(row.date) || 0, `${row.date}: planned mismatch`);
  note('  days with visits planned', byDay.size);
});

// ─────────────────────────────────────────────────────────────────────────────
S('3. the accumulation behaves');

await okA('cum_planned and cum_adhered only ever go up', async () => {
  let p = -1, a = -1;
  for (const d of all.days) {
    assert.ok(d.cum_planned >= p, `${d.date}: cum_planned went backwards`);
    assert.ok(d.cum_adhered >= a, `${d.date}: cum_adhered went backwards`);
    p = d.cum_planned; a = d.cum_adhered;
  }
  const last = all.days[all.days.length - 1];
  note('  end of cycle', `${last.cum_adhered} of ${last.cum_planned} · ${last.cum_pct}%`);
});

await okA('cum_planned on each day equals the visits due up to that day', async () => {
  for (const d of all.days) {
    const upto = await dbGet(
      `SELECT COUNT(*) AS n FROM sales_plan_details x JOIN sales_plans p ON p.id = x.plan_id
        WHERE p.period_month=? AND p.cycle_code=? AND x.visit_date <= ?`,
      [PERIOD, CYCLE, d.date]);
    assert.equal(d.cum_planned, Number(upto.n), `${d.date}: cum_planned is wrong`);
  }
});

await okA('adhered never exceeds due, so the percentage cannot pass 100', async () => {
  for (const d of all.days) {
    assert.ok(d.cum_adhered <= d.cum_planned, `${d.date}: ${d.cum_adhered} > ${d.cum_planned}`);
    assert.ok(d.cum_pct >= 0 && d.cum_pct <= 100, `${d.date}: ${d.cum_pct}%`);
  }
});

await okA('the percentage is the two running totals divided, not a separate number', async () => {
  for (const d of all.days) {
    const expected = d.cum_planned > 0
      ? Math.round((d.cum_adhered / d.cum_planned) * 1000) / 10 : 0;
    assert.equal(d.cum_pct, expected, `${d.date}`);
  }
});

await okA('a second visit to the same counter does not inflate the number', async () => {
  // Capping is the whole difference between "how much work got done" and "how many
  // times did anyone log anything".
  const before = (await call(app.getDailyAdherence, {
    query: { month: PERIOD, cycle: CYCLE, empCode: SO } })).body;
  const anyLog = await dbGet(
    `SELECT visit_date, customer_code, customer_name, employee_name
       FROM visit_execution_logs WHERE employee_code = ? LIMIT 1`, [SO]);
  if (!anyLog) { note('  (this officer has no logged visit to duplicate)', ''); return; }

  await dbRun(
    `INSERT INTO visit_execution_logs
       (visit_date, customer_code, customer_name, employee_code, employee_name,
        check_in_time, visit_status, batch_code)
     VALUES (?, ?, ?, ?, ?, '15:00:00', 'Productive', 'TEST-DUP')`,
    [anyLog.visit_date, anyLog.customer_code, anyLog.customer_name, SO, anyLog.employee_name]);

  const after = (await call(app.getDailyAdherence, {
    query: { month: PERIOD, cycle: CYCLE, empCode: SO } })).body;
  note('  cum_adhered before / after a duplicate log',
       `${before.totals.cum_adhered} → ${after.totals.cum_adhered}`);
  assert.equal(after.totals.cum_adhered, before.totals.cum_adhered,
    'a repeat visit to the same counter inflated adherence');
  // logged_in_cycle is the DE-DUPLICATED count, so it must not move either. The raw
  // row count must, otherwise the duplicate was never read and this proves nothing.
  assert.equal(after.totals.logged_in_cycle, before.totals.logged_in_cycle,
    'the duplicate was counted as a second visit');
  assert.ok(after.totals.log_rows_read > before.totals.log_rows_read,
    'the extra log row was never read — the test is not exercising the de-duplication');
  note('  raw log rows before / after',
       `${before.totals.log_rows_read} → ${after.totals.log_rows_read}`);
  await dbRun(`DELETE FROM visit_execution_logs WHERE batch_code = 'TEST-DUP'`);
});

await okA('a visit made late still counts, from the day it happened', async () => {
  const planned = await dbGet(
    `SELECT d.visit_date, d.dealer_sap_code, d.dealer_name
       FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.emp_code = ? AND p.period_month = ? AND p.cycle_code = ?
        AND d.visit_date <= ?
        AND UPPER(TRIM(d.dealer_sap_code)) NOT IN (
          SELECT UPPER(TRIM(customer_code)) FROM visit_execution_logs WHERE employee_code = ?)
      ORDER BY d.visit_date LIMIT 1`,
    [SO, PERIOD, CYCLE, `${PERIOD}-10`, SO]);
  if (!planned) { note('  (no unvisited early counter to use)', ''); return; }

  const plannedDay = String(planned.visit_date).slice(0, 10);
  const lateDay = `${PERIOD}-14`;
  const before = (await call(app.getDailyAdherence, {
    query: { month: PERIOD, cycle: CYCLE, empCode: SO } })).body;

  await dbRun(
    `INSERT INTO visit_execution_logs
       (visit_date, customer_code, customer_name, employee_code, employee_name,
        check_in_time, visit_status, batch_code)
     VALUES (?, ?, ?, ?, ?, '11:00:00', 'Productive', 'TEST-LATE')`,
    [lateDay, planned.dealer_sap_code, planned.dealer_name, SO, soRow.emp_name]);

  const after = (await call(app.getDailyAdherence, {
    query: { month: PERIOD, cycle: CYCLE, empCode: SO } })).body;
  const dayOf = (s2, date) => s2.days.find(d => d.date === date);
  note('  planned / visited', `${plannedDay} → ${lateDay}`);
  note(`  cum_adhered on ${plannedDay}`,
       `${dayOf(before, plannedDay).cum_adhered} → ${dayOf(after, plannedDay).cum_adhered}`);
  note(`  cum_adhered on ${lateDay}`,
       `${dayOf(before, lateDay).cum_adhered} → ${dayOf(after, lateDay).cum_adhered}`);

  assert.equal(dayOf(after, plannedDay).cum_adhered, dayOf(before, plannedDay).cum_adhered,
    'a visit made later was back-dated to the day it was planned');
  assert.equal(dayOf(after, lateDay).cum_adhered, dayOf(before, lateDay).cum_adhered + 1,
    'the late visit was never counted');
  await dbRun(`DELETE FROM visit_execution_logs WHERE batch_code = 'TEST-LATE'`);
});

// ─────────────────────────────────────────────────────────────────────────────
S('4. scope — admin sees everyone, an L1 sees his own people');

await okA('narrowing to one officer returns a smaller series, not the same one', async () => {
  const one = (await call(app.getDailyAdherence, {
    query: { month: PERIOD, cycle: CYCLE, empCode: SO } })).body;
  note('  planned: everyone / this officer',
       `${all.totals.planned_in_cycle} / ${one.totals.planned_in_cycle}`);
  assert.ok(one.totals.planned_in_cycle > 0, 'the officer filter returned nothing');
  assert.ok(one.totals.planned_in_cycle < all.totals.planned_in_cycle,
    'filtering to one officer changed nothing — the filter is not applied');
  const truth = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code=? AND p.emp_code=?`, [PERIOD, CYCLE, SO]);
  assert.equal(one.totals.planned_in_cycle, Number(truth.n));
});

await okA('a role filter covers exactly the officers in that role', async () => {
  const so = (await call(app.getDailyAdherence, {
    query: { month: PERIOD, cycle: CYCLE, role: 'SO' } })).body;
  const truth = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code=? AND p.emp_role='SO'`, [PERIOD, CYCLE]);
  note('  SO planned in cycle', so.totals.planned_in_cycle);
  assert.equal(so.totals.planned_in_cycle, Number(truth.n));
});

await okA('the L1 series covers his team and nobody else', async () => {
  const t = (await call(app.getTeamDailyAdherence, {
    params: { empCode: L1 }, query: { month: PERIOD, cycle: CYCLE } })).body;
  const truth = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code=? AND p.l1_approver_emp_code=?`,
    [PERIOD, CYCLE, L1]);
  note('  team / planned in cycle', `${t.team.length} officers · ${t.totals.planned_in_cycle} visits`);
  assert.equal(t.totals.planned_in_cycle, Number(truth.n));
  assert.ok(t.team.some(m => m.emp_code === SO));
  assert.ok(t.totals.planned_in_cycle <= all.totals.planned_in_cycle);
});

await okA('the team series is the sum of its members, day for day', async () => {
  const t = (await call(app.getTeamDailyAdherence, {
    params: { empCode: L1 }, query: { month: PERIOD, cycle: CYCLE } })).body;
  const perMember = [];
  for (const m of t.team) {
    perMember.push((await call(app.getDailyAdherence, {
      query: { month: PERIOD, cycle: CYCLE, empCode: m.emp_code } })).body);
  }
  for (let i = 0; i < t.days.length; i++) {
    const summedPlanned = perMember.reduce((s2, p) => s2 + p.days[i].cum_planned, 0);
    const summedAdhered = perMember.reduce((s2, p) => s2 + p.days[i].cum_adhered, 0);
    assert.equal(t.days[i].cum_planned, summedPlanned, `${t.days[i].date}: planned`);
    assert.equal(t.days[i].cum_adhered, summedAdhered, `${t.days[i].date}: adhered`);
  }
  note('  days reconciled against members', t.days.length);
});

// ─────────────────────────────────────────────────────────────────────────────
S('5. as-on date, and bad input');

await okA('days after the as-on date are flagged as future', async () => {
  const r = (await call(app.getDailyAdherence, {
    query: { month: PERIOD, cycle: CYCLE, asOn: `${PERIOD}-07` } })).body;
  const future = r.days.filter(d => d.is_future).map(d => d.date);
  const past = r.days.filter(d => !d.is_future).map(d => d.date);
  note('  as on', `${r.as_on_date} — ${past.length} elapsed, ${future.length} still to come`);
  assert.equal(past[past.length - 1], `${PERIOD}-07`);
  assert.ok(future.every(d => d > `${PERIOD}-07`));
  assert.equal(r.totals.cum_pct, r.days.find(d => d.date === `${PERIOD}-07`).cum_pct,
    'the headline total is not the figure as at the as-on date');
});

await okA('a bad month, cycle or as-on date is refused', async () => {
  for (const q of [{ month: 'June' }, { month: PERIOD, cycle: 'C9' },
                   { month: PERIOD, asOn: '07-06-2026' }]) {
    const r = await call(app.getDailyAdherence, { query: q });
    assert.equal(r.code, 400, `accepted ${JSON.stringify(q)}`);
    assert.ok(r.body.error);
  }
});

await okA('an approver with no team gets an empty series, not an error', async () => {
  const r = await call(app.getTeamDailyAdherence, {
    params: { empCode: 'NOBODY-999' }, query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.code, 200);
  assert.deepEqual(r.body.team, []);
  assert.equal(r.body.totals.cum_planned, 0);
  assert.equal(r.body.totals.cum_pct, 0);
  assert.ok(r.body.days.length > 0, 'the day rows should still be there, just empty');
});

console.log('\n' + '─'.repeat(76));
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
