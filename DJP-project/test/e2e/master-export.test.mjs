/**
 * MASTER EXPORT — must open looking like the client's own M.xlsx.
 *
 * Generates the workbook from the kit, reads the bytes back, and compares the result
 * against the REAL M.xlsx staged from the client folder: sheet name, row layout, the
 * B2 anchor, all 42 headers, the row-3 source annotations, column widths, the hidden
 * column, the frozen pane, and the number formats.
 *
 * The headers are compared against M.xlsx itself rather than a copy pasted in here,
 * so the test cannot drift from the client file.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';
import { dbAll } from './sandbox/src/config/database.js';
import { seed } from './seed.mjs';

const here   = dirname(fileURLToPath(import.meta.url));
const PERIOD = '2026-07';
const M_PATH = '/mnt/user-data/uploads/DJP-project/upload-files/M.xlsx';

let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                        catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const S = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`);
const note = (k, v) => console.log(`     ${String(k).padEnd(44, '.')} ${v}`);

// ── the reference: the client's own file ─────────────────────────────────────
const haveReference = existsSync(M_PATH);
let ref = null;
if (haveReference) {
  const zip = readFileSync(M_PATH);
  const wbRef = new ExcelJS.Workbook();
  await wbRef.xlsx.load(zip);
  const wsRef = wbRef.worksheets[0];
  ref = {
    sheetName: wsRef.name,
    b2: wsRef.getCell('B2').value,
    sources: [], headers: [], widths: [], hidden: []
  };
  for (let c = 1; c <= 42; c++) {
    ref.sources.push(wsRef.getRow(3).getCell(c).value);
    ref.headers.push(wsRef.getRow(4).getCell(c).value);
    ref.widths.push(wsRef.getColumn(c).width);
    ref.hidden.push(!!wsRef.getColumn(c).hidden);
  }
  ref.freeze = (wsRef.views && wsRef.views[0]) || null;
}

console.log('\n' + '═'.repeat(76));
console.log('  MASTER EXPORT vs the client master M.xlsx');
console.log('═'.repeat(76));
note('reference M.xlsx available', haveReference ? 'yes' : 'NO — structural checks only');

// ── generate ─────────────────────────────────────────────────────────────────
const counts = await seed();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const quiet = console.log; console.log = () => {};
await generateFullPjpDjpSolution(PERIOD, 'C1', {
  generationRunCode: 'GEN-EXPORT', dealerMappingBatchCode: counts.mappingBatch,
  salesHistoryBatchCodes: [counts.salesBatch]
});
console.log = quiet;

const targets = await dbAll(
  `SELECT * FROM dealer_visit_targets WHERE period_month=? AND cycle_code='C1' ORDER BY sap_code ASC, id ASC`,
  [PERIOD]);

const { buildMasterWorkbook } = await import('./sandbox/src/controllers/djp.controller.js');
const { dedupeTargets, COLUMNS } = await import('./sandbox/src/services/masterSheet.service.js');

const buf = await buildMasterWorkbook(dedupeTargets(targets), PERIOD);
note('workbook bytes', buf.length.toLocaleString());

const wb = new ExcelJS.Workbook();
await wb.xlsx.load(buf);
const ws = wb.worksheets[0];

// ─────────────────────────────────────────────────────────────────────────────
S('shape');

ok('the sheet is named "Master " — with the trailing space', () => {
  note('  sheet name', JSON.stringify(ws.name));
  assert.equal(ws.name, 'Master ');
  if (ref) assert.equal(ws.name, ref.sheetName, 'differs from M.xlsx');
});

ok('42 columns, A through AP', () => {
  note('  columns', COLUMNS.length);
  assert.equal(COLUMNS.length, 42);
  assert.equal(COLUMNS[41].col, 'AP');
});

ok('row 1 is blank', () => {
  const vals = [];
  for (let c = 1; c <= 42; c++) { const v = ws.getRow(1).getCell(c).value; if (v !== null && v !== undefined && v !== '') vals.push(c); }
  assert.equal(vals.length, 0, `row 1 has values in columns ${vals.join(', ')}`);
});

ok('B2 holds the planning anchor as a real date', () => {
  const v = ws.getCell('B2').value;
  note('  B2', v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  assert.ok(v instanceof Date, `B2 is ${typeof v}, not a Date`);
  assert.equal(v.toISOString().slice(0, 10), '2026-07-01');
  if (ref) note('  M.xlsx B2 (its own anchor)', ref.b2 instanceof Date ? ref.b2.toISOString().slice(0, 10) : String(ref.b2));
});

ok('headers sit on row 4 and data starts on row 5', () => {
  assert.equal(ws.getRow(4).getCell(1).value, 'Cust Type');
  assert.ok(ws.getRow(5).getCell(1).value, 'row 5 is empty');
});

ok('the pane is frozen through the header row', () => {
  const v = ws.views && ws.views[0];
  note('  freeze', JSON.stringify(v));
  assert.equal(v.state, 'frozen');
  assert.equal(v.ySplit, 4);
  if (ref?.freeze) assert.equal(v.ySplit, ref.freeze.ySplit, 'freeze differs from M.xlsx');
});

// ─────────────────────────────────────────────────────────────────────────────
S('headers — compared against M.xlsx cell by cell');

if (ref) {
  const MONTHY = new Set(['current_sales', 'lysm_sales', 'previous_sales']);
  const diffs = [];
  for (let i = 0; i < 42; i++) {
    const mine = String(ws.getRow(4).getCell(i + 1).value ?? '');
    const theirs = String(ref.headers[i] ?? '');
    if (MONTHY.has(COLUMNS[i].key)) continue;     // month labels move with the period
    if (mine !== theirs) diffs.push({ col: COLUMNS[i].col, mine, theirs });
  }
  for (const d of diffs)
    console.log(`     ✗ ${d.col}: ours ${JSON.stringify(d.mine)} vs M.xlsx ${JSON.stringify(d.theirs)}`);
  ok('all 39 fixed headers match M.xlsx exactly', () =>
    assert.equal(diffs.length, 0, `${diffs.length} header(s) differ`));

  ok('the three month headers follow the planning month', () => {
    const o = ws.getRow(4).getCell(15).value;   // O
    const q = ws.getRow(4).getCell(17).value;   // Q
    const r = ws.getRow(4).getCell(18).value;   // R
    note('  O / Q / R for 2026-07', `${o}  |  ${q}  |  ${r}`);
    note('  M.xlsx (its anchor was Jun-26)', `${ref.headers[14]}  |  ${ref.headers[16]}  |  ${ref.headers[17]}`);
    assert.equal(o, "Jun'26 Sales");
    assert.equal(q, "Jun'25 (Sales)");
    assert.equal(r, "May'26 Sales");
  });

  ok('the shape of those labels is the same as M.xlsx', () => {
    // M.xlsx at Jun-26 reads May'26 Sales / May'25 (Sales) / Apr'26 Sales.
    // Ours at Jul-26 must read the same pattern, one month on.
    assert.match(String(ws.getRow(4).getCell(15).value), /^[A-Z][a-z]{2}'\d{2} Sales$/);
    assert.match(String(ws.getRow(4).getCell(17).value), /^[A-Z][a-z]{2}'\d{2} \(Sales\)$/);
    assert.match(String(ws.getRow(4).getCell(18).value), /^[A-Z][a-z]{2}'\d{2} Sales$/);
  });

  S('row 3 — source annotations');
  const sdiffs = [];
  for (let i = 0; i < 42; i++) {
    const mine   = ws.getRow(3).getCell(i + 1).value;
    const theirs = ref.sources[i];
    const norm = v => (v === null || v === undefined || v === '') ? null : String(v).trim();
    if (norm(mine) !== norm(theirs)) sdiffs.push({ col: COLUMNS[i].col, mine: norm(mine), theirs: norm(theirs) });
  }
  for (const d of sdiffs)
    console.log(`     ✗ ${d.col}: ours ${JSON.stringify(d.mine)} vs M.xlsx ${JSON.stringify(d.theirs)}`);
  ok('every source annotation matches M.xlsx', () =>
    assert.equal(sdiffs.length, 0, `${sdiffs.length} annotation(s) differ`));

  S('column widths and the hidden column');
  const wdiffs = [];
  for (let i = 0; i < 42; i++) {
    const mine = ws.getColumn(i + 1).width, theirs = ref.widths[i];
    if (theirs && Math.abs((mine || 0) - theirs) > 0.02) wdiffs.push(`${COLUMNS[i].col}: ${mine} vs ${theirs}`);
  }
  for (const d of wdiffs) console.log(`     ✗ ${d}`);
  ok('all 42 column widths match M.xlsx', () =>
    assert.equal(wdiffs.length, 0, `${wdiffs.length} width(s) differ`));

  ok('column H (Area Strategy) is hidden, as it is in M.xlsx', () => {
    note('  H hidden here / in M.xlsx', `${!!ws.getColumn(8).hidden} / ${ref.hidden[7]}`);
    assert.equal(!!ws.getColumn(8).hidden, true);
    assert.equal(ref.hidden[7], true, 'M.xlsx does not hide H — check the reference');
  });

  ok('no other column is hidden', () => {
    const extra = [];
    for (let i = 0; i < 42; i++) if (i !== 7 && ws.getColumn(i + 1).hidden) extra.push(COLUMNS[i].col);
    assert.equal(extra.length, 0, `also hidden: ${extra.join(', ')}`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
S('data types — values, not pre-formatted strings');

ok('a PROSPECT shows NEW in the DOA column, never a blank', () => {
  // The client master carries the literal text NEW for all 46 of its prospect rows and
  // has no blank DOA anywhere. Column U reads T="New" as its first branch, so an empty
  // cell would be read as 0 and drop the row into the Old tier on a round-trip.
  const prospectRows = [];
  for (let r = 5; r < 5 + targets.length; r++) {
    if (String(ws.getRow(r).getCell(1).value) === 'NON STAR') prospectRows.push(r);
  }
  note('  prospect rows in the sheet', prospectRows.length);
  assert.ok(prospectRows.length > 0, 'no prospects in this kit — not exercised');

  const wrong = prospectRows.filter(r => String(ws.getRow(r).getCell(20).value ?? '') !== 'NEW');
  for (const r of wrong.slice(0, 5))
    console.log(`     ✗ row ${r}: DOA is ${JSON.stringify(ws.getRow(r).getCell(20).value)}`);
  assert.equal(wrong.length, 0, `${wrong.length} prospect row(s) do not read NEW`);
});

ok('no row anywhere leaves the DOA blank', () => {
  const blank = [];
  for (let r = 5; r < 5 + targets.length; r++) {
    const v = ws.getRow(r).getCell(20).value;
    if (v === null || v === undefined || v === '') blank.push(r);
  }
  note('  rows with a blank DOA', blank.length);
  assert.equal(blank.length, 0, `blank at rows ${blank.slice(0, 8).join(', ')}`);
});

ok('DOA is written as a real Date for DEALERS, not text', () => {
  let checked = 0;
  for (let r = 5; r < 5 + Math.min(targets.length, 60); r++) {
    if (String(ws.getRow(r).getCell(1).value) === 'NON STAR') continue;   // prospects carry NEW
    const v = ws.getRow(r).getCell(20).value;      // T
    if (v === null) continue;
    assert.ok(v instanceof Date, `row ${r}: DOA is ${typeof v} (${v})`);
    checked++;
  }
  note('  DOA cells checked', checked);
  assert.ok(checked > 0, 'no DOA values to check');
});

ok('DOA carries a date number format', () => {
  const f = ws.getRow(5).getCell(20).numFmt;
  note('  T numFmt', f);
  assert.match(String(f), /y/i);
});

ok('sales and potential are numbers', () => {
  for (const c of [14, 15, 17, 18, 19]) {           // N, O, Q, R, S
    const v = ws.getRow(5).getCell(c).value;
    if (v === null) continue;
    assert.equal(typeof v, 'number', `column ${COLUMNS[c - 1].col} is ${typeof v}`);
  }
});

ok('counter share is a fraction with a percent format', () => {
  const cell = ws.getRow(5).getCell(16);           // P
  note('  P value / numFmt', `${cell.value} / ${cell.numFmt}`);
  assert.equal(typeof cell.value, 'number');
  assert.ok(cell.value <= 1.0001, 'stored as 0-100 rather than a fraction');
  assert.equal(cell.numFmt, '0%');
});

ok('both area percentiles are percent-formatted', () => {
  assert.equal(ws.getRow(5).getCell(36).numFmt, '0%');   // AJ
  assert.equal(ws.getRow(5).getCell(40).numFmt, '0%');   // AN
});

ok('a dealer missing from SBG has a blank potential, not a zero', () => {
  // null must survive as null — 0 would mean "no potential", which is a different claim.
  const anyNull = targets.some(t => t.sbg_potential === null || t.sbg_potential === undefined);
  note('  targets with no SBG potential', targets.filter(t => t.sbg_potential === null || t.sbg_potential === undefined).length);
  if (!anyNull) { note('  (none in this kit — not exercised)', ''); return; }
  let found = false;
  for (let r = 5; r < 5 + targets.length; r++) {
    const v = ws.getRow(r).getCell(14).value;
    if (v === null || v === undefined) { found = true; break; }
  }
  assert.ok(found, 'a missing potential was written as 0');
});

// ─────────────────────────────────────────────────────────────────────────────
S('every row is present and in order');

ok(`all ${targets.length} dealers appear`, () => {
  let n = 0;
  for (let r = 5; ; r++) { const v = ws.getRow(r).getCell(1).value; if (!v) break; n++; }
  note('  data rows written', n);
  assert.equal(n, targets.length);
});

ok('Sl.No. runs 1..n without gaps', () => {
  for (let i = 0; i < targets.length; i++)
    assert.equal(ws.getRow(5 + i).getCell(2).value, i + 1, `row ${5 + i}`);
});

ok('the Final Category column is populated on every row', () => {
  const blank = [];
  for (let i = 0; i < targets.length; i++)
    if (!ws.getRow(5 + i).getCell(21).value) blank.push(5 + i);
  assert.equal(blank.length, 0, `blank at rows ${blank.join(', ')}`);
});

ok('Cust Type uses only M.xlsx vocabulary — RSAR / DEALER / NON STAR', () => {
  const ALLOWED = new Set(['RSAR', 'DEALER', 'NON STAR']);
  const seen = new Map();
  for (let i = 0; i < targets.length; i++) {
    const v = String(ws.getRow(5 + i).getCell(1).value ?? '');
    seen.set(v, (seen.get(v) || 0) + 1);
  }
  note('  distinct Cust Type values', JSON.stringify([...seen.entries()]));
  const bad = [...seen.keys()].filter(v => !ALLOWED.has(v));
  assert.equal(bad.length, 0, `not in the client's vocabulary: ${bad.join(', ')}`);
  if (ref) {
    // The client master uses exactly these three and never the internal word.
    assert.ok(!seen.has('PROSPECTIVE'), 'PROSPECTIVE leaked into column A');
  }
});

S('what the sheet looks like — first rows, key columns');
const show = [1, 13, 14, 15, 20, 21, 33, 37];   // Cust Type, Dealer, Potential, Sales, DOA, Category, Grade, NTG
console.log('     ' + show.map(c => String(ws.getRow(4).getCell(c).value).split('\n')[0].slice(0, 13).padEnd(14)).join(''));
console.log('     ' + '─'.repeat(show.length * 14));
for (let i = 0; i < Math.min(6, targets.length); i++) {
  console.log('     ' + show.map(c => {
    const v = ws.getRow(5 + i).getCell(c).value;
    const s = v instanceof Date ? v.toISOString().slice(0, 10)
            : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2))
            : String(v ?? '');
    return s.slice(0, 13).padEnd(14);
  }).join(''));
}

// ─────────────────────────────────────────────────────────────────────────────
S('the on-screen view matches the file, cell for cell');

const { getMasterView } = await import('./sandbox/src/controllers/djp.controller.js');
const call = async (handler, query) => {
  let code = 200, payload = null;
  const res = { status(c) { code = c; return this; }, json(p) { payload = p; return this; } };
  await handler({ query, params: {}, body: {} }, res);
  return { code, body: payload };
};

const view = await call(getMasterView, { periodMonth: PERIOD, cycleCode: 'C1', pageSize: 500 });

ok('the view endpoint answers', () => {
  assert.equal(view.code, 200, JSON.stringify(view.body));
  note('  rows returned', view.body.rows.length);
  note('  columns returned', view.body.columns.length);
});

ok('the view reports the same sheet name and anchor as the file', () => {
  assert.equal(view.body.sheet_name, ws.name);
  assert.equal(view.body.anchor, ws.getCell('B2').value.toISOString().slice(0, 10));
  assert.equal(view.body.header_row, 4);
  assert.equal(view.body.first_data_row, 5);
});

ok('the view carries all 42 columns in sheet order', () => {
  assert.equal(view.body.columns.length, 42);
  view.body.columns.forEach((c, i) => {
    assert.equal(c.col, COLUMNS[i].col, `position ${i}`);
    assert.equal(c.key, COLUMNS[i].key);
  });
});

ok('every view header is identical to the file header', () => {
  const diffs = [];
  view.body.columns.forEach((c, i) => {
    const inFile = String(ws.getRow(4).getCell(i + 1).value ?? '');
    if (String(c.header ?? '') !== inFile) diffs.push(`${c.col}: view ${JSON.stringify(c.header)} vs file ${JSON.stringify(inFile)}`);
  });
  for (const d of diffs) console.log(`     ✗ ${d}`);
  assert.equal(diffs.length, 0, `${diffs.length} header(s) differ`);
});

ok('every view source annotation matches the file', () => {
  const diffs = [];
  view.body.columns.forEach((c, i) => {
    const inFile = ws.getRow(3).getCell(i + 1).value;
    const norm = v => (v === null || v === undefined || v === '') ? null : String(v).trim();
    if (norm(c.source) !== norm(inFile)) diffs.push(`${c.col}: view ${JSON.stringify(c.source)} vs file ${JSON.stringify(norm(inFile))}`);
  });
  for (const d of diffs) console.log(`     ✗ ${d}`);
  assert.equal(diffs.length, 0);
});

ok('the view marks column H hidden, as the file does', () => {
  const h = view.body.columns[7];
  assert.equal(h.key, 'area_strategy');
  assert.equal(h.hidden, true);
  assert.equal(view.body.columns.filter(c => c.hidden).length, 1, 'more than one column flagged hidden');
});

ok('every data cell in the view equals the cell in the file', () => {
  const diffs = [];
  const norm = (v, key) => {
    if (v === null || v === undefined || v === '') return '';
    if (key === 'doa') {
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      return String(v).trim();          // the prospect marker "NEW" stays text
    }
    if (typeof v === 'number') return Number(v.toFixed(6));
    return String(v).trim();
  };

  for (let r = 0; r < view.body.rows.length; r++) {
    const viewRow = view.body.rows[r];
    for (let c = 0; c < 42; c++) {
      const key = COLUMNS[c].key;
      const a = norm(viewRow[key], key);
      const b = norm(ws.getRow(5 + r).getCell(c + 1).value, key);
      if (String(a) !== String(b)) {
        diffs.push(`row ${5 + r} ${COLUMNS[c].col} (${key}): view ${JSON.stringify(a)} vs file ${JSON.stringify(b)}`);
      }
    }
  }
  for (const d of diffs.slice(0, 12)) console.log(`     ✗ ${d}`);
  note('  cells compared', view.body.rows.length * 42);
  assert.equal(diffs.length, 0, `${diffs.length} cell(s) differ`);
});

ok('Sl.No. in the view numbers the whole sheet, not the page', async () => {
  const p2 = await call(getMasterView, { periodMonth: PERIOD, cycleCode: 'C1', page: 2, pageSize: 10 });
  assert.equal(p2.code, 200);
  note('  page 2 of 10 starts at Sl.No.', p2.body.rows[0].sl_no);
  assert.equal(p2.body.rows[0].sl_no, 11, 'paging restarted the numbering');
});

ok('search filters without renumbering', async () => {
  const one = view.body.rows[0];
  const f = await call(getMasterView, { periodMonth: PERIOD, cycleCode: 'C1', search: one.dealer_name });
  assert.equal(f.code, 200);
  note(`  search "${String(one.dealer_name).slice(0, 22)}"`, `${f.body.total} of ${f.body.total_unfiltered}`);
  assert.ok(f.body.total >= 1);
  assert.ok(f.body.total < f.body.total_unfiltered || f.body.total_unfiltered === 1);
  assert.equal(f.body.rows[0].sl_no, one.sl_no, 'filtering changed the Sl.No.');
});

console.log('\n' + '─'.repeat(76));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
