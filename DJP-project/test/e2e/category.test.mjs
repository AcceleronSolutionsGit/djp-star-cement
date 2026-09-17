/**
 * FINAL CATEGORY (column U) — every row of the kit must match the client master.
 *
 * The expected values come from EXPECTED_RESULTS.xlsx → Expected_Category, which was
 * derived from the live formula in M.xlsx and replays over that master at 99.98%.
 * The kit is built for planning month 2026-07, so that is the anchor used here.
 *
 * This is the regression guard for the DOA tiers. If someone removes them, the two
 * young dealers fall back to Churn and this fails loudly.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbAll } from './sandbox/src/config/database.js';
import { seed } from './seed.mjs';

const here    = dirname(fileURLToPath(import.meta.url));
const PERIOD  = '2026-07';                       // the kit's planning month
const expected = JSON.parse(readFileSync(join(here, 'expected_category.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); pass++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); fail++; }
};
const S = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`);

const counts = await seed();
const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');

const quiet = console.log; console.log = () => {};
await generateFullPjpDjpSolution(PERIOD, 'C1', {
  generationRunCode: 'GEN-CAT', dealerMappingBatchCode: counts.mappingBatch,
  salesHistoryBatchCodes: [counts.salesBatch]
});
console.log = quiet;

const rows = await dbAll(
  `SELECT sap_code, sfa_code, dealer_name, doa, dealer_status, category,
          current_sales, previous_sales, lysm_sales, rsar_six_month_avg,
          need_to_grow, so_visits, asm_visits, rsm_visits, zh_visits, final_volume
     FROM dealer_visit_targets WHERE period_month=? AND cycle_code='C1'`, [PERIOD]);

const byCode = new Map();
for (const r of rows) {
  if (r.sap_code) byCode.set(String(r.sap_code).trim(), r);
  if (r.sfa_code) byCode.set(String(r.sfa_code).trim(), r);
}

// ─────────────────────────────────────────────────────────────────────────────
S(`Final Category — ${Object.keys(expected).length} rows against the client master`);

const misses = [];
for (const [code, exp] of Object.entries(expected)) {
  const got = byCode.get(code);
  if (!got) { misses.push({ code, want: exp.category, got: '(no row produced)', name: exp.name, doa: exp.doa }); continue; }
  if (String(got.dealer_status).trim() !== exp.category) {
    misses.push({ code, want: exp.category, got: got.dealer_status, name: got.dealer_name, doa: got.doa, tier: exp.tier });
  }
}

console.log(`     rows expected .................................. ${Object.keys(expected).length}`);
console.log(`     rows produced by the engine ................... ${rows.length}`);
console.log(`     matches ....................................... ${Object.keys(expected).length - misses.length}`);
console.log(`     mismatches .................................... ${misses.length}`);

if (misses.length) {
  console.log('');
  for (const m of misses)
    console.log(`     ✗ ${String(m.code).padEnd(12)} ${String(m.name).slice(0, 26).padEnd(27)} DOA ${String(m.doa || '—').padEnd(12)} expected ${String(m.want).padEnd(14)} got ${m.got}`);
}

ok('every dealer in the kit matches the client master', () =>
  assert.equal(misses.length, 0, `${misses.length} row(s) differ`));

// ─────────────────────────────────────────────────────────────────────────────
S('the DOA tiers do what they exist to do');

const { resolveDoaTier } = await import('./sandbox/src/engines/pjp/classification.engine.js');

ok('the four cut-offs match the kit for a 2026-07 anchor', () => {
  const { cutoffs } = resolveDoaTier('2020-01-01', PERIOD);
  const iso = d => d.toISOString().slice(0, 10);
  console.log(`     anchor $B$2 ................................... ${iso(cutoffs.anchor)}`);
  console.log(`     brand-new  $B$2 − 15 .......................... ${iso(cutoffs.brandNew)}`);
  console.log(`     old        DATE(Y−1, M−1, 1) ................. ${iso(cutoffs.old)}`);
  console.log(`     mid        $B$2 − 180 ......................... ${iso(cutoffs.mid)}`);
  assert.equal(iso(cutoffs.anchor),   '2026-07-01');
  assert.equal(iso(cutoffs.brandNew), '2026-06-16');
  assert.equal(iso(cutoffs.old),      '2025-06-01');
  assert.equal(iso(cutoffs.mid),      '2026-01-02');
});

ok('each dealer lands in the tier the kit says it should', () => {
  const cases = [
    ['2026-06-20', 'BRAND_NEW'], ['2026-06-16', 'BRAND_NEW'],
    ['2026-06-15', 'NEW'],       ['2026-04-05', 'NEW'],
    ['2026-01-03', 'NEW'],       ['2026-01-02', 'MID'],
    ['2025-08-12', 'MID'],       ['2025-06-01', 'OLD'],
    ['2021-02-03', 'OLD'],       ['2008-04-28', 'OLD']
  ];
  for (const [doa, want] of cases) {
    const { tier } = resolveDoaTier(doa, PERIOD);
    assert.equal(tier, want, `DOA ${doa} → ${tier}, expected ${want}`);
  }
});

ok('Old is tested before Mid — the cut-offs are not in ascending order', () => {
  // 2025-08-12 is NOT <= 2025-06-01 (so not Old) but IS <= 2026-01-02.
  // Testing Mid first would wrongly catch genuinely old dealers.
  assert.equal(resolveDoaTier('2025-08-12', PERIOD).tier, 'MID');
  assert.equal(resolveDoaTier('2024-01-01', PERIOD).tier, 'OLD');
});

ok('a brand-new dealer with zero sales is Growing, not Churn', async () => {
  const { classifyDealer } = await import('./sandbox/src/engines/pjp/classification.engine.js');
  const r = classifyDealer({
    dealerType: 'DEALER', doa: '2026-06-20', reportMonth: PERIOD,
    currentSales: 0, previousMonthSales: 0, sameMonthLastYearSales: 0,
    sixMonthAverage: 0, needToGrow: false, status: 'ACTIVE'
  });
  console.log(`     ${r.finalCategory} — ${r.reason}`);
  assert.equal(r.finalCategory, 'Growing');
});

ok('Churn is unreachable in the New tier — zero sales gives Zero Lifter', async () => {
  const { classifyDealer } = await import('./sandbox/src/engines/pjp/classification.engine.js');
  const r = classifyDealer({
    dealerType: 'DEALER', doa: '2026-01-03', reportMonth: PERIOD,
    currentSales: 0, previousMonthSales: 0, sameMonthLastYearSales: 0,
    sixMonthAverage: 0, needToGrow: false, status: 'ACTIVE'
  });
  console.log(`     ${r.finalCategory} — ${r.reason}`);
  assert.equal(r.finalCategory, 'Zero Lifter');
});

ok('Churn IS reachable in the Old and Mid tiers, on S = 0 alone', async () => {
  const { classifyDealer } = await import('./sandbox/src/engines/pjp/classification.engine.js');
  for (const doa of ['2021-02-03', '2025-08-12']) {
    const r = classifyDealer({
      dealerType: 'DEALER', doa, reportMonth: PERIOD,
      currentSales: 0, previousMonthSales: 500, sameMonthLastYearSales: 900,
      sixMonthAverage: 0, needToGrow: false, status: 'ACTIVE'
    });
    assert.equal(r.finalCategory, 'Churn', `DOA ${doa} → ${r.finalCategory}`);
  }
});

ok('need-to-grow is now READ — it outranks every growth comparison', async () => {
  const { classifyDealer } = await import('./sandbox/src/engines/pjp/classification.engine.js');
  for (const doa of ['2021-02-03', '2025-08-12', '2026-04-05']) {
    const base = {
      dealerType: 'DEALER', doa, reportMonth: PERIOD,
      currentSales: 100, previousMonthSales: 50, sameMonthLastYearSales: 50,
      sixMonthAverage: 60, status: 'ACTIVE'
    };
    const without = classifyDealer({ ...base, needToGrow: false });
    const with_   = classifyDealer({ ...base, needToGrow: true });
    assert.equal(with_.finalCategory, 'Need to Grow', `DOA ${doa}: AK ignored`);
    assert.equal(without.finalCategory, 'Growing', `DOA ${doa}: ${without.finalCategory}`);
  }
});

ok('CM == PM no longer produces Need to Grow', async () => {
  const { classifyDealer } = await import('./sandbox/src/engines/pjp/classification.engine.js');
  const r = classifyDealer({
    dealerType: 'DEALER', doa: '2026-02-14', reportMonth: PERIOD,
    currentSales: 500, previousMonthSales: 500, sameMonthLastYearSales: 500,
    sixMonthAverage: 500, needToGrow: false, status: 'ACTIVE'
  });
  console.log(`     equal sales, no NTG flag → ${r.finalCategory}`);
  assert.equal(r.finalCategory, 'Growing', 'equality must be inclusive → Growing');
});

ok('a blank DOA falls into the Old tier, as Excel does', () =>
  assert.equal(resolveDoaTier(null, PERIOD).tier, 'OLD'));

ok('a prospect is Prospective whichever way it is marked', async () => {
  const { classifyDealer } = await import('./sandbox/src/engines/pjp/classification.engine.js');
  assert.equal(classifyDealer({ dealerType: 'PROSPECTIVE', doa: null, reportMonth: PERIOD }).finalCategory, 'Prospective');
  assert.equal(classifyDealer({ dealerType: 'DEALER', doa: 'New', reportMonth: PERIOD }).finalCategory, 'Prospective');
});

// ─────────────────────────────────────────────────────────────────────────────
S('the consequence — young dealers are no longer dropped from the plan');

const churn = rows.filter(r => r.dealer_status === 'Churn');
const anchor = new Date(`${PERIOD}-01T00:00:00Z`);
const ageOf = d => d ? Math.round((anchor - new Date(`${String(d).slice(0,10)}T00:00:00Z`)) / 86400000) : null;

for (const r of churn)
  console.log(`     Churn: ${String(r.sap_code).padEnd(12)} ${String(r.dealer_name).slice(0,26).padEnd(27)} DOA ${String(r.doa||'—').padEnd(12)} age ${ageOf(r.doa)}d`);

ok('no dealer younger than 180 days is classified Churn', () => {
  const young = churn.filter(r => ageOf(r.doa) !== null && ageOf(r.doa) <= 180);
  assert.equal(young.length, 0,
    `still churning young dealers: ${young.map(y => `${y.sap_code} (${ageOf(y.doa)}d)`).join(', ')}`);
});

ok('every dealer that is not Churn receives at least one visit', () => {
  const silent = rows.filter(r => r.dealer_status !== 'Churn' &&
    (+r.so_visits || 0) + (+r.asm_visits || 0) + (+r.rsm_visits || 0) + (+r.zh_visits || 0) === 0);
  console.log(`     non-Churn dealers with zero visits ............ ${silent.length}`);
  assert.equal(silent.length, 0,
    `no visits: ${silent.map(s => `${s.sap_code} ${s.dealer_status}`).join(', ')}`);
});

const dist = {};
for (const r of rows) dist[r.dealer_status] = (dist[r.dealer_status] || 0) + 1;
console.log(`\n     Final Category distribution ... ${JSON.stringify(dist)}`);

console.log('\n' + '─'.repeat(72));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
