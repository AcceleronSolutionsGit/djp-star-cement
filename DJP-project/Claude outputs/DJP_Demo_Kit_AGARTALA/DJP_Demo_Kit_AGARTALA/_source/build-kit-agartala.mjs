/**
 * DEMO KIT — AGARTALA, built from the client's own data.
 *
 * Centred on three dealers the client named:
 *   1000000013  BANKA BEHARI PAUL    → De-growing
 *   1000000021  AJOY BHATTACHARJEE   → Growing
 *   1000000022  ANJAN DEBNATH        → Growing
 *
 * Every dealer in their area (AGARTALA, zone NE2) is included, because area potential,
 * volume, rank, percentile, grade and the need-to-grow flag are all computed across the
 * whole area — a kit holding only three dealers would compute different ones.
 *
 * Planning month is 2026-06, which is the anchor M.xlsx itself uses (B2 = 46174 =
 * 2026-06-01), so every expected value can be read straight off the client master:
 *   O = May'26   R = Apr'26   Q = May'25   S = Dec'25 … May'26 average
 *
 * WHAT IS REAL AND WHAT IS NOT
 *   Real, taken from M.xlsx: SAP and SFA codes, dealer names, zone, area, block,
 *   ZH / RSM / ASM, counter potential, DOA, and the O / R / Q / S sales figures.
 *   Synthesised: the SO layer (M.xlsx leaves column I blank for all 387 AGARTALA
 *   rows, and the approval workflow needs one), the monthly Dealer Performance series
 *   (built to reproduce O, R and S exactly), prospects, and the SFA visit log.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT  = join(here, '..', '..', 'kit-agartala');
mkdirSync(OUT, { recursive: true });

const AG   = JSON.parse(readFileSync('/home/claude/agartala.json', 'utf8'));
const SRC  = JSON.parse(readFileSync('/home/claude/agartala_src.json', 'utf8'));

const PLAN   = '2026-06';                 // anchor 2026-06-01 — same as M.xlsx B2
const MONTHS = ['2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05'];
const LYSM   = '2025-05';                 // Q — same month, previous year
const NAMED  = ['1000000013', '1000000021', '1000000022'];

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const code = c => { const n = num(c.L); return n ? String(Math.round(n)) : String(c.L ?? '').trim(); };

/** Excel serial → YYYY-MM-DD */
function serialToDate(serial) {
  const n = num(serial);
  if (!n) return null;
  const ms = Date.UTC(1899, 11, 30) + n * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
/** 'YYYY-MM-DD' → '31-Jan-05', the shape the client's files use */
function dmy(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return `${String(d).padStart(2, '0')}-${MON[m - 1]}-${String(y).slice(2)}`;
}
const tag = ym => `${MON[+ym.slice(5, 7) - 1]}-${ym.slice(2, 4)}`;

// ── the dealers, and the sub-dealers beneath them ────────────────────────────
const dealers = AG.filter(c => c.A === 'DEALER').map(c => ({
  sap:   code(c),
  sfa:   String(c.K ?? '').trim(),
  name:  String(c.M ?? '').trim(),
  zone:  String(c.C ?? '').trim(),
  area:  String(c.G ?? '').trim(),
  block: String(c.J ?? '').trim(),
  zh:    String(c.D ?? '').trim(),
  rsm:   String(c.E ?? '').trim(),
  asm:   String(c.F ?? '').trim(),
  potential: num(c.N),
  O: num(c.O), R: num(c.R), Q: num(c.Q), S: num(c.S),
  doa: serialToDate(c.T),
  // the client master's own answers, carried through for the expected-results sheet
  m_category: String(c.U ?? '').trim(),
  m_grade:    String(c.AG ?? '').trim(),
  m_share:    num(c.P),
  m_ntg:      String(c.AK ?? '').trim(),
  m_area_potential: num(c.AL), m_area_pot_rank: num(c.AM), m_area_pot_pct: num(c.AN),
  m_area_volume:    num(c.AH), m_area_vol_rank: num(c.AI), m_area_vol_pct: num(c.AJ),
  m_final_volume:   num(c.AF)
}));

const subDealers = (SRC.rsar || []).filter(r => dealers.some(d => d.sap === r.parent));

// ── the SO layer M.xlsx does not carry ───────────────────────────────────────
// Blocks are grouped into four territories so the approval chain has something to
// run through. SO → ASM → RSM → ZH; the upper three are the real ones.
const SO_BY_BLOCK = {};
{
  const blocks = [...new Set(dealers.map(d => d.block).filter(Boolean))].sort();
  const officers = [
    ['SUBRATA DEB',        '11003101'],
    ['PARTHA SARKAR',      '11003102'],
    ['RAJIB CHAKRABORTY',  '11003103'],
    ['MANAS BHOWMIK',      '11003104']
  ];
  blocks.forEach((b, i) => { SO_BY_BLOCK[b] = officers[i % officers.length]; });
}
const soOf = d => SO_BY_BLOCK[d.block] || ['SUBRATA DEB', '11003101'];

const ASM_CODE = '11003201', RSM_CODE = '11003301', ZH_CODE = '11003401';

/**
 * A six-month series whose mean is S, whose last month is O and second-last is R.
 * The four earlier months carry the remainder equally.
 *
 * Where 6·S is less than O + R the remainder would be negative, which no non-negative
 * series can produce — M.xlsx sources S separately ("GET DATA FROM SOUMADEEP"), so it
 * need not be the mean of these columns. Those rows are scaled instead, and flagged.
 */
function monthlySeries(d) {
  const remainder = 6 * d.S - d.O - d.R;
  if (remainder >= 0) {
    const each = remainder / 4;
    return { series: [each, each, each, each, d.R, d.O], exact: true };
  }
  // 6·S < O + R, so no non-negative series can average to S while keeping both.
  // O and R are kept exact — they decide the category in every tier — and the four
  // earlier months go to zero, which makes S larger than the master's. S only changes
  // an outcome when it is zero (Churn) or in the Mid tier, and a larger S is never
  // zero, so the classification is unaffected. Flagged rather than silently scaled:
  // scaling was the earlier approach and it corrupted O, which does decide categories.
  return { series: [0, 0, 0, 0, d.R, d.O], exact: false };
}

const csv = rows => rows.map(r => r.map(c => {
  const s = c === null || c === undefined ? '' : String(c);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n') + '\n';

const r2 = v => Math.round(v * 100) / 100;

// ── 1. Dealer Mapping ────────────────────────────────────────────────────────
const mapping = [[
  'SAP Code','SFA Code','Dealer Name','Cust Type','Area','Zone','Block',
  'SO Name','SO Emp Code','ASM Name','ASM Code','RSM Name','RSM Code','ZH Name','ZH Code',
  'Counter Potential','DOA'
]];
for (const d of dealers) {
  const [soName, soCode] = soOf(d);
  mapping.push([d.sap, d.sfa, d.name, 'STAR', d.area, d.zone, d.block,
    soName, soCode, d.asm, ASM_CODE, d.rsm, RSM_CODE, d.zh, ZH_CODE,
    r2(d.potential), dmy(d.doa)]);
}
writeFileSync(join(OUT, 'TEST_01_Dealer_Mapping.csv'), csv(mapping));

// ── 2. Dealer Performance — the DEALER's own sales ───────────────────────────
const perf = [[
  'SAP','CODE','DEALERS NAME','AREA','REGION','DOA','Targeted Dealer','EXCLUSIVE DEALER',
  "May'26 Tgt",'Prorata Tgt',"May'26 SALE","Apr'26 DEALER",'May-25 SALE',
  ...MONTHS.map(tag), 'Last 6 Months Avg Sales'
]];
let inexact = 0;
for (const d of dealers) {
  const { series, exact } = monthlySeries(d);
  if (!exact) inexact++;
  perf.push([d.sap, d.sfa, d.name, d.area, d.zone, dmy(d.doa), 'Targeted Dealer', '-',
    r2(d.O * 1.1), r2(d.O * 1.1), r2(d.O), 'Apr', r2(d.Q),
    ...series.map(r2), r2(d.S)]);
}
writeFileSync(join(OUT, 'TEST_02_Dealer_Performance.csv'), csv(perf));

// ── 3. SBG — authoritative potential and block ───────────────────────────────
const sbg = [[
  'Customer Code','Dealer Name','Territory Code','Territory Name','Block (Taluka)',
  'Counter Potential Average (MT)','Zone','SO Code','SO Name','ASM Code','ASM Name',
  'RSM Code','RSM Name','ZH Code','ZH Name','Status in SAP','Dealer Start Date'
]];
for (const d of dealers) {
  const [soName, soCode] = soOf(d);
  sbg.push([d.sap, d.name, 'TR-AGT', d.area, d.block, r2(d.potential), d.zone,
    soCode, soName, ASM_CODE, d.asm, RSM_CODE, d.rsm, ZH_CODE, d.zh,
    'ACTIVE', dmy(d.doa)]);
}
writeFileSync(join(OUT, 'TEST_03_SBG_Master.csv'), csv(sbg));

// ── 4. RSAR — SUB-DEALER sales, linked to their parent dealer ────────────────
const rsar = [['SAP Code','RSSD Code','Sub Dealer Name','LinkedDealerCode','Linked Dealer Name','Zone',
               ...MONTHS.map(tag)]];
for (const s of subDealers) {
  rsar.push([s.sap, s.rssd, s.name, s.parent, s.parent_name, s.zone || 'NE2',
    ...MONTHS.map(m => r2(num(s.sales?.[m])))]);
}
writeFileSync(join(OUT, 'TEST_04_Sales_History_RSAR.csv'), csv(rsar));

// ── 5. Prospects ─────────────────────────────────────────────────────────────
const pros = [['Prospective Dealer Name','SFA Code','Zone','Area','Taluka','Name of SO','SO Emp Code','Potential','Expected Sale','Status']];
const PROSPECTS = [
  ['TRIPURA BUILD CENTRE', 'NSNE90001', 'AMC (SADAR)', 900, 300],
  ['NEW AGARTALA TRADERS', 'NSNE90002', 'DUKLI',       640, 210],
  ['MATABARI HARDWARE',    'NSNE90003', 'TELIAMURA',   420, 120]
];
for (const [name, sfa, block, pot, exp] of PROSPECTS) {
  const [soName, soCode] = SO_BY_BLOCK[block] || ['SUBRATA DEB', '11003101'];
  pros.push([name, sfa, 'NE2', 'AGARTALA', block, soName, soCode, pot, exp, 'PROSPECTIVE']);
}
writeFileSync(join(OUT, 'TEST_05_Prospect_Dealers.csv'), csv(pros));

// ── 6. SFA feedback for the 15th — deliberately partial ──────────────────────
// Two of the three named dealers are visited, the third is not, so the C2 regeneration
// has something real to move. ANJAN DEBNATH is visited twice, so capped and uncapped
// adherence differ.
const named = NAMED.map(c => dealers.find(d => d.sap === c)).filter(Boolean);
const sfa = [['SI','Date of Visit','Customer Code','Customer Name','Route','Type','Branch',
  'Employee Code','Employee Name','Check In Time','Check Out Time','Duration',
  'Visit Status(Productive / Non productive)','Remarks','Purpose Of Visit']];
const VISITS = [];
{
  const [n13, n21, n22] = named;
  const so = d => soOf(d);
  if (n13) VISITS.push(['2026-06-03', n13.sap, n13.name, ...so(n13), 'Productive']);
  if (n22) VISITS.push(['2026-06-04', n22.sap, n22.name, ...so(n22), 'Productive']);
  if (n22) VISITS.push(['2026-06-09', n22.sap, n22.name, ...so(n22), 'Productive']);  // twice
  // n21 (AJOY BHATTACHARJEE) deliberately NOT visited — it should lead the new C2.
  // A handful of other AGARTALA dealers, so adherence is not only about the named three.
  for (const d of dealers.filter(d => !NAMED.includes(d.sap)).slice(0, 6)) {
    VISITS.push([`2026-06-${String(2 + (VISITS.length % 11)).padStart(2, '0')}`, d.sap, d.name, ...so(d),
                 VISITS.length % 5 === 0 ? 'Non productive' : 'Productive']);
  }
}
VISITS.forEach((v, i) => sfa.push([i + 1, v[0], v[1], v[2], 'AGARTALA-RT', 'Dealer', 'AGARTALA',
  v[4], v[3], '10:05:00', '11:12:00', '34 Minute(s)', v[5], 'None', 'Routine Visit,,']));
writeFileSync(join(OUT, 'TEST_06_SFA_Report.csv'), csv(sfa));

// ── machine-readable copy for the harness and the expected-results sheet ─────
writeFileSync(join(OUT, 'kit.json'), JSON.stringify({
  plan: PLAN, months: MONTHS, lysm: LYSM, named: NAMED,
  soByBlock: SO_BY_BLOCK, asmCode: ASM_CODE, rsmCode: RSM_CODE, zhCode: ZH_CODE,
  dealers: dealers.map(d => ({ ...d, series: monthlySeries(d).series.map(r2), seriesExact: monthlySeries(d).exact })),
  subDealers: subDealers.map(s => ({ sap: s.sap, rssd: s.rssd, name: s.name, parent: s.parent,
    sales: Object.fromEntries(MONTHS.map(m => [m, r2(num(s.sales?.[m]))])) })),
  prospects: PROSPECTS, visits: VISITS
}, null, 1));

console.log(`Kit written to ${OUT}`);
console.log(`  planning month ......... ${PLAN}  (anchor ${PLAN}-01, same as M.xlsx B2)`);
console.log(`  dealers ................ ${dealers.length}  (all of AGARTALA)`);
console.log(`  sub-dealers in RSAR .... ${subDealers.length}`);
console.log(`  prospects .............. ${PROSPECTS.length}`);
console.log(`  SFA visits ............. ${VISITS.length}`);
console.log(`  series reproducing S exactly: ${dealers.length - inexact}/${dealers.length}`);
console.log(`  the three named dealers:`);
for (const d of named)
  console.log(`    ${d.sap}  ${d.name.padEnd(22)} ${d.m_category.padEnd(13)} grade ${d.m_grade}  ` +
              `N=${d.potential} O=${d.O} R=${d.R} Q=${d.Q} S=${r2(d.S)} DOA ${d.doa}`);
