/**
 * C2 Review — snapshot + diff tests
 *
 * Covers the question the screen exists to answer: what did the adherence result
 * change in the second cycle? The diff is the part with the logic in it, so it is
 * tested directly; the snapshot round-trip is tested against the SQLite harness to
 * prove BEFORE survives the purge that happens between the two calls.
 */
import assert from 'node:assert/strict';
import { db, dbAll, dbRun } from './sandbox/src/config/database.js';

let pass = 0, fail = 0, section = '';
const head = t => { section = t; console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 70 - t.length))}`); };
const it = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const ita = async (name, fn) => {
  try { await fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};

const { diffLines, readC2PlanLines, openRegeneration, closeRegeneration } =
  await import('./sandbox/src/services/c2Snapshot.service.js');

const line = (emp, dealer, date, seq = 1, extra = {}) => ({
  emp_code: emp, emp_name: `Name ${emp}`, emp_role: 'SO',
  dealer_sap_code: dealer, dealer_name: `Dealer ${dealer}`,
  visit_date: date, sequence: seq, ...extra
});

// ─────────────────────────────────────────────────────────────────────────────
head('1. diffLines — dealers added and dropped');

{
  const before = [line('SO1', 'D1', '2026-09-17'), line('SO1', 'D2', '2026-09-18')];
  const after  = [line('SO1', 'D1', '2026-09-17'), line('SO1', 'D3', '2026-09-19')];
  const { changes, summary } = diffLines(before, after);

  it('a dealer only in AFTER is ADDED', () =>
    assert.equal(changes.filter(c => c.change === 'ADDED')[0].dealer_sap_code, 'D3'));
  it('a dealer only in BEFORE is DROPPED', () =>
    assert.equal(changes.filter(c => c.change === 'DROPPED')[0].dealer_sap_code, 'D2'));
  it('an identical dealer produces no change row', () =>
    assert.equal(changes.filter(c => c.dealer_sap_code === 'D1').length, 0));
  it('the summary counts both sides', () => {
    assert.equal(summary.added, 1);
    assert.equal(summary.dropped, 1);
    assert.equal(summary.dealers_before, 2);
    assert.equal(summary.dealers_after, 2);
  });
  it('unchanged counts only dealers still on the plan', () =>
    assert.equal(summary.unchanged, 1));
}

// ─────────────────────────────────────────────────────────────────────────────
head('2. diffLines — a reorder is a move, not an add plus a drop');

{
  const before = [line('SO1', 'D1', '2026-09-22')];
  const after  = [line('SO1', 'D1', '2026-09-17')];
  const { changes, summary } = diffLines(before, after);

  it('exactly one change row, not two', () => assert.equal(changes.length, 1));
  it('classified MOVED_EARLIER', () => assert.equal(changes[0].change, 'MOVED_EARLIER'));
  it('nothing is reported as added or dropped', () => {
    assert.equal(summary.added, 0);
    assert.equal(summary.dropped, 0);
  });
  it('the before date is carried for the reviewer', () =>
    assert.deepEqual(changes[0].before_dates, ['2026-09-22']));
  it('the later direction is detected too', () =>
    assert.equal(diffLines([line('SO1','D1','2026-09-17')], [line('SO1','D1','2026-09-25')])
      .changes[0].change, 'MOVED_LATER'));
}

// ─────────────────────────────────────────────────────────────────────────────
head('3. diffLines — visit count changes are their own class');

{
  const before = [line('SO1', 'D1', '2026-09-17')];
  const after  = [line('SO1', 'D1', '2026-09-17'), line('SO1', 'D1', '2026-09-24', 2)];
  const { changes, summary } = diffLines(before, after);

  it('same first date, more lines → MORE_VISITS', () =>
    assert.equal(changes[0].change, 'MORE_VISITS'));
  it('both visit counts are reported', () => {
    assert.equal(changes[0].visits, 2);
    assert.equal(changes[0].before_visits, 1);
  });
  it('the reverse is FEWER_VISITS', () =>
    assert.equal(diffLines(after, before).changes[0].change, 'FEWER_VISITS'));
  it('it is counted separately from add/drop', () => {
    assert.equal(summary.visit_count_changed, 1);
    assert.equal(summary.added, 0);
  });
  it('a move that also changes the count is reported as the move', () =>
    assert.equal(diffLines(
      [line('SO1','D1','2026-09-25')],
      [line('SO1','D1','2026-09-17'), line('SO1','D1','2026-09-20', 2)]
    ).changes[0].change, 'MOVED_EARLIER'));
}

// ─────────────────────────────────────────────────────────────────────────────
head('4. diffLines — dealers missed in C1 rank first');

{
  const before = [line('SO1', 'D9', '2026-09-17')];
  const after  = [
    line('SO1', 'D5', '2026-09-18'),   // plain add
    line('SO1', 'D7', '2026-09-17'),   // add, missed in C1
    line('SO1', 'D9', '2026-09-17')
  ];
  const { changes, summary } = diffLines(before, after, ['d7']);  // lower case on purpose

  it('the missed-in-C1 dealer sorts to the top', () =>
    assert.equal(changes[0].dealer_sap_code, 'D7'));
  it('it is flagged for the badge', () => assert.equal(changes[0].was_missed_in_c1, true));
  it('the other add is not flagged', () =>
    assert.equal(changes.find(c => c.dealer_sap_code === 'D5').was_missed_in_c1, false));
  it('matching ignores case', () => assert.equal(summary.missed_c1_dealers_on_new_c2, 1));
  it('the missed total comes from the adherence result, not the plan', () =>
    assert.equal(diffLines(before, after, ['D7', 'D8']).summary.missed_c1_dealers_total, 2));
}

// ─────────────────────────────────────────────────────────────────────────────
head('5. diffLines — the same dealer under two officers is two rows');

{
  const before = [line('SO1', 'D1', '2026-09-17')];
  const after  = [line('SO1', 'D1', '2026-09-17'), line('SO2', 'D1', '2026-09-18')];
  const { changes } = diffLines(before, after);

  it('the second officer is an ADDED row of its own', () => {
    assert.equal(changes.length, 1);
    assert.equal(changes[0].emp_code, 'SO2');
    assert.equal(changes[0].change, 'ADDED');
  });
  it('the first officer is untouched', () =>
    assert.equal(changes.filter(c => c.emp_code === 'SO1').length, 0));
  it('an empty BEFORE makes everything an add', () =>
    assert.equal(diffLines([], after).summary.added, 2));
  it('an empty AFTER makes everything a drop', () =>
    assert.equal(diffLines(after, []).summary.dropped, 2));
  it('two empty snapshots produce no changes', () =>
    assert.equal(diffLines([], []).changes.length, 0));
}

// ─────────────────────────────────────────────────────────────────────────────
head('6. snapshot round-trip — BEFORE survives the purge');

db.exec(`
CREATE TABLE sales_plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  emp_code TEXT NOT NULL, emp_name TEXT NOT NULL, emp_role TEXT DEFAULT 'SO',
  period_month TEXT NOT NULL, cycle_code TEXT NOT NULL DEFAULT 'C1',
  status TEXT DEFAULT 'DRAFT', created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE sales_plan_details (
  id INTEGER PRIMARY KEY AUTOINCREMENT, plan_id INTEGER NOT NULL,
  visit_date TEXT NOT NULL, dealer_sap_code TEXT, dealer_name TEXT,
  sequence INTEGER DEFAULT 1
);
CREATE TABLE c2_regenerations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, generation_code TEXT, period_month TEXT,
  adherence_as_on TEXT, adherence_planned INTEGER, adherence_adhered INTEGER,
  adherence_missed INTEGER, adherence_pct REAL, plans_before INTEGER, visits_before INTEGER,
  plans_after INTEGER, visits_after INTEGER, missed_dealer_codes TEXT, status TEXT,
  completed_at TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE c2_regeneration_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, regeneration_id INTEGER, phase TEXT,
  emp_code TEXT, emp_name TEXT, emp_role TEXT, visit_date TEXT,
  dealer_sap_code TEXT, dealer_name TEXT, sequence INTEGER
);
`);

async function seedPlan(empCode, rows) {
  const r = await dbRun(
    `INSERT INTO sales_plans (emp_code, emp_name, emp_role, period_month, cycle_code, status)
     VALUES (?, ?, 'SO', '2026-09', 'C2', 'DRAFT')`, [empCode, `Name ${empCode}`]);
  const planId = r.insertId || r.lastID;
  for (const [dealer, date, seq] of rows) {
    await dbRun(
      `INSERT INTO sales_plan_details (plan_id, visit_date, dealer_sap_code, dealer_name, sequence)
       VALUES (?, ?, ?, ?, ?)`, [planId, date, dealer, `Dealer ${dealer}`, seq || 1]);
  }
  return planId;
}

const planA = await seedPlan('SO1', [['D1', '2026-09-22'], ['D2', '2026-09-23']]);
await seedPlan('SO2', [['D3', '2026-09-18']]);

const beforeLines = await readC2PlanLines('2026-09');
await ita('readC2PlanLines returns every C2 line across officers', () =>
  assert.equal(beforeLines.length, 3));

const regenId = await openRegeneration('2026-09', 'GEN-C2-TEST', {
  asOnDate: '2026-09-15', plannedCount: 10, completedCount: 7, missedCount: 3, adherencePct: 70
});
await ita('openRegeneration returns an id', () => assert.ok(regenId));

// the purge the real regeneration performs
await dbRun(`DELETE FROM sales_plan_details WHERE plan_id IN
  (SELECT id FROM sales_plans WHERE period_month = '2026-09' AND cycle_code = 'C2')`);
await dbRun(`DELETE FROM sales_plans WHERE period_month = '2026-09' AND cycle_code = 'C2'`);

await ita('after the purge the live plan is gone', async () =>
  assert.equal((await readC2PlanLines('2026-09')).length, 0));

await ita('but the BEFORE snapshot is still there', async () => {
  const rows = await dbAll(
    `SELECT * FROM c2_regeneration_lines WHERE regeneration_id = ? AND phase = 'BEFORE'`, [regenId]);
  assert.equal(rows.length, 3);
});

// the rebuild
await seedPlan('SO1', [['D1', '2026-09-17'], ['D4', '2026-09-21']]);
await seedPlan('SO2', [['D3', '2026-09-18']]);
await closeRegeneration(regenId, '2026-09', [{ dealer_sap_code: 'D4' }]);

await ita('closeRegeneration records the AFTER side and completes', async () => {
  const rec = await dbAll(`SELECT * FROM c2_regenerations WHERE id = ?`, [regenId]);
  assert.equal(rec[0].status, 'COMPLETED');
  assert.equal(rec[0].visits_before, 3);
  assert.equal(rec[0].visits_after, 3);
  assert.equal(rec[0].plans_before, 2);
});

await ita('the adherence figures that drove it are stored on the record', async () => {
  const rec = await dbAll(`SELECT * FROM c2_regenerations WHERE id = ?`, [regenId]);
  assert.equal(rec[0].adherence_planned, 10);
  assert.equal(rec[0].adherence_adhered, 7);
  assert.equal(rec[0].adherence_pct, 70);
  assert.equal(rec[0].adherence_as_on, '2026-09-15');
});

await ita('missed dealer codes survive the next SFA upload', async () => {
  const rec = await dbAll(`SELECT * FROM c2_regenerations WHERE id = ?`, [regenId]);
  assert.deepEqual(JSON.parse(rec[0].missed_dealer_codes), ['D4']);
});

// ─────────────────────────────────────────────────────────────────────────────
head('7. the stored snapshots diff to the real change');

{
  const b = await dbAll(`SELECT * FROM c2_regeneration_lines WHERE regeneration_id = ? AND phase = 'BEFORE'`, [regenId]);
  const a = await dbAll(`SELECT * FROM c2_regeneration_lines WHERE regeneration_id = ? AND phase = 'AFTER'`, [regenId]);
  const { changes, summary } = diffLines(b, a, ['D4']);

  await ita('D2 was dropped', () =>
    assert.ok(changes.some(c => c.dealer_sap_code === 'D2' && c.change === 'DROPPED')));
  await ita('D4 was added and is flagged as missed in C1', () => {
    const d4 = changes.find(c => c.dealer_sap_code === 'D4');
    assert.equal(d4.change, 'ADDED');
    assert.equal(d4.was_missed_in_c1, true);
  });
  await ita('D1 moved earlier rather than being re-added', () =>
    assert.equal(changes.find(c => c.dealer_sap_code === 'D1').change, 'MOVED_EARLIER'));
  await ita('SO2 is untouched, so it does not appear', () =>
    assert.equal(changes.filter(c => c.emp_code === 'SO2').length, 0));
  await ita('the summary matches', () => {
    assert.equal(summary.added, 1);
    assert.equal(summary.dropped, 1);
    assert.equal(summary.moved_earlier, 1);
    assert.equal(summary.missed_c1_dealers_on_new_c2, 1);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
head('8. a missing history table never blocks a regeneration');

await dbRun(`DROP TABLE c2_regenerations`);
await dbRun(`DROP TABLE c2_regeneration_lines`);

await ita('openRegeneration returns null instead of throwing', async () =>
  assert.equal(await openRegeneration('2026-09', 'GEN-NO-TABLES', {}), null));
await ita('closeRegeneration on a null id is a no-op', async () =>
  assert.equal(await closeRegeneration(null, '2026-09', []), null));

console.log('\n' + '─'.repeat(72));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
