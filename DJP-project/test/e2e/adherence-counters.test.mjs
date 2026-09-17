/**
 * COUNTER TRACKER — the client's "Target vs Adhe SO_ASM_RSM_ZM" sheet, as an endpoint.
 *
 * Their workbook is one row per counter with four role blocks, five figures each.
 * Transcribed from row 4 (headers) and row 5 (formulas) of the file they sent:
 *
 *   P  No. of visits Planned by SO in (DJP)
 *   Q  MTD No. of visits Planned by SO in (DJP)
 *   R  No. of visits Adhered by SO
 *   S  SO Adherence %            = IFERROR(R / IF(Q < 1, P, Q), 0)
 *   T  SO Pending to visit       = Q - R
 *
 * ...repeated for ASM (U-Y), RSM (Z-AD) and ZH (AE-AI).
 *
 * The two subtleties worth testing rather than trusting:
 *   1. the denominator falls back to the FULL plan when MTD rounds below 1
 *   2. Pending is allowed to go negative — that is "ahead of schedule", not an error
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
const ROLES = ['SO', 'ASM', 'RSM', 'ZH'];

console.log('\n' + '═'.repeat(76));
console.log('  COUNTER TRACKER — Target vs Adhered, per counter, per role');
console.log('═'.repeat(76));

await seedAgartala();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const gen = await import('./sandbox/src/controllers/generation.controller.js');
{
  const un = silence();
  await generateFullPjpDjpSolution(PERIOD, CYCLE, { generationRunCode: 'GEN-TRACK' });
  await gen.generatePlansForAllRoles(PERIOD, CYCLE, {});
  un();
}
note('SFA visits logged', await seedAgartalaSfa());

const app = await import('./sandbox/src/controllers/appPlan.controller.js');

const soRow = await dbGet(
  `SELECT p.emp_code, p.emp_name, p.l1_approver_emp_code,
          (SELECT COUNT(*) FROM sales_plan_details d WHERE d.plan_id = p.id) visits
     FROM sales_plans p
    WHERE p.period_month=? AND p.cycle_code=? AND p.emp_role='SO'
      AND p.l1_approver_emp_code IS NOT NULL
    ORDER BY visits DESC LIMIT 1`, [PERIOD, CYCLE]);
const SO = soRow.emp_code, L1 = soRow.l1_approver_emp_code;
note('officer / his L1', `${soRow.emp_name} (${SO}) / ${L1}`);

// ─────────────────────────────────────────────────────────────────────────────
S('1. routed, and drawn');

await okA('both counter routes exist and the simulator renders the tracker', async () => {
  const routes = readFileSync(join(here, '..', '..', 'src', 'routes', 'api.routes.js'), 'utf8');
  assert.ok(routes.includes('/app/admin/adherence/counters'), 'admin counters not routed');
  assert.ok(routes.includes('/app/approvers/:empCode/adherence/counters'), 'team counters not routed');
  assert.ok(PAGE.includes('/adherence/counters'), 'the page never asks for the tracker');
  assert.ok(PAGE.includes('trackerTable('), 'the page cannot draw it');
  for (const f of ['by_role', 'mtd_planned', 'adherence_pct', 'pending', 'counter_strategy'])
    assert.ok(PAGE.includes(f), `the page never reads "${f}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
S('2. every column of their sheet is present');

let all = null;
await okA('the dimension columns are all there, and populated', async () => {
  const r = await call(app.getCounterAdherence, { query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 300));
  all = r.body;
  note('  counters', all.count);
  assert.ok(all.count > 0, 'no counters came back');

  // Their row-4 dimension headers, mapped to the fields this returns.
  const mapping = {
    'ZONE': 'zone', 'Region': 'region', 'Cust Type': 'cust_type', 'Area': 'area',
    'Block': 'block', 'ZSH NAME': 'zsh_name', 'RSM NAME': 'rsm_name',
    'ASM NAME': 'asm_name', 'SO/SE  NAME': 'so_name', 'DEALER NAME': 'dealer_name',
    'SFA': 'sfa_code', 'Counter strategy': 'counter_strategy',
    'Customer CODE': 'customer_code', 'Category': 'category'
  };
  const missing = [], empty = [];
  for (const [header, field] of Object.entries(mapping)) {
    if (!(field in all.counters[0])) { missing.push(header); continue; }
    if (!all.counters.some(c => c[field] !== null && c[field] !== '')) empty.push(header);
  }
  note('  dimension columns', Object.keys(mapping).length);
  assert.equal(missing.length, 0, `not returned: ${missing.join(', ')}`);
  // counter_strategy legitimately comes from master_dealers and may be blank in a kit.
  const hardEmpty = empty.filter(h => h !== 'Counter strategy');
  assert.equal(hardEmpty.length, 0, `returned but empty for every counter: ${hardEmpty.join(', ')}`);
  if (empty.includes('Counter strategy')) note('  (counter_strategy blank in this kit)', '');
});

await okA('each counter carries all four role blocks, with all five figures', async () => {
  for (const c of all.counters) {
    for (const role of ROLES) {
      const b = c.by_role[role];
      assert.ok(b, `${c.dealer_name}: no ${role} block`);
      for (const f of ['planned', 'mtd_planned', 'adhered', 'adherence_pct', 'pending'])
        assert.equal(typeof b[f], 'number', `${c.dealer_name} ${role}.${f} is not a number`);
    }
  }
  const withAsm = all.counters.filter(c => c.by_role.ASM.planned > 0).length;
  const withRsm = all.counters.filter(c => c.by_role.RSM.planned > 0).length;
  note('  counters planned for SO / ASM / RSM / ZH',
       [ 'SO', 'ASM', 'RSM', 'ZH' ].map(r =>
         all.counters.filter(c => c.by_role[r].planned > 0).length).join(' / '));
  assert.ok(withAsm > 0 || withRsm > 0, 'no non-SO block was ever populated');
});

// ─────────────────────────────────────────────────────────────────────────────
S('3. their two formulas, exactly');

await okA('Adherence % = adhered / IF(MTD < 1, planned, MTD)', async () => {
  let checked = 0, fellBack = 0;
  for (const c of all.counters) {
    for (const role of ROLES) {
      const b = c.by_role[role];
      if (!b.planned && !b.adhered) continue;
      const denom = b.mtd_planned < 1 ? b.planned : b.mtd_planned;
      if (b.mtd_planned < 1 && b.planned > 0) fellBack++;
      const expected = denom > 0 ? Math.round((b.adhered / denom) * 1000) / 10 : 0;
      assert.equal(b.adherence_pct, expected,
        `${c.dealer_name} ${role}: ${b.adhered}/${denom} should be ${expected}%, got ${b.adherence_pct}%`);
      checked++;
    }
  }
  note('  role blocks checked', checked);
  note('  ...of which fell back to the full plan (MTD < 1)', fellBack);
  assert.ok(checked > 0);
});

await okA('Pending = MTD planned − adhered', async () => {
  for (const c of all.counters) {
    for (const role of ROLES) {
      const b = c.by_role[role];
      assert.equal(b.pending, Math.round((b.mtd_planned - b.adhered) * 100) / 100,
        `${c.dealer_name} ${role}`);
    }
  }
});

await okA('a counter visited more than it was due shows NEGATIVE pending, not zero', async () => {
  // Their sheet lets pending go below zero on purpose — it is how "ahead of schedule"
  // reads. Clamping it at zero would hide over-visiting entirely.
  const target = await dbGet(
    `SELECT d.dealer_sap_code, d.dealer_name FROM sales_plan_details d
       JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.emp_code = ? AND p.period_month = ? AND p.cycle_code = ?
      ORDER BY d.visit_date LIMIT 1`, [SO, PERIOD, CYCLE]);
  for (const day of ['02', '03', '04', '05']) {
    await dbRun(
      `INSERT INTO visit_execution_logs
         (visit_date, customer_code, customer_name, employee_code, employee_name,
          check_in_time, visit_status, batch_code)
       VALUES (?, ?, ?, ?, ?, '10:00:00', 'Productive', 'TEST-OVER')`,
      [`${PERIOD}-${day}`, target.dealer_sap_code, target.dealer_name, SO, soRow.emp_name]);
  }
  const un = silence();
  const r = await call(app.getCounterAdherence, {
    query: { month: PERIOD, cycle: CYCLE, empCode: SO } });
  un();
  const c = r.body.counters.find(x =>
    String(x.dealer_name).toUpperCase() === String(target.dealer_name).toUpperCase());
  assert.ok(c, 'the over-visited counter vanished from the tracker');
  note('  over-visited counter', `${c.dealer_name} — MTD ${c.by_role.SO.mtd_planned}, ` +
       `adhered ${c.by_role.SO.adhered}, pending ${c.by_role.SO.pending}`);
  assert.ok(c.by_role.SO.adhered > c.by_role.SO.mtd_planned, 'the extra visits were not counted');
  assert.ok(c.by_role.SO.pending < 0, 'pending was clamped at zero — over-visiting is hidden');
  assert.ok(c.by_role.SO.adherence_pct > 100, 'raw adherence should be allowed above 100 here');
  await dbRun(`DELETE FROM visit_execution_logs WHERE batch_code = 'TEST-OVER'`);
});

// ─────────────────────────────────────────────────────────────────────────────
S('4. the figures reconcile with everything else');

await okA('planned per role adds up to the plans in the database', async () => {
  for (const role of ROLES) {
    const truth = await dbGet(
      `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
        WHERE p.period_month = ? AND p.cycle_code = ? AND p.emp_role = ?`,
      [PERIOD, CYCLE, role]);
    note(`  ${role} planned`, `${all.totals[role].planned} (db says ${truth.n})`);
    assert.equal(all.totals[role].planned, Number(truth.n), `${role} planned mismatch`);
  }
});

await okA('the footer totals are the rows summed, then their formula applied', async () => {
  for (const role of ROLES) {
    const t = all.totals[role];
    const planned = all.counters.reduce((s, c) => s + c.by_role[role].planned, 0);
    const adhered = all.counters.reduce((s, c) => s + c.by_role[role].adhered, 0);
    assert.equal(t.planned, planned, `${role} planned`);
    assert.equal(t.adhered, adhered, `${role} adhered`);
    const denom = t.mtd_planned < 1 ? t.planned : t.mtd_planned;
    const expected = denom > 0 ? Math.round((t.adhered / denom) * 1000) / 10 : 0;
    assert.equal(t.adherence_pct, expected, `${role} %`);
    assert.equal(t.pending, Math.round((t.mtd_planned - t.adhered) * 100) / 100, `${role} pending`);
  }
  note('  SO footer', `${all.totals.SO.adhered} of ${all.totals.SO.mtd_planned} · ` +
       `${all.totals.SO.adherence_pct}% · ${all.totals.SO.pending} pending`);
});

await okA('one officer\'s SO block agrees with his own adherence screen', async () => {
  const un = silence();
  const mine = (await call(app.getMyAdherence, {
    params: { empCode: SO }, query: { month: PERIOD, cycle: CYCLE } })).body;
  const tr = (await call(app.getCounterAdherence, {
    query: { month: PERIOD, cycle: CYCLE, empCode: SO } })).body;
  un();
  const trAdhered = tr.counters.reduce((s, c) => s + c.by_role.SO.adhered, 0);
  note('  adhered — his screen / the tracker', `${mine.totals.adhered} / ${trAdhered}`);
  assert.equal(trAdhered, mine.totals.adhered);
  assert.equal(tr.totals.SO.planned, mine.totals.planned_visits);
  assert.equal(tr.totals.SO.mtd_planned, mine.totals.mtd_due);
});

// ─────────────────────────────────────────────────────────────────────────────
S('5. scope, sort and search');

await okA('the furthest behind is at the top', async () => {
  let prev = Infinity;
  for (const c of all.counters) {
    assert.ok(c.by_role.SO.pending <= prev, `${c.dealer_name} is out of order`);
    prev = c.by_role.SO.pending;
  }
  note('  most pending', `${all.counters[0].dealer_name} — ${all.counters[0].by_role.SO.pending}`);
});

await okA('an L1 sees his team\'s counters and nobody else\'s', async () => {
  const un = silence();
  const t = (await call(app.getTeamCounterAdherence, {
    params: { empCode: L1 }, query: { month: PERIOD, cycle: CYCLE } })).body;
  un();
  note('  team / counters', `${t.team.length} officers · ${t.count} counters`);
  assert.ok(t.count > 0);
  assert.ok(t.count <= all.count, 'the team sees more counters than the whole company');
  const truth = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code=? AND p.l1_approver_emp_code=? AND p.emp_role='SO'`,
    [PERIOD, CYCLE, L1]);
  assert.equal(t.totals.SO.planned, Number(truth.n));
});

await okA('search narrows by dealer, code or officer', async () => {
  const un = silence();
  const name = all.counters[0].dealer_name;
  const r = (await call(app.getCounterAdherence, {
    query: { month: PERIOD, cycle: CYCLE, search: name.slice(0, 6) } })).body;
  un();
  note('  search', `"${name.slice(0, 6)}" → ${r.count} of ${all.count}`);
  assert.ok(r.count >= 1);
  assert.ok(r.count < all.count, 'the search matched everything — it is not being applied');
  assert.ok(r.counters.some(c => c.dealer_name === name));
});

await okA('an approver with no team gets an empty tracker, not the whole company', async () => {
  const un = silence();
  const r = await call(app.getTeamCounterAdherence, {
    params: { empCode: 'NOBODY-999' }, query: { month: PERIOD, cycle: CYCLE } });
  un();
  assert.equal(r.code, 200);
  assert.equal(r.body.count, 0);
  assert.equal(r.body.totals.SO.planned, 0);
});

await okA('a bad month or cycle is refused', async () => {
  for (const q of [{ month: 'June' }, { month: PERIOD, cycle: 'C9' }]) {
    const r = await call(app.getCounterAdherence, { query: q });
    assert.equal(r.code, 400, `accepted ${JSON.stringify(q)}`);
  }
});

console.log('\n' + '─'.repeat(76));
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
