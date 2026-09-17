/**
 * DEMO KIT v2 — proves WHICH sales source classifies a dealer.
 *
 * Every expected Final Category below is computed here from the client's column U
 * formula, independently of the engine, using DEALER PERFORMANCE only. The engine is
 * then run on the same files and the two are compared.
 *
 * The four trap dealers are the point: each is built so that RSAR and Dealer
 * Performance give DIFFERENT answers. If the engine ever classifies on RSAR again,
 * these four flip and this test names them.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, dbAll, dbGet, dbRun } from './sandbox/src/config/database.js';

const here = dirname(fileURLToPath(import.meta.url));
const KIT  = JSON.parse(readFileSync(join(here, '..', '..', 'kit-v2', 'kit.json'), 'utf8'));
const PLAN = KIT.plan;                                  // 2026-07
const D    = KIT.dealers;

let pass = 0, fail = 0;
const ok = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`); pass++; }
                        catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const okA = async (n, fn) => { try { await fn(); console.log(`  ✓ ${n}`); pass++; }
                               catch (e) { console.log(`  ✗ ${n}\n      ${e.message}`); fail++; } };
const S = t => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 68 - t.length))}`);
const note = (k, v) => console.log(`     ${String(k).padEnd(46, '.')} ${v}`);

// ─────────────────────────────────────────────────────────────────────────────
// Expected Final Category, computed from the formula — Dealer Performance only.
// ─────────────────────────────────────────────────────────────────────────────
const MONN = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
function doaDate(s) {
  const m = String(s || '').match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += y < 50 ? 2000 : 1900;
  return new Date(Date.UTC(y, MONN[m[2].toLowerCase()] - 1, +m[1]));
}
const anchor = new Date(`${PLAN}-01T00:00:00Z`);
const DAY = 86400000;
const CUT = {
  brandNew: new Date(anchor.getTime() - 15 * DAY),
  old:      new Date(Date.UTC(anchor.getUTCFullYear() - 1, anchor.getUTCMonth() - 1, 1)),
  mid:      new Date(anchor.getTime() - 180 * DAY)
};

// Area potential percentile (AN) and counter share (P) → need-to-grow (AK)
const byArea = new Map();
for (const d of D) { if (!byArea.has(d.area)) byArea.set(d.area, []); byArea.get(d.area).push(d); }
const metrics = new Map();
for (const [, group] of byArea) {
  const total = group.reduce((a, d) => a + d.pot, 0);
  for (const d of group) {
    const rank = group.filter(x => x.pot > d.pot).length + 1;
    const atOrAbove = group.filter(x => (group.filter(y => y.pot > x.pot).length + 1) >= rank);
    const AN = total > 0 ? atOrAbove.reduce((a, x) => a + x.pot, 0) / total : 0;
    const O = d.dp[5];
    metrics.set(d.sap, { AN, P: d.pot > 0 ? O / d.pot : 0 });
  }
}

function expectedCategory(d) {
  const O = d.dp[5], R = d.dp[4], Q = d.lys, S6 = d.dp.reduce((a, b) => a + b, 0) / 6;
  const { AN, P } = metrics.get(d.sap);
  const t = doaDate(d.doa);
  const AK = AN > 0.60 && P < 0.20;

  let tier;
  if (!t)                                       tier = 'OLD';        // blank → Excel reads 0
  else if (t.getTime() >= CUT.brandNew.getTime()) tier = 'BRAND_NEW';
  else if (t.getTime() <= CUT.old.getTime())      tier = 'OLD';
  else if (t.getTime() <= CUT.mid.getTime())      tier = 'MID';
  else                                            tier = 'NEW';

  if (tier === 'BRAND_NEW') return { tier, cat: 'Growing', AK };
  if (tier === 'OLD') {
    if (S6 === 0) return { tier, cat: 'Churn', AK };
    if (O === 0)  return { tier, cat: 'Zero Lifter', AK };
    if (AK)       return { tier, cat: 'Need to Grow', AK };
    return { tier, cat: O >= Q ? 'Growing' : 'De-growing', AK };
  }
  if (tier === 'MID') {
    if (S6 === 0) return { tier, cat: 'Churn', AK };
    if (O === 0)  return { tier, cat: 'Zero Lifter', AK };
    if (AK)       return { tier, cat: 'Need to Grow', AK };
    return { tier, cat: S6 > O ? 'De-growing' : 'Growing', AK };
  }
  if (O === 0) return { tier, cat: 'Zero Lifter', AK };
  if (AK)      return { tier, cat: 'Need to Grow', AK };
  return { tier, cat: R > O ? 'De-growing' : 'Growing', AK };
}

/** What the SAME formula would say if RSAR were used instead — the trap detector. */
function categoryIfRsarWereUsed(d) {
  if (!d.rsar) return 'Churn';                  // no sub-dealers → S=0 → Churn
  const fake = { ...d, dp: d.rsar, lys: 0 };
  return expectedCategory(fake).cat;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(76));
console.log('  DEMO KIT v2 — Dealer Performance classifies, RSAR does not');
console.log('═'.repeat(76));

S('expected Final Category, computed from the formula (Dealer Performance)');
console.log('     SAP CODE     DEALER                     TIER        O     R     Q      S   AK   EXPECTED');
console.log('     ' + '─'.repeat(92));
const expected = {};
for (const d of D) {
  const e = expectedCategory(d);
  expected[d.sap] = e.cat;
  const S6 = d.dp.reduce((a, b) => a + b, 0) / 6;
  console.log(`     ${d.sap.padEnd(12)} ${d.name.slice(0, 25).padEnd(26)} ${e.tier.padEnd(10)}` +
    `${String(d.dp[5]).padStart(5)} ${String(d.dp[4]).padStart(5)} ${String(d.lys).padStart(5)} ${S6.toFixed(0).padStart(6)}  ` +
    `${(e.AK ? 'Y' : 'n').padEnd(3)}  ${e.cat}`);
}

// ─────────────────────────────────────────────────────────────────────────────
S('the traps — where the two sources disagree');
const traps = [];
for (const d of D) {
  const want = expected[d.sap];
  const ifRsar = categoryIfRsarWereUsed(d);
  if (ifRsar !== want) traps.push({ d, want, ifRsar });
}
for (const t of traps)
  console.log(`     ${t.d.sap.padEnd(12)} ${t.d.name.slice(0, 24).padEnd(25)} DP → ${String(t.want).padEnd(14)} RSAR → ${t.ifRsar}`);
note('dealers where the source changes the answer', traps.length);

ok('the kit actually distinguishes the two sources', () =>
  assert.ok(traps.length >= 4, `only ${traps.length} dealer(s) differ — the kit cannot prove the source`));

// ─────────────────────────────────────────────────────────────────────────────
S('run the real engine on the kit');

const { seedKitV2 } = await import('./seed-kit-v2.mjs');
const counts = await seedKitV2();
note('dealers / prospects seeded', `${counts.dealers} / ${counts.prospects}`);
note('RSAR sub-dealer rows', counts.rsarRows);
note('Dealer Performance rows', counts.dpRows);

const { generateFullPjpDjpSolution } = await import('./sandbox/src/engines/djp-generator.engine.js');
const quiet = console.log; console.log = () => {};
const djp = await generateFullPjpDjpSolution(PLAN, 'C1', {
  generationRunCode: 'GEN-KITV2', dealerMappingBatchCode: counts.mappingBatch,
  salesHistoryBatchCodes: [counts.salesBatch]
});
console.log = quiet;

const rows = await dbAll(
  `SELECT sap_code, dealer_name, doa, dealer_status, category, need_to_grow,
          current_sales, previous_sales, lysm_sales, rsar_six_month_avg, dp_six_month_avg,
          counter_share, final_volume, so_visits, asm_visits, rsm_visits, zh_visits
     FROM dealer_visit_targets WHERE period_month=? AND cycle_code='C1'`, [PLAN]);
const got = new Map(rows.filter(r => r.sap_code).map(r => [String(r.sap_code).trim(), r]));

note('dealer_visit_targets produced', rows.length);
note('DJP day-slots allocated', djp.totalDjpSlots);

// ─────────────────────────────────────────────────────────────────────────────
S('every dealer matches the formula');
const misses = [];
for (const d of D) {
  const r = got.get(d.sap);
  if (!r) { misses.push(`${d.sap} ${d.name}: no row produced`); continue; }
  if (String(r.dealer_status).trim() !== expected[d.sap])
    misses.push(`${d.sap} ${d.name}: expected ${expected[d.sap]}, got ${r.dealer_status}`);
}
for (const m of misses) console.log(`     ✗ ${m}`);
ok(`all ${D.length} dealers classify as the formula says`, () =>
  assert.equal(misses.length, 0, `${misses.length} mismatch(es)`));

// ─────────────────────────────────────────────────────────────────────────────
S('the source is Dealer Performance — proved on the traps');

for (const t of traps) {
  await okA(`${t.d.name} → ${t.want} (RSAR would say ${t.ifRsar})`, () => {
    const r = got.get(t.d.sap);
    assert.equal(String(r.dealer_status).trim(), t.want,
      `classified ${r.dealer_status} — that is the RSAR answer, so the engine is reading sub-dealer sales`);
  });
}

await okA('current sales on every dealer equal its OWN Jun-26, not its sub-dealers\'', () => {
  const bad = [];
  for (const d of D) {
    const r = got.get(d.sap);
    if (Math.abs((+r.current_sales || 0) - d.dp[5]) > 0.01)
      bad.push(`${d.sap}: current_sales ${r.current_sales}, own Jun-26 ${d.dp[5]}, sub-dealers ${d.rsar ? d.rsar[5] : 0}`);
  }
  for (const b of bad) console.log(`       ${b}`);
  assert.equal(bad.length, 0, `${bad.length} dealer(s) carry the wrong sales`);
});

await okA('the 6-month average is the dealer\'s own, not the sub-dealer roll-up', () => {
  const bad = [];
  for (const d of D) {
    const r = got.get(d.sap);
    const ownAvg = d.dp.reduce((a, b) => a + b, 0) / 6;
    if (Math.abs((+r.dp_six_month_avg || 0) - ownAvg) > 0.01)
      bad.push(`${d.sap}: dp_six_month_avg ${r.dp_six_month_avg} vs own ${ownAvg.toFixed(2)}`);
  }
  for (const b of bad) console.log(`       ${b}`);
  assert.equal(bad.length, 0);
});

await okA('RSAR is still recorded alongside — separated, not discarded', () => {
  const withSub = D.filter(d => d.rsar);
  let carried = 0;
  for (const d of withSub) {
    const r = got.get(d.sap);
    const subAvg = d.rsar.reduce((a, b) => a + b, 0) / 6;
    if (Math.abs((+r.rsar_six_month_avg || 0) - subAvg) < 0.01) carried++;
  }
  note('  dealers with sub-dealers', withSub.length);
  note('  ...whose RSAR roll-up is stored correctly', carried);
  assert.equal(carried, withSub.length, 'RSAR was dropped rather than kept separate');
});

await okA('a dealer with NO sub-dealers still gets a full classification', () => {
  const r = got.get('1000002102');   // PIONEER — healthy, zero sub-dealers
  note('  PIONEER CEMENT STORE', `${r.dealer_status}, own 6M avg ${r.dp_six_month_avg}, RSAR ${r.rsar_six_month_avg}`);
  assert.equal(r.dealer_status, 'Growing');
  assert.equal(+r.rsar_six_month_avg, 0);
});

await okA('counter share uses the dealer\'s own sales', () => {
  const r = got.get('1000002104');   // EASTERN — small dealer, very large sub-dealers
  const own = 900 / 6500;
  note('  EASTERN BUILD MART share', `${(+r.counter_share).toFixed(4)} (own ${own.toFixed(4)}, sub-dealer-inflated would be ${(2000/6500).toFixed(4)})`);
  assert.ok(Math.abs(+r.counter_share - own) < 0.001);
});

// ─────────────────────────────────────────────────────────────────────────────
S('the DOA tiers still hold');

await okA('the brand-new dealer is Growing and gets visits, not Churn with none', () => {
  const r = got.get('1000002105');
  const v = (+r.so_visits||0)+(+r.asm_visits||0)+(+r.rsm_visits||0)+(+r.zh_visits||0);
  note('  NEWLEAF HARDWARE (11 days old)', `${r.dealer_status}, ${v} visit(s)`);
  assert.equal(r.dealer_status, 'Growing');
  assert.ok(v > 0, 'a brand-new dealer received no visits');
});

await okA('no dealer younger than 180 days is Churn', () => {
  const young = rows.filter(r => {
    if (r.dealer_status !== 'Churn' || !r.doa) return false;
    return (anchor - new Date(`${String(r.doa).slice(0,10)}T00:00:00Z`)) / DAY <= 180;
  });
  assert.equal(young.length, 0, young.map(y => `${y.sap_code} ${y.doa}`).join(', '));
});

await okA('every non-Churn dealer receives at least one visit', () => {
  const silent = rows.filter(r => r.dealer_status !== 'Churn' &&
    (+r.so_visits||0)+(+r.asm_visits||0)+(+r.rsm_visits||0)+(+r.zh_visits||0) === 0);
  note('  non-Churn dealers with no visits', silent.length);
  assert.equal(silent.length, 0, silent.map(s => `${s.sap_code} ${s.dealer_status}`).join(', '));
});

const dist = {};
for (const r of rows) dist[r.dealer_status] = (dist[r.dealer_status] || 0) + 1;
note('Final Category distribution', JSON.stringify(dist));

// Expected-results file for the demo pack.
const expRows = D.map(d => {
  const e = expectedCategory(d);
  const r = got.get(d.sap);
  return {
    sap: d.sap, name: d.name, area: d.area, doa: d.doa, tier: e.tier,
    potential: d.pot,
    own_jun26: d.dp[5], own_may26: d.dp[4], own_jun25: d.lys,
    own_6m_avg: +(d.dp.reduce((a, b) => a + b, 0) / 6).toFixed(2),
    subdealer_jun26: d.rsar ? d.rsar[5] : 0,
    subdealer_6m_avg: d.rsar ? +(d.rsar.reduce((a, b) => a + b, 0) / 6).toFixed(2) : 0,
    need_to_grow: e.AK ? 'Yes' : 'No',
    expected_category: e.cat,
    if_rsar_were_used: categoryIfRsarWereUsed(d),
    engine_gave: r ? r.dealer_status : '(none)',
    match: r && String(r.dealer_status).trim() === e.cat ? 'MATCH' : 'MISMATCH',
    grade: r ? r.category : null,
    visits_so: r ? r.so_visits : null,
    note: d.trap
  };
});
writeFileSync(join(here, '..', '..', 'kit-v2', 'expected.json'), JSON.stringify(expRows, null, 1));

console.log('\n' + '─'.repeat(76));
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
