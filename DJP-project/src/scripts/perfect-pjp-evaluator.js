import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');

  const visitSheet = wb.Sheets['Visits'];
  const visitRows = XLSX.utils.sheet_to_json(visitSheet, { header: 1 });

  const masterSheet = wb.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });

  // Rules Approved Matrix
  const matrix = {
    SO: {
      'Zero Lifter':  [1, 2, 3, 2],
      'Prospective':  [1, 2, 3, 2],
      'De-growing':   [2, 2, 3, 2],
      'Growing':      [2, 2, 3, 2],
      'Need to Grow': [2, 2, 3, 2]
    },
    ASM: {
      'Zero Lifter':  [3, 2, 1, 0.5],
      'Prospective':  [3, 2, 1, 0.5],
      'De-growing':   [3, 2, 1, 0.5],
      'Growing':      [2, 2, 1, 0.5],
      'Need to Grow': [3, 2, 1, 0.5]
    },
    RSM: {
      'Zero Lifter':  [2, 0.5, 0.5, 0],
      'Prospective':  [2, 1, 0.5, 0],
      'De-growing':   [2, 1, 0.5, 0],
      'Growing':      [1, 1, 0.5, 0],
      'Need to Grow': [3, 1, 0.5, 0]
    },
    ZH: {
      'Zero Lifter':  [1, 0, 0, 0],
      'Prospective':  [1, 0, 0, 0],
      'De-growing':   [1, 0, 0, 0],
      'Growing':      [1, 0, 0, 0],
      'Need to Grow': [1, 0, 0, 0]
    }
  };

  function getCatIdx(cat) {
    if (cat === 'A') return 0;
    if (cat === 'B') return 1;
    if (cat === 'C') return 2;
    return 3;
  }

  // Parse all dealers from Master sheet
  // Col 6 (G): AREA
  // Col 8 (I): SO NAME
  // Col 10 (K): SFA CODE
  // Col 12 (M): DEALER NAME
  // Col 13 (N): COUNTER POTENTIAL
  // Col 14 (O): Nov Sales
  // Col 15 (P): Counter Share%
  // Col 18 (S): Last 6 months avg sales
  // Col 20 (U): Final Category (Status)
  const dealers = [];
  for (let r = 4; r < masterRows.length; r++) {
    const row = masterRows[r];
    if (!row || !row[12]) continue;

    const area = (row[6] || 'UNKNOWN').toString().trim();
    const soName = (row[8] || 'UNKNOWN').toString().trim();
    const sfaCode = (row[10] || '').toString().trim();
    const dealerName = (row[12] || '').toString().trim();
    const potential = Number(row[13] || 0);
    const latestSales = Number(row[14] || 0);
    const counterShare = Number(row[15] || 0);
    const avgSales = Number(row[18] || 0);
    let status = (row[20] || 'De-growing').toString().trim();

    if (status.toLowerCase() === 'zero lifter' || status.toLowerCase() === 'zero-lifter') status = 'Zero Lifter';
    if (status.toLowerCase() === 'need to grow') status = 'Need to Grow';
    if (status.toLowerCase() === 'de-growing' || status.toLowerCase() === 'degrowing') status = 'De-growing';
    if (status.toLowerCase() === 'growing') status = 'Growing';
    if (status.toLowerCase() === 'prospective') status = 'Prospective';
    if (status.toLowerCase() === 'churn') status = 'De-growing';

    let finalVolume = latestSales;
    if (status === 'Prospective') finalVolume = potential * 0.4;
    else if (status === 'Zero Lifter') finalVolume = avgSales;

    dealers.push({
      masterRow: r + 1,
      area,
      soName,
      sfaCode,
      dealerName,
      potential,
      latestSales,
      counterShare,
      avgSales,
      status,
      finalVolume
    });
  }

  // 1. Group by Area to calculate Area Percentile & Category A/B/C/D
  const areaMap = new Map();
  for (const d of dealers) {
    if (!areaMap.has(d.area)) areaMap.set(d.area, []);
    areaMap.get(d.area).push(d);
  }

  for (const [area, group] of areaMap.entries()) {
    // Sort descending by finalVolume
    group.sort((a, b) => b.finalVolume - a.finalVolume);
    const totalVol = group.reduce((sum, d) => sum + d.finalVolume, 0);

    for (let i = 0; i < group.length; i++) {
      let lowerEqVol = 0;
      for (let j = i; j < group.length; j++) {
        lowerEqVol += group[j].finalVolume;
      }
      const aj = totalVol > 0 ? (lowerEqVol / totalVol) : 0;
      let cat = 'D';
      if (aj > 0.60) cat = 'A';
      else if (aj > 0.40) cat = 'B';
      else if (aj >= 0.20) cat = 'C';
      else cat = 'D';

      group[i].catABCD = cat;
      group[i].areaPercentile = aj;
    }
  }

  // 2. Group by SO to calculate Priority Scores & Priority Rank per SO
  const soMap = new Map();
  for (const d of dealers) {
    if (!soMap.has(d.soName)) soMap.set(d.soName, []);
    soMap.get(d.soName).push(d);
  }

  const categoryScores = {
    'Zero Lifter': 10,
    'Prospective': 30,
    'De-growing': 20,
    'Growing': 10,
    'Need to Grow': 25
  };

  for (const [so, group] of soMap.entries()) {
    // Calculate Rank based on potential (Col V)
    // COUNTIFS(I:I, I5, N:N, "<" & N5) + 1
    for (const d of group) {
      const smallerPotentialCount = group.filter(x => x.potential < d.potential).length;
      d.potentialRank = smallerPotentialCount + 1;
    }
    const maxPrioRank = Math.max(...group.map(d => d.potentialRank));

    for (const d of group) {
      // Score A = potentialRank / maxPrioRank * 40
      d.scoreA = maxPrioRank > 0 ? (d.potentialRank / maxPrioRank) * 40 : 0;

      // Score B = Category score
      d.scoreB = categoryScores[d.status] || 20;

      // Score C = Counter share score
      const higherShareCount = group.filter(x => x.counterShare > d.counterShare).length;
      d.scoreC = group.length > 0 ? ((higherShareCount + 1) / group.length) * 20 : 0;

      d.totalScore = d.scoreA + d.scoreB + d.scoreC;
    }

    // Rank based on totalScore (SO wise) (Col AA)
    for (const d of group) {
      const higherTotalScoreCount = group.filter(x => x.totalScore > d.totalScore).length;
      d.prioRank = higherTotalScoreCount + 1;
    }
  }

  // Create lookup map by SFA/Name
  const dealerLookup = new Map();
  for (const d of dealers) {
    if (d.sfaCode) dealerLookup.set(d.sfaCode.toUpperCase(), d);
    if (d.dealerName) dealerLookup.set(d.dealerName.toUpperCase(), d);
  }

  // Compare against Visits sheet (1769 dealers)
  let totalVisits = 0;
  let matchSO = 0, matchASM = 0, matchRSM = 0, matchZH = 0, matchPrio = 0, matchCat = 0;
  const sampleMismatches = [];

  for (let i = 2; i < visitRows.length; i++) {
    const r = visitRows[i];
    if (!r || r.length < 7) continue;
    totalVisits++;

    const sfa = (r[6] || '').toString().trim().toUpperCase();
    const name = (r[5] || '').toString().trim().toUpperCase();
    const excelPrio = Number(r[7] || 0);
    const excelCategory = (r[8] || '').toString().trim();
    const excelSO = Number(r[9] || 0);
    const excelASM = Number(r[10] || 0);
    const excelRSM = Number(r[11] || 0);
    const excelZH = Number(r[12] || 0);

    const d = dealerLookup.get(sfa) || dealerLookup.get(name);
    if (d) {
      if (d.prioRank === excelPrio) matchPrio++;
      if (d.status.toLowerCase() === excelCategory.toLowerCase()) matchCat++;

      const cIdx = getCatIdx(d.catABCD);
      const calcSO = matrix.SO[d.status] ? matrix.SO[d.status][cIdx] : 2;
      const calcASM = matrix.ASM[d.status] ? matrix.ASM[d.status][cIdx] : 0.5;
      const calcRSM = matrix.RSM[d.status] ? matrix.RSM[d.status][cIdx] : 0;
      const calcZH = matrix.ZH[d.status] ? matrix.ZH[d.status][cIdx] : 0;

      if (calcSO === excelSO) matchSO++;
      if (calcASM === excelASM) matchASM++;
      if (calcRSM === excelRSM) matchRSM++;
      if (calcZH === excelZH) matchZH++;

      if (calcSO !== excelSO || calcASM !== excelASM || calcRSM !== excelRSM || calcZH !== excelZH) {
        if (sampleMismatches.length < 15) {
          sampleMismatches.push({
            dealer: name,
            sfa,
            excel: { prio: excelPrio, status: excelCategory, so: excelSO, asm: excelASM, rsm: excelRSM, zh: excelZH },
            eval: { prio: d.prioRank, status: d.status, catABCD: d.catABCD },
            calc: { so: calcSO, asm: calcASM, rsm: calcRSM, zh: calcZH }
          });
        }
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`PERFECT JS ENGINE EVALUATION RESULTS (${totalVisits} total dealers):`);
  console.log(`Status Category Match: ${matchCat} / ${totalVisits} (${((matchCat/totalVisits)*100).toFixed(1)}%)`);
  console.log(`Priority Rank Match:   ${matchPrio} / ${totalVisits} (${((matchPrio/totalVisits)*100).toFixed(1)}%)`);
  console.log(`SO Visits Match:       ${matchSO} / ${totalVisits} (${((matchSO/totalVisits)*100).toFixed(1)}%)`);
  console.log(`ASM Visits Match:      ${matchASM} / ${totalVisits} (${((matchASM/totalVisits)*100).toFixed(1)}%)`);
  console.log(`RSM Visits Match:      ${matchRSM} / ${totalVisits} (${((matchRSM/totalVisits)*100).toFixed(1)}%)`);
  console.log(`ZH Visits Match:       ${matchZH} / ${totalVisits} (${((matchZH/totalVisits)*100).toFixed(1)}%)`);
  console.log(`========================================`);

  console.log('\nSample Mismatches:');
  console.dir(sampleMismatches, { depth: null });
}

main().catch(console.error);
