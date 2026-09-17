/**
 * Drives the REAL adherence engine over the published test kit so the expected
 * values in EXPECTED_ADHERENCE.xlsx are machine-derived, never hand-computed.
 * Emits JSON consumed by the workbook builder.
 */
import { writeFileSync } from 'node:fs';
import { db } from './sandbox/src/config/database.js';
import { analyseAdherence } from './sandbox/src/engines/sfa-adherence.engine.real.js';

const PERIOD = '2026-09';

db.exec(`
CREATE TABLE business_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, rule_key TEXT, rule_value TEXT);
CREATE TABLE sales_plans (id INTEGER PRIMARY KEY AUTOINCREMENT, emp_code TEXT, emp_name TEXT, emp_role TEXT, period_month TEXT, cycle_code TEXT, status TEXT DEFAULT 'APPROVED');
CREATE TABLE sales_plan_details (id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER, visit_date TEXT, dealer_id INTEGER, dealer_sap_code TEXT, dealer_name TEXT);
CREATE TABLE visit_execution_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, visit_date TEXT, customer_code TEXT, customer_name TEXT, employee_code TEXT, employee_name TEXT, visit_status TEXT);
CREATE TABLE master_dealers (id INTEGER PRIMARY KEY AUTOINCREMENT, sap_code TEXT, sfa_code TEXT, rssd_code TEXT, dealer_name TEXT);
`);
for (const [k,v] of [['c1_start_day','1'],['c1_end_day','15'],['c2_start_day','16'],['c2_end_day','31']])
  db.prepare('INSERT INTO business_rules (rule_key, rule_value) VALUES (?,?)').run(k,v);

const DEALERS = [
  ['1000001153','WBR128','R P ENTERPRISE'], ['1000001144','WBG075','GARG ENTERPRISES'],
  ['1000001140','R132','RADHA HARDWARE'],   ['1000001148','WBM273','MAHESWARI CEMENT AGENCY - ALIPURDUAR'],
  ['1000001147','WBM272','MAA BHABANI HARDWARE'], ['1000001141','S141','SAHA & CO.'],
  ['1000001150','WBP050','PUNAM TRADING'],  ['1000001146','WBH019','HARI OM TRADERS (JALPAIGURI)'],
  ['1000001154','WBS267','SADHANA ENTERPRISE (MATHURABAGAN)'],
  ['1000002043','WBM282','MD EMRAN ALI KHAN'], ['1000001600','WBK066','KARIM ENTERPRISE'],
  ['1000001609','WBM235','MURARI MOHAN RETAIL'], ['1000001590','WBA110','ANSARI ENTERPRISE'],
  ['1000002033','WBM279','MD YOUSUF ALI ENTERPRISE'], ['1000002018','WBM277','MAHAMMAD HARDWARE'],
  ['1000001611','WBM247','MD SAHAJAHAN'], ['1000001587','WBA035','ADIL HARDWARE'],
  ['1000001615','WBR005','ROY SUPPLIERS']
];
for (const [sap,sfa,name] of DEALERS)
  db.prepare('INSERT INTO master_dealers (sap_code, sfa_code, dealer_name) VALUES (?,?,?)').run(sap,sfa,name);

const NAME = c => DEALERS.find(d => d[0]===c)[2];
const DAYS = ['2026-09-01','2026-09-02','2026-09-03','2026-09-04','2026-09-05','2026-09-07',
              '2026-09-08','2026-09-09','2026-09-10','2026-09-11','2026-09-14','2026-09-15'];

const PLAN = [
  ['11001774','DEBABRATA CHAKRABORTY- FKT','SO', [['1000001153',2],['1000001144',3],['1000001140',2],['1000001148',2],['1000001147',2]]],
  ['11001975','ARINDAM PAUL','SO',              [['1000001141',2],['1000001150',2]]],
  ['11002168','SUBHASISH KARMAKAR','SO',        [['1000002043',2],['1000001600',2],['1000001609',2],['1000001590',3],['1000002033',2],['1000002018',3],['1000001611',2]]],
  ['11001393','DEBABRATA GHOSH','ASM',          [['1000001153',2],['1000001140',1]]]
];
const seedRows = [];
for (const [code,name,role,dealers] of PLAN) {
  db.prepare(`INSERT INTO sales_plans (emp_code, emp_name, emp_role, period_month, cycle_code) VALUES (?,?,?,?,'C1')`)
    .run(code,name,role,PERIOD);
  const pid = db.prepare('SELECT id FROM sales_plans ORDER BY id DESC LIMIT 1').get().id;
  let i = 0;
  for (const [sap,n] of dealers) for (let v=0; v<n; v++) {
    const date = DAYS[i++ % DAYS.length];
    db.prepare(`INSERT INTO sales_plan_details (plan_id, visit_date, dealer_sap_code, dealer_name) VALUES (?,?,?,?)`)
      .run(pid,date,sap,NAME(sap));
    seedRows.push({ emp_code: code, emp_name: name, role, cycle: 'C1', period: PERIOD, visit_date: date, dealer_sap_code: sap, dealer_name: NAME(sap) });
  }
}

const LOG = [
  ['2026-09-03','1000001153','11001774','DEBABRATA CHAKRABORTY- FKT','Productive','counted - inside C1'],
  ['2026-09-05','1000001153','11001774','DEBABRATA CHAKRABORTY- FKT','Productive','2nd visit - raw count rises above plan'],
  ['2026-09-08','1000001153','11001774','DEBABRATA CHAKRABORTY- FKT','Productive','3rd visit - capped stays at the planned 2, pending goes negative'],
  ['2026-09-11','1000001144','11001774','DEBABRATA CHAKRABORTY- FKT','Productive','counted - planned date ignored, matching is dealer-level'],
  ['2026-09-16','1000001140','11001774','DEBABRATA CHAKRABORTY- FKT','Productive','OUTSIDE the C1 window (day 16) - not counted'],
  ['2026-09-09','WBM273',    '11001774','DEBABRATA CHAKRABORTY- FKT','Productive','logged with the SFA code - resolved to 1000001148 and counted'],
  ['2026-09-10','1000001150','11001774','DEBABRATA CHAKRABORTY- FKT','Productive','PUNAM is not on this SO plan - unplanned visit'],
  ['2026-09-04','1000001141',' 11001975 ','arindam paul','Non Productive','counted - status is not filtered by default; padded lowercase code still matches'],
  ['2026-09-02','1000002043','11002168','SUBHASISH KARMAKAR','Productive','counted'],
  ['2026-09-09','1000001600','11002168','SUBHASISH KARMAKAR','Productive','counted'],
  ['2026-09-15','1000001609','11002168','SUBHASISH KARMAKAR','Productive','day 15 is the last day inside C1 - counted'],
  ['2026-09-01','1000001590','11002168','SUBHASISH KARMAKAR','Productive','1 visit against 3 planned - 33% for this dealer'],
  ['2026-08-31','1000002018','11002168','SUBHASISH KARMAKAR','Productive','BEFORE the window opens - not counted'],
  ['2026-09-05','1000001611','11002168','SUBHASISH KARMAKAR','Productive','1st of two visits'],
  ['2026-09-12','1000001611','11002168','SUBHASISH KARMAKAR','Productive','2nd visit - both count now (2 planned, 2 adhered = 100%)'],
  ['2026-09-07','1000001587','11002168','SUBHASISH KARMAKAR','Productive','Churn dealer, never planned - unplanned visit'],
  ['2026-09-03','1000001615','11002168','SUBHASISH KARMAKAR','Productive','Churn dealer, never planned - unplanned visit'],
  ['2026-09-06','1000001153','11001393','DEBABRATA GHOSH','Productive','ASM visit - scored against the ASM plan, separately from the SO'],
  ['2026-09-13','1000001153','11001393','DEBABRATA GHOSH','Productive','2nd ASM visit - ASM hits 2 of 2 planned = 100%']
];
for (const [date,code,emp,empName,status] of LOG) {
  const d = DEALERS.find(x => x[0]===code || x[1]===code);
  db.prepare(`INSERT INTO visit_execution_logs (visit_date, customer_code, customer_name, employee_code, employee_name, visit_status) VALUES (?,?,?,?,?,?)`)
    .run(date, code, d ? d[2] : 'UNKNOWN', emp, empName, status);
}

const c1  = await analyseAdherence({ periodMonth: PERIOD, cycleCode: 'C1' });                       // as on the 15th
const mid = await analyseAdherence({ periodMonth: PERIOD, cycleCode: 'C1', asOnDate: '2026-09-08' }); // mid-cycle prorata
const prod= await analyseAdherence({ periodMonth: PERIOD, cycleCode: 'C1', productiveOnly: true });

writeFileSync('/home/claude/kit/_adherence_expected.json', JSON.stringify({
  seedRows, log: LOG, c1, mid, prod
}, null, 1));

console.log(`planned rows ${c1.totals.planned} · pairs ${c1.totals.dealers} · adhered ${c1.totals.adhered} (capped ${c1.totals.adhered_capped})`);
console.log(`capped ${(c1.totals.adherence_pct_capped*100).toFixed(2)}%  raw ${(c1.totals.adherence_pct*100).toFixed(2)}%  pending ${c1.totals.pending}`);
console.log('by role:', Object.entries(c1.byRole).map(([r,v])=>`${r} ${v.adhered}/${v.planned}`).join(' · '));
console.log('diagnostics:', JSON.stringify({ inWindow: c1.diagnostics.sfa_visits_in_window, sfaCode: c1.diagnostics.resolved_via_sfa_code, unresolved: c1.diagnostics.unresolved_visits, unplanned: c1.diagnostics.unplanned_visits }));
console.log('mid-cycle (8th) fraction:', mid.elapsedFraction.C1.toFixed(6), 'MTD due', mid.totals.mtd_planned.toFixed(4));
