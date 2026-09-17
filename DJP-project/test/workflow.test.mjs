/**
 * End-to-end exercise of the app plan workflow against the REAL controller code.
 *
 * Seeds a miniature version of the Star Cement hierarchy from the DJP test kit
 * (ALIPURDUAR: SO 11001774 under ASM 11001393 under RSM 11001813 under ZH 11002257),
 * then walks every state transition and every guard.
 */
import assert from 'node:assert/strict';
import { db, dbRun, dbAll, dbGet } from './sandbox/src/config/database.js';
import * as app from './sandbox/src/controllers/appPlan.controller.js';
import { stampPlanRoutingForPeriod } from './sandbox/src/services/planRouting.service.js';

const PERIOD = '2026-09';
const CYCLE  = 'C1';

// ── schema (the columns the app workflow touches, post-migration) ────────────
db.exec(`
CREATE TABLE sales_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_code TEXT NOT NULL, emp_name TEXT NOT NULL,
  period_month TEXT NOT NULL, cycle_code TEXT NOT NULL DEFAULT 'C1',
  status TEXT DEFAULT 'DRAFT',
  submitted_at TEXT, approved_by TEXT, approved_at TEXT, remarks TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  emp_role TEXT DEFAULT 'SO', required_approver_role TEXT, approver_emp_code TEXT,
  l1_approver_emp_code TEXT, l1_approver_name TEXT, l1_approver_role TEXT,
  rectification_count INTEGER DEFAULT 0,
  rectify_requested_by TEXT, rectify_requested_at TEXT, rectify_remarks TEXT,
  resubmitted_at TEXT, last_edited_by TEXT, last_edited_at TEXT
);
CREATE TABLE sales_plan_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL,
  visit_date TEXT NOT NULL, dealer_id INTEGER, dealer_sap_code TEXT,
  dealer_name TEXT NOT NULL, dealer_type TEXT, purpose_of_visit TEXT,
  sequence INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')),
  visit_status TEXT DEFAULT 'ACTIVE', added_by TEXT, source TEXT DEFAULT 'AUTO'
);
CREATE TABLE plan_approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER, action_by TEXT,
  action_type TEXT, remarks TEXT, approver_role TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE master_employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT, emp_code TEXT UNIQUE, emp_name TEXT,
  designation TEXT, role TEXT, zone TEXT, region TEXT
);
CREATE TABLE master_dealers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sap_code TEXT, sfa_code TEXT,
  dealer_name TEXT, dealer_type TEXT, block TEXT
);
CREATE TABLE dealer_visit_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, period_month TEXT, cycle_code TEXT,
  dealer_id INTEGER, sap_code TEXT, sfa_code TEXT, dealer_name TEXT,
  area TEXT, zone TEXT, category TEXT, dealer_status TEXT, priority INTEGER,
  so_name TEXT, so_emp_code TEXT, asm_name TEXT, asm_code TEXT,
  rsm_name TEXT, rsm_code TEXT, zh_name TEXT, zh_code TEXT,
  so_visits REAL, asm_visits REAL, rsm_visits REAL, zh_visits REAL
);
CREATE TABLE master_dealer_so_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT, dealer_id INTEGER, sap_code TEXT, dealer_name TEXT,
  area TEXT, branch TEXT, region TEXT, block TEXT,
  so_name TEXT, so_emp_code TEXT, asm_name TEXT, asm_code TEXT,
  rsm_name TEXT, rsm_code TEXT, zh_name TEXT, zh_code TEXT,
  territory_code TEXT, territory_name TEXT, linked_dealer_code TEXT, batch_code TEXT
);
CREATE TABLE business_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_key TEXT, rule_value TEXT, data_type TEXT);
CREATE TABLE approval_matrix (id INTEGER PRIMARY KEY AUTOINCREMENT, submitter_role TEXT, required_approver_role TEXT, is_active INTEGER DEFAULT 1);
`);

for (const [k, v] of [['c1_start_day','1'],['c1_end_day','15'],['c2_start_day','16'],['c2_end_day','30'],['daily_visit_capacity','8']])
  db.prepare('INSERT INTO business_rules (rule_key, rule_value) VALUES (?,?)').run(k, v);
for (const [s, a] of [['SO','ASM'],['ASM','RSM'],['RSM','ZH'],['ZH','ADMIN']])
  db.prepare('INSERT INTO approval_matrix (submitter_role, required_approver_role) VALUES (?,?)').run(s, a);

const EMP = [
  ['11001774','DEBABRATA CHAKRABORTY- FKT','SO/SE'],
  ['11001393','DEBABRATA GHOSH','ASM'],
  ['11001813','RITWICK CHATTERJEE','RSM'],
  ['11002257','GIRIDHARI MUKHERJEE','ZH'],
  ['ADMIN01','SYSTEM ADMIN','ADMIN'],
  ['11002168','SUBHASISH KARMAKAR','SO/SE']
];
for (const [c, n, d] of EMP)
  db.prepare('INSERT INTO master_employees (emp_code, emp_name, designation) VALUES (?,?,?)').run(c, n, d);

const DEALERS = [
  ['1000001153','WBR128','R P ENTERPRISE','MADARIHAT','Need to Grow','A',95,2],
  ['1000001144','WBG075','GARG ENTERPRISES','MADARIHAT','De-growing','C',80,3],
  ['1000001140','R132','RADHA HARDWARE','FALAKATA','Zero Lifter','D',60,2],
  ['1000001148','WBM273','MAHESWARI CEMENT AGENCY','MADARIHAT','Growing','D',55,2],
  ['1000001147','WBM272','MAA BHABANI HARDWARE','ALIPURDUAR-II','De-growing','D',50,2],
  ['1000001146','WBH019','HARI OM TRADERS','ALIPURDUAR-I','Churn','D',10,0]
];
for (const [sap, sfa, name, block, cat, grade, prio, sov] of DEALERS) {
  db.prepare('INSERT INTO master_dealers (sap_code, sfa_code, dealer_name, dealer_type, block) VALUES (?,?,?,?,?)')
    .run(sap, sfa, name, 'DEALER', block);
  const did = db.prepare('SELECT id FROM master_dealers WHERE sap_code = ?').get(sap).id;
  db.prepare(`INSERT INTO dealer_visit_targets
    (period_month, cycle_code, dealer_id, sap_code, sfa_code, dealer_name, area, zone, category, dealer_status, priority,
     so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code, so_visits, asm_visits, rsm_visits, zh_visits)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(PERIOD, CYCLE, did, sap, sfa, name, 'ALIPURDUAR', 'NB1', grade, cat, prio,
         'DEBABRATA CHAKRABORTY- FKT','11001774','DEBABRATA GHOSH','11001393',
         'RITWICK CHATTERJEE','11001813','GIRIDHARI MUKHERJEE','11002257', sov, 1, 0.5, 0);
}

// ── Dealer / SO Mapping — the authoritative hierarchy ────────────────────────
// Deliberately disagrees with dealer_visit_targets on one link: both agree the SO
// reports to ASM 11001393, but the DJP snapshot says that ASM's RSM is 11001813
// while the mapping says RSM-FROM-MAPPING. The mapping is the authoritative record,
// so it must win — a territory reassignment lands there before it reaches a DJP run.
for (const [sap, name, block] of DEALERS.map(d => [d[0], d[2], d[3]])) {
  db.prepare(`INSERT INTO master_dealer_so_mapping
    (sap_code, dealer_name, area, block, region, so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(sap, name, 'ALIPURDUAR', block, 'NB1',
         'DEBABRATA CHAKRABORTY- FKT', '11001774', 'DEBABRATA GHOSH', '11001393',
         'MAPPED RSM', 'RSM-FROM-MAPPING', 'GIRIDHARI MUKHERJEE', '11002257');
}
// a single stray row pointing the ASM at someone else — majority must absorb it,
// so one bad row cannot silently reroute a whole plan
db.prepare(`INSERT INTO master_dealer_so_mapping
  (sap_code, dealer_name, area, so_name, so_emp_code, asm_name, asm_code, rsm_name, rsm_code, zh_name, zh_code)
  VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  .run('1000009999', 'MID-HANDOVER DEALER', 'ALIPURDUAR',
       'DEBABRATA CHAKRABORTY- FKT', '11001774', 'DEBABRATA GHOSH', '11001393',
       'STRAY RSM', 'RSM-STRAY', 'GIRIDHARI MUKHERJEE', '11002257');

// ── a generated DRAFT plan for the SO, mirroring AutoPlanGenerator output ─────
db.prepare(`INSERT INTO sales_plans (emp_code, emp_name, period_month, cycle_code, status, emp_role)
            VALUES (?,?,?,?,'DRAFT','SO')`)
  .run('11001774', 'DEBABRATA CHAKRABORTY- FKT', PERIOD, CYCLE);
const PLAN = db.prepare('SELECT id FROM sales_plans ORDER BY id DESC LIMIT 1').get().id;
const DAYS = ['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-07'];
let i = 0;
for (const [sap, , name, , cat, grade, , sov] of DEALERS) {
  for (let v = 0; v < sov; v++) {
    const did = db.prepare('SELECT id FROM master_dealers WHERE sap_code = ?').get(sap).id;
    db.prepare(`INSERT INTO sales_plan_details (plan_id, visit_date, dealer_id, dealer_sap_code, dealer_name, dealer_type, purpose_of_visit, sequence, source)
                VALUES (?,?,?,?,?,?,?,?,'AUTO')`)
      .run(PLAN, DAYS[i % DAYS.length], did, sap, name, 'DEALER', `PJP Scheduled Visit (${grade} - ${cat})`, (i % 5) + 1);
    i++;
  }
}
// an ASM plan too, to prove roles route differently
db.prepare(`INSERT INTO sales_plans (emp_code, emp_name, period_month, cycle_code, status, emp_role)
            VALUES (?,?,?,?,'DRAFT','ASM')`)
  .run('11001393', 'DEBABRATA GHOSH', PERIOD, CYCLE);
const ASM_PLAN = db.prepare('SELECT id FROM sales_plans ORDER BY id DESC LIMIT 1').get().id;
db.prepare(`INSERT INTO sales_plan_details (plan_id, visit_date, dealer_sap_code, dealer_name, sequence) VALUES (?,?,?,?,1)`)
  .run(ASM_PLAN, '2026-09-03', '1000001153', 'R P ENTERPRISE');

// ── express double ───────────────────────────────────────────────────────────
function call(handler, { params = {}, query = {}, body = {} } = {}) {
  return new Promise((resolve) => {
    let code = 200;
    const res = {
      status(c) { code = c; return this; },
      json(payload) { resolve({ code, body: payload }); }
    };
    handler({ params, query, body }, res).catch(e => resolve({ code: 500, body: { error: e.message } }));
  });
}

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== routing ==');
const routed = await stampPlanRoutingForPeriod(PERIOD, CYCLE);
const soPlan  = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [PLAN]);
const asmPlan = await dbGet('SELECT * FROM sales_plans WHERE id = ?', [ASM_PLAN]);

check('SO plan routes to the ASM who owns his territory', () => {
  assert.equal(soPlan.emp_role, 'SO');
  assert.equal(soPlan.l1_approver_emp_code, '11001393');
  assert.equal(soPlan.l1_approver_role, 'ASM');
});
check('ASM plan routes one level higher, to the RSM', () => {
  assert.equal(asmPlan.emp_role, 'ASM');
  assert.equal(asmPlan.l1_approver_role, 'RSM');
  assert.ok(asmPlan.l1_approver_emp_code);
});
check('every plan in the period got stamped', () => assert.equal(routed.stamped, 2));
check('the hierarchy is read from Dealer / SO Mapping, not the DJP snapshot', () => {
  assert.deepEqual(routed.hierarchySources, ['master_dealer_so_mapping']);
});
check('where the two sources disagree, Dealer / SO Mapping wins', () => {
  // dealer_visit_targets says the ASM's RSM is 11001813; the mapping says RSM-FROM-MAPPING
  assert.equal(asmPlan.l1_approver_emp_code, 'RSM-FROM-MAPPING');
  assert.equal(asmPlan.l1_approver_name, 'MAPPED RSM');
});
check('a single stray mapping row cannot reroute a plan — majority wins', () => {
  assert.notEqual(asmPlan.l1_approver_emp_code, 'RSM-STRAY');
});

console.log('== agent list + detail ==');
const list = await call(app.listMyPlans, { params: { empCode: '11001774' } });
check('list view returns the SO plan with counts and actions', () => {
  assert.equal(list.code, 200);
  assert.equal(list.body.plans.length, 1);
  const p = list.body.plans[0];
  assert.equal(p.counts.visits, 11);
  assert.equal(p.counts.dealers, 5);          // HARI OM has 0 visits, so 5 of 6
  assert.equal(p.actions.can_edit, true);
  assert.equal(p.actions.can_submit, true);
  assert.equal(p.rectification.remaining, 1);
});
const detail = await call(app.getMyPlanDetail, { params: { empCode: '11001774', planId: PLAN } });
check('detail view groups visits by day with category and grade', () => {
  assert.equal(detail.code, 200);
  assert.equal(detail.body.plan.days.length, 5);
  const first = detail.body.plan.days[0].visits[0];
  assert.ok(first.dealer.sap_code);
  assert.ok(first.final_category, 'final category joined from dealer_visit_targets');
  assert.ok(first.grade);
  assert.ok(detail.body.plan.category_mix['Need to Grow'] >= 1);
});
const foreign = await call(app.getMyPlanDetail, { params: { empCode: '11002168', planId: PLAN } });
check('another officer cannot open this plan', () => assert.equal(foreign.code, 403));

console.log('== agent edits ==');
const dealerPool = await call(app.getMyDealers, { params: { empCode: '11001774' }, query: { month: PERIOD, cycle: CYCLE } });
check('dealer pool excludes the Churn dealer with 0 required visits', () => {
  assert.equal(dealerPool.code, 200);
  assert.equal(dealerPool.body.dealers.length, 5);
  assert.ok(!dealerPool.body.dealers.some(d => d.sap_code === '1000001146'));
});
const badDate = await call(app.addVisit, {
  params: { empCode: '11001774', planId: PLAN },
  body: { visitDate: '2026-09-20', dealerSapCode: '1000001153' }
});
check('a C2 date is refused on a C1 plan', () => {
  assert.equal(badDate.code, 400);
  assert.match(badDate.body.error, /outside cycle C1/);
});
const dupDay = await call(app.addVisit, {
  params: { empCode: '11001774', planId: PLAN },
  body: { visitDate: '2026-09-01', dealerSapCode: '1000001153' }
});
check('the same dealer twice on one day is refused', () => {
  assert.equal(dupDay.code, 409);
  assert.match(dupDay.body.error, /already scheduled/);
});
const notMine = await call(app.addVisit, {
  params: { empCode: '11001774', planId: PLAN },
  body: { visitDate: '2026-09-08', dealerSapCode: '9999999999' }
});
check("a dealer outside the officer's targets is refused", () => assert.equal(notMine.code, 400));

const added = await call(app.addVisit, {
  params: { empCode: '11001774', planId: PLAN },
  body: { visitDate: '2026-09-08', dealerSapCode: '1000001146', purposeOfVisit: 'Revival call' }
});
check('a valid visit is added', () => assert.equal(added.code, 200));

const moved = await call(app.moveVisit, {
  params: { empCode: '11001774', planId: PLAN, detailId: added.body.detail_id },
  body: { visitDate: '2026-09-09' }
});
check('a visit can be moved within the cycle', () => assert.equal(moved.code, 200));

// fill 2026-09-10 to the cap, then prove the 9th is refused
for (let k = 0; k < 5; k++) {
  db.prepare(`INSERT INTO sales_plan_details (plan_id, visit_date, dealer_sap_code, dealer_name, sequence) VALUES (?,?,?,?,?)`)
    .run(PLAN, '2026-09-10', `PAD${k}`, `PAD DEALER ${k}`, k + 1);
}
for (let k = 0; k < 3; k++) {
  db.prepare(`INSERT INTO sales_plan_details (plan_id, visit_date, dealer_sap_code, dealer_name, sequence) VALUES (?,?,?,?,?)`)
    .run(PLAN, '2026-09-10', `PADX${k}`, `PAD X ${k}`, k + 6);
}
const overCap = await call(app.moveVisit, {
  params: { empCode: '11001774', planId: PLAN, detailId: added.body.detail_id },
  body: { visitDate: '2026-09-10' }
});
check('the 8-visit daily cap is enforced on edits', () => {
  assert.equal(overCap.code, 409);
  assert.match(overCap.body.error, /daily cap/);
});

const removed = await call(app.removeVisit, {
  params: { empCode: '11001774', planId: PLAN, detailId: added.body.detail_id }
});
check('a visit can be removed', () => assert.equal(removed.code, 200));

console.log('== submit ==');
const submit1 = await call(app.submitMyPlan, { params: { empCode: '11001774', planId: PLAN }, body: {} });
check('agent submits to his named ASM', () => {
  assert.equal(submit1.code, 200);
  assert.equal(submit1.body.status, 'SUBMITTED');
  assert.equal(submit1.body.approver.emp_code, '11001393');
  assert.equal(submit1.body.is_resubmission, false);
});
const editLocked = await call(app.addVisit, {
  params: { empCode: '11001774', planId: PLAN },
  body: { visitDate: '2026-09-11', dealerSapCode: '1000001146' }
});
check('agent is locked out while the plan is with the approver', () => {
  assert.equal(editLocked.code, 409);
  assert.match(editLocked.body.error, /with your approver/);
});

console.log('== L1 approval ==');
const inbox = await call(app.getApprovalInbox, { params: { empCode: '11001393' }, query: {} });
check("the ASM's inbox shows the submitted plan", () => {
  assert.equal(inbox.code, 200);
  assert.equal(inbox.body.plans.length, 1);
  assert.equal(inbox.body.plans[0].plan_id, PLAN);
  assert.equal(inbox.body.plans[0].actions.can_approve, true);
  assert.equal(inbox.body.plans[0].actions.can_rectify, true);
});
const wrongInbox = await call(app.getApprovalInbox, { params: { empCode: '11001813' }, query: {} });
check('the RSM does not see the SO plan in his inbox', () => {
  assert.equal(wrongInbox.body.plans.filter(p => p.plan_id === PLAN).length, 0);
});
const strangerDecision = await call(app.decidePlan, {
  params: { empCode: '11002168', planId: PLAN }, body: { action: 'APPROVE' }
});
check('a non-approver cannot approve', () => assert.equal(strangerDecision.code, 403));

const noRemarks = await call(app.decidePlan, {
  params: { empCode: '11001393', planId: PLAN }, body: { action: 'RECTIFY' }
});
check('sending back without remarks is refused', () => {
  assert.equal(noRemarks.code, 400);
  assert.match(noRemarks.body.error, /remarks are required/);
});

const rect1 = await call(app.decidePlan, {
  params: { empCode: '11001393', planId: PLAN },
  body: { action: 'RECTIFY', remarks: 'Move the Falakata cluster to one day and drop the duplicate on the 4th.' }
});
check('L1 sends the plan back once', () => {
  assert.equal(rect1.code, 200);
  assert.equal(rect1.body.status, 'RECTIFY');
  assert.equal(rect1.body.rectification_count, 1);
  assert.equal(rect1.body.rectification_remaining, 0);
});

console.log('== rectify, resubmit, and the one-shot rule ==');
const editAgain = await call(app.addVisit, {
  params: { empCode: '11001774', planId: PLAN },
  body: { visitDate: '2026-09-11', dealerSapCode: '1000001146' }
});
check('agent can edit again while in RECTIFY', () => assert.equal(editAgain.code, 200));

const listAfterRect = await call(app.listMyPlans, { params: { empCode: '11001774' } });
check('list view carries the rectification remarks back to the agent', () => {
  const p = listAfterRect.body.plans[0];
  assert.equal(p.status, 'RECTIFY');
  assert.match(p.rectification.remarks, /Falakata/);
  assert.equal(p.rectification.requested_by, '11001393');
  assert.equal(p.actions.can_edit, true);
});

const submit2 = await call(app.submitMyPlan, { params: { empCode: '11001774', planId: PLAN }, body: {} });
check('agent re-submits', () => {
  assert.equal(submit2.code, 200);
  assert.equal(submit2.body.is_resubmission, true);
  assert.equal(submit2.body.rectification_remaining, 0);
});

const inbox2 = await call(app.getApprovalInbox, { params: { empCode: '11001393' }, query: {} });
check('approver now sees Rectify greyed out with a reason', () => {
  const p = inbox2.body.plans[0];
  assert.equal(p.actions.can_approve, true);
  assert.equal(p.actions.can_rectify, false);
  assert.match(p.actions.rectify_blocked_reason, /already been sent back once/);
});

const rect2 = await call(app.decidePlan, {
  params: { empCode: '11001393', planId: PLAN },
  body: { action: 'RECTIFY', remarks: 'One more change please.' }
});
check('a SECOND rectification is refused', () => {
  assert.equal(rect2.code, 409);
  assert.match(rect2.body.error, /already been sent back for rectification once/);
  assert.deepEqual(rect2.body.allowed_actions, ['APPROVE']);
});

const approved = await call(app.decidePlan, {
  params: { empCode: '11001393', planId: PLAN },
  body: { action: 'APPROVE', remarks: 'Looks good.' }
});
check('L1 approves', () => {
  assert.equal(approved.code, 200);
  assert.equal(approved.body.status, 'APPROVED');
  assert.equal(approved.body.approver_role, 'ASM');
});

const editAfterApproval = await call(app.addVisit, {
  params: { empCode: '11001774', planId: PLAN },
  body: { visitDate: '2026-09-14', dealerSapCode: '1000001146' }
});
check('agent cannot edit an approved plan directly', () => {
  assert.equal(editAfterApproval.code, 409);
  assert.match(editAfterApproval.body.error, /APPROVED and can no longer be edited/);
});
const decideAgain = await call(app.decidePlan, {
  params: { empCode: '11001393', planId: PLAN }, body: { action: 'APPROVE' }
});
check('an approved plan cannot be approved twice', () => assert.equal(decideAgain.code, 409));

console.log('== audit trail ==');
const history = await dbAll('SELECT action_type, action_by FROM plan_approvals WHERE plan_id = ? ORDER BY id', [PLAN]);
check('every transition is logged in order', () => {
  assert.deepEqual(history.map(h => h.action_type),
    ['SUBMITTED', 'RECTIFY', 'RESUBMITTED', 'APPROVED']);
});

const adminInbox = await call(app.getApprovalInbox, { params: { empCode: 'ADMIN01' }, query: { status: 'ALL' } });
check('admin can see plans across the hierarchy', () => assert.equal(adminInbox.code, 200));

const summary = await call(app.getMySummary, { params: { empCode: '11001774' }, query: { month: PERIOD } });
check('home summary reports the final state', () => {
  assert.equal(summary.body.my_plans.APPROVED, 1);
  assert.equal(summary.body.action_required, 0);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(72));
let pass = 0, fail = 0;
for (const r of results) {
  if (r[0] === 'PASS') { pass++; console.log(`  ✓ ${r[1]}`); }
  else { fail++; console.log(`  ✗ ${r[1]}\n      ${r[2]}`); }
}
console.log('─'.repeat(72));
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
