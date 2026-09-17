/**
 * VISITS EXPORT — the date columns, and every officer's diary.
 *
 * The export used to write the visit COUNTS and leave "Date of Visit 1/2/3" blank, so
 * the file said how many visits were owed and never when any of them was happening.
 * These checks drive the real controller over the AGARTALA kit and read the bytes back
 * with ExcelJS, so what is asserted is what opens in Excel.
 *
 * What matters here:
 *   - sheet 1 keeps the client's shape (name, blank row 1, headers row 2, 16 fixed cols)
 *   - it carries at least five date columns, widening if a dealer needs more
 *   - the dates on a dealer's row are HIS dates — no day he is not scheduled on
 *   - every role's visits reach sheet 2, including a prospect, whose code is an SFA code
 *   - plans of every status appear, each carrying its own status
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { dbAll, dbGet, dbRun } from './sandbox/src/config/database.js';
import { seedAgartala, KIT } from './seed-agartala.mjs';

const here   = dirname(fileURLToPath(import.meta.url));
const PERIOD = KIT.plan;
const CYCLE  = 'C1';

let pass = 0, fail = 0;
const okA = async (n, fn) => { try { await fn(); console.log(`  ✓ ${n}`); pass++; }
                               catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const S = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`);
/** A date cell as YYYY-MM-DD, whatever ExcelJS handed back. */
const asDay = v => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').slice(0, 10));
const note = (k, v) => console.log(`     ${String(k).padEnd(44, '.')} ${v}`);
const silence = () => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {};
                        return () => { console.log = l; console.warn = w; }; };

console.log('\n' + '═'.repeat(76));
console.log('  VISITS EXPORT — dates, per officer');
console.log('═'.repeat(76));

await seedAgartala();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const gen = await import('./sandbox/src/controllers/generation.controller.js');
{
  const un = silence();
  await generateFullPjpDjpSolution(PERIOD, CYCLE, { generationRunCode: 'GEN-VIS' });
  await gen.generatePlansForAllRoles(PERIOD, CYCLE, {});
  un();
}

const djp = await import('./sandbox/src/controllers/djp.controller.js');

// Drive the endpoint exactly as the browser does, and capture the bytes it sends.
let sent = null, sentStatus = 200;
const res = {
  setHeader() { return this; },
  status(c) { sentStatus = c; return this; },
  json(p) { sent = p; return this; },
  send(buf) { sent = buf; return this; }
};
await djp.exportVisitsExcel({ query: { periodMonth: PERIOD, cycleCode: CYCLE } }, res);
assert.equal(sentStatus, 200, `export failed: ${JSON.stringify(sent)}`);

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(sent);
const visits = wb.getWorksheet('Visits');
const sched  = wb.getWorksheet('SFA Report');

// ─────────────────────────────────────────────────────────────────────────────
S('1. sheet 1 still looks like the client file');

const HEADERS = visits ? visits.getRow(2).values.slice(1).map(v => String(v ?? '')) : [];
const FIXED = 16;
const DATE_COLS = HEADERS.length - FIXED;

await okA('the sheet name, row layout and the 16 fixed columns are unchanged', async () => {
  assert.ok(visits, "there is no sheet called 'Visits'");
  const blank = visits.getRow(1).values.filter(v => v !== null && v !== undefined);
  assert.equal(blank.length, 0, 'row 1 should be blank');
  assert.ok(!HEADERS.includes('concat'), "the empty 'concat' helper column is still there");
  assert.equal(HEADERS[0], 'Zone');
  assert.equal(HEADERS[9], 'Customer CODE');
  assert.equal(HEADERS[15], 'Number of Visit by ZH');
  note('  columns', HEADERS.length);
  note('  dealer rows', visits.rowCount - 2);
  assert.ok(visits.rowCount > 2, 'no dealer rows were written');
});

await okA('there are at least five date columns, numbered in order', async () => {
  note('  date columns', DATE_COLS);
  assert.ok(DATE_COLS >= 5, `only ${DATE_COLS} date column(s) — five is the minimum`);
  const expected = Array.from({ length: DATE_COLS }, (_, i) => `Date of Visit ${i + 1}`);
  assert.deepEqual(HEADERS.slice(FIXED), expected);
});

// ─────────────────────────────────────────────────────────────────────────────
S('2. the date columns are filled, and they are the right dates');

const rowsOut = [];
for (let r = 3; r <= visits.rowCount; r++) {
  const g = c => visits.getRow(r).getCell(c).value;
  rowsOut.push({
    so: g(8), dealer: g(9), code: String(g(10) ?? ''),
    soVisits: Number(g(13) || 0),
    dates: Array.from({ length: DATE_COLS }, (_, i) => g(FIXED + 1 + i))
      .filter(Boolean).map(asDay)
  });
}

await okA('a dealer owed SO visits now carries dates', async () => {
  const owed = rowsOut.filter(r => r.soVisits > 0);
  const withDates = owed.filter(r => r.dates.length > 0);
  note('  rows owed an SO visit', owed.length);
  note('  ...of those, rows with a date', withDates.length);
  assert.ok(owed.length > 0, 'the kit produced no SO visits at all');
  assert.ok(withDates.length > 0, 'every date column is still blank — nothing was read from the plans');
  const sample = withDates[0];
  note('  example', `${sample.dealer} — ${sample.dates.join(', ')}`);
});

await okA('every date on a row is a day that dealer is actually scheduled', async () => {
  // Check every dated row against the plans directly. A row must never show a day on
  // which nobody was scheduled to visit it.
  let checked = 0;
  for (const r of rowsOut) {
    if (!r.dates.length) continue;
    // The sheet's Customer CODE is the SFA code; a plan stores whichever code
    // identified the dealer when the visit was created — the SAP code for a real
    // dealer, the SFA code for a prospect. Resolve both before comparing.
    const tgt = await dbGet(
      `SELECT sap_code, sfa_code FROM dealer_visit_targets
        WHERE period_month = ? AND cycle_code = ?
          AND (UPPER(TRIM(sfa_code)) = ? OR UPPER(TRIM(sap_code)) = ?) LIMIT 1`,
      [PERIOD, CYCLE, r.code.trim().toUpperCase(), r.code.trim().toUpperCase()]
    );
    const codes = [tgt?.sap_code, tgt?.sfa_code, r.code]
      .filter(Boolean).map(c => String(c).trim().toUpperCase());
    const truth = await dbAll(
      `SELECT DISTINCT d.visit_date AS day
         FROM sales_plan_details d
         JOIN sales_plans p ON p.id = d.plan_id
        WHERE p.period_month = ? AND p.cycle_code = ?
          AND UPPER(TRIM(d.dealer_sap_code)) IN (${codes.map(() => '?').join(',')})
        ORDER BY day`,
      [PERIOD, CYCLE, ...codes]
    );
    const days = truth.map(t => String(t.day).slice(0, 10));
    for (const d of r.dates) {
      assert.ok(days.includes(d),
        `${r.dealer} (${r.code}) shows ${d}, but no plan schedules that dealer that day`);
    }
    checked++;
  }
  note('  dated rows verified against the plans', checked);
  assert.ok(checked > 0);
});

await okA('the dates are real date cells shown as DD-MM-YYYY', async () => {
  // Written as dates, not as "05-06-2026" text, so the columns sort and filter in Excel;
  // the DD-MM-YYYY is a display format on the column.
  const firstDated = [];
  for (let r = 3; r <= visits.rowCount && firstDated.length < 3; r++) {
    const cell = visits.getRow(r).getCell(FIXED + 1);
    if (cell.value) firstDated.push(cell);
  }
  assert.ok(firstDated.length > 0, 'no dated cell to check');
  for (const c of firstDated)
    assert.ok(c.value instanceof Date, `a date cell holds ${typeof c.value}, not a date`);

  for (let c = FIXED + 1; c <= HEADERS.length; c++) {
    const fmt = String(visits.getColumn(c).numFmt || '').toLowerCase();
    assert.equal(fmt, 'dd-mm-yyyy', `"${HEADERS[c - 1]}" shows as "${fmt}"`);
  }
  const schedFmt = String(sched.getColumn(1).numFmt || '').toLowerCase();
  assert.equal(schedFmt, 'dd-mm-yyyy', `the schedule Date column shows as "${schedFmt}"`);
  note('  date format', 'dd-mm-yyyy on ' + (HEADERS.length - FIXED) + ' columns + the schedule');
});

await okA('a UTC-midnight date cannot slip a day in another timezone', async () => {
  // ExcelJS converts with 25569 + getTime()/86400000 — pure UTC. A whole serial means
  // the same day everywhere; a fractional one is a date that will display differently
  // for the client than it does here.
  for (const r of rowsOut.slice(0, 20)) {
    for (const d of r.dates) {
      const back = new Date(d + 'T00:00:00Z');
      const serial = 25569 + back.getTime() / 86400000;
      assert.equal(serial, Math.round(serial), `${r.dealer}: ${d} is not a whole-day serial`);
    }
  }
});

await okA('the dates are in order and never repeat on a row', async () => {
  for (const r of rowsOut) {
    if (r.dates.length < 2) continue;
    const sorted = [...r.dates].sort();
    assert.deepEqual(r.dates, sorted, `${r.dealer}: dates are out of order`);
    assert.equal(new Set(r.dates).size, r.dates.length, `${r.dealer}: the same day appears twice`);
  }
});

await okA('no scheduled day is dropped from a dealer\'s row', async () => {
  // The point of widening to five columns: what the plans hold and what the row shows
  // must be the same set of days, for every dealer, with nothing truncated.
  let widest = 0, checkedRows = 0;
  for (const r of rowsOut) {
    const tgt = await dbGet(
      `SELECT sap_code, sfa_code FROM dealer_visit_targets
        WHERE period_month = ? AND cycle_code = ?
          AND (UPPER(TRIM(sfa_code)) = ? OR UPPER(TRIM(sap_code)) = ?) LIMIT 1`,
      [PERIOD, CYCLE, r.code.trim().toUpperCase(), r.code.trim().toUpperCase()]);
    const codes = [tgt?.sap_code, tgt?.sfa_code, r.code]
      .filter(Boolean).map(c => String(c).trim().toUpperCase());
    const truth = await dbAll(
      `SELECT DISTINCT d.visit_date AS day
         FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
        WHERE p.period_month = ? AND p.cycle_code = ?
          AND UPPER(TRIM(d.dealer_sap_code)) IN (${codes.map(() => '?').join(',')})
        ORDER BY day`, [PERIOD, CYCLE, ...codes]);
    const days = [...new Set(truth.map(t => String(t.day).slice(0, 10)))].sort();
    widest = Math.max(widest, days.length);
    assert.deepEqual(r.dates, days,
      `${r.dealer}: the row shows ${r.dates.length} of ${days.length} scheduled days`);
    checkedRows++;
  }
  note('  most days any one dealer needs', widest);
  note('  rows whose dates match the plans exactly', checkedRows);
  assert.ok(DATE_COLS >= widest, `${widest} days needed but only ${DATE_COLS} columns`);
});

await okA('a day booked by an ASM or RSM appears on the dealer row too', async () => {
  const nonSo = await dbAll(
    `SELECT UPPER(TRIM(d.dealer_sap_code)) AS code, d.visit_date AS day, p.emp_role AS role
       FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month = ? AND p.cycle_code = ? AND p.emp_role <> 'SO'
      LIMIT 25`, [PERIOD, CYCLE]);
  note('  non-SO visits sampled', nonSo.length);
  if (!nonSo.length) return;

  let matched = 0;
  for (const v of nonSo) {
    const tgt = await dbGet(
      `SELECT sfa_code, sap_code FROM dealer_visit_targets
        WHERE period_month=? AND cycle_code=?
          AND (UPPER(TRIM(sap_code))=? OR UPPER(TRIM(sfa_code))=?) LIMIT 1`,
      [PERIOD, CYCLE, v.code, v.code]);
    if (!tgt) continue;
    const sheetCode = String(tgt.sfa_code || tgt.sap_code).trim().toUpperCase();
    const row = rowsOut.find(r => r.code.trim().toUpperCase() === sheetCode);
    if (!row) continue;                       // Churn / zero-visit rows are excluded
    const day = String(v.day).slice(0, 10);
    assert.ok(row.dates.includes(day),
      `${row.dealer}: ${v.role} visits on ${day}, but the row does not show that day`);
    matched++;
  }
  note('  non-SO days found on their dealer row', matched);
});

// ─────────────────────────────────────────────────────────────────────────────
S('3. sheet 2 — every officer, every day');

await okA("'SFA Report' holds one row per scheduled visit", async () => {
  assert.ok(sched, "there is no sheet called 'SFA Report'");
  const total = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month = ? AND p.cycle_code = ?`, [PERIOD, CYCLE]);
  note('  visits in the database', total.n);
  note('  rows on the sheet', sched.rowCount - 1);
  assert.equal(sched.rowCount - 1, Number(total.n));
});

// The SFA Report columns, in the order the importer reads them.
const SFA_HEADERS = [
  'Date of Visit', 'Customer Code', 'Customer Name', 'Type', 'Route', 'Branch',
  'Employee Code', 'Employee Name', 'Check In Time', 'Check Out Time', 'Duration',
  'Visit Status(Productive / Non productive)', 'Purpose Of Visit', 'Remarks'
];

await okA('its columns are the SFA Report columns, exactly and in order', async () => {
  const headers = sched.getRow(1).values.slice(1).map(v => String(v ?? ''));
  note('  columns', headers.length);
  assert.deepEqual(headers, SFA_HEADERS);
});

await okA('the importer would read this sheet back without reshaping', async () => {
  // The importer picks fields out of each row BY HEADER NAME off the 'SFA Report'
  // sheet. If a name here drifts, a filled-in copy silently imports as blanks.
  const src = readFileSync(join(here, '..', '..', 'src', 'imports', 'sfa-report.importer.js'), 'utf8');
  assert.ok(src.includes("'SFA Report'"), 'the importer no longer reads a sheet by that name');
  for (const h of SFA_HEADERS)
    assert.ok(src.includes(`row['${h}']`), `the importer never reads "${h}"`);
});

await okA('every row names the customer, the employee and a real date', async () => {
  for (let r = 2; r <= sched.rowCount; r++) {
    const row = sched.getRow(r);
    assert.ok(row.getCell(1).value instanceof Date, `row ${r}: the date is not a real date cell`);
    assert.ok(String(row.getCell(2).value || '').trim(), `row ${r} has no Customer Code`);
    assert.ok(String(row.getCell(3).value || '').trim(), `row ${r} has no Customer Name`);
    assert.ok(String(row.getCell(7).value || '').trim(), `row ${r} has no Employee Code`);
    assert.ok(String(row.getCell(8).value || '').trim(), `row ${r} has no Employee Name`);
  }
  note('  rows with code + name + employee', sched.rowCount - 1);
});

await okA('the execution columns are left blank for the field team to fill', async () => {
  // A planned visit has not happened. Writing a check-in time would turn a plan into a
  // fabricated execution record, and it would import back as one.
  for (let r = 2; r <= Math.min(sched.rowCount, 40); r++) {
    for (const c of [9, 10, 11, 12]) {
      const v = sched.getRow(r).getCell(c).value;
      assert.ok(v === null || v === undefined || v === '',
        `row ${r}, "${SFA_HEADERS[c - 1]}" is pre-filled with ${JSON.stringify(v)}`);
    }
  }
});

await okA('the customer code is the one the SFA log matches on', async () => {
  const codes = [];
  for (let r = 2; r <= sched.rowCount; r++)
    codes.push(String(sched.getRow(r).getCell(2).value || '').trim());
  assert.ok(codes.every(Boolean), 'a row has no customer code');
  const known = await dbAll(
    `SELECT sfa_code, sap_code FROM dealer_visit_targets WHERE period_month=? AND cycle_code=?`,
    [PERIOD, CYCLE]);
  const valid = new Set();
  for (const k of known) {
    if (k.sfa_code) valid.add(String(k.sfa_code).trim().toUpperCase());
    if (k.sap_code) valid.add(String(k.sap_code).trim().toUpperCase());
  }
  const unknown = codes.filter(c => !valid.has(c.toUpperCase()));
  note("  codes not found in this cycle's targets", unknown.length);
  assert.equal(unknown.length, 0, `unmatched: ${unknown.slice(0, 5).join(', ')}`);
});

await okA('it is sorted by date, so it reads as a diary', async () => {
  let prev = '';
  for (let r = 2; r <= sched.rowCount; r++) {
    const d = asDay(sched.getRow(r).getCell(1).value);
    assert.ok(d >= prev, `row ${r}: ${d} comes after ${prev}`);
    prev = d;
  }
});

await okA('an ASM or RSM visit reaches sheet 2, identified by its employee code', async () => {
  const nonSo = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month = ? AND p.cycle_code = ? AND p.emp_role <> 'SO'`, [PERIOD, CYCLE]);
  note('  non-SO visits scheduled', nonSo.n);
  if (!Number(nonSo.n)) { note('  (the kit scheduled none — nothing to check)', ''); return; }
  const nonSoCodes = await dbAll(
    `SELECT DISTINCT p.emp_code FROM sales_plans p
      WHERE p.period_month = ? AND p.cycle_code = ? AND p.emp_role <> 'SO'`, [PERIOD, CYCLE]);
  const codes = new Set(nonSoCodes.map(x => String(x.emp_code).trim()));
  let found = 0;
  for (let r = 2; r <= sched.rowCount; r++)
    if (codes.has(String(sched.getRow(r).getCell(7).value || '').trim())) found++;
  assert.equal(found, Number(nonSo.n));
});

// ─────────────────────────────────────────────────────────────────────────────
S('4. status, and the prospect case');

await okA('a plan that is not approved still contributes its visits', async () => {
  // Approve exactly one plan, re-export, and confirm both statuses show up. A file
  // that quietly dropped unapproved plans would look complete and be wrong.
  const plan = await dbGet(
    `SELECT id FROM sales_plans WHERE period_month=? AND cycle_code=? ORDER BY id LIMIT 1`,
    [PERIOD, CYCLE]);
  await dbRun(`UPDATE sales_plans SET status='APPROVED' WHERE id=?`, [plan.id]);

  let buf = null;
  await djp.exportVisitsExcel({ query: { periodMonth: PERIOD, cycleCode: CYCLE } },
    { setHeader() { return this; }, status() { return this; }, json() { return this; },
      send(b) { buf = b; return this; } });
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(buf);
  const s2 = wb2.getWorksheet('SFA Report');
  const total = await dbGet(
    `SELECT COUNT(*) AS n FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month = ? AND p.cycle_code = ?`, [PERIOD, CYCLE]);
  note('  rows with one plan approved', `${s2.rowCount - 1} of ${total.n}`);
  assert.equal(s2.rowCount - 1, Number(total.n),
    'approving one plan changed the row count — some status is being filtered out');
  await dbRun(`UPDATE sales_plans SET status='DRAFT' WHERE id=?`, [plan.id]);
});

await okA('a prospect is matched by its SFA code, not lost for having no SAP code', async () => {
  const prospects = await dbAll(
    `SELECT sfa_code, dealer_name FROM dealer_visit_targets
      WHERE period_month=? AND cycle_code=? AND (sap_code IS NULL OR TRIM(sap_code)='')
        AND sfa_code IS NOT NULL`, [PERIOD, CYCLE]);
  note('  prospects in the cycle', prospects.length);
  if (!prospects.length) { note('  (none in this kit)', ''); return; }

  const planned = await dbAll(
    `SELECT DISTINCT UPPER(TRIM(d.dealer_sap_code)) AS code
       FROM sales_plan_details d JOIN sales_plans p ON p.id = d.plan_id
      WHERE p.period_month=? AND p.cycle_code=?`, [PERIOD, CYCLE]);
  const plannedCodes = new Set(planned.map(p => p.code));
  const scheduledProspects = prospects
    .filter(p => plannedCodes.has(String(p.sfa_code).trim().toUpperCase()));
  note('  ...of those, actually scheduled', scheduledProspects.length);
  if (!scheduledProspects.length) return;

  const onSheet = new Set();
  for (let r = 2; r <= sched.rowCount; r++)
    onSheet.add(String(sched.getRow(r).getCell(2).value || '').trim().toUpperCase());
  const missing = scheduledProspects
    .filter(p => !onSheet.has(String(p.sfa_code).trim().toUpperCase()))
    .map(p => p.dealer_name);
  assert.equal(missing.length, 0, `prospects missing from the schedule: ${missing.slice(0, 5).join(', ')}`);
});

console.log('\n' + '─'.repeat(76));
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
