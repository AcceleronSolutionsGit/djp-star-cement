/**
 * Proves the rewritten adherence engine implements the client's method.
 *
 * Reference: Trade DJP Zone wise - 28-06-2026.xlsx
 *   DJP!D5 = C5 * DAY($M$2) / DAY(EOMONTH($M$2,0))
 *   'Target vs Adhe'!S5 = IFERROR(R5/IF(Q5<1,P5,Q5),0)
 *   'Target vs Adhe'!T5 = Q5-R5
 *   'Visits Plan'!T5    = IF(COUNTIFS(...)>P5, P5, COUNTIFS(...))    ' capped
 *   'Visits Plan'!X5    = COUNTIFS(...)                              ' uncapped
 */
import assert from 'node:assert/strict';
import { db, dbRun } from './sandbox/src/config/database.js';
import {
  analyseAdherence, analyseC1Adherence, getAdherenceForEmployee,
  cycleElapsedFraction, defaultAsOnDate, daysInMonth, loadCycleWindows
// The pipeline suite needs a STUB at sfa-adherence.engine.js, so prepare-sandbox also
// copies the real engine alongside it under .real.js. This is that file, unmodified.
} from './sandbox/src/engines/sfa-adherence.engine.real.js';

const PERIOD = '2026-09';   // 30 days, like June in the reference file

db.exec(`
CREATE TABLE business_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_key TEXT, rule_value TEXT);
CREATE TABLE sales_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT, emp_code TEXT, emp_name TEXT, emp_role TEXT,
  period_month TEXT, cycle_code TEXT, status TEXT DEFAULT 'APPROVED'
);
CREATE TABLE sales_plan_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER, visit_date TEXT,
  dealer_id INTEGER, dealer_sap_code TEXT, dealer_name TEXT
);
CREATE TABLE visit_execution_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, visit_date TEXT, customer_code TEXT, customer_name TEXT,
  employee_code TEXT, employee_name TEXT, visit_status TEXT
);
CREATE TABLE master_dealers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sap_code TEXT, sfa_code TEXT, rssd_code TEXT, dealer_name TEXT
);
`);
for (const [k, v] of [['c1_start_day','1'],['c1_end_day','15'],['c2_start_day','16'],['c2_end_day','31']])
  db.prepare('INSERT INTO business_rules (rule_key, rule_value) VALUES (?,?)').run(k, v);

const DEALERS = [
  ['1000001153','WBR128','R P ENTERPRISE'],
  ['1000001144','WBG075','GARG ENTERPRISES'],
  ['1000001140','R132','RADHA HARDWARE'],
  ['1000001148','WBM273','MAHESWARI CEMENT AGENCY'],
  ['1000001147','WBM272','MAA BHABANI HARDWARE']
];
for (const [sap, sfa, name] of DEALERS)
  db.prepare('INSERT INTO master_dealers (sap_code, sfa_code, dealer_name) VALUES (?,?,?)').run(sap, sfa, name);

function addPlan(empCode, empName, role, cycle, visits) {
  db.prepare(`INSERT INTO sales_plans (emp_code, emp_name, emp_role, period_month, cycle_code)
              VALUES (?,?,?,?,?)`).run(empCode, empName, role, PERIOD, cycle);
  const id = db.prepare('SELECT id FROM sales_plans ORDER BY id DESC LIMIT 1').get().id;
  for (const [sap, date] of visits) {
    const name = DEALERS.find(d => d[0] === sap)[2];
    db.prepare(`INSERT INTO sales_plan_details (plan_id, visit_date, dealer_sap_code, dealer_name)
                VALUES (?,?,?,?)`).run(id, date, sap, name);
  }
}
const log = (date, code, emp, empName, status = 'Productive') => {
  const d = DEALERS.find(x => x[0] === code || x[1] === code);
  db.prepare(`INSERT INTO visit_execution_logs (visit_date, customer_code, customer_name, employee_code, employee_name, visit_status)
              VALUES (?,?,?,?,?,?)`).run(date, code, d ? d[2] : 'UNKNOWN', emp, empName, status);
};

// SO: 3 dealers in C1. R P planned twice, visited 5 times (over-visit).
addPlan('11001774', 'DEBABRATA CHAKRABORTY- FKT', 'SO', 'C1', [
  ['1000001153','2026-09-02'], ['1000001153','2026-09-09'],
  ['1000001144','2026-09-03'],
  ['1000001140','2026-09-04']
]);
// ASM: 2 dealers in C1
addPlan('11001393', 'DEBABRATA GHOSH', 'ASM', 'C1', [
  ['1000001148','2026-09-05'], ['1000001147','2026-09-08']
]);
// SO C2 plan — used to prove the cycle prorata
addPlan('11001774', 'DEBABRATA CHAKRABORTY- FKT', 'SO', 'C2', [
  ['1000001153','2026-09-17'], ['1000001144','2026-09-18'],
  ['1000001140','2026-09-22'], ['1000001147','2026-09-25']
]);

for (const d of ['2026-09-02','2026-09-02','2026-09-09','2026-09-11','2026-09-11'])
  log(d, '1000001153', '11001774', 'DEBABRATA CHAKRABORTY- FKT');     // 5 rows, 3 distinct days
log('2026-09-03', '1000001144', '11001774', 'DEBABRATA CHAKRABORTY- FKT');
// RADHA not visited at all
log('2026-09-05', 'WBM273', '11001393', 'DEBABRATA GHOSH');            // logged with the SFA code
log('2026-09-06', 'NOT-A-DEALER', '11001393', 'DEBABRATA GHOSH');      // unresolvable
log('2026-09-07', '1000001147', 'UNKNOWN-EMP', 'SOMEONE ELSE');        // unplanned
log('2026-09-20', '1000001153', '11001774', 'DEBABRATA CHAKRABORTY- FKT');  // C2 visit

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['PASS', name]); }
  catch (e) { results.push(['FAIL', name, e.message]); }
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

const windows = await loadCycleWindows();

// ── 1. prorata ──────────────────────────────────────────────────────────────
check('month length is read, not assumed', () => assert.equal(daysInMonth(PERIOD), 30));
check('C1 is fully elapsed on the 15th — the day the SFA feedback lands', () => {
  assert.equal(cycleElapsedFraction('C1', '2026-09-15', PERIOD, windows), 1);
});
check('C2 has not started on the 15th', () => {
  assert.equal(cycleElapsedFraction('C2', '2026-09-15', PERIOD, windows), 0);
});
check('C1 is half elapsed on the 8th', () => {
  assert.ok(near(cycleElapsedFraction('C1', '2026-09-08', PERIOD, windows), 8 / 15));
});
check('C2 is 13/15 elapsed on the 28th', () => {
  assert.ok(near(cycleElapsedFraction('C2', '2026-09-28', PERIOD, windows), 13 / 15));
});
check("summing the cycles reproduces the client's month prorata exactly", () => {
  // DJP!D5 = Plan * DAY(asOn) / DAY(EOMONTH(asOn))  -> on the 28th of a 30-day month, 28/30
  const asOn = '2026-09-28', planPerCycle = 1500;      // even split, as the month formula assumes
  const f1 = cycleElapsedFraction('C1', asOn, PERIOD, windows);
  const f2 = cycleElapsedFraction('C2', asOn, PERIOD, windows);
  const cycleWay = planPerCycle * f1 + planPerCycle * f2;
  const clientWay = (planPerCycle * 2) * 28 / 30;
  assert.ok(near(cycleWay, clientWay), `${cycleWay} vs ${clientWay}`);
});
check('the default as-on date for C1 is the 15th', () => {
  assert.equal(defaultAsOnDate(PERIOD, 'C1', windows), '2026-09-15');
});
check('the default as-on date for C2 is month end', () => {
  assert.equal(defaultAsOnDate(PERIOD, 'C2', windows), '2026-09-30');
});

// ── 2. C1 on the 15th ───────────────────────────────────────────────────────
const c1 = await analyseAdherence({ periodMonth: PERIOD, cycleCode: 'C1' });

check('as-on defaults to the 15th and C1 is fully due', () => {
  assert.equal(c1.asOnDate, '2026-09-15');
  assert.equal(c1.elapsedFraction.C1, 1);
  assert.equal(c1.totals.mtd_planned, c1.totals.planned);
});

const rp = c1.byDealer.find(d => d.dealer_sap_code === '1000001153');
check('visits are COUNTED, not treated as a yes/no', () => {
  assert.equal(rp.planned, 2);
  assert.equal(rp.adhered, 5);          // 5 log rows
  assert.equal(rp.adhered_days, 3);     // 3 distinct days — the NE+ROE COUNTS measure
});
check('capped adhered is MIN(actual, planned)', () => assert.equal(rp.adhered_capped, 2));
check('raw adherence can exceed 100%', () => assert.ok(near(rp.adherence_pct, 5 / 2)));
check('capped adherence cannot', () => assert.ok(near(rp.adherence_pct_capped, 1)));
check('pending goes negative when over-visited', () => assert.ok(near(rp.pending, 2 - 5)));

const radha = c1.byDealer.find(d => d.dealer_sap_code === '1000001140');
check('a dealer never visited scores zero with pending equal to the plan', () => {
  assert.equal(radha.adhered, 0);
  assert.equal(radha.adherence_pct, 0);
  assert.ok(near(radha.pending, 1));
});

// ── 3. SFA-code resolution ──────────────────────────────────────────────────
const mahesh = c1.byDealer.find(d => d.dealer_sap_code === '1000001148');
check('a visit logged with the SFA code now counts against the SAP-coded plan', () => {
  assert.equal(mahesh.adhered, 1, 'WBM273 must resolve to 1000001148');
  assert.ok(near(mahesh.adherence_pct, 1));
});
check('the report says how many visits needed that resolution', () => {
  assert.equal(c1.diagnostics.resolved_via_sfa_code, 1);
});
check('a customer code matching no dealer is reported, not silently dropped', () => {
  assert.equal(c1.diagnostics.unresolved_visits, 1);
  assert.equal(c1.diagnostics.unresolved_detail[0].customer_code, 'NOT-A-DEALER');
});
check('a visit by someone with no plan for that dealer is counted as unplanned', () => {
  assert.equal(c1.diagnostics.unplanned_visits, 1);
});

// ── 4. per role and per employee ────────────────────────────────────────────
check('both roles are reported separately', () => {
  assert.deepEqual(Object.keys(c1.byRole).sort(), ['ASM', 'SO']);
  assert.equal(c1.byRole.SO.dealers, 3);
  assert.equal(c1.byRole.ASM.dealers, 2);
});
check('the ASM roll-up is right', () => {
  // MAHESWARI visited once of one planned; MAA BHABANI not visited
  assert.equal(c1.byRole.ASM.planned, 2);
  assert.equal(c1.byRole.ASM.adhered, 1);
  assert.ok(near(c1.byRole.ASM.adherence_pct, 0.5));
  assert.ok(near(c1.byRole.ASM.pending, 1));
});
check('per-employee rows carry both percentages and the missed list', () => {
  const so = c1.byEmployee.find(e => e.emp_code === '11001774');
  assert.equal(so.role, 'SO');
  assert.equal(so.planned, 4);
  assert.equal(so.adhered, 6);                 // 5 + 1
  assert.equal(so.adhered_capped, 3);          // 2 + 1 + 0
  assert.ok(near(so.adherence_pct_capped, 3 / 4));
  assert.equal(so.missed_dealers.length, 1);
  assert.equal(so.missed_dealers[0].sap_code, '1000001140');
});
check('per-dealer rows exist for every planned employee-dealer pair', () => {
  assert.equal(c1.byDealer.length, 5);
});

// ── 5. the < 1 fallback ─────────────────────────────────────────────────────
const mid = await analyseAdherence({ periodMonth: PERIOD, cycleCode: 'C1', asOnDate: '2026-09-01' });
check('when MTD due rounds below 1, the full plan is the denominator', () => {
  const r = mid.byDealer.find(d => d.dealer_sap_code === '1000001144');
  assert.ok(r.mtd_planned < 1, `mtd_planned was ${r.mtd_planned}`);
  assert.ok(near(r.adherence_pct, r.adhered / r.planned), 'must fall back to planned, not divide by a fraction');
});

// ── 6. C2 and both cycles ───────────────────────────────────────────────────
const c2 = await analyseAdherence({ periodMonth: PERIOD, cycleCode: 'C2', asOnDate: '2026-09-22' });
check('C2 prorates against its own window', () => {
  assert.ok(near(c2.elapsedFraction.C2, 7 / 15));
  assert.ok(near(c2.totals.mtd_planned, 4 * (7 / 15)));
});
check('C2 counts only visits inside the C2 window', () => {
  const rpC2 = c2.byDealer.find(d => d.dealer_sap_code === '1000001153');
  assert.equal(rpC2.adhered, 1, 'the 20-Sep visit, not the C1 ones');
});

const both = await analyseAdherence({ periodMonth: PERIOD, asOnDate: '2026-09-28' });
check('omitting the cycle analyses both, each with its own fraction', () => {
  assert.deepEqual(both.cycles, ['C1', 'C2']);
  assert.equal(both.elapsedFraction.C1, 1);
  assert.ok(near(both.elapsedFraction.C2, 13 / 15));
  assert.ok(near(both.totals.mtd_planned, 6 * 1 + 4 * (13 / 15)));
});

// ── 7. productive-only filter ───────────────────────────────────────────────
log('2026-09-12', '1000001140', '11001774', 'DEBABRATA CHAKRABORTY- FKT', 'Non Productive');
const all  = await analyseAdherence({ periodMonth: PERIOD, cycleCode: 'C1' });
const prod = await analyseAdherence({ periodMonth: PERIOD, cycleCode: 'C1', productiveOnly: true });
check('non-productive visits count by default, as the client\'s COUNTIFS does', () => {
  assert.equal(all.byDealer.find(d => d.dealer_sap_code === '1000001140').adhered, 1);
});
check('productiveOnly excludes them when you ask', () => {
  assert.equal(prod.byDealer.find(d => d.dealer_sap_code === '1000001140').adhered, 0);
});

// ── 8. backwards compatibility for C2 regeneration ──────────────────────────
const legacy = await analyseC1Adherence(PERIOD);
check('the legacy C1 shape still works for regenerate-c2', () => {
  assert.ok(legacy.byEmployee instanceof Map);
  assert.ok(Array.isArray(legacy.completedDealers));
  assert.ok(Array.isArray(legacy.missedDealers));
  assert.equal(typeof legacy.adherencePct, 'number');
  assert.equal(legacy.completedCount + legacy.missedCount, 5);
});
check('getAdherenceForEmployee still returns the two Sets AutoPlanGenerator needs', () => {
  // The SO has visited all three by this point — RADHA picked up the non-productive
  // visit added in section 7, and non-productive counts by default.
  const so = getAdherenceForEmployee(legacy.byEmployee, '11001774');
  assert.ok(so.visitedDealerCodes.has('1000001153'));
  assert.ok(so.visitedDealerCodes.has('1000001140'));
  assert.equal(so.missedDealerCodes.size, 0);

  // The ASM still has one genuinely unvisited dealer, which is what C2 must prioritise.
  const asm = getAdherenceForEmployee(legacy.byEmployee, '11001393');
  assert.ok(asm.visitedDealerCodes.has('1000001148'), 'resolved from the SFA code WBM273');
  assert.ok(asm.missedDealerCodes.has('1000001147'));
});
check('the richer analysis rides along on the legacy result', () => {
  assert.ok(legacy.detail?.byRole?.SO);
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
