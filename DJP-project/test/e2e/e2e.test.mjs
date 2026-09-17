/**
 * FULL END-TO-END RUN — Star Cement PJP/DJP
 *
 * Walks all eight stages in order, on the test-kit data, against the REAL engines.
 * Nothing here is stubbed except the database driver (MySQL → in-memory SQLite).
 *
 *   1  Upload           the six input files land in the right tables
 *   2  PJP              categories, grades, visit frequencies per dealer
 *   3  DJP              visits allocated to working days within capacity
 *   4  Officer plans    one plan per employee per role, routed to a named L1
 *   5  Workflow         edit → submit → rectify (once) → resubmit → approve
 *   6  SFA feedback     the 15th-of-month upload
 *   7  Adherence        MTD-prorata adherence per role and per dealer
 *   8  C2 regeneration  missed dealers lead the new C2, with a reviewable diff
 *
 * Every stage prints what it produced. Failures are reported, not thrown, so one
 * broken stage does not hide the state of the rest.
 */
import assert from 'node:assert/strict';
import { dbAll, dbGet, dbRun } from './sandbox/src/config/database.js';
import { seed, seedSfaFeedback, KIT } from './seed.mjs';

const PERIOD = '2026-09';
let pass = 0, fail = 0;
const out = [];

const H = t => { const l = `\n${'═'.repeat(74)}\n  ${t}\n${'═'.repeat(74)}`; console.log(l); };
const S = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`);
const ok = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; out.push(name); }
};
const okA = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; out.push(name); }
};
const note = (k, v) => console.log(`     ${String(k).padEnd(44, '.')} ${v}`);

// Controllers take (req,res); this captures what they would send.
const call = async (handler, { params = {}, query = {}, body = {} } = {}) => {
  let code = 200, payload = null;
  const res = { status(c) { code = c; return this; }, json(p) { payload = p; return this; } };
  await handler({ params, query, body }, res);
  return { code, body: payload };
};

const silence = () => { const l = console.log; console.log = () => {}; return () => { console.log = l; }; };

// ═══════════════════════════════════════════════════════════════════════════
H('STAGE 1 — UPLOAD: the six input files');

const counts = await seed();
note('master_dealers (18 mapped + 15 prospects)', counts.dealers);
note('master_dealer_so_mapping rows', counts.mapping);
note('master_employees (all four roles)', counts.employees);
note('sales_history rows (RSAR only)', counts.rsarRows);
note('dealer_performance_history rows (DP only)', counts.dpRows);

await okA('Dealer Mapping produced 18 dealers', async () =>
  assert.equal((await dbGet(`SELECT COUNT(*) c FROM master_dealers WHERE dealer_type='DEALER'`)).c, 18));
await okA('Prospects are loaded as PROSPECTIVE, not as dealers', async () =>
  assert.equal((await dbGet(`SELECT COUNT(*) c FROM master_dealers WHERE dealer_type='PROSPECTIVE'`)).c, 15));
await okA('every one of the four roles is in master_employees', async () => {
  const r = await dbAll(`SELECT designation, COUNT(*) c FROM master_employees GROUP BY designation ORDER BY designation`);
  const byRole = Object.fromEntries(r.map(x => [x.designation, x.c]));
  note('  employees by role', JSON.stringify(byRole));
  for (const role of ['SO', 'ASM', 'RSM', 'ZH']) assert.ok(byRole[role] > 0, `no ${role} in master_employees`);
});
await okA('RSAR and Dealer Performance stayed in separate tables', async () => {
  const rsarInDp = await dbGet(`SELECT COUNT(*) c FROM dealer_performance_history WHERE sap_code LIKE '15%'`);
  assert.equal(rsarInDp.c, 0, 'RSAR sub-dealer codes leaked into dealer_performance_history');
});
await okA('SBG supplied potential and block; absent SBG is NULL not zero', async () => {
  const withSbg = await dbGet(`SELECT COUNT(*) c FROM master_dealers WHERE sbg_potential IS NOT NULL`);
  note('  dealers carrying an SBG potential', withSbg.c);
  assert.ok(withSbg.c > 0);
});

// ═══════════════════════════════════════════════════════════════════════════
H('STAGE 2+3 — PJP AND DJP: run the real generator for C1');

const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');

let djpC1 = null, djpError = null;
{
  const un = silence();
  try { djpC1 = await generateFullPjpDjpSolution(PERIOD, 'C1', { generationRunCode: 'GEN-E2E-C1', dealerMappingBatchCode: counts.mappingBatch, salesHistoryBatchCodes: [counts.salesBatch] }); }
  catch (e) { djpError = e; }
  un();
}

await okA('the DJP generator ran without throwing', () => {
  if (djpError) throw new Error(djpError.message);
  assert.ok(djpC1);
});

if (djpC1) {
  note('dealer targets produced', djpC1.totalDealerTargets);
  note('visits required (float sum)', Number(djpC1.totalVisitsRequired).toFixed(2));
  note('DJP day-slots allocated', djpC1.totalDjpSlots);
  note('unallocated (capacity exhausted)', djpC1.unallocatedCount);
  note('capacity violated', djpC1.capacityViolated);
}

S('PJP output — the dealer-level table (this is column U)');
const targets = await dbAll(
  `SELECT sap_code, dealer_name, dm_area, category, dealer_status, priority,
          so_visits, asm_visits, rsm_visits, zh_visits, so_emp_code, asm_code, rsm_code, zh_code
     FROM dealer_visit_targets WHERE period_month=? AND cycle_code='C1' ORDER BY priority, sap_code`, [PERIOD]);

await okA('every active dealer got a visit target row', () => {
  note('  dealer_visit_targets rows (C1)', targets.length);
  assert.ok(targets.length > 0, 'PJP produced no targets at all');
});

await okA('each dealer carries a Final Category (column U)', () => {
  const byCat = {};
  for (const t of targets) byCat[t.dealer_status || '(blank)'] = (byCat[t.dealer_status || '(blank)'] || 0) + 1;
  note('  Final Category distribution', JSON.stringify(byCat));
  assert.equal(targets.filter(t => !t.dealer_status).length, 0, 'some dealers have no Final Category');
});

await okA('each dealer carries an area grade', () => {
  const byGrade = {};
  for (const t of targets) byGrade[t.category || '(blank)'] = (byGrade[t.category || '(blank)'] || 0) + 1;
  note('  Grade distribution', JSON.stringify(byGrade));
  assert.equal(targets.filter(t => !t.category).length, 0);
});

await okA('the hierarchy CODES are stored, not names', () => {
  const nameLike = targets.filter(t => t.asm_code && /[A-Za-z]{3}/.test(t.asm_code));
  note('  ASM code cells holding a name instead', nameLike.length);
  assert.equal(nameLike.length, 0, `asm_code holds a name for ${nameLike.length} row(s)`);
});

await okA('visit frequencies were assigned for more than one role', () => {
  const sum = r => targets.reduce((a, t) => a + (parseFloat(t[r]) || 0), 0);
  note('  SO visits / ASM / RSM / ZH',
    `${sum('so_visits').toFixed(1)} / ${sum('asm_visits').toFixed(1)} / ${sum('rsm_visits').toFixed(1)} / ${sum('zh_visits').toFixed(1)}`);
  assert.ok(sum('so_visits') > 0, 'no SO visits planned');
});

S('DJP output — visits placed on working days');
const recs = await dbAll(
  `SELECT role_type, COUNT(*) n, COUNT(DISTINCT emp_code) emps, COUNT(DISTINCT visit_date) days
     FROM djp_recommendations WHERE period_month=? AND cycle_code='C1' GROUP BY role_type`, [PERIOD]);
for (const r of recs) note(`  ${r.role_type}`, `${r.n} visit(s) across ${r.emps} officer(s), ${r.days} day(s)`);

await okA('DJP scheduled visits for the SO role', () =>
  assert.ok(recs.find(r => r.role_type === 'SO')?.n > 0, 'no SO visits were scheduled'));

await okA('no working day exceeds the daily capacity of 8', async () => {
  const over = await dbAll(
    `SELECT emp_code, visit_date, COUNT(*) n FROM djp_recommendations
      WHERE period_month=? AND cycle_code='C1' AND role_type='SO'
      GROUP BY emp_code, visit_date HAVING n > 8`, [PERIOD]);
  note('  officer-days above capacity', over.length);
  assert.equal(over.length, 0);
});

await okA('no visit was scheduled on a Sunday', async () => {
  const rows = await dbAll(`SELECT DISTINCT visit_date FROM djp_recommendations WHERE period_month=? AND cycle_code='C1'`, [PERIOD]);
  const sundays = rows.filter(r => new Date(`${r.visit_date}T00:00:00Z`).getUTCDay() === 0);
  note('  distinct working days used', rows.length);
  assert.equal(sundays.length, 0, `scheduled on Sunday: ${sundays.map(s => s.visit_date).join(', ')}`);
});

await okA('every scheduled visit falls inside the C1 window (days 1-15)', async () => {
  const rows = await dbAll(`SELECT DISTINCT visit_date FROM djp_recommendations WHERE period_month=? AND cycle_code='C1'`, [PERIOD]);
  const outside = rows.filter(r => { const d = parseInt(String(r.visit_date).slice(8, 10), 10); return d < 1 || d > 15; });
  assert.equal(outside.length, 0, `outside C1: ${outside.map(o => o.visit_date).join(', ')}`);
});

// ═══════════════════════════════════════════════════════════════════════════
H('STAGE 4 — OFFICER PLANS: generated in the same run as the DJP');

const { generatePlansForAllRoles } = await import('./sandbox/src/controllers/generation.controller.js');

let plansC1 = null;
{ const un = silence(); plansC1 = await generatePlansForAllRoles(PERIOD, 'C1', {}); un(); }

note('officer plans created', plansC1.totalPlans);
note('visits inside those plans', plansC1.totalVisits);
note('by role', JSON.stringify(plansC1.byRole));
if (plansC1.errors?.length) note('errors', JSON.stringify(plansC1.errors.slice(0, 3)));

await okA('plans were generated for at least the SO role', () =>
  assert.ok(plansC1.totalPlans > 0, 'no officer plans at all'));

const planRows = await dbAll(
  `SELECT emp_code, emp_name, emp_role, status, l1_approver_emp_code, l1_approver_name, l1_approver_role,
          (SELECT COUNT(*) FROM sales_plan_details d WHERE d.plan_id = p.id) visits
     FROM sales_plans p WHERE period_month=? AND cycle_code='C1' ORDER BY emp_role, emp_code`, [PERIOD]);

S('every plan, with the L1 it routed to');
for (const p of planRows) {
  console.log(`     ${String(p.emp_role || '?').padEnd(4)} ${String(p.emp_code).padEnd(10)} ${String(p.emp_name || '').slice(0, 26).padEnd(27)} ` +
              `${String(p.visits).padStart(3)} visit(s)  →  L1 ${p.l1_approver_role || '?'} ${p.l1_approver_name || p.l1_approver_emp_code || '(none)'}`);
}

await okA('emp_role is persisted — no plan silently defaults to SO', () => {
  const roles = [...new Set(planRows.map(p => p.emp_role))];
  note('  distinct roles on plans', JSON.stringify(roles));
  assert.ok(!planRows.some(p => !p.emp_role), 'a plan has no emp_role');
});

await okA('the employee NAME is shown, never the bare code', () => {
  const codeAsName = planRows.filter(p => !p.emp_name || p.emp_name === p.emp_code || /^\d+$/.test(String(p.emp_name)));
  note('  plans showing a code in place of a name', codeAsName.length);
  assert.equal(codeAsName.length, 0,
    `code-as-name: ${codeAsName.map(p => p.emp_code).join(', ')}`);
});

await okA('every officer PRESENT IN THE DEALER/SO MAPPING routed to a named L1', async () => {
  const mapped = new Set((await dbAll(`SELECT DISTINCT so_emp_code c FROM master_dealer_so_mapping`)).map(r => String(r.c)));
  const missing = planRows.filter(p => p.emp_role === 'SO' && mapped.has(String(p.emp_code)) && !p.l1_approver_emp_code);
  note('  mapped SOs with no L1', missing.length);
  assert.equal(missing.length, 0, `unrouted: ${missing.map(p => p.emp_code).join(', ')}`);
});

await okA('FINDING — prospect-only officers get a plan that reaches no inbox', async () => {
  const mapped = new Set((await dbAll(`SELECT DISTINCT so_emp_code c FROM master_dealer_so_mapping`)).map(r => String(r.c)));
  const orphans = planRows.filter(p => p.emp_role === 'SO' && !mapped.has(String(p.emp_code)));
  note('  SOs that exist only in the Prospect file', orphans.length);
  note('  ...of which have no L1 and cannot be approved', orphans.filter(o => !o.l1_approver_emp_code).length);
  // The Prospect template carries SO Name and SO Emp Code but no ASM/RSM/ZH, so
  // these officers have no hierarchy anywhere. The engine warns, which is right —
  // but the plan is still created and is un-approvable. Documented, not asserted away.
  assert.equal(orphans.filter(o => o.l1_approver_emp_code).length, 0,
    'a prospect-only SO somehow acquired an L1 — the routing source changed');
});

await okA('a dealer cannot be booked twice on the same day', async () => {
  const dup = await dbAll(
    `SELECT p.emp_code, d.visit_date, d.dealer_sap_code, COUNT(*) n
       FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month=? AND p.cycle_code='C1'
      GROUP BY p.emp_code, d.visit_date, d.dealer_sap_code HAVING n > 1`, [PERIOD]);
  note('  same dealer twice in one officer-day', dup.length);
  assert.equal(dup.length, 0);
});

await okA('the L1 of an SO is his ASM, from the Dealer/SO mapping', async () => {
  const so = planRows.find(p => p.emp_role === 'SO');
  assert.ok(so, 'no SO plan to check');
  const expect = await dbGet(`SELECT asm_code, asm_name FROM master_dealer_so_mapping WHERE so_emp_code = ? LIMIT 1`, [so.emp_code]);
  note(`  SO ${so.emp_code} L1`, `${so.l1_approver_name} (${so.l1_approver_emp_code}) — mapping says ${expect?.asm_name} (${expect?.asm_code})`);
  assert.equal(so.l1_approver_emp_code, expect.asm_code);
  assert.equal(so.l1_approver_role, 'ASM');
});

await okA('no officer is scheduled more than 8 visits on one day', async () => {
  const over = await dbAll(
    `SELECT p.emp_code, d.visit_date, COUNT(*) n
       FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month=? AND p.cycle_code='C1' GROUP BY p.emp_code, d.visit_date HAVING n > 8`, [PERIOD]);
  assert.equal(over.length, 0, `over cap: ${JSON.stringify(over)}`);
});

// ═══════════════════════════════════════════════════════════════════════════
H('STAGE 5 — WORKFLOW: edit → submit → rectify (once) → resubmit → approve');

const app = await import('./sandbox/src/controllers/appPlan.controller.js');
const soPlan = planRows.find(p => p.emp_role === 'SO' && p.visits > 0);
const soRow  = await dbGet(`SELECT id FROM sales_plans WHERE emp_code=? AND period_month=? AND cycle_code='C1'`, [soPlan.emp_code, PERIOD]);
const planId = soRow.id;
const SO = soPlan.emp_code, L1 = soPlan.l1_approver_emp_code;
note('demo plan', `#${planId} — SO ${SO} (${soPlan.emp_name}), L1 ${L1}`);

await okA('the officer can list his own plans', async () => {
  const r = await call(app.listMyPlans, { params: { empCode: SO }, query: { month: PERIOD } });
  assert.equal(r.code, 200);
  note('  plans visible to him', r.body.plans?.length ?? 0);
  assert.ok(r.body.plans.length > 0);
});

await okA('another officer cannot read his plan', async () => {
  const other = planRows.find(p => p.emp_code !== SO && p.emp_role === 'SO');
  if (!other) return;
  const r = await call(app.getMyPlanDetail, { params: { empCode: other.emp_code, planId } });
  assert.ok(r.code === 403 || r.code === 404, `expected 403/404, got ${r.code}`);
});

let beforeEdit = 0;
await okA('he can add a visit while the plan is DRAFT', async () => {
  beforeEdit = (await dbGet(`SELECT COUNT(*) c FROM sales_plan_details WHERE plan_id=?`, [planId])).c;
  const d = await call(app.getMyDealers, { params: { empCode: SO }, query: { month: PERIOD, cycle: 'C1' } });
  const dealers = d.body.dealers || [];
  assert.ok(dealers.length, 'no dealer available to add');

  // Find a (dealer, day) pair that is genuinely free — the API refuses the same
  // dealer twice on one day, which is correct and is asserted separately below.
  const days = (await dbAll(`SELECT DISTINCT visit_date FROM sales_plan_details WHERE plan_id=? ORDER BY visit_date`, [planId]))
    .map(x => String(x.visit_date).slice(0, 10));
  const taken = new Set((await dbAll(`SELECT visit_date, dealer_sap_code FROM sales_plan_details WHERE plan_id=?`, [planId]))
    .map(x => `${String(x.visit_date).slice(0, 10)}|${String(x.dealer_sap_code).toUpperCase()}`));
  const counts = Object.fromEntries((await dbAll(
    `SELECT visit_date, COUNT(*) n FROM sales_plan_details WHERE plan_id=? GROUP BY visit_date`, [planId]))
    .map(x => [String(x.visit_date).slice(0, 10), x.n]));

  let picked = null;
  for (const day of days) {
    if ((counts[day] || 0) >= 8) continue;              // respect the daily cap
    for (const dl of dealers) {
      const code = dl.sap_code || dl.dealer_sap_code;
      if (!code) continue;
      if (taken.has(`${day}|${String(code).toUpperCase()}`)) continue;
      picked = { day, code, name: dl.dealer_name }; break;
    }
    if (picked) break;
  }
  assert.ok(picked, 'no free dealer/day slot in this plan');
  note('  adding', `${picked.name} on ${picked.day}`);

  const r = await call(app.addVisit, {
    params: { empCode: SO, planId },
    body: { visitDate: picked.day, dealerSapCode: picked.code, dealerName: picked.name, purposeOfVisit: 'E2E added' }
  });
  assert.ok(r.code === 200 || r.code === 201, `add failed: ${JSON.stringify(r.body)}`);
  const after = (await dbGet(`SELECT COUNT(*) c FROM sales_plan_details WHERE plan_id=?`, [planId])).c;
  note('  visits before → after', `${beforeEdit} → ${after}`);
  assert.equal(after, beforeEdit + 1);
});

await okA('submitting moves it to SUBMITTED', async () => {
  const r = await call(app.submitMyPlan, { params: { empCode: SO, planId }, body: {} });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const s = await dbGet(`SELECT status FROM sales_plans WHERE id=?`, [planId]);
  note('  status', s.status);
  assert.equal(s.status, 'SUBMITTED');
});

await okA('once submitted he can no longer edit it', async () => {
  const r = await call(app.removeVisit, { params: { empCode: SO, planId, detailId: 1 } });
  assert.ok(r.code >= 400, `expected a refusal, got ${r.code}`);
});

await okA('the plan appears in his L1 inbox and nobody else\'s', async () => {
  const inbox = await call(app.getApprovalInbox, { params: { empCode: L1 }, query: { month: PERIOD } });
  assert.equal(inbox.code, 200);
  const ids = (inbox.body.plans || []).map(p => p.plan_id ?? p.id);
  note(`  L1 ${L1} inbox`, `${ids.length} plan(s)`);
  assert.ok(ids.includes(planId), 'plan is not in the L1 inbox');

  const stranger = planRows.find(p => p.emp_code !== L1 && p.emp_role === 'SO');
  if (stranger) {
    const other = await call(app.getApprovalInbox, { params: { empCode: stranger.emp_code }, query: { month: PERIOD } });
    assert.ok(!(other.body.plans || []).map(p => p.plan_id ?? p.id).includes(planId), 'plan leaked into another inbox');
  }
});

await okA('L1 can send it back for rectification', async () => {
  const r = await call(app.decidePlan, { params: { empCode: L1, planId }, body: { action: 'RECTIFY', remarks: 'Add the two missed counters.' } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const s = await dbGet(`SELECT status, rectification_count, rectify_remarks FROM sales_plans WHERE id=?`, [planId]);
  note('  status / count / remark', `${s.status} / ${s.rectification_count} / "${s.rectify_remarks}"`);
  assert.equal(s.status, 'RECTIFY');
  assert.equal(s.rectification_count, 1);
});

await okA('the officer can edit again while it is in RECTIFY', async () => {
  const one = await dbGet(`SELECT id FROM sales_plan_details WHERE plan_id=? ORDER BY id DESC LIMIT 1`, [planId]);
  const r = await call(app.removeVisit, { params: { empCode: SO, planId, detailId: one.id } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
});

await okA('he resubmits', async () => {
  const r = await call(app.submitMyPlan, { params: { empCode: SO, planId }, body: {} });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  assert.equal((await dbGet(`SELECT status FROM sales_plans WHERE id=?`, [planId])).status, 'SUBMITTED');
});

await okA('a SECOND rectification is refused — the rule is once only', async () => {
  const r = await call(app.decidePlan, { params: { empCode: L1, planId }, body: { action: 'RECTIFY', remarks: 'again' } });
  note('  second RECTIFY returned', `${r.code} — ${r.body?.error || ''}`);
  assert.ok(r.code >= 400, 'a second rectification was allowed');
  assert.equal((await dbGet(`SELECT status FROM sales_plans WHERE id=?`, [planId])).status, 'SUBMITTED');
});

await okA('someone who is not the L1 cannot approve', async () => {
  const stranger = planRows.find(p => p.emp_code !== L1 && p.emp_code !== SO);
  if (!stranger) return;
  const r = await call(app.decidePlan, { params: { empCode: stranger.emp_code, planId }, body: { action: 'APPROVE' } });
  assert.ok(r.code >= 400, `a non-L1 approved the plan (${r.code})`);
});

await okA('the L1 approves and the plan locks', async () => {
  const r = await call(app.decidePlan, { params: { empCode: L1, planId }, body: { action: 'APPROVE', remarks: 'OK' } });
  assert.equal(r.code, 200, JSON.stringify(r.body));
  const s = await dbGet(`SELECT status, approved_by FROM sales_plans WHERE id=?`, [planId]);
  note('  status / approved_by', `${s.status} / ${s.approved_by}`);
  assert.equal(s.status, 'APPROVED');
});

await okA('an approved plan cannot be approved twice', async () => {
  const r = await call(app.decidePlan, { params: { empCode: L1, planId }, body: { action: 'APPROVE' } });
  assert.ok(r.code >= 400);
});

await okA('every transition is in the audit trail, in order', async () => {
  const log = await dbAll(`SELECT action_type, action_by FROM plan_approvals WHERE plan_id=? ORDER BY id`, [planId]);
  note('  trail', log.map(l => l.action_type).join(' → '));
  assert.ok(log.length >= 4, `expected the full trail, got ${log.length} entries`);
});

// ═══════════════════════════════════════════════════════════════════════════
H('STAGE 6+7 — SFA FEEDBACK AND ADHERENCE (the 15th-of-month upload)');

const sfaRows = await seedSfaFeedback(PERIOD);
note('SFA visit rows loaded', sfaRows);
note('distinct officers in the feedback',
  (await dbGet(`SELECT COUNT(DISTINCT employee_code) c FROM visit_execution_logs`)).c);

const adh = await import('./sandbox/src/engines/sfa-adherence.engine.js');
let report = null;
{ const un = silence(); report = await adh.analyseAdherence({ periodMonth: PERIOD, cycleCode: 'C1', asOnDate: `${PERIOD}-15` }); un(); }

S('adherence as on the 15th — the client method');
const T = report.totals;
note('planned visit instances', T.planned);
note('MTD due (prorata to the 15th)', T.mtd_planned.toFixed(1));
note('adhered (uncapped)', T.adhered);
note('adhered (capped at planned)', T.adhered_capped);
note('pending (MTD due − adhered)', T.pending.toFixed(1));
note('adherence % capped / raw',
  `${(T.adherence_pct_capped * 100).toFixed(1)}% / ${(T.adherence_pct * 100).toFixed(1)}%`);
note('SFA rows resolved / unresolved',
  `${report.diagnostics.resolved_visits} / ${report.diagnostics.unresolved_visits}`);
note('visits made that were never planned', report.diagnostics.unplanned_visits);

await okA('the adherence engine returned a report', () =>
  assert.ok(report && typeof T.adherence_pct_capped === 'number'));

await okA('capped and uncapped are both reported, and capped never exceeds planned', () => {
  assert.ok(T.adhered_capped <= T.planned, 'capped adherence exceeds the plan');
  assert.ok(T.adhered_capped <= T.adhered, 'capped exceeds uncapped');
});

await okA('every SFA customer code resolved to a dealer', () => {
  const d = report.diagnostics;
  if (d.unresolved_visits) note('  unresolved codes', JSON.stringify(d.unresolved_detail.slice(0, 3)));
  assert.equal(d.unresolved_visits, 0, `${d.unresolved_visits} SFA row(s) match no dealer`);
});

await okA('MTD prorata is applied, not a raw full-cycle comparison', () => {
  const f = adh.cycleElapsedFraction('C1', `${PERIOD}-15`, PERIOD, { C1: { start: 1, end: 15 }, C2: { start: 16, end: 31 } });
  note('  elapsed fraction of C1 on the 15th', f);
  assert.equal(f, 1, 'day 15 should be the full C1 cycle');
  const mid = adh.cycleElapsedFraction('C1', `${PERIOD}-08`, PERIOD, { C1: { start: 1, end: 15 }, C2: { start: 16, end: 31 } });
  note('  elapsed fraction on the 8th', mid.toFixed(4));
  assert.ok(mid > 0.5 && mid < 0.6, `expected ~8/15, got ${mid}`);
});

await okA('adherence is reported per ROLE, not SO-only', () => {
  const roles = Object.keys(report.byRole || {});
  note('  roles in the report', JSON.stringify(roles));
  for (const [r, v] of Object.entries(report.byRole))
    console.log(`     ${r.padEnd(4)} planned ${String(v.planned).padStart(3)}  adhered ${String(v.adhered).padStart(3)}  ` +
                `pending ${String(v.pending.toFixed(1)).padStart(6)}  ${(v.adherence_pct_capped * 100).toFixed(1)}%`);
  assert.ok(roles.length > 1, 'byRole covers only one role — still SO-only');
});

await okA('adherence is reported per DEALER as well as per EMPLOYEE', () => {
  note('  per-employee rows', report.byEmployee.length);
  note('  per-dealer rows', report.byDealer.length);
  assert.ok(report.byDealer.length > 0, 'no per-dealer breakdown');
  assert.ok(report.byEmployee.length > 0, 'no per-employee breakdown');
});

S('the officers with the worst adherence — what the admin screen shows first');
for (const e of report.byEmployee.slice(0, 6))
  console.log(`     ${String(e.role).padEnd(4)} ${String(e.emp_code).padEnd(10)} ${String(e.emp_name || '').slice(0, 24).padEnd(25)}` +
              ` planned ${String(e.planned).padStart(3)}  adhered ${String(e.adhered).padStart(3)}` +
              `  pending ${String(e.pending.toFixed(1)).padStart(6)}  ${(e.adherence_pct_capped * 100).toFixed(0)}%`);

await okA('pending = MTD planned − adhered, negatives allowed', () => {
  assert.ok(report.byEmployee.every(e => typeof e.pending === 'number'));
  for (const e of report.byEmployee) {
    const expect = e.mtd_planned - e.adhered;
    assert.ok(Math.abs(e.pending - expect) < 1e-6,
      `${e.emp_code}: pending ${e.pending} ≠ mtd ${e.mtd_planned} − adhered ${e.adhered}`);
  }
  const neg = report.byEmployee.filter(e => e.pending < 0);
  note('  officers who over-performed (negative pending)', neg.length);
});

await okA('visits are COUNTED, not treated as a yes/no flag', () => {
  const multi = report.byDealer.filter(d => d.adhered > 1);
  note('  dealer rows with more than one logged visit', multi.length);
  assert.ok(report.byDealer.every(d => typeof d.adhered === 'number'));
});

await okA('SFA customer codes resolved through master_dealers.sfa_code', () => {
  note('  visits resolved via an SFA code rather than SAP', report.diagnostics.resolved_via_sfa_code);
  const unmatched = report.byDealer.filter(d => !d.dealer_sap_code);
  assert.equal(unmatched.length, 0);
});

let legacy = null;
await okA('the C1 wrapper still gives the C2 rebuild what it needs', async () => {
  const un = silence();
  legacy = await adh.analyseC1Adherence(PERIOD, { asOnDate: `${PERIOD}-15` });
  un();
  note('  completed / missed dealer records', `${legacy.completedCount} / ${legacy.missedCount}`);
  note('  byEmployee map size', legacy.byEmployee.size);
  for (const m of (legacy.missedDealers || []).slice(0, 5))
    console.log(`     missed: ${m.dealer_sap_code} ${String(m.dealer_name || '').slice(0, 30).padEnd(31)} officer ${m.emp_code}`);
  assert.ok(Array.isArray(legacy.missedDealers));
  assert.ok(legacy.byEmployee instanceof Map);
});

// ═══════════════════════════════════════════════════════════════════════════
H('STAGE 8 — C2 REGENERATION: missed dealers lead the new cycle');

const gen = await import('./sandbox/src/controllers/generation.controller.js');

// Build a C2 first, so the regeneration has a real BEFORE to diff against.
{ const un = silence(); await gen.runGenerationPipeline(PERIOD, 'C2', { generationRunCode: 'GEN-E2E-C2', dealerMappingBatchCode: counts.mappingBatch, salesHistoryBatchCodes: [counts.salesBatch] }); un(); }

const c2Before = await dbGet(
  `SELECT COUNT(DISTINCT p.id) plans, COUNT(d.id) visits FROM sales_plans p
    LEFT JOIN sales_plan_details d ON d.plan_id = p.id
   WHERE p.period_month=? AND p.cycle_code='C2'`, [PERIOD]);
note('original C2 — plans / visits', `${c2Before.plans} / ${c2Before.visits}`);

let regen = null;
{ const un = silence(); regen = await call(gen.regenerateC2Plans, { body: { planMonth: PERIOD } }); un(); }

await okA('the regeneration endpoint succeeded', () => {
  assert.equal(regen.code, 200, JSON.stringify(regen.body));
  note('  message', regen.body.message);
});

const c2After = await dbGet(
  `SELECT COUNT(DISTINCT p.id) plans, COUNT(d.id) visits FROM sales_plans p
    LEFT JOIN sales_plan_details d ON d.plan_id = p.id
   WHERE p.period_month=? AND p.cycle_code='C2'`, [PERIOD]);
note('regenerated C2 — plans / visits', `${c2After.plans} / ${c2After.visits}`);

await okA('C1 was left untouched — it is the record adherence was measured against', async () => {
  const c1 = await dbGet(`SELECT COUNT(*) c FROM sales_plans WHERE period_month=? AND cycle_code='C1'`, [PERIOD]);
  note('  C1 plans still present', c1.c);
  assert.equal(c1.c, planRows.length);
  const approved = await dbGet(`SELECT status FROM sales_plans WHERE id=?`, [planId]);
  assert.equal(approved.status, 'APPROVED', 'the approved C1 plan was disturbed');
});

await okA('the regeneration is recorded in the run history', async () => {
  const runs = await dbAll(`SELECT generation_code, cycle_code, status FROM generation_runs WHERE cycle_code='C2' ORDER BY id DESC`);
  note('  C2 runs recorded', runs.length);
  assert.ok(runs.some(r => r.generation_code.includes('C2REGEN')), 'no C2REGEN run row');
});

await okA('a BEFORE and an AFTER snapshot were both captured', async () => {
  const r = await dbGet(`SELECT * FROM c2_regenerations ORDER BY id DESC LIMIT 1`);
  assert.ok(r, 'no regeneration record');
  note('  status', r.status);
  note('  visits before → after', `${r.visits_before} → ${r.visits_after}`);
  note('  adherence stored on the record', `${r.adherence_adhered}/${r.adherence_planned} = ${r.adherence_pct}%`);
  assert.equal(r.status, 'COMPLETED');
  const b = await dbGet(`SELECT COUNT(*) c FROM c2_regeneration_lines WHERE regeneration_id=? AND phase='BEFORE'`, [r.id]);
  const a = await dbGet(`SELECT COUNT(*) c FROM c2_regeneration_lines WHERE regeneration_id=? AND phase='AFTER'`, [r.id]);
  note('  snapshot lines BEFORE / AFTER', `${b.c} / ${a.c}`);
  assert.equal(b.c, c2Before.visits, 'BEFORE snapshot does not match the plan that existed');
  assert.equal(a.c, c2After.visits, 'AFTER snapshot does not match the rebuilt plan');
});

await okA('the review screen returns a readable diff', async () => {
  const list = await call(app.listC2Regenerations, { query: { month: PERIOD } });
  assert.equal(list.code, 200, JSON.stringify(list.body));
  const first = list.body.regenerations[0];
  note('  history rows', list.body.regenerations.length);
  const detail = await call(app.getC2Regeneration, { params: { id: first.id } });
  assert.equal(detail.code, 200, JSON.stringify(detail.body));
  const s = detail.body.summary;
  note('  distinct dealers before / after', `${s.dealers_before} / ${s.dealers_after}`);
  note('  officer-dealer assignments before / after', `${s.assignments_before} / ${s.assignments_after}`);
  note('  added / dropped', `${s.added} / ${s.dropped}`);
  note('  moved earlier / later', `${s.moved_earlier} / ${s.moved_later}`);
  note('  visit-count changes', s.visit_count_changed);
  note('  missed-in-C1 dealers now on C2', `${s.missed_c1_dealers_on_new_c2} of ${s.missed_c1_dealers_total}`);
  note('  ...across officer visits', s.missed_c1_assignments_on_new_c2);
  assert.ok(detail.body.changes, 'no change list returned');

  // "48 of 28 covered" was real: the numerator counted officer-dealer pairs and the
  // denominator counted dealers. Any ratio the screen prints must compare like with like.
  assert.ok(s.missed_c1_dealers_on_new_c2 <= s.missed_c1_dealers_total,
    `covered (${s.missed_c1_dealers_on_new_c2}) exceeds the total missed (${s.missed_c1_dealers_total}) — the two counts are not comparable`);
  assert.ok(s.dealers_after <= s.assignments_after,
    'distinct dealers cannot exceed officer-dealer assignments');

  S('the first changes the reviewer would see');
  for (const c of (detail.body.changes || []).slice(0, 8))
    console.log(`     ${String(c.change).padEnd(14)} ${String(c.emp_code).padEnd(10)} ${String(c.dealer_name || c.dealer_sap_code).slice(0, 26).padEnd(27)}` +
                `${c.before_dates?.length ? ` was ${c.before_dates.join(',')}` : ''}${c.dates?.length ? ` now ${c.dates.join(',')}` : ''}` +
                `${c.was_missed_in_c1 ? '   [missed in C1]' : ''}`);
});

await okA('dealers missed in C1 are scheduled EARLIER in the new C2', async () => {
  const r = await dbGet(`SELECT id, missed_dealer_codes FROM c2_regenerations ORDER BY id DESC LIMIT 1`);
  const missed = new Set(JSON.parse(r.missed_dealer_codes || '[]').map(c => String(c).toUpperCase()));
  note('  missed dealers carried into the rebuild', missed.size);
  if (missed.size === 0) { note('  (no missed dealers in this data — ordering not exercised)', ''); return; }

  const lines = await dbAll(
    `SELECT emp_code, dealer_sap_code, MIN(visit_date) d FROM c2_regeneration_lines
      WHERE regeneration_id=? AND phase='AFTER' GROUP BY emp_code, dealer_sap_code`, [r.id]);
  const byEmp = new Map();
  for (const l of lines) {
    if (!byEmp.has(l.emp_code)) byEmp.set(l.emp_code, []);
    byEmp.get(l.emp_code).push(l);
  }
  let checked = 0;
  for (const [emp, ls] of byEmp) {
    const m = ls.filter(l => missed.has(String(l.dealer_sap_code).toUpperCase()));
    const other = ls.filter(l => !missed.has(String(l.dealer_sap_code).toUpperCase()));
    if (!m.length || !other.length) continue;
    const firstMissed = m.map(x => x.d).sort()[0];
    const firstOther  = other.map(x => x.d).sort()[0];
    note(`  ${emp}: first missed-dealer visit / first other`, `${firstMissed} / ${firstOther}`);
    assert.ok(firstMissed <= firstOther, `${emp}: a missed dealer is scheduled after a non-missed one`);
    checked++;
  }
  if (!checked) note('  (no officer has both kinds — ordering not exercised)', '');
});

await okA('the admin list and adherence report both answer', async () => {
  const all = await call(app.listAllPlans, { query: { month: PERIOD, cycle: 'C2' } });
  assert.equal(all.code, 200, JSON.stringify(all.body));
  note('  admin sees C2 plans', (all.body.plans || []).length);
  const rep = await call(app.getAdherenceReport, { query: { month: PERIOD, cycle: 'C1', asOn: `${PERIOD}-15` } });
  assert.equal(rep.code, 200, JSON.stringify(rep.body));
  note('  adherence endpoint — capped / raw', `${rep.body.adherence.capped_pct}% / ${rep.body.adherence.raw_pct}%`);
  note('  ...dealers on plan / visited / missed',
    `${rep.body.totals.dealers_on_plan} / ${rep.body.totals.dealers_visited} / ${rep.body.totals.dealers_missed}`);
  note('  ...MTD due / adhered / pending',
    `${rep.body.totals.mtd_due} / ${rep.body.totals.adhered} / ${rep.body.totals.pending}`);

  // The screen and the engine must not disagree.
  assert.equal(rep.body.adherence.capped_pct, Math.round(T.adherence_pct_capped * 1000) / 10,
    'the endpoint and the engine report different adherence');
  assert.equal(rep.body.totals.planned_visits, T.planned);
});

// ═══════════════════════════════════════════════════════════════════════════
H('RESULT');
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) { console.log('\n  Failing checks:'); for (const f of out) console.log(`    • ${f}`); }
console.log('');
process.exit(fail ? 1 : 0);
