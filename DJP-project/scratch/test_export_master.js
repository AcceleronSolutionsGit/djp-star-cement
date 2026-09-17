import XLSX from 'xlsx';
import { dbAll } from '../src/config/database.js';

async function testExport() {
  const targetPeriod = '2026-06';
  const targetCycle = 'C1';

  let targets = await dbAll(`
    SELECT *
    FROM dealer_visit_targets
    WHERE period_month = ? AND cycle_code = ?
    ORDER BY sap_code ASC, id ASC
  `, [targetPeriod, targetCycle]);

  const uniqueTargetsMap = new Map();
  for (const t of targets) {
    const code = t.sap_code || t.sfa_code;
    if (code) uniqueTargetsMap.set(code, t);
  }
  const uniqueTargets = [...uniqueTargetsMap.values()];

  const MASTER_HEADERS = [
    'Cust Type', 'Sl.No.', 'Zone', 'ZONAL HEAD', 'RSM', 'ASM', 'AREA', 'Area Strategy', 'SO/SE  NAME', 'Block (Taluka)',
    'SFA CODE', 'Customer code', 'DEALER NAME', 'DLR COUNTER POTENTIAL ', 'Current Month Sales', 'Counter Share%', 'LYSM Sales', 'Previous Month Sales',
    'Last 6 months avg sales', 'DOA', 'Final Category', 'Rank based on counter potential (SO wise)',
    'A. Score based on counter potential (SO wise)\n(Out of 40)',
    'B. Score based on the category\n(Out of 40)',
    'C. Score based on the counter share (Out of 20)',
    'Total Score\n(A+B+C) \n(out of 100)',
    'Rank based on Total score\n(SO wise)',
    'Number of Visits by SO/SR (Based on Percentile)',
    'Number of visits by ASM (Based on Percentile)',
    'Number of Visits by RSM (based on percentile) ',
    'Number of visits by ZH (Based on percentile)',
    'Final volume',
    'Category based on percentile',
    'Area Volume',
    'Area Rank',
    'Area Percentile Based on Total Volume of Sales',
    "Is 'Need to grow'?",
    'Area Potential',
    'Area rank based on potential',
    'Area percentile based on potential',
    'Concat Category',
    'Concat'
  ];

  const masterRows = uniqueTargets.map((t, idx) => {
    const custType = t.cust_type || (t.dealer_type === 'PROSPECTIVE' ? 'NON STAR' : 'DEALER');
    const slNo = idx + 1;
    const zone = t.zone || '-';
    const zh = t.zh_name || '-';
    const rsm = t.rsm_name || '-';
    const asm = t.asm_name || '-';
    const area = t.dm_area || t.area || '-';
    const areaStrategy = '-';
    const soName = t.so_name || '-';
    const block = t.sbg_block || t.block || '-';
    const sfaCode = t.sfa_code || '-';
    const customerCode = t.sap_code || t.sfa_code || '-';
    const dealerName = t.dealer_name || '-';
    const potential = (t.sbg_potential !== null && t.sbg_potential !== undefined)
      ? Number(t.sbg_potential)
      : ((t.potential !== null && t.potential !== undefined) ? Number(t.potential) : null);
    const currSales = Number(t.current_sales) || 0;
    const counterShare = (potential && potential > 0) ? Number(t.counter_share || (currSales / potential)) : '-';
    const lysmSales = Number(t.lysm_sales) || 0;
    const prevSales = Number(t.previous_sales) || 0;
    const avg6m = Number(t.rsar_six_month_avg) || Number(t.dp_six_month_avg) || 0;
    const doa = t.doa || '-';
    const finalCategory = t.dealer_status || '-';
    const potRank = (potential && potential > 0) ? (t.potential_rank || 1) : '-';
    const scoreA = (potential && potential > 0) ? (Number(t.score_a) || 0) : '-';
    const scoreB = t.score_b !== null && t.score_b !== undefined ? Number(t.score_b) : 0;
    const scoreC = (potential && potential > 0) ? (Number(t.score_c) || 0) : '-';
    const totalScore = Number(t.total_score) || 0;
    const priorityRank = t.priority || 1;
    const soVisits = Number(t.so_visits) || 0;
    const asmVisits = Number(t.asm_visits) || 0;
    const rsmVisits = Number(t.rsm_visits) || 0;
    const zhVisits = Number(t.zh_visits) || 0;
    const finalVolume = Number(t.final_volume) || 0;
    const grade = t.category || t.grade || '-';
    const areaVolume = Number(t.area_volume) || 0;
    const areaRank = t.area_volume_rank || 1;
    const areaVolPct = Number(t.area_volume_percentile) || 0;
    const needToGrow = t.need_to_grow ? 'Yes' : 'No';
    const areaPotential = Number(t.area_potential) || 0;
    const areaPotRank = t.area_potential_rank || 1;
    const areaPotPct = Number(t.area_potential_percentile) || 0;
    const concatCategory = grade && grade !== '-' ? `${finalCategory}-${grade}` : finalCategory;
    const concat = `${dealerName}-${soName}-${finalCategory}`;

    return [
      custType, slNo, zone, zh, rsm, asm, area, areaStrategy, soName, block,
      sfaCode, customerCode, dealerName, potential ?? '-', currSales, counterShare, lysmSales, prevSales,
      avg6m, doa, finalCategory, potRank, scoreA, scoreB, scoreC, totalScore,
      priorityRank, soVisits, asmVisits, rsmVisits, zhVisits, finalVolume,
      grade, areaVolume, areaRank, areaVolPct, needToGrow, areaPotential,
      areaPotRank, areaPotPct, concatCategory, concat
    ];
  });

  console.log(`Exporting ${masterRows.length} dealers with 42 columns:`);
  for (const r of masterRows) {
    console.log({
      customerCode: r[11],
      name: r[12],
      CM: r[14],
      PM: r[17],
      LYSM: r[16],
      avg6m: r[18],
      finalCategory: r[20],
      scoreA: r[22],
      scoreB: r[23],
      scoreC: r[24],
      totalScore: r[25],
      visits: `SO:${r[27]} ASM:${r[28]} RSM:${r[29]} ZH:${r[30]}`,
      grade: r[32],
      concatCategory: r[40],
      concat: r[41]
    });
  }

  process.exit(0);
}

testExport().catch(e => { console.error(e); process.exit(1); });
