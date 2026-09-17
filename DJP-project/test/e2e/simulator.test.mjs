/**
 * FIELD APP SIMULATOR — every call the page makes, against the real controllers.
 *
 * public/simulator.html drives ten endpoints. This walks the same sequence in the same
 * order with the same payload shapes, so the page cannot quietly drift from the API:
 * if a response shape changes, the assertions here name the field that moved.
 *
 *   officer   plans → plan detail → dealers → add → move → remove → submit
 *   approver  inbox → plan → send back
 *   officer   edit again → resubmit
 *   approver  send back a SECOND time → refused → approve
 *
 * Run on the AGARTALA kit, so it is the same data the demo uses.
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

/** Mirrors the page's `call()` — same method, same path, same body. */
const call = async (handler, { params = {}, query = {}, body = {} } = {}) => {
  let code = 200, payload = null;
  const res = { status(c) { code = c; return this; }, json(p) { payload = p; return this; } };
  await handler({ params, query, body }, res);
  return { code, body: payload };
};

// ── the page's own source, so the endpoint list is checked, not assumed ──────
const PAGE = readFileSync(join(here, '..', '..', 'public', 'simulator.html'), 'utf8');

console.log('\n' + '═'.repeat(76));
console.log('  FIELD APP SIMULATOR — every call it makes');
console.log('═'.repeat(76));

const counts = await seedAgartala();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const gen = await import('./sandbox/src/controllers/generation.controller.js');
{
  const un = silence();
  await generateFullPjpDjpSolution(PERIOD, CYCLE, {
    generationRunCode: 'GEN-SIM', dealerMappingBatchCode: counts.mappingBatch,
    salesHistoryBatchCodes: [counts.salesBatch] });
  await gen.generatePlansForAllRoles(PERIOD, CYCLE, {});
  un();
}
const app = await import('./sandbox/src/controllers/appPlan.controller.js');

// ─────────────────────────────────────────────────────────────────────────────
S('the page and the router agree');

await okA('every endpoint the page calls exists on the API router', async () => {
  const routes = readFileSync(join(here, '..', '..', 'src', 'routes', 'api.routes.js'), 'utf8');
  const needed = [
    "/app/admin/plan-periods",
    "/app/admin/plans", "/app/officers/:empCode/plans", "/app/officers/:empCode/plans/:planId",
    "/app/officers/:empCode/dealers", "/app/officers/:empCode/plans/:planId/visits",
    "/app/officers/:empCode/plans/:planId/visits/:detailId",
    "/app/officers/:empCode/plans/:planId/submit",
    "/app/approvers/:empCode/inbox", "/app/approvers/:empCode/plans/:planId",
    "/app/approvers/:empCode/plans/:planId/decision"
  ];
  const missing = needed.filter(r => !routes.includes(r));
  note('  endpoints the page drives', needed.length);
  assert.equal(missing.length, 0, `not routed: ${missing.join(', ')}`);
});

await okA('the page sends the field names the controllers read', () => {
  // A silent rename here is the most likely way the page breaks.
  for (const field of ['visitDate', 'dealerSapCode', 'action', 'remarks'])
    assert.ok(PAGE.includes(field), `the page never sends "${field}"`);
  assert.ok(!/\bdecision:\s*/.test(PAGE), 'the page sends "decision" — the controller reads "action"');
});

// ─────────────────────────────────────────────────────────────────────────────
S('0. the schema carries every column the screens read');

// The plan-detail query names columns that schema.sql has to declare. When it does
// not, MySQL answers "Unknown column 'd.source' in 'field list'" and every plan
// detail screen 500s — while SQLite-backed tests that build their own tables pass.
// So check the shipped DDL, not the test database.
await okA('schema.sql declares the columns buildDetail selects', async () => {
  const ddl = readFileSync(join(here, '..', '..', 'src', 'models', 'schema.sql'), 'utf8');
  const block = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS sales_plan_details'));
  const table = block.slice(0, block.indexOf(');') + 1);
  const missing = ['visit_status', 'source', 'added_by', 'sequence', 'purpose_of_visit']
    .filter(c => !new RegExp(`\\b${c}\\b`).test(table));
  note('  sales_plan_details columns checked', 5);
  assert.equal(missing.length, 0, `schema.sql is missing: ${missing.join(', ')}`);
});

await okA('schema.sql declares the routing columns the approval flow writes', async () => {
  // When these are absent the stamp throws, generation swallows it as a ROUTING
  // error and finishes PARTIAL, and every plan reads as having no L1 approver —
  // so nothing can ever be submitted. Silent, and fatal to the whole workflow.
  const ddl = readFileSync(join(here, '..', '..', 'src', 'models', 'schema.sql'), 'utf8');
  const block = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS sales_plans'));
  const table = block.slice(0, block.indexOf(');') + 1);
  const missing = ['emp_role', 'required_approver_role', 'l1_approver_emp_code',
                   'l1_approver_name', 'l1_approver_role', 'rectification_count']
    .filter(c => !new RegExp(`\\b${c}\\b`).test(table));
  note('  sales_plans routing columns checked', 6);
  assert.equal(missing.length, 0, `schema.sql is missing: ${missing.join(', ')}`);

  const pa = ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS plan_approvals'));
  assert.ok(/\bapprover_role\b/.test(pa.slice(0, pa.indexOf(');') + 1)),
    'plan_approvals.approver_role is missing — decidePlan inserts it');
});

await okA('a routing diagnosis exists for when nobody has an approver', async () => {
  const src = readFileSync(join(here, '..', '..', 'src', 'scripts', 'fix-routing.js'), 'utf8');
  for (const need of ['l1_approver_emp_code', 'master_dealer_so_mapping', 'stampPlanRoutingForPeriod'])
    assert.ok(src.includes(need), `fix-routing.js never looks at ${need}`);
});

await okA('the migration can add them to a database built before they existed', async () => {
  const mig = readFileSync(join(here, '..', '..', 'src', 'scripts', 'migrate-missing-objects.js'), 'utf8');
  for (const c of ['visit_status', 'source', 'added_by'])
    assert.ok(mig.includes(`'${c}'`), `migrate-missing-objects.js never adds sales_plan_details.${c}`);
});

// ─────────────────────────────────────────────────────────────────────────────
S('0b. the month picker — /app/admin/plan-periods');

// A second month, so the picker has a real choice to make. One plan row is
// enough: the picker is driven by what sales_plans holds, not by visits.
await dbRun(
  `INSERT INTO sales_plans (emp_code, emp_name, period_month, cycle_code, status)
   VALUES (?, ?, ?, ?, ?)`,
  ['11003102', 'PARTHA SARKAR', '2026-05', 'C2', 'APPROVED']
);

await okA('the picker is offered only months that actually have plans', async () => {
  const r = await call(app.listPlanPeriods, {});
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const months = (r.body.periods || []).map(p => p.month);
  note('  months in the dropdown', months.join(', '));
  assert.ok(months.includes(PERIOD), `the generated month ${PERIOD} is missing`);
  assert.ok(months.includes('2026-05'), 'the second month is missing');
  // Newest first — the page opens periods[0] when nothing is remembered.
  assert.deepEqual(months, [...months].sort().reverse(), 'months are not newest-first');
  assert.equal(r.body.latest, months[0]);
});

await okA('each month carries its plan, officer and per-cycle counts', async () => {
  const r = await call(app.listPlanPeriods, {});
  const demo = r.body.periods.find(p => p.month === PERIOD);

  const truth = await dbGet(
    `SELECT COUNT(*) plans, COUNT(DISTINCT emp_code) officers
       FROM sales_plans WHERE period_month = ?`, [PERIOD]);
  note('  plans / officers in ' + PERIOD, `${demo.plans} / ${demo.officers}`);
  assert.equal(demo.plans, Number(truth.plans));
  assert.equal(demo.officers, Number(truth.officers));

  const c1 = await dbGet(
    `SELECT COUNT(*) plans FROM sales_plans WHERE period_month=? AND cycle_code='C1'`, [PERIOD]);
  note('  C1 plans / visits', `${demo.cycles.C1.plans} / ${demo.cycles.C1.visits}`);
  assert.equal(demo.cycles.C1.plans, Number(c1.plans));

  const visits = await dbGet(
    `SELECT COUNT(*) n FROM sales_plan_details d JOIN sales_plans p ON p.id=d.plan_id
      WHERE p.period_month=? AND p.cycle_code='C1'`, [PERIOD]);
  assert.equal(demo.cycles.C1.visits, Number(visits.n));

  const statusTotal = Object.values(demo.by_status).reduce((a, b) => a + b, 0);
  assert.equal(statusTotal, demo.plans, 'status counts do not add up to the plan count');
});

await okA('a cycle with no plans is reported so the page can disable it', async () => {
  const r = await call(app.listPlanPeriods, {});
  const demo = r.body.periods.find(p => p.month === PERIOD);
  const older = r.body.periods.find(p => p.month === '2026-05');
  note('  cycles present', `${PERIOD}: ${Object.keys(demo.cycles).join(',')} · 2026-05: ${Object.keys(older.cycles).join(',')}`);
  assert.ok(!demo.cycles.C2, `${PERIOD} should have no C2 — nothing generated one`);
  assert.ok(older.cycles.C2 && !older.cycles.C1, '2026-05 should be C2 only');
});

await okA('the page reads the picker the way the endpoint answers it', () => {
  assert.ok(PAGE.includes('/app/admin/plan-periods'), 'the page never asks which months exist');
  assert.ok(!/id="fMonth"[^>]*type="month"/.test(PAGE),
    'the month control is still a free-text month box — it can land on an empty month');
  for (const field of ['periods', 'cycles', 'plans'])
    assert.ok(PAGE.includes(field), `the page never reads "${field}" off the response`);
});

// Put the database back the way generation left it.
await dbRun(`DELETE FROM sales_plans WHERE period_month = '2026-05'`);

// ─────────────────────────────────────────────────────────────────────────────
S('1. the officer picker — /app/admin/plans');

let officers = [];
await okA('the admin list returns officers with plans', async () => {
  const r = await call(app.listAllPlans, { query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const seen = new Map();
  for (const p of r.body.plans || []) {
    const code = p.employee?.emp_code || p.emp_code;
    const name = p.employee?.emp_name || p.emp_name;
    const role = p.employee?.role || p.emp_role;
    if (code && !seen.has(code)) seen.set(code, { code, name, role });
  }
  officers = [...seen.values()];
  note('  officers the picker will show', officers.length);
  for (const o of officers) console.log(`       ${String(o.role).padEnd(4)} ${String(o.code).padEnd(10)} ${o.name}`);
  assert.ok(officers.length > 0);
  assert.ok(officers.every(o => o.name && !/^\d+$/.test(o.name)), 'an officer would show as a bare code');
});

await okA('the picker opens on someone whose plan can actually be approved', async () => {
  // Mirrors the page's own ordering. Whoever lands first is who the client sees,
  // so an officer with no L1 approver must not be it.
  const r = await call(app.listAllPlans, { query: { month: PERIOD, cycle: CYCLE } });
  const by = new Map();
  for (const p of r.body.plans || []) {
    const code = p.employee?.emp_code;
    if (!code) continue;
    if (!by.has(code)) by.set(code, { code, name: p.employee.emp_name, role: p.employee.role, visits: 0, routed: false });
    const o = by.get(code);
    o.visits += Number(p.counts?.visits || 0);
    if (p.approver?.emp_code) o.routed = true;
  }
  const rank = { SO: 0, ASM: 1, RSM: 2, ZH: 3 };
  const ordered = [...by.values()].sort((a, b) =>
    (b.routed - a.routed) || ((rank[a.role] ?? 9) - (rank[b.role] ?? 9)) ||
    (b.visits - a.visits) || String(a.name).localeCompare(String(b.name)));
  const first = ordered[0];
  note('  the page opens on', `${first.name} · ${first.role} · ${first.visits} visits`);
  assert.ok(first.routed, `${first.name} has no L1 approver — his plan cannot be submitted anywhere`);
  assert.ok(first.visits > 0, `${first.name} has no visits to show`);
  assert.ok(PAGE.includes('no approver'), 'the page never flags an unrouted officer in the dropdown');
});

// Pick an SO with an approver and visits — what a demo would pick.
const soRow = await dbGet(
  `SELECT p.id, p.emp_code, p.emp_name, p.l1_approver_emp_code, p.l1_approver_name,
          (SELECT COUNT(*) FROM sales_plan_details d WHERE d.plan_id = p.id) visits
     FROM sales_plans p
    WHERE p.period_month=? AND p.cycle_code=? AND p.emp_role='SO' AND p.l1_approver_emp_code IS NOT NULL
    ORDER BY visits DESC LIMIT 1`, [PERIOD, CYCLE]);
const SO = soRow.emp_code, L1 = soRow.l1_approver_emp_code, PLAN = soRow.id;
note('demo officer', `${soRow.emp_name} (${SO}) — ${soRow.visits} visits`);
note('his L1', `${soRow.l1_approver_name} (${L1})`);

// ─────────────────────────────────────────────────────────────────────────────
S('2. officer opens his plans, then one plan');

await okA('the list view returns what the page renders', async () => {
  const r = await call(app.listMyPlans, { params: { empCode: SO }, query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.code, 200);
  const p = r.body.plans[0];
  for (const f of ['plan_id', 'status', 'counts', 'approver', 'rectification', 'actions'])
    assert.ok(p[f] !== undefined, `the summary has no "${f}" — the card would render blank`);
  note('  status / visits / approver', `${p.status} / ${p.counts.visits} / ${p.approver.name}`);
});

let detail = null;
await okA('the detail view returns days, visits and actions', async () => {
  const r = await call(app.getMyPlanDetail, { params: { empCode: SO, planId: PLAN } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  detail = r.body.plan;
  assert.ok(Array.isArray(detail.days), 'no days array — the schedule would be empty');
  const v = detail.days[0].visits[0];
  for (const f of ['detail_id', 'sequence', 'dealer', 'final_category', 'source'])
    assert.ok(v[f] !== undefined, `a visit has no "${f}"`);
  assert.ok(v.dealer.name, 'a visit has no dealer name');
  note('  days / visits', `${detail.days.length} / ${detail.counts.visits}`);
  note('  first day', `${detail.days[0].visit_date} — ${detail.days[0].visits.map(x => x.dealer.name.slice(0,18)).join(', ')}`);
  assert.equal(detail.actions.can_edit, true, 'a DRAFT plan is not editable');
});

// ─────────────────────────────────────────────────────────────────────────────
S('3. the officer edits — add, move, remove');

let dealers = [];
await okA('the dealer picker only offers his own targets', async () => {
  const r = await call(app.getMyDealers, { params: { empCode: SO }, query: { month: PERIOD, cycle: CYCLE } });
  assert.equal(r.code, 200);
  dealers = r.body.dealers || [];
  note('  dealers offered', dealers.length);
  assert.ok(dealers.length > 0);
  const foreign = await dbGet(
    `SELECT COUNT(*) c FROM dealer_visit_targets
      WHERE period_month=? AND cycle_code=? AND so_emp_code <> ? AND sap_code IN (${dealers.map(()=>'?').join(',')})`,
    [PERIOD, CYCLE, SO, ...dealers.map(d => d.sap_code)]);
  assert.equal(foreign.c, 0, 'the picker offered a dealer targeted to another officer');
});

let addedId = null;
await okA('he adds a visit on a free day', async () => {
  const taken = new Set(detail.days.flatMap(d => d.visits.map(v => `${d.visit_date}|${v.dealer.sap_code}`)));
  let picked = null;
  for (const d of detail.days) {
    if (d.visits.length >= 8) continue;                        // daily cap
    // A prospect has no SAP code — only an SFA code. Prefer one, because that is the
    // case that used to be un-addable.
    const ordered = [...dealers].sort((a, b) => (a.sap_code ? 1 : 0) - (b.sap_code ? 1 : 0));
    for (const dl of ordered) {
      const code = dl.sap_code || dl.sfa_code;
      if (!code) continue;
      if (taken.has(`${d.visit_date}|${code}`)) continue;
      picked = { day: d.visit_date, dealer: dl, code }; break;
    }
    if (picked) break;
  }
  assert.ok(picked, 'no free dealer/day slot');
  const before = detail.counts.visits;
  const r = await call(app.addVisit, { params: { empCode: SO, planId: PLAN },
    body: { visitDate: picked.day, dealerSapCode: picked.code,
            dealerName: picked.dealer.dealer_name, purposeOfVisit: 'Routine Visit' } });
  assert.ok(r.code === 200 || r.code === 201, JSON.stringify(r.body));
  const after = (await call(app.getMyPlanDetail, { params: { empCode: SO, planId: PLAN } })).body.plan;
  note('  added', `${picked.dealer.dealer_name} (${picked.code}${picked.dealer.sap_code ? '' : ' — a PROSPECT, no SAP code'}) on ${picked.day}`);
  note('  visits before → after', `${before} → ${after.counts.visits}`);
  assert.equal(after.counts.visits, before + 1);
  const found = after.days.flatMap(d => d.visits).find(v => v.source === 'AGENT');
  assert.ok(found, 'the added visit is not flagged AGENT — the approver cannot see what changed');
  addedId = found.detail_id;
  detail = after;
});

await okA('the same dealer twice on one day is refused', async () => {
  const d = detail.days.find(x => x.visits.length);
  const r = await call(app.addVisit, { params: { empCode: SO, planId: PLAN },
    body: { visitDate: d.visit_date, dealerSapCode: d.visits[0].dealer.sap_code,
            dealerName: d.visits[0].dealer.name } });
  note('  response', `${r.code} — ${r.body?.error || ''}`);
  assert.ok(r.code >= 400);
});

await okA('he moves the visit he added to another day', async () => {
  const from = detail.days.find(d => d.visits.some(v => v.detail_id === addedId));
  const to   = detail.days.find(d => d.visit_date !== from.visit_date && d.visits.length < 8);
  assert.ok(to, 'no other day to move to');
  const r = await call(app.moveVisit, { params: { empCode: SO, planId: PLAN, detailId: addedId },
    body: { visitDate: to.visit_date } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  detail = (await call(app.getMyPlanDetail, { params: { empCode: SO, planId: PLAN } })).body.plan;
  const landed = detail.days.find(d => d.visits.some(v => v.detail_id === addedId));
  note('  moved', `${from.visit_date} → ${landed.visit_date}`);
  assert.equal(landed.visit_date, to.visit_date);
});

await okA('he removes it again', async () => {
  const before = detail.counts.visits;
  const r = await call(app.removeVisit, { params: { empCode: SO, planId: PLAN, detailId: addedId } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  detail = (await call(app.getMyPlanDetail, { params: { empCode: SO, planId: PLAN } })).body.plan;
  note('  visits before → after', `${before} → ${detail.counts.visits}`);
  assert.equal(detail.counts.visits, before - 1);
});

// ─────────────────────────────────────────────────────────────────────────────
S('4. submit → the approver pane fills');

await okA('the inbox is empty before he submits', async () => {
  const r = await call(app.getApprovalInbox, { params: { empCode: L1 }, query: { month: PERIOD } });
  assert.equal(r.code, 200);
  const ids = (r.body.plans || []).map(p => p.plan_id);
  note('  plans waiting', ids.length);
  assert.ok(!ids.includes(PLAN));
});

await okA('he submits, and it locks', async () => {
  const r = await call(app.submitMyPlan, { params: { empCode: SO, planId: PLAN }, body: {} });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const after = (await call(app.getMyPlanDetail, { params: { empCode: SO, planId: PLAN } })).body.plan;
  note('  status / can_edit', `${after.status} / ${after.actions.can_edit}`);
  assert.equal(after.status, 'SUBMITTED');
  assert.equal(after.actions.can_edit, false, 'still editable after submitting');
});

await okA('it appears in his L1 inbox and nobody else\'s', async () => {
  const mine = await call(app.getApprovalInbox, { params: { empCode: L1 }, query: { month: PERIOD } });
  assert.ok((mine.body.plans || []).map(p => p.plan_id).includes(PLAN), 'not in the L1 inbox');
  const other = officers.find(o => o.code !== L1 && o.code !== SO);
  if (other) {
    const r = await call(app.getApprovalInbox, { params: { empCode: other.code }, query: { month: PERIOD } });
    assert.ok(!(r.body.plans || []).map(p => p.plan_id).includes(PLAN),
      `the plan leaked into ${other.code}'s inbox`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
S('5. the approver reviews and sends it back');

await okA('the approval view shows the schedule and a category mix', async () => {
  const r = await call(app.getPlanForApproval, { params: { empCode: L1, planId: PLAN } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const p = r.body.plan;
  note('  category mix', JSON.stringify(p.category_mix));
  assert.ok(p.category_mix && Object.keys(p.category_mix).length, 'no category mix — the chips render empty');
  assert.equal(p.actions.can_approve, true);
  assert.equal(p.actions.can_rectify, true);
});

await okA('Send back works, and the officer sees the remark', async () => {
  const r = await call(app.decidePlan, { params: { empCode: L1, planId: PLAN },
    body: { action: 'RECTIFY', remarks: 'Add the two counters you missed in Dukli.' } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const back = (await call(app.getMyPlanDetail, { params: { empCode: SO, planId: PLAN } })).body.plan;
  note('  status / remaining rectifications', `${back.status} / ${back.rectification.remaining}`);
  note('  remark the officer sees', back.rectification.remarks);
  assert.equal(back.status, 'RECTIFY');
  assert.equal(back.actions.can_edit, true, 'he cannot fix it after being told to');
  assert.equal(back.rectification.remaining, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
S('6. he resubmits — and a second send-back is refused');

await okA('he resubmits', async () => {
  const r = await call(app.submitMyPlan, { params: { empCode: SO, planId: PLAN }, body: {} });
  assert.equal(r.code, 200, JSON.stringify(r.body));
});

await okA('the button is disabled AND the API refuses', async () => {
  const view = await call(app.getPlanForApproval, { params: { empCode: L1, planId: PLAN } });
  const a = view.body.plan.actions;
  note('  can_rectify (the button)', a.can_rectify);
  note('  reason shown', a.rectify_blocked_reason);
  assert.equal(a.can_rectify, false, 'the Send back button would still be live');
  assert.ok(a.rectify_blocked_reason, 'no explanation for the disabled button');

  const r = await call(app.decidePlan, { params: { empCode: L1, planId: PLAN },
    body: { action: 'RECTIFY', remarks: 'again' } });
  note('  API response', `${r.code} — ${r.body?.error || ''}`);
  assert.ok(r.code >= 400, 'a second rectification was allowed');
});

await okA('someone who is not the L1 cannot approve', async () => {
  const stranger = officers.find(o => o.code !== L1 && o.code !== SO);
  if (!stranger) return;
  const r = await call(app.decidePlan, { params: { empCode: stranger.code, planId: PLAN },
    body: { action: 'APPROVE' } });
  assert.ok(r.code >= 400, `${stranger.code} approved someone else's plan`);
});

await okA('the L1 approves, and both sides settle', async () => {
  const r = await call(app.decidePlan, { params: { empCode: L1, planId: PLAN },
    body: { action: 'APPROVE', remarks: 'Approved.' } });
  assert.equal(r.code, 200, JSON.stringify(r.body));

  const off = (await call(app.getMyPlanDetail, { params: { empCode: SO, planId: PLAN } })).body.plan;
  note('  officer sees', `${off.status} · can_edit ${off.actions.can_edit}`);
  assert.equal(off.status, 'APPROVED');
  assert.equal(off.actions.can_edit, false);

  const inbox = await call(app.getApprovalInbox, { params: { empCode: L1 }, query: { month: PERIOD } });
  assert.ok(!(inbox.body.plans || []).map(p => p.plan_id).includes(PLAN), 'still sitting in the inbox');
});

await okA('the trail the page prints is complete and in order', async () => {
  const p = (await call(app.getMyPlanDetail, { params: { empCode: SO, planId: PLAN } })).body.plan;
  const trail = (p.history || []).map(h => h.action_type);
  note('  history', trail.join(' → '));
  assert.deepEqual(trail, ['SUBMITTED', 'RECTIFY', 'RESUBMITTED', 'APPROVED']);
});

console.log('\n' + '─'.repeat(76));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
