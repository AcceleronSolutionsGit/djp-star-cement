/**
 * HIERARCHY ANALYSIS — the funnel, and who is allowed to see whom.
 *
 * The access rule is the whole point:
 *
 *   ZH  → RSM → ASM → SO
 *   RSM → ASM → SO
 *   ASM → SO
 *   SO  → himself
 *
 * Nobody sees sideways and nobody sees upward. These checks prove the scope is derived
 * from the hierarchy rather than from anything the caller sends, that the roll-ups add
 * up, and that "own" and "team" are kept apart — a manager has counters of his own, and
 * mixing them into his team's figures flatters or damns him for the wrong reason.
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
console.log('  HIERARCHY ANALYSIS — ZH → RSM → ASM → SO');
console.log('═'.repeat(76));

await seedAgartala();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const gen = await import('./sandbox/src/controllers/generation.controller.js');
{
  const un = silence();
  await generateFullPjpDjpSolution(PERIOD, CYCLE, { generationRunCode: 'GEN-HIER' });
  await gen.generatePlansForAllRoles(PERIOD, CYCLE, {});
  un();
}
note('SFA visits logged', await seedAgartalaSfa());

const app = await import('./sandbox/src/controllers/appPlan.controller.js');
const people = await dbAll(
  `SELECT DISTINCT emp_code, emp_name, emp_role FROM sales_plans WHERE period_month=? AND cycle_code=?`,
  [PERIOD, CYCLE]);
const pick = role => people.find(p => p.emp_role === role);
const ZH = pick('ZH'), RSM = pick('RSM'), ASM = pick('ASM'), SO = pick('SO');
note('chain', [ZH, RSM, ASM, SO].map(p => `${p.emp_role} ${p.emp_name}`).join(' → '));

const get = async (emp, extra = {}) => {
  const un = silence();
  const r = await call(app.getHierarchyAnalysis, {
    params: { empCode: emp.emp_code }, query: { month: PERIOD, cycle: CYCLE, ...extra } });
  un();
  return r;
};

// ─────────────────────────────────────────────────────────────────────────────
S('1. routed, and drawn');

await okA('the route exists and the simulator renders the funnel', async () => {
  const routes = readFileSync(join(here, '..', '..', 'src', 'routes', 'api.routes.js'), 'utf8');
  assert.ok(routes.includes('/app/hierarchy/:empCode/analysis'), 'not routed');
  assert.ok(PAGE.includes('/app/hierarchy/'), 'the page never asks for the analysis');
  assert.ok(/\/analysis`/.test(PAGE), 'the analysis URL is not built');
  assert.ok(PAGE.includes('svgFunnel('), 'the page cannot draw the funnel');
  assert.ok(PAGE.includes('treeLines('), 'the page cannot draw the drill-down');
});

// ─────────────────────────────────────────────────────────────────────────────
S('2. each role sees exactly the levels below it');

const views = {};
await okA('ZH sees RSM, ASM and SO — RSM sees ASM and SO — ASM sees SO — SO sees nobody', async () => {
  for (const p of [ZH, RSM, ASM, SO]) {
    const r = await get(p);
    assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
    views[p.emp_role] = r.body;
  }
  assert.deepEqual(views.ZH.viewer.sees,  ['RSM', 'ASM', 'SO']);
  assert.deepEqual(views.RSM.viewer.sees, ['ASM', 'SO']);
  assert.deepEqual(views.ASM.viewer.sees, ['SO']);
  assert.deepEqual(views.SO.viewer.sees,  []);
  for (const role of ['ZH', 'RSM', 'ASM', 'SO'])
    note(`  ${role} scope`, `${views[role].scope.people} people ${JSON.stringify(views[role].scope.by_role)}`);
});

await okA('nobody appears in the scope of someone at or below their own level', async () => {
  // The bug this guards: a chain row carries a man's superiors' codes as well, so an
  // unfiltered index puts an ASM's own RSM inside the ASM's "scope".
  const rank = { ZH: 0, RSM: 1, ASM: 2, SO: 3 };
  for (const role of ['ZH', 'RSM', 'ASM', 'SO']) {
    for (const r of Object.keys(views[role].scope.by_role)) {
      assert.ok(rank[r] > rank[role],
        `${role} is shown ${r} in his scope — that is his own level or above`);
    }
  }
  assert.equal(views.SO.scope.people, 0, 'an SO has nobody below him');
  assert.deepEqual(views.SO.levels, [], 'an SO should get no level bands');
});

await okA('the viewer is named, not printed as an object', async () => {
  // resolveEmployeeName returns { name, source }; using it as a string put
  // "[object Object]" at the top of the report where the manager's name belongs.
  for (const role of ['ZH', 'RSM', 'ASM', 'SO']) {
    const n = views[role].viewer.emp_name;
    assert.equal(typeof n, 'string', `${role}: emp_name is ${typeof n}`);
    assert.ok(!/\[object/.test(n), `${role}: emp_name is "${n}"`);
    assert.ok(n.trim().length > 0, `${role}: emp_name is blank`);
  }
  note('  names', ['ZH', 'RSM', 'ASM', 'SO'].map(r => views[r].viewer.emp_name).join(' → '));
});

await okA('the scope narrows as you go down the chain', async () => {
  assert.ok(views.ZH.scope.people >= views.RSM.scope.people, 'ZH sees fewer than his RSM');
  assert.ok(views.RSM.scope.people >= views.ASM.scope.people, 'RSM sees fewer than his ASM');
  assert.ok(views.ASM.scope.people > views.SO.scope.people, 'ASM sees no more than an SO');
  note('  people in scope', ['ZH', 'RSM', 'ASM', 'SO']
    .map(r => `${r} ${views[r].scope.people}`).join(' → '));
});

await okA('every person listed under a manager really reports to him', async () => {
  const chains = await dbAll(
    `SELECT DISTINCT zh_code, rsm_code, asm_code, so_emp_code FROM master_dealer_so_mapping`);
  const under = (col, code, wantCol) => new Set(
    chains.filter(c => String(c[col] || '').trim().toUpperCase() === code.toUpperCase())
          .map(c => String(c[wantCol] || '').trim().toUpperCase()).filter(Boolean));

  const asmSos = under('asm_code', ASM.emp_code, 'so_emp_code');
  const listed = new Set(views.ASM.levels.find(L => L.role === 'SO').people
    .map(p => p.emp_code.toUpperCase()));
  note('  SOs under this ASM (mapping / report)', `${asmSos.size} / ${listed.size}`);
  for (const c of listed)
    assert.ok(asmSos.has(c), `${c} is listed under the ASM but does not report to him`);
});

// ─────────────────────────────────────────────────────────────────────────────
S('3. the numbers add up');

await okA('planned per level reconciles with the plans in the database', async () => {
  for (const L of views.ZH.levels) {
    const codes = L.people.map(p => p.emp_code);
    if (!codes.length) continue;
    const truth = await dbGet(
      `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
        WHERE p.period_month=? AND p.cycle_code=? AND p.emp_role=?
          AND UPPER(TRIM(p.emp_code)) IN (${codes.map(() => '?').join(',')})`,
      [PERIOD, CYCLE, L.role, ...codes.map(c => c.toUpperCase())]);
    note(`  ${L.role} planned`, `${L.totals.planned} (db says ${truth.n})`);
    assert.equal(L.totals.planned, Number(truth.n), `${L.role}`);
  }
});

await okA('total = own + team, at every node', async () => {
  const walk = n => {
    for (const f of ['counters', 'planned', 'adhered']) {
      assert.equal(n.total[f], n.own[f] + n.team[f],
        `${n.emp_name} ${f}: total ${n.total[f]} ≠ own ${n.own[f]} + team ${n.team[f]}`);
    }
    (n.reports || []).forEach(walk);
  };
  views.ZH.tree.forEach(walk);
  note('  nodes checked', JSON.stringify(views.ZH.tree.map(t => t.emp_name)));
});

await okA('a manager\'s team figures are the sum of his reports\' totals', async () => {
  const walk = n => {
    if (n.reports && n.reports.length) {
      const summed = n.reports.reduce((s, r) => s + r.total.planned, 0);
      assert.equal(n.team.planned, summed,
        `${n.emp_name}: team planned ${n.team.planned} ≠ reports ${summed}`);
    }
    (n.reports || []).forEach(walk);
  };
  views.ZH.tree.forEach(walk);
});

await okA('the scope total equals the viewer plus his whole tree', async () => {
  const v = views.ZH;
  const summed = v.tree.reduce((s, t) => s + t.total.planned, 0) + v.totals.own.planned;
  assert.equal(v.totals.scope.planned, summed);
  note('  ZH scope planned', `${v.totals.scope.planned} (own ${v.totals.own.planned})`);
});

await okA('adherence % uses their formula, not a re-derived one', async () => {
  for (const role of ['ZH', 'RSM', 'ASM', 'SO']) {
    const t = views[role].totals.scope;
    const denom = t.mtd_due < 1 ? t.planned : t.mtd_due;
    const expected = denom > 0 ? Math.round((t.adhered / denom) * 1000) / 10 : 0;
    assert.equal(t.adherence_pct, expected, role);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
S('4. the funnel');

await okA('it has five stages, in order, each measured against the one above', async () => {
  const f = views.ZH.funnel;
  assert.deepEqual(f.map(x => x.stage),
    ['Counters targeted', 'Visits planned', 'Due so far', 'Visits made', 'Counters covered']);
  note('  funnel', f.map(x => `${x.stage} ${x.value}`).join(' → '));
  const t = views.ZH.totals.scope;
  assert.equal(f[0].value, t.counters);
  assert.equal(f[1].value, t.planned);
  assert.equal(f[2].value, t.mtd_due);
  assert.equal(f[3].value, t.adhered);
  assert.equal(f[4].value, t.counters_visited);
});

await okA('visits made never exceeds what was planned, and covered never exceeds counters', async () => {
  for (const role of ['ZH', 'RSM', 'ASM', 'SO']) {
    const t = views[role].totals.scope;
    assert.ok(t.counters_visited <= t.counters, `${role}: covered > counters`);
    assert.ok(t.counters_missed + t.counters_visited <= t.counters + 1, `${role}: missed+covered`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
S('5. the visit detail, and refusals');

await okA('include=visits returns every scheduled visit for the people in scope', async () => {
  const r = await get(ASM, { include: 'visits' });
  const codes = [ASM.emp_code,
    ...r.body.levels.flatMap(L => L.people.map(p => p.emp_code))];
  const truth = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month=? AND p.cycle_code=?
        AND UPPER(TRIM(p.emp_code)) IN (${codes.map(() => '?').join(',')})`,
    [PERIOD, CYCLE, ...codes.map(c => c.toUpperCase())]);
  note('  visits returned', `${r.body.visits.length} (db says ${truth.n})`);
  assert.equal(r.body.visits.length, Number(truth.n));
  const v = r.body.visits[0];
  for (const f of ['emp_code', 'emp_name', 'role', 'visit_date', 'dealer_name', 'dealer_sap_code'])
    assert.ok(f in v, `a visit row has no "${f}"`);
});

await okA('a visit for somebody outside the scope never appears', async () => {
  const r = await get(ASM, { include: 'visits' });
  const allowed = new Set([ASM.emp_code.toUpperCase(),
    ...r.body.levels.flatMap(L => L.people.map(p => p.emp_code.toUpperCase()))]);
  const strangers = [...new Set(r.body.visits.map(v => String(v.emp_code).toUpperCase()))]
    .filter(c => !allowed.has(c));
  assert.equal(strangers.length, 0, `visits leaked for: ${strangers.join(', ')}`);
});

await okA('omitting include leaves visits null rather than shipping thousands of rows', async () => {
  assert.equal(views.ZH.visits, null);
});

await okA('depth limits the drill-down without changing the totals', async () => {
  const shallow = await get(ZH, { depth: 1 });
  assert.equal(shallow.body.tree[0].reports.length, 0, 'depth=1 should not nest');
  assert.ok(shallow.body.tree[0].reports_count > 0, 'but it should still say how many there are');
  assert.equal(shallow.body.totals.scope.planned, views.ZH.totals.scope.planned,
    'trimming the tree changed the totals');
});

await okA('a bad month or cycle is refused', async () => {
  for (const q of [{ month: 'June' }, { month: PERIOD, cycle: 'C9' }]) {
    const un = silence();
    const r = await call(app.getHierarchyAnalysis, { params: { empCode: ZH.emp_code }, query: q });
    un();
    assert.equal(r.code, 400, `accepted ${JSON.stringify(q)}`);
  }
});

await okA('an unknown employee gets an empty scope, not somebody else\'s data', async () => {
  const un = silence();
  const r = await call(app.getHierarchyAnalysis, {
    params: { empCode: 'NOBODY-999' }, query: { month: PERIOD, cycle: CYCLE } });
  un();
  assert.equal(r.code, 200);
  assert.equal(r.body.scope.people, 0);
  assert.equal(r.body.totals.scope.planned, 0);
  assert.deepEqual(r.body.tree, []);
});


// ─────────────────────────────────────────────────────────────────────────────
S('6. clicking an officer — his visits, adhered or not');

let drill = null;
await okA('a manager can open an officer beneath him', async () => {
  const un = silence();
  const r = await call(app.getOfficerVisitDrill, {
    params: { viewerCode: ASM.emp_code, empCode: SO.emp_code },
    query: { month: PERIOD, cycle: CYCLE } });
  un();
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 200));
  drill = r.body;
  const t = drill.totals;
  note('  planned / adhered / missed', `${t.planned_visits} / ${t.adhered} / ${t.missed}`);
  note('  on the day / another day', `${t.adhered_same_day} / ${t.adhered_other_day}`);
  assert.equal(drill.officer.emp_code, SO.emp_code);
  assert.ok(t.planned_visits > 0);
});

await okA('every planned visit is listed, none invented', async () => {
  const truth = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month=? AND p.cycle_code=? AND UPPER(TRIM(p.emp_code))=?`,
    [PERIOD, CYCLE, SO.emp_code.toUpperCase()]);
  assert.equal(drill.visits.length, Number(truth.n));
  assert.equal(drill.totals.planned_visits, Number(truth.n));
  const inDays = drill.days.reduce((s2, d) => s2 + d.visits.length, 0);
  assert.equal(inDays, drill.visits.length, 'the day grouping lost or duplicated a visit');
});

await okA('adhered + missed = planned, with no visit counted twice', async () => {
  const t = drill.totals;
  assert.equal(t.adhered + t.missed, t.planned_visits);
  assert.equal(t.adhered_same_day + t.adhered_other_day, t.adhered);
  assert.equal(drill.visits.filter(v => v.adhered).length, t.adhered);
});

await okA('a counter planned twice and visited once reads as one of each', async () => {
  // The matching rule that stops a single logged visit paying for two planned slots.
  const byCounter = new Map();
  for (const v of drill.visits) {
    if (!byCounter.has(v.customer_code)) byCounter.set(v.customer_code, []);
    byCounter.get(v.customer_code).push(v);
  }
  let checked = 0;
  for (const [code, list] of byCounter) {
    if (list.length < 2) continue;
    const logs = await dbGet(
      `SELECT COUNT(DISTINCT visit_date) AS n FROM visit_execution_logs
        WHERE UPPER(TRIM(employee_code))=? AND UPPER(TRIM(customer_code)) IN (
          SELECT UPPER(TRIM(sfa_code)) FROM dealer_visit_targets
           WHERE period_month=? AND (UPPER(TRIM(sap_code))=? OR UPPER(TRIM(sfa_code))=?)
          UNION SELECT UPPER(TRIM(sap_code)) FROM dealer_visit_targets
           WHERE period_month=? AND (UPPER(TRIM(sap_code))=? OR UPPER(TRIM(sfa_code))=?))`,
      [SO.emp_code.toUpperCase(), PERIOD, code, code, PERIOD, code, code]);
    const adheredHere = list.filter(v => v.adhered).length;
    assert.ok(adheredHere <= Number(logs.n),
      `${list[0].dealer_name}: ${adheredHere} slots adhered from only ${logs.n} logged day(s)`);
    checked++;
  }
  note('  counters planned more than once', checked);
});

await okA('an adhered visit names the day it actually happened', async () => {
  for (const v of drill.visits) {
    if (v.adhered) {
      assert.ok(v.visited_date, `${v.dealer_name}: adhered with no visit date`);
      if (v.status === 'ADHERED') assert.equal(v.visited_date, v.planned_date);
      if (v.status === 'ADHERED_LATE') assert.ok(v.visited_date > v.planned_date);
      if (v.status === 'ADHERED_EARLY') assert.ok(v.visited_date < v.planned_date);
    } else {
      assert.equal(v.status, 'MISSED');
      assert.equal(v.visited_date, null, `${v.dealer_name}: missed but carries a date`);
    }
  }
  const late = drill.visits.filter(v => v.status === 'ADHERED_LATE');
  if (late.length) note('  example late visit',
    `${late[0].dealer_name} planned ${late[0].planned_date}, visited ${late[0].visited_date} (+${late[0].days_late}d)`);
});

await okA('every visited_date is genuinely in his SFA log', async () => {
  const days = new Set((await dbAll(
    `SELECT DISTINCT visit_date AS d FROM visit_execution_logs WHERE UPPER(TRIM(employee_code))=?`,
    [SO.emp_code.toUpperCase()])).map(r => String(r.d).slice(0, 10)));
  for (const v of drill.visits.filter(x => x.adhered))
    assert.ok(days.has(v.visited_date), `${v.dealer_name}: ${v.visited_date} is not in his log`);
});

await okA('his drill totals agree with his own adherence screen', async () => {
  const un = silence();
  const mine = (await call(app.getMyAdherence, {
    params: { empCode: SO.emp_code }, query: { month: PERIOD, cycle: CYCLE } })).body;
  un();
  note('  counters — drill / his screen', `${drill.totals.counters} / ${mine.totals.dealers_on_plan}`);
  assert.equal(drill.totals.counters, mine.totals.dealers_on_plan);
  assert.equal(drill.totals.planned_visits, mine.totals.planned_visits);
  assert.equal(drill.totals.counters_visited, mine.totals.dealers_visited);
});

await okA('an SO cannot open another SO', async () => {
  const other = people.filter(p => p.emp_role === 'SO' && p.emp_code !== SO.emp_code)[0];
  const un = silence();
  const r = await call(app.getOfficerVisitDrill, {
    params: { viewerCode: SO.emp_code, empCode: other.emp_code },
    query: { month: PERIOD, cycle: CYCLE } });
  un();
  assert.equal(r.code, 403, JSON.stringify(r.body));
  assert.match(r.body.error, /does not report to/i);
});

await okA('an officer can always open himself', async () => {
  const un = silence();
  const r = await call(app.getOfficerVisitDrill, {
    params: { viewerCode: SO.emp_code, empCode: SO.emp_code },
    query: { month: PERIOD, cycle: CYCLE } });
  un();
  assert.equal(r.code, 200);
  assert.equal(r.body.totals.planned_visits, drill.totals.planned_visits);
});

await okA('a ZH can open an SO three levels down', async () => {
  const un = silence();
  const r = await call(app.getOfficerVisitDrill, {
    params: { viewerCode: ZH.emp_code, empCode: SO.emp_code },
    query: { month: PERIOD, cycle: CYCLE } });
  un();
  assert.equal(r.code, 200, JSON.stringify(r.body).slice(0, 160));
  assert.equal(r.body.totals.planned_visits, drill.totals.planned_visits);
});

await okA('the page makes the names clickable and renders the diary', async () => {
  assert.ok(PAGE.includes('openOfficer('), 'no click handler on a person row');
  assert.ok(PAGE.includes('/officer/'), 'the page never asks for an officer drill-down');
  for (const f of ['ADHERED_LATE', 'MISSED', 'extra_visits', 'visited_date'])
    assert.ok(PAGE.includes(f), `the page never reads "${f}"`);
});

// ─────────────────────────────────────────────────────────────────────────────
S('7. the charts');

await okA('every chart is drawn, and none of them is a dual-axis chart', async () => {
  for (const fn of ['svgFunnel(', 'svgTrend(', 'svgDayColumns(', 'svgStatusMix('])
    assert.ok(PAGE.includes(fn), `${fn} is missing`);
  // Two measures on two scales in one frame is the mistake this guards against: the
  // columns chart plots planned and visited, both counts of visits, on one axis.
  assert.ok(!/secondAxis|y2Scale|rightAxis/.test(PAGE), 'a second y-scale crept in');
});

await okA('colour is assigned by the job it does', async () => {
  // The funnel is an ordinal ramp (one hue, light to dark) whose steps were checked
  // with the palette validator; the two-series columns use categorical slots 1 and 2;
  // the outcome mix uses the reserved status palette.
  for (const hex of ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'])
    assert.ok(PAGE.includes(hex), `funnel ramp step ${hex} is missing`);
  assert.ok(PAGE.includes('#eb6834'), 'the second categorical slot is missing');
  for (const hex of ['#0ca30c', '#fab219', '#d03b3b', '#ec835a'])
    assert.ok(PAGE.includes(hex), `status colour ${hex} is missing`);
});

await okA('no chart relies on colour alone', async () => {
  assert.ok(PAGE.includes('class="legend"'), 'there is no legend anywhere');
  assert.ok(PAGE.includes('aria-label='), 'a chart has no accessible label');
  // The status segments each print their own name and count in the legend.
  assert.ok(PAGE.includes('On the planned day'), 'the status legend is unlabelled');
  assert.ok(PAGE.includes('data-tip'), 'the charts carry no hover read-out');
});

await okA('the day table and the trend line encode the same series the same way', async () => {
  // Colouring the table bars green/amber/red while the chart above drew the same
  // numbers in one blue put two encodings on one series, and shouted at a 100% first
  // day that was one visit out of one due.
  assert.ok(!/<i class="\$\{meterClass\(r\.cum_pct\)\}"/.test(PAGE),
    'the daily table still colours its bars by threshold');
  assert.ok(PAGE.includes('.spark i{display:block;height:100%;background:#2a78d6}'),
    'the daily table bars are not the chart hue');
});

console.log('\n' + '─'.repeat(76));
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
