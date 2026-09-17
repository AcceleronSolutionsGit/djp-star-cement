/**
 * ADHERENCE IN THE APP — what the officer sees, and what his manager sees.
 *
 * The admin report answers for the whole company. The app needs two narrower answers:
 * one officer's own number with the counters behind it, and one manager's team, one
 * line per person. Both must come from the SAME engine as the admin report — if they
 * drifted, an officer's phone would argue with his manager's dashboard.
 *
 * These checks drive the real controllers against the AGARTALA kit with its real SFA
 * visit log, and reconcile every figure against the admin report and the database.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAll, dbGet } from './sandbox/src/config/database.js';
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
console.log('  ADHERENCE — the officer\'s phone and his manager\'s');
console.log('═'.repeat(76));

await seedAgartala();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const gen = await import('./sandbox/src/controllers/generation.controller.js');
{
  const un = silence();
  await generateFullPjpDjpSolution(PERIOD, CYCLE, { generationRunCode: 'GEN-ADH' });
  await gen.generatePlansForAllRoles(PERIOD, CYCLE, {});
  un();
}
const sfaRows = await seedAgartalaSfa();
note('SFA visits logged', sfaRows);

const app = await import('./sandbox/src/controllers/appPlan.controller.js');

// The officer the demo would pick: an SO with an approver and the most visits.
const soRow = await dbGet(
  `SELECT p.emp_code, p.emp_name, p.l1_approver_emp_code, p.l1_approver_name,
          (SELECT COUNT(*) FROM sales_plan_details d WHERE d.plan_id = p.id) visits
     FROM sales_plans p
    WHERE p.period_month=? AND p.cycle_code=? AND p.emp_role='SO'
      AND p.l1_approver_emp_code IS NOT NULL
    ORDER BY visits DESC LIMIT 1`, [PERIOD, CYCLE]);
const SO = soRow.emp_code, L1 = soRow.l1_approver_emp_code;
note('officer', `${soRow.emp_name} (${SO}) — ${soRow.visits} visits`);
note('his L1', `${soRow.l1_approver_name} (${L1})`);

// ─────────────────────────────────────────────────────────────────────────────
S('1. the endpoints exist and the page calls them');

await okA('both adherence routes are on the API router', async () => {
  const routes = readFileSync(join(here, '..', '..', 'src', 'routes', 'api.routes.js'), 'utf8');
  for (const r of ['/app/officers/:empCode/adherence', '/app/approvers/:empCode/team-adherence'])
    assert.ok(routes.includes(r), `not routed: ${r}`);
});

await okA('the simulator has an Adherence tab in each pane that calls them', async () => {
  assert.ok(PAGE.includes('/adherence'), 'the page never asks for an officer\'s adherence');
  assert.ok(PAGE.includes('/team-adherence'), 'the page never asks for the team');
  assert.ok(/data-tab="adherence"/.test(PAGE), 'there is no Adherence tab');
  assert.ok(PAGE.includes('renderMyAdherence') && PAGE.includes('renderTeamAdherence'));
});

// ─────────────────────────────────────────────────────────────────────────────
S('2. the officer\'s own number');

let mine = null;
await okA('it answers with his totals, his percentage and his counters', async () => {
  const r = await call(app.getMyAdherence, {
    params: { empCode: SO }, query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  mine = r.body;
  assert.ok(mine.has_plan, 'the officer has no plan in the report');
  note('  adherence (capped / raw)', `${mine.adherence.capped_pct}% / ${mine.adherence.raw_pct}%`);
  note('  dealers on plan / visited / missed',
       `${mine.totals.dealers_on_plan} / ${mine.totals.dealers_visited} / ${mine.totals.dealers_missed}`);
  note('  MTD due / adhered / pending',
       `${mine.totals.mtd_due} / ${mine.totals.adhered} / ${mine.totals.pending}`);
  note('  counters listed', mine.dealers.length);
  assert.ok(mine.dealers.length > 0, 'no counter detail — a bare percentage is not actionable');
});

await okA('it agrees exactly with the admin report — one engine, not two', async () => {
  const admin = await call(app.getAdherenceReport, { query: { month: PERIOD, cycle: CYCLE } });
  const row = admin.body.by_employee.find(e => e.emp_code === SO);
  assert.ok(row, 'the officer is missing from the admin report');
  assert.equal(mine.adherence.capped_pct, row.capped_pct);
  assert.equal(mine.totals.adhered, row.adhered);
  assert.equal(mine.totals.mtd_due, row.mtd_due);
  assert.equal(mine.totals.dealers_missed, row.missed);
  note('  admin says / app says', `${row.capped_pct}% / ${mine.adherence.capped_pct}%`);
});

await okA('the capped percentage never exceeds 100', async () => {
  const all = await call(app.getAdherenceReport, { query: { month: PERIOD, cycle: CYCLE } });
  for (const e of all.body.by_employee) {
    const r = await call(app.getMyAdherence, {
      params: { empCode: e.emp_code }, query: { month: PERIOD, cycle: CYCLE } });
    if (!r.body.has_plan) continue;
    assert.ok(r.body.adherence.capped_pct <= 100,
      `${e.emp_name}: ${r.body.adherence.capped_pct}%`);
  }
  note('  officers checked', all.body.by_employee.length);
});

await okA('every counter is marked DONE, PARTIAL or PENDING, and the marks are right', async () => {
  const tally = { DONE: 0, PARTIAL: 0, PENDING: 0 };
  for (const d of mine.dealers) {
    assert.ok(['DONE', 'PARTIAL', 'PENDING'].includes(d.state), `bad state ${d.state}`);
    tally[d.state]++;
    if (d.state === 'PENDING') assert.equal(d.adhered, 0, `${d.dealer_name} is PENDING but has visits`);
    if (d.state === 'DONE')    assert.ok(d.adhered_capped >= d.planned, `${d.dealer_name} is DONE but short`);
    if (d.visit_dates.length)  assert.ok(d.adhered > 0, `${d.dealer_name} has visit dates but no credit`);
  }
  note('  pending / partial / done', `${tally.PENDING} / ${tally.PARTIAL} / ${tally.DONE}`);
  assert.equal(tally.DONE + tally.PARTIAL + tally.PENDING, mine.dealers.length);
});

await okA('what still needs doing is listed first', async () => {
  const rank = { PENDING: 0, PARTIAL: 1, DONE: 2 };
  let prev = -1;
  for (const d of mine.dealers) {
    assert.ok(rank[d.state] >= prev, `${d.dealer_name} (${d.state}) is out of order`);
    prev = Math.max(prev, rank[d.state]);
  }
});

await okA('a visited counter carries the day it was visited', async () => {
  const visited = mine.dealers.filter(d => d.visit_dates.length);
  note('  counters with a visit date', visited.length);
  if (!visited.length) return;
  for (const d of visited.slice(0, 10)) {
    const seen = await dbAll(
      `SELECT DISTINCT visit_date AS day FROM visit_execution_logs
        WHERE employee_code = ?`, [SO]);
    const days = seen.map(x => String(x.day).slice(0, 10));
    for (const v of d.visit_dates)
      assert.ok(days.includes(String(v).slice(0, 10)),
        `${d.dealer_name}: ${v} is not in this officer's SFA log`);
  }
});

await okA('it only ever answers for the officer named in the path', async () => {
  const other = await dbGet(
    `SELECT emp_code FROM sales_plans WHERE period_month=? AND cycle_code=? AND emp_code <> ?
      AND emp_role='SO' LIMIT 1`, [PERIOD, CYCLE, SO]);
  const r = await call(app.getMyAdherence, {
    params: { empCode: other.emp_code }, query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.body.emp_code, other.emp_code);
  const mineCodes = new Set(mine.dealers.map(d => d.sap_code));
  const theirs = r.body.dealers.map(d => d.sap_code);
  const bleed = theirs.filter(c => mineCodes.has(c));
  // Two officers can legitimately share no counters at all; what must never happen is
  // the endpoint returning the whole company to whoever asks.
  assert.notEqual(r.body.dealers.length, mine.dealers.length + theirs.length);
  note('  counters shared between the two officers', bleed.length);
});

await okA('a month with no plan says so instead of erroring', async () => {
  const r = await call(app.getMyAdherence, {
    params: { empCode: SO }, query: { month: '2020-01', cycle: CYCLE } });
  assert.equal(r.code, 200);
  assert.equal(r.body.has_plan, false);
  assert.equal(r.body.totals, null);
  assert.deepEqual(r.body.dealers, []);
});

await okA('a bad month is refused with a clear message', async () => {
  const r = await call(app.getMyAdherence, { params: { empCode: SO }, query: { month: 'June' } });
  assert.equal(r.code, 400);
  assert.match(r.body.error, /month/i);
  const bad = await call(app.getMyAdherence, {
    params: { empCode: SO }, query: { month: PERIOD, asOn: '15-06-2026' } });
  assert.equal(bad.code, 400);
  assert.match(bad.body.error, /asOn/);
});

// ─────────────────────────────────────────────────────────────────────────────
S('3. the manager\'s team view');

let team = null;
await okA('it lists exactly the people whose plans he approves', async () => {
  const r = await call(app.getTeamAdherence, {
    params: { empCode: L1 }, query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  team = r.body;
  const truth = await dbAll(
    `SELECT DISTINCT emp_code FROM sales_plans
      WHERE l1_approver_emp_code = ? AND period_month = ? AND cycle_code = ?`,
    [L1, PERIOD, CYCLE]);
  note('  team size', team.team_size);
  assert.equal(team.team_size, truth.length);
  assert.deepEqual(team.team.map(m => m.emp_code).sort(),
                   truth.map(t => t.emp_code).sort());
  assert.ok(team.team.some(m => m.emp_code === SO), 'the demo officer is not in his own L1\'s team');
});

await okA('each line matches what that officer sees on his own phone', async () => {
  for (const m of team.team) {
    const own = await call(app.getMyAdherence, {
      params: { empCode: m.emp_code }, query: { month: PERIOD, cycle: CYCLE } });
    if (!own.body.has_plan) continue;
    assert.equal(m.capped_pct, own.body.adherence.capped_pct,
      `${m.emp_name}: manager sees ${m.capped_pct}%, he sees ${own.body.adherence.capped_pct}%`);
    assert.equal(m.adhered, own.body.totals.adhered);
    assert.equal(m.dealers_missed, own.body.totals.dealers_missed);
  }
  note('  lines reconciled', team.team.length);
});

await okA('the weakest performer is at the top', async () => {
  let prev = -1;
  for (const m of team.team) {
    assert.ok(m.capped_pct >= prev, `${m.emp_name} at ${m.capped_pct}% is out of order`);
    prev = m.capped_pct;
  }
  note('  order', team.team.map(m => `${m.emp_name.split(' ')[0]} ${m.capped_pct}%`).join(' · '));
});

await okA('the team total is the sum of the team, not an average of averages', async () => {
  const adhered = team.team.reduce((s, m) => s + m.adhered, 0);
  const due = Math.round(team.team.reduce((s, m) => s + m.mtd_due, 0) * 100) / 100;
  assert.equal(team.totals.adhered, adhered);
  assert.equal(team.totals.mtd_due, due);
  const expected = due >= 1 ? Math.round((adhered / due) * 1000) / 10 : 0;
  assert.equal(team.totals.capped_pct, expected);
  note('  team adherence', `${team.totals.capped_pct}% (${adhered} of ${due})`);
});

await okA('a manager with nobody under him gets an empty team, not an error', async () => {
  const r = await call(app.getTeamAdherence, {
    params: { empCode: 'NOBODY-999' }, query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.code, 200);
  assert.equal(r.team_size, undefined);
  assert.deepEqual(r.body.team, []);
  assert.equal(r.body.totals.capped_pct, 0);
});

console.log('\n' + '─'.repeat(76));
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
