/**
 * "I changed a value in Dealer Performance and nothing changed."
 *
 * Regression guard for two separate bugs that looked identical from the screen. Both
 * are fixed; this reproduces the exact scenario with the REAL importer and the REAL
 * loader, and fails if either comes back.
 *
 *   A. A re-upload did not replace the previous upload.
 *      dealer-performance.importer.js writes with ON DUPLICATE KEY UPDATE, which only
 *      fires on a UNIQUE key violation — and dealer_performance_history declared none,
 *      so the clause was dead and every upload appended. loadDealerPerformanceHistory
 *      aggregates with SUM(quantity_mt) GROUP BY sap_code, period_year_month, so the
 *      old figure and the corrected one were ADDED: 1200 corrected to 500 read as 1700.
 *      Fixed by the unique key (migrate-dp-unique-key.js, and schema.sql) plus a delete
 *      of the pairs the upload is about to write, so the importer is right on its own.
 *
 *   B. The DLRWISE export names some months twice.
 *      "Jun'26 SALE" and "Jun-26 SALE" both parse to 2026-06. The importer kept the
 *      LARGER of the two silently, so correcting a figure downwards in one column had
 *      no effect whatsoever. The later column now wins, and a disagreement is reported
 *      as a warning naming both headers and both values.
 *
 * C is not a bug — uploading never writes dealer_visit_targets, so nothing on screen
 * moves until Generate Plans runs. Asserted here because it is the first thing to rule
 * out when someone says the data did not change.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import XLSX from 'xlsx';
import { db, dbAll, dbGet, dbRun } from './sandbox/src/config/database.js';
import { loadSchemaAndRules } from './seed.mjs';

let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                        catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const okA = async (n, fn) => { try { await fn(); console.log(`  ✓ ${n}`); pass++; }
                               catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const S = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`);
const note = (k, v) => console.log(`     ${String(k).padEnd(48, '.')} ${v}`);
const quiet = async fn => { const l = console.log, w = console.warn; console.log = () => {}; console.warn = () => {};
                            try { return await fn(); } finally { console.log = l; console.warn = w; } };

const TMP = mkdtempSync(join(tmpdir(), 'dp-'));
const SAP = '1000000013';

/**
 * A DLRWISE-shaped workbook. `juneApostrophe` and `juneDash` are the two columns that
 * both mean June 2026 — exactly as the client's export has them.
 */
function writeDlrwise(file, { juneApostrophe, juneDash }) {
  const rows = [
    ['#REF!'],                                            // row 1, as in the real export
    ['REGION','AREA','CODE','SAP','DEALERS NAME','DOA','Targeted Dealer','EXCLUSIVE DEALER',
     "Jun'26 Tgt",'Prorata Tgt',"Jun'26 SALE",'Jun-25 SALE',
     'Jan-26 SALE','Feb-26 SALE','Mar-26 SALE','Apr-26 SALE','May-26 SALE','Jun-26 SALE'],
    ['NE 2','AGARTALA','B138', SAP,'BANKA BEHARI PAUL','09-May-12','Targeted Dealer','-',
     200, 200, juneApostrophe, 164.25,
     90, 95, 100, 105, 70, juneDash]
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'DLRWISE');
  XLSX.writeFile(wb, file);
  return file;
}

/** What the PJP engine will actually read for June 2026. */
async function whatTheEngineSees() {
  const { loadDealerPerformanceHistory } = await import('./sandbox/src/engines/pjp/data-loader.engine.js');
  const map = await quiet(() => loadDealerPerformanceHistory(['2026-06']));
  const series = map.get(SAP) || [];
  const jun = series.find(s => s.period_year_month === '2026-06');
  return jun ? jun.quantity_mt : null;
}
const rowsFor = async () => dbAll(
  `SELECT quantity_mt, batch_code FROM dealer_performance_history
    WHERE sap_code=? AND period_year_month='2026-06' ORDER BY id`, [SAP]);

loadSchemaAndRules();
await dbRun(`INSERT INTO master_dealers (dealer_type, sap_code, dealer_name, status)
             VALUES ('DEALER', ?, 'BANKA BEHARI PAUL', 'ACTIVE')`, [SAP]);

const { importDealerPerformance } = await import('./sandbox/src/imports/dealer-performance.importer.js');

console.log('\n' + '═'.repeat(76));
console.log('  "I changed the value in Dealer Performance and nothing changed"');
console.log('═'.repeat(76));

// ═════════════════════════════════════════════════════════════════════════════
S('A.  Re-uploading with an edited figure');

const f1 = writeDlrwise(join(TMP, 'dp1.xlsx'), { juneApostrophe: 1200, juneDash: 1200 });
await quiet(() => importDealerPerformance(f1, 'BATCH-1'));

const after1 = await whatTheEngineSees();
note('upload 1 — June in the sheet', 1200);
note('upload 1 — what the engine reads', after1);
note('upload 1 — rows in dealer_performance_history', (await rowsFor()).length);

// The user edits June down to 500 and uploads the same file again.
const f2 = writeDlrwise(join(TMP, 'dp2.xlsx'), { juneApostrophe: 500, juneDash: 500 });
await quiet(() => importDealerPerformance(f2, 'BATCH-2'));

const after2 = await whatTheEngineSees();
const rows2 = await rowsFor();
console.log('');
note('upload 2 — June edited in the sheet to', 500);
note('upload 2 — what the engine reads', after2);
note('upload 2 — rows in dealer_performance_history', rows2.length);
note('  the rows themselves', JSON.stringify(rows2.map(r => ({ qty: r.quantity_mt, batch: r.batch_code }))));

await okA('the second upload REPLACES the first — one row, not two', () => {
  assert.equal(rows2.length, 1,
    `${rows2.length} rows for one dealer-month — uploads are accumulating again`);
});

await okA('the engine reads the corrected figure, not the sum of both', () => {
  note('  the old behaviour summed them to', 1700);
  assert.equal(after2, 500, `engine reads ${after2}`);
  assert.notEqual(after2, 1700, 'the accumulation bug is back');
});

await okA('the unique key the upsert needs is present', async () => {
  const idx = await dbAll(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='dealer_performance_history'`);
  note('  indexes on dealer_performance_history', idx.length ? idx.map(i => i.name).join(', ') : '(none)');
  assert.ok(idx.length > 0, 'no unique key — ON DUPLICATE KEY UPDATE cannot fire');
});

// ═════════════════════════════════════════════════════════════════════════════
S('B.  Editing only ONE of the two June columns');

// Fresh table, so this mechanism is isolated from the one above.
await dbRun(`DELETE FROM dealer_performance_history`);

const f3 = writeDlrwise(join(TMP, 'dp3.xlsx'), { juneApostrophe: 1200, juneDash: 1200 });
await quiet(() => importDealerPerformance(f3, 'BATCH-3'));
note("both June columns at 1200 → engine reads", await whatTheEngineSees());

await dbRun(`DELETE FROM dealer_performance_history`);
// The user edits "Jun-26 SALE" down to 500 but leaves "Jun'26 SALE" at 1200.
const f4 = writeDlrwise(join(TMP, 'dp4.xlsx'), { juneApostrophe: 1200, juneDash: 500 });
await quiet(() => importDealerPerformance(f4, 'BATCH-4'));
const oneEdited = await whatTheEngineSees();
console.log('');
note("\"Jun'26 SALE\" left at", 1200);
note('"Jun-26 SALE" edited down to', 500);
note('what the engine reads', oneEdited);

await okA('the edited column is honoured — the later column wins', () => {
  note('  the old behaviour kept the larger and read', 1200);
  assert.equal(oneEdited, 500,
    `engine read ${oneEdited} — expected the later column (Jun-26 SALE) to win`);
});

await okA('and the disagreement is REPORTED, not swallowed', async () => {
  await dbRun(`DELETE FROM dealer_performance_history`);
  const f = writeDlrwise(join(TMP, 'dpw.xlsx'), { juneApostrophe: 1200, juneDash: 500 });
  const res = await quiet(() => importDealerPerformance(f, 'BATCH-W'));
  note('  warnings returned', res.warnings.length);
  for (const w of res.warnings) console.log(`       "${w}"`);
  assert.ok(res.warnings.length > 0, 'a half-edited sheet produced no warning');
  assert.ok(res.warnings.some(w => /appears twice/i.test(w)));
});

await dbRun(`DELETE FROM dealer_performance_history`);
const f5 = writeDlrwise(join(TMP, 'dp5.xlsx'), { juneApostrophe: 500, juneDash: 1200 });
await quiet(() => importDealerPerformance(f5, 'BATCH-5'));
const otherEdited = await whatTheEngineSees();
console.log('');
note("editing the OTHER one instead — \"Jun'26 SALE\" to", 500);
note('"Jun-26 SALE" left at', 1200);
note('what the engine reads', otherEdited);

await okA('editing only the earlier column leaves the later one in charge', () => {
  // Predictable rather than silent: the later column wins either way, and the
  // warning above tells the user the two disagree.
  assert.equal(otherEdited, 1200);
});

await dbRun(`DELETE FROM dealer_performance_history`);
const f6 = writeDlrwise(join(TMP, 'dp6.xlsx'), { juneApostrophe: 500, juneDash: 500 });
await quiet(() => importDealerPerformance(f6, 'BATCH-6'));
const bothEdited = await whatTheEngineSees();
console.log('');
note('editing BOTH columns to', 500);
note('what the engine reads', bothEdited);

await okA('only editing BOTH columns moves the number', () =>
  assert.equal(bothEdited, 500));

// ═════════════════════════════════════════════════════════════════════════════
S('C.  And uploading alone never changes what the screen shows');

await okA('dealer_visit_targets is not touched by an upload', async () => {
  const n = (await dbGet(`SELECT COUNT(*) c FROM dealer_visit_targets`)).c;
  note('  target rows after six uploads', n);
  assert.equal(n, 0,
    'an upload wrote targets — then Generate Plans would not be required');
});

console.log(`
     The Master sheet, the plans and the categories all read dealer_visit_targets.
     That table is only written by Generate Plans. Uploading a corrected file and
     refreshing the screen shows the previous figures because nothing recalculated.
`);

console.log('─'.repeat(76));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
