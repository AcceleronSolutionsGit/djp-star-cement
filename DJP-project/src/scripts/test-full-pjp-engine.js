import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  
  const visitSheet = wb.Sheets['Visits'];
  const visitRows = XLSX.utils.sheet_to_json(visitSheet, { header: 1 });

  const masterSheet = wb.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });

  // Matrix from Rules Approved
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
    return 3; // D
  }

  // Parse dealers from Master tab
  // Row 3 is header:
  // Col 6 (G): AREA
  // Col 10 (K): SFA CODE
  // Col 12 (M): DEALER NAME
  // Col 13 (N): COUNTER POTENTIAL
  // Col 14 (O): Nov Sales (Latest Sales)
  // Col 15 (P): Counter Share
  // Col 18 (S): Last 6 months avg sales
  // Col 20 (U): Final Category (Status)
  const dealers = [];
  for (let r = 4; r < masterRows.length; r++) {
    const row = masterRows[r];
    if (!row || !row[12]) continue;

    const area = (row[6] || 'UNKNOWN').toString().trim();
    const sfaCode = (row[10] || '').toString().trim();
    const dealerName = (row[12] || '').toString().trim();
    const potential = Number(row[13] || 0);
    const latestSales = Number(row[14] || 0);
    const avgSales = Number(row[18] || 0);
    let status = (row[20] || 'De-growing').toString().trim();

    // Standardize status
    if (status.toLowerCase() === 'zero lifter' || status.toLowerCase() === 'zero-lifter') status = 'Zero Lifter';
    if (status.toLowerCase() === 'need to grow') status = 'Need to Grow';
    if (status.toLowerCase() === 'de-growing' || status.toLowerCase() === 'degrowing') status = 'De-growing';
    if (status.toLowerCase() === 'growing') status = 'Growing';
    if (status.toLowerCase() === 'prospective') status = 'Prospective';
    if (status.toLowerCase() === 'churn') status = 'De-growing';

    // Calculate final volume
    let finalVolume = latestSales;
    if (status === 'Prospective') finalVolume = potential * 0.4;
    else if (status === 'Zero Lifter') finalVolume = avgSales;

    dealers.push({
      rowIdx: r + 1,
      area,
      sfaCode,
      dealerName,
      potential,
      latestSales,
      avgSales,
      status,
      finalVolume
    });
  }

  console.log(`Parsed ${dealers.length} dealers from Master sheet.`);

  // Group by Area
  const areaGroups = new Map();
  for (const d of dealers) {
    if (!areaGroups.has(d.area)) areaGroups.set(d.area, []);
    areaGroups.get(d.area).push(d);
  }

  // Calculate Area Volume, Rank, Percentile, and Category A/B/C/D
  for (const [area, group] of areaGroups.entries()) {
    // Sort descending by finalVolume
    group.sort((a, b) => b.finalVolume - a.finalVolume);

    const totalAreaVolume = group.reduce((sum, d) => sum + d.finalVolume, 0);

    let runningVolume = 0;
    for (let i = 0; i < group.length; i++) {
      const d = group[i];
      d.areaRank = i + 1;
      runningVolume += d.finalVolume;
      
      // Cumulative percentile
      const cumPct = totalAreaVolume > 0 ? (runningVolume / totalAreaVolume) : 0;
      d.areaPercentile = cumPct;

      // Assign Category A/B/C/D based on position in cumulative volume
      // In Excel: AJ > 60% -> A, AJ > 40% -> B, AJ >= 20% -> C, AJ < 20% -> D
      // Note: In Excel, AJ is volume of higher/equal ranked items / total volume.
      // So top 40% volume corresponds to 1 - cumPct <= 0.40 or percentile ranking
      // Let's check exact Excel logic:
      // In Excel: SUMIFS(AF:AF, G:G, G5, AI:AI, ">="&AI5)/AH5
      // Notice: AI is rank where 1 is highest volume, so AI >= AI5 means volume of lower or equal ranked dealers?
      // Wait! Let's check AI formula: COUNTIFS(G:G, G5, AF:AF, ">"&AF5)+1 -> Rank 1 has AF5 largest, so AI=1.
      // SUMIFS(AF:AF, G:G, G5, AI:AI, ">="&AI5) sums AF for AI >= AI_row, which means current dealer + ALL DEALERS WITH SMALLER VOLUME!
      // So dealer with rank 1 (largest) has SUMIFS = Total Area Volume! So AJ = 100%!
      // AJ > 60% means top volume portion!
      // AJ > 60% -> A (Top 40% volume!)
      // AJ > 40% -> B (40-60% volume)
      // AJ >= 20% -> C (20-40% volume)
      // AJ < 20% -> D (Bottom 20% volume)

      // Since group is sorted descending (rank 1 to N):
      // SUMIFS of rank >= i is sum from i to N (bottom to top).
      // So (Sum from i to N) / Total:
      // Rank 1 has (Total Volume) / Total Volume = 100% (> 60% -> A)!
    }

    // Calculate sum from i to N for exact SUMIFS match
    for (let i = 0; i < group.length; i++) {
      let sumLowerAndEqual = 0;
      for (let j = i; j < group.length; j++) {
        sumLowerAndEqual += group[j].finalVolume;
      }
      const ajPct = totalAreaVolume > 0 ? (sumLowerAndEqual / totalAreaVolume) : 0;
      let cat = 'D';
      if (ajPct > 0.60) cat = 'A';
      else if (ajPct > 0.40) cat = 'B';
      else if (ajPct >= 0.20) cat = 'C';
      else cat = 'D';

      group[i].catABCD = cat;
      group[i].ajPct = ajPct;
    }
  }

  // Build dealer Map by SFA/Name
  const dealerMap = new Map();
  for (const d of dealers) {
    if (d.sfaCode) dealerMap.set(d.sfaCode.toUpperCase(), d);
    if (d.dealerName) dealerMap.set(d.dealerName.toUpperCase(), d);
  }

  // Now compare against Visits sheet (1769 dealers)
  let totalVisitsCount = 0;
  let matchSO = 0, matchASM = 0, matchRSM = 0, matchZH = 0;

  for (let i = 2; i < visitRows.length; i++) {
    const r = visitRows[i];
    if (!r || r.length < 7) continue;
    totalVisitsCount++;

    const sfa = (r[6] || '').toString().trim().toUpperCase();
    const name = (r[5] || '').toString().trim().toUpperCase();
    const excelSO = Number(r[9] || 0);
    const excelASM = Number(r[10] || 0);
    const excelRSM = Number(r[11] || 0);
    const excelZH = Number(r[12] || 0);

    const d = dealerMap.get(sfa) || dealerMap.get(name);
    let calcSO = 2, calcASM = 0.5, calcRSM = 0, calcZH = 0;

    if (d) {
      const cIdx = getCatIdx(d.catABCD);
      const st = d.status;
      calcSO = matrix.SO[st] ? matrix.SO[st][cIdx] : 2;
      calcASM = matrix.ASM[st] ? matrix.ASM[st][cIdx] : 0.5;
      calcRSM = matrix.RSM[st] ? matrix.RSM[st][cIdx] : 0;
      calcZH = matrix.ZH[st] ? matrix.ZH[st][cIdx] : 0;
    }

    if (calcSO === excelSO) matchSO++;
    if (calcASM === excelASM) matchASM++;
    if (calcRSM === excelRSM) matchRSM++;
    if (calcZH === excelZH) matchZH++;
  }

  console.log(`\n========================================`);
  console.log(`FULL PJP RULE ENGINE ACCURACY ON EXCEL DATA (${totalVisitsCount} dealers):`);
  console.log(`SO Visits Match:   ${matchSO} / ${totalVisitsCount} (${((matchSO/totalVisitsCount)*100).toFixed(1)}%)`);
  console.log(`ASM Visits Match:  ${matchASM} / ${totalVisitsCount} (${((matchASM/totalVisitsCount)*100).toFixed(1)}%)`);
  console.log(`RSM Visits Match:  ${matchRSM} / ${totalVisitsCount} (${((matchRSM/totalVisitsCount)*100).toFixed(1)}%)`);
  console.log(`ZH Visits Match:   ${matchZH} / ${totalVisitsCount} (${((matchZH/totalVisitsCount)*100).toFixed(1)}%)`);
  console.log(`========================================`);
}

main().catch(console.error);
