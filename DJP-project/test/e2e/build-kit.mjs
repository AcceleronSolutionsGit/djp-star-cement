/**
 * Build the DEMO TEST KIT v2.
 *
 * The v1 kit was cross-source consistent on purpose — RSAR roll-up equalled the Dealer
 * Performance monthly series — which made it useless for proving WHICH source the
 * engine reads. This kit makes them diverge deliberately.
 *
 *   Dealer Performance  →  the DEALER's own sales.      Drives everything.
 *   RSAR                →  the SUB-DEALERS beneath it.  Reported, never classifies.
 *
 * Four trap dealers make the difference visible. Read them straight off the sheet:
 * if the engine ever goes back to classifying on RSAR, each one flips to the wrong
 * category and the expected-results file will say so.
 *
 * Also carried over from v1: full DOA tier coverage (brand-new / new / mid / old /
 * blank), need-to-grow cases, and prospects.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const OUT  = join(here, '..', '..', 'kit-v2');
mkdirSync(OUT, { recursive: true });

// Planning month 2026-07 → anchor 2026-07-01.
//   O = Jun-26   R = May-26   Q = Jun-25   S = mean(Jan-26 … Jun-26)
const PLAN = '2026-07';
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];

const ZONE = 'NB1';
const HIER = {
  ALIPURDUAR: { so: ['DEBABRATA CHAKRABORTY- FKT', '11001774'], asm: ['DEBABRATA GHOSH', '11001393'],
                rsm: ['RITWICK CHATTERJEE', '11001813'],       zh:  ['GIRIDHARI MUKHERJEE', '11002257'] },
  JALPAIGURI: { so: ['ARINDAM PAUL', '11001975'],              asm: ['DEBABRATA GHOSH', '11001393'],
                rsm: ['RITWICK CHATTERJEE', '11001813'],       zh:  ['GIRIDHARI MUKHERJEE', '11002257'] },
  KATIHAR:    { so: ['SUBHASISH KARMAKAR', '11002168'],        asm: ['SANTANU BAZAL', '11002336'],
                rsm: ['PRAKRITI RANJAN SIKDAR', '1101157'],    zh:  ['GIRIDHARI MUKHERJEE', '11002257'] }
};

/**
 * dp  = the dealer's OWN monthly sales, Jan-26 … Jun-26
 * rsar= what the SUB-DEALERS beneath it sold, same months (or null = no sub-dealers)
 * lys = Jun-25, the dealer's own
 */
const D = [
  // ── THE FOUR TRAPS ───────────────────────────────────────────────────────────
  {
    sap: '1000002101', sfa: 'WBT201', name: 'SUNRISE TRADERS', area: 'ALIPURDUAR', block: 'MADARIHAT',
    doa: '12-Mar-19', pot: 9000,
    dp:  [0, 0, 0, 0, 0, 0], lys: 0, rsar: [800, 820, 840, 860, 880, 900],
    trap: 'TRAP 1 — busy sub-dealers, dealer sells NOTHING itself. DP S=0 → Churn. ' +
          'On RSAR it would read Growing and keep its visits.'
  },
  {
    sap: '1000002102', sfa: 'WBT202', name: 'PIONEER CEMENT STORE', area: 'ALIPURDUAR', block: 'ALIPURDUAR-I',
    doa: '08-Jul-17', pot: 7000,
    dp:  [900, 950, 1000, 1050, 1100, 1200], lys: 1000, rsar: null,
    trap: 'TRAP 2 — healthy dealer with NO sub-dealers at all. DP → Growing. ' +
          'On RSAR it would find nothing and read Churn, losing every visit.'
  },
  {
    sap: '1000002103', sfa: 'WBT203', name: 'NORTHGATE SUPPLIERS', area: 'JALPAIGURI', block: 'RAJGANJ',
    doa: '22-Nov-16', pot: 8000,
    dp:  [1400, 1350, 1300, 1250, 1200, 1100], lys: 1500, rsar: [100, 150, 200, 300, 500, 900],
    trap: 'TRAP 3 — dealer sliding, sub-dealers climbing. DP O(1100) < Q(1500) → De-growing. ' +
          'On RSAR the rising trend would read Growing.'
  },
  {
    sap: '1000002104', sfa: 'WBT204', name: 'EASTERN BUILD MART', area: 'JALPAIGURI', block: 'MAYNAGURI',
    doa: '05-Feb-14', pot: 6500,
    dp:  [600, 650, 700, 750, 800, 900], lys: 700, rsar: [2000, 2000, 2000, 2000, 2000, 2000],
    trap: 'TRAP 4 — modest dealer, very large sub-dealers. DP O(900) >= Q(700) → Growing, ' +
          'and counter share stays low. On RSAR the share would swamp need-to-grow.'
  },

  // ── DOA TIER COVERAGE ────────────────────────────────────────────────────────
  {
    sap: '1000002105', sfa: 'WBT205', name: 'NEWLEAF HARDWARE', area: 'ALIPURDUAR', block: 'KALCHINI',
    doa: '20-Jun-26', pot: 5000, dp: [0, 0, 0, 0, 0, 0], lys: 0, rsar: null,
    trap: 'BRAND-NEW — appointed 11 days before the anchor. Forced Growing despite zero sales. ' +
          'Without the DOA tiers this was Churn and got ZERO visits.'
  },
  {
    sap: '1000002106', sfa: 'WBT206', name: 'RIVERSIDE CEMENT', area: 'KATIHAR', block: 'KATIHAR',
    doa: '03-Mar-26', pot: 4200, dp: [0, 0, 0, 0, 0, 0], lys: 0, rsar: null,
    trap: 'NEW TIER — 120 days old, no sales. The New tier has no Churn branch → Zero Lifter.'
  },
  {
    sap: '1000002107', sfa: 'WBT207', name: 'GANGA TRADING CO', area: 'KATIHAR', block: 'BARSOI',
    doa: '14-Apr-26', pot: 3800, dp: [0, 0, 0, 0, 200, 150], lys: 0, rsar: null,
    trap: 'NEW TIER — R(200) > O(150) → De-growing.'
  },
  {
    sap: '1000002108', sfa: 'WBT208', name: 'SHIVAM ENTERPRISE', area: 'KATIHAR', block: 'KATIHAR',
    doa: '18-Sep-25', pot: 4500, dp: [300, 320, 340, 360, 380, 500], lys: 400, rsar: [50, 50, 50, 50, 50, 50],
    trap: 'MID TIER — S(366.67) <= O(500) → Growing.'
  },
  {
    sap: '1000002109', sfa: 'WBT209', name: 'MAA TARA HARDWARE', area: 'JALPAIGURI', block: 'RAJGANJ',
    doa: '02-Oct-25', pot: 5200, dp: [900, 880, 860, 840, 820, 400], lys: 950, rsar: null,
    trap: 'MID TIER — S(783.33) > O(400) → De-growing.'
  },
  {
    sap: '1000002110', sfa: 'WBT210', name: 'HERITAGE CEMENT AGENCY', area: 'ALIPURDUAR', block: 'MADARIHAT',
    doa: '30-Jan-12', pot: 11000, dp: [1500, 1500, 1500, 1500, 1500, 1800], lys: 1600, rsar: [200, 200, 200, 200, 200, 200],
    trap: 'OLD TIER — O(1800) >= Q(1600) → Growing.'
  },
  {
    sap: '1000002111', sfa: 'WBT211', name: 'BALAJI TRADERS', area: 'JALPAIGURI', block: 'MAYNAGURI',
    doa: '11-Jun-09', pot: 9500, dp: [1200, 1180, 1160, 1140, 1120, 900], lys: 1400, rsar: null,
    trap: 'OLD TIER — O(900) < Q(1400) → De-growing.'
  },
  {
    sap: '1000002112', sfa: 'WBT212', name: 'DURGA CEMENT DEPOT', area: 'KATIHAR', block: 'BARSOI',
    doa: '', pot: 3000, dp: [0, 0, 0, 0, 0, 0], lys: 0, rsar: null,
    trap: 'BLANK DOA — Excel reads blank as 0, so it falls into the Old tier. S=0 → Churn.'
  },
  {
    sap: '1000002113', sfa: 'WBT213', name: 'LAXMI HARDWARE STORES', area: 'ALIPURDUAR', block: 'KALCHINI',
    doa: '07-May-20', pot: 8800, dp: [0, 0, 0, 0, 0, 0], lys: 1200, rsar: null,
    trap: 'OLD TIER — S=0 but Q=1200 → still Churn. Churn is S=0 alone, not CM+PM+6M.'
  },
  {
    sap: '1000002114', sfa: 'WBT214', name: 'ANNAPURNA BUILDERS', area: 'KATIHAR', block: 'KATIHAR',
    doa: '25-Jan-21', pot: 7400, dp: [400, 400, 400, 400, 400, 0], lys: 500, rsar: null,
    trap: 'OLD TIER — O=0 but S=333.33 → Zero Lifter, not Churn.'
  },

  // ── NEED-TO-GROW (AK) — biggest potential in its area, tiny counter share ────
  {
    sap: '1000002115', sfa: 'WBT215', name: 'METRO CEMENT HUB', area: 'SILIGURI', block: 'MATIGARA',
    doa: '09-Aug-18', pot: 40000, dp: [500, 500, 500, 500, 500, 600], lys: 400, rsar: null,
    trap: 'NEED TO GROW — dominates area potential, share 1.5%. AK beats O>=Q, so NOT Growing.'
  },
  {
    sap: '1000002116', sfa: 'WBT216', name: 'SILIGURI TRADE LINKS', area: 'SILIGURI', block: 'MATIGARA',
    doa: '17-Dec-25', pot: 1200, dp: [300, 300, 300, 300, 300, 350], lys: 250, rsar: null,
    trap: 'Small neighbour of the NTG dealer — share 29%, so AK is No. Mid tier → Growing.'
  },
  {
    sap: '1000002117', sfa: 'WBT217', name: 'TEESTA HARDWARE', area: 'SILIGURI', block: 'MATIGARA',
    doa: '21-Mar-26', pot: 900, dp: [0, 0, 100, 120, 140, 160], lys: 0, rsar: null,
    trap: 'New tier, share 17.8% — but AK needs BOTH high area potential and low share. ' +
          'Its area percentile is low, so AK is No → R(140) <= O(160) → Growing.'
  },
  {
    sap: '1000002118', sfa: 'WBT218', name: 'BORDER CEMENT MART', area: 'ALIPURDUAR', block: 'ALIPURDUAR-I',
    doa: '13-Feb-23', pot: 10500, dp: [700, 700, 700, 700, 700, 700], lys: 700, rsar: [300, 300, 300, 300, 300, 300],
    trap: 'EQUALITY BOUNDARY — O(700) == Q(700). Inclusive, so Growing, never Need to Grow.'
  }
];

const PROSPECTS = [
  ['MAA DURGA HARDWARE',   'NSRE19295', 'DAKSHIN DINAJPUR', 'BALURGHAT', 'DIPANKAR MAHATO',  '11002401', 100, 50],
  ['MANORAMA BUILDERS',    'WBJ055',    'DARJEELING PLAINS','RAJGANJ',   'TAPAS PAL',        '11002402', 350, 100],
  ['NEW LOCKNATH BUILDERS','WBJ061',    'DARJEELING PLAINS','MATIGARA',  'TAPAS PAL',        '11002402', 500, 180],
  ['SOURABH ENTERPRISES',  'WBA112',    'ALIPURDUAR',       'KALCHINI',  'DEBABRATA CHAKRABORTY- FKT', '11001774', 620, 240],
  ['GANESH ENTERPRIESES',  'WBA118',    'ALIPURDUAR',       'MADARIHAT', 'DEBABRATA CHAKRABORTY- FKT', '11001774', 300, 90],
  ['PAUL ENTERPRISE',      'WBJ077',    'JALPAIGURI',       'MAYNAGURI', 'ARINDAM PAUL',     '11001975', 450, 150]
];

// ── writers ───────────────────────────────────────────────────────────────────
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const label = (ym) => `${MON[+ym.slice(5, 7) - 1]}-${ym.slice(2, 4)}`;
const hier = a => HIER[a] || HIER.ALIPURDUAR;
const csv = rows => rows.map(r => r.map(c => {
  const s = c === null || c === undefined ? '' : String(c);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}).join(',')).join('\n') + '\n';

// 1 — Dealer Mapping
const mapping = [[
  'SAP Code','SFA Code','Dealer Name','Cust Type','Area','Zone','Block',
  'SO Name','SO Emp Code','ASM Name','ASM Code','RSM Name','RSM Code','ZH Name','ZH Code',
  'Counter Potential','DOA'
]];
for (const d of D) {
  const h = hier(d.area);
  mapping.push([d.sap, d.sfa, d.name, 'STAR', d.area, ZONE, d.block,
    h.so[0], h.so[1], h.asm[0], h.asm[1], h.rsm[0], h.rsm[1], h.zh[0], h.zh[1], d.pot, d.doa]);
}
writeFileSync(join(OUT, 'TEST_01_Dealer_Mapping.csv'), csv(mapping));

// 2 — Dealer Performance (DLRWISE). Duplicate Jun columns kept on purpose: the real
// export has them, and the importer must keep de-duplicating by max.
const perf = [[
  'SAP','CODE','DEALERS NAME','AREA','REGION','DOA','Targeted Dealer','EXCLUSIVE DEALER',
  "Jun'26 Tgt",'Prorata Tgt',"Jun'26 SALE","May'26 DEALER",'Jun-25 SALE',
  ...MONTHS.map(label), 'Last 6 Months Avg Sales'
]];
for (const d of D) {
  const avg6 = d.dp.reduce((a, b) => a + b, 0) / 6;
  perf.push([d.sap, d.sfa, d.name, d.area, ZONE, d.doa, 'Targeted Dealer', '-',
    Math.round(d.dp[5] * 1.1), Math.round(d.dp[5] * 1.1), d.dp[5], 'Jun', d.lys,
    ...d.dp, Math.round(avg6 * 100) / 100]);
}
writeFileSync(join(OUT, 'TEST_02_Dealer_Performance.csv'), csv(perf));

// 3 — SBG
const sbg = [[
  'Customer Code','Dealer Name','Territory Code','Territory Name','Block (Taluka)',
  'Counter Potential Average (MT)','Zone','SO Code','SO Name','ASM Code','ASM Name',
  'RSM Code','RSM Name','ZH Code','ZH Name','Status in SAP','Dealer Start Date'
]];
for (const d of D) {
  const h = hier(d.area);
  sbg.push([d.sap, d.name, `TR-${d.area.slice(0, 3).toUpperCase()}`, d.area, d.block, d.pot, ZONE,
    h.so[1], h.so[0], h.asm[1], h.asm[0], h.rsm[1], h.rsm[0], h.zh[1], h.zh[0], 'ACTIVE', d.doa]);
}
writeFileSync(join(OUT, 'TEST_03_SBG_Master.csv'), csv(sbg));

// 4 — RSAR: SUB-DEALERS ONLY. Their own codes, linked back to the dealer.
const rsar = [['SAP Code','Sub Dealer Name','LinkedDealerCode','Linked Dealer Name','Zone', ...MONTHS.map(label)]];
for (const d of D) {
  if (!d.rsar) continue;                       // no sub-dealers beneath this dealer
  const half = d.rsar.map(v => Math.round(v * 0.6));
  const rest = d.rsar.map((v, i) => v - half[i]);
  rsar.push([`15${d.sap.slice(2)}A`, `RSSD ${d.name} A`, d.sap, d.name, ZONE, ...half]);
  rsar.push([`15${d.sap.slice(2)}B`, `RSSD ${d.name} B`, d.sap, d.name, ZONE, ...rest]);
}
writeFileSync(join(OUT, 'TEST_04_Sales_History_RSAR.csv'), csv(rsar));

// 5 — Prospects
const pros = [['Prospective Dealer Name','SFA Code','Zone','Area','Taluka','Name of SO','SO Emp Code','Potential','Expected Sale','Status']];
for (const p of PROSPECTS) pros.push([p[0], p[1], ZONE, p[2], p[3], p[4], p[5], p[6], p[7], 'PROSPECTIVE']);
writeFileSync(join(OUT, 'TEST_05_Prospect_Dealers.csv'), csv(pros));

// 6 — SFA feedback for the 15th. Deliberately partial: two officers report, and one
// dealer is visited twice, so capped-vs-uncapped adherence differ.
const sfa = [['SI','Date of Visit','Customer Code','Customer Name','Route','Type','Branch',
  'Employee Code','Employee Name','Check In Time','Check Out Time','Duration',
  'Visit Status(Productive / Non productive)','Remarks','Purpose Of Visit']];
const VISITS = [
  ['2026-07-02', '1000002102', 'PIONEER CEMENT STORE', '11001774', 'DEBABRATA CHAKRABORTY- FKT', 'Productive'],
  ['2026-07-03', '1000002110', 'HERITAGE CEMENT AGENCY', '11001774', 'DEBABRATA CHAKRABORTY- FKT', 'Productive'],
  ['2026-07-06', '1000002110', 'HERITAGE CEMENT AGENCY', '11001774', 'DEBABRATA CHAKRABORTY- FKT', 'Productive'],
  ['2026-07-07', '1000002118', 'BORDER CEMENT MART', '11001774', 'DEBABRATA CHAKRABORTY- FKT', 'Non productive'],
  ['2026-07-08', 'WBT205',     'NEWLEAF HARDWARE', '11001774', 'DEBABRATA CHAKRABORTY- FKT', 'Productive'],
  ['2026-07-09', '1000002103', 'NORTHGATE SUPPLIERS', '11001975', 'ARINDAM PAUL', 'Productive'],
  ['2026-07-10', '1000002104', 'EASTERN BUILD MART', '11001975', 'ARINDAM PAUL', 'Productive'],
  ['2026-07-13', '1000002109', 'MAA TARA HARDWARE', '11001975', 'ARINDAM PAUL', 'Productive'],
  ['2026-07-14', '1000002111', 'BALAJI TRADERS', '11001975', 'ARINDAM PAUL', 'Productive']
];
VISITS.forEach((v, i) => sfa.push([i + 1, v[0], v[1], v[2], 'ROUTE', 'Dealer', v[1].startsWith('1') ? 'ALIPURDUAR' : 'JALPAIGURI',
  v[3], v[4], '10:05:00', '11:10:00', '31 Minute(s)', v[5], 'None', 'Routine Visit,,']));
writeFileSync(join(OUT, 'TEST_06_SFA_Report.csv'), csv(sfa));

// machine-readable copy for the harness
writeFileSync(join(OUT, 'kit.json'), JSON.stringify({ plan: PLAN, months: MONTHS, dealers: D, prospects: PROSPECTS, visits: VISITS }, null, 1));

console.log(`Kit v2 written to ${OUT}`);
console.log(`  dealers ${D.length}  ·  prospects ${PROSPECTS.length}  ·  SFA visits ${VISITS.length}`);
console.log(`  dealers WITH sub-dealers (RSAR rows): ${D.filter(d => d.rsar).length}`);
console.log(`  dealers WITHOUT any sub-dealers:      ${D.filter(d => !d.rsar).length}`);
