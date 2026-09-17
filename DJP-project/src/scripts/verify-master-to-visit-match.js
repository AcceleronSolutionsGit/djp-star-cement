import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx', { cellFormulas: true });

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

  // Parse Master rows with evaluated cell values where available
  // Col 10 (K): SFA CODE
  // Col 12 (M): DEALER NAME
  // Col 20 (U): Final Category (Status)
  // Col 26 (AA): Rank based on Total Score (SO wise) -> Priority Rank
  // Col 32 (AG): Category based on percentile (A, B, C, D)
  const masterMap = new Map();
  for (let r = 4; r < masterRows.length; r++) {
    const row = masterRows[r];
    if (!row || !row[12]) continue;

    const sfa = (row[10] || '').toString().trim().toUpperCase();
    const name = (row[12] || '').toString().trim().toUpperCase();
    const status = (row[20] || 'De-growing').toString().trim();
    const prioRank = Number(row[26] || 0);

    // Get evaluated value for AG (Category A/B/C/D)
    const agCell = masterSheet[XLSX.utils.encode_cell({ r, c: 32 })];
    let catVal = agCell ? agCell.v : 'D';
    if (catVal === 29 || typeof catVal === 'number') {
      // If formula evaluation wasn't saved, infer from Excel row
      catVal = row[32] || 'D';
    }

    const info = { status, prioRank, catABCD: catVal, rowIdx: r + 1 };
    if (sfa) masterMap.set(sfa, info);
    if (name) masterMap.set(name, info);
  }

  let totalVisits = 0;
  let matchSO = 0, matchASM = 0, matchRSM = 0, matchZH = 0, matchPrio = 0;
  const mismatches = [];

  for (let i = 2; i < visitRows.length; i++) {
    const r = visitRows[i];
    if (!r || r.length < 7) continue;
    totalVisits++;

    const sfa = (r[6] || '').toString().trim().toUpperCase();
    const name = (r[5] || '').toString().trim().toUpperCase();
    const excelPrio = Number(r[7] || 0);
    const excelStatus = (r[8] || '').toString().trim();
    const excelSO = Number(r[9] || 0);
    const excelASM = Number(r[10] || 0);
    const excelRSM = Number(r[11] || 0);
    const excelZH = Number(r[12] || 0);

    const m = masterMap.get(sfa) || masterMap.get(name);
    if (m) {
      // Let's test matching priority rank
      if (m.prioRank === excelPrio) matchPrio++;

      let st = m.status;
      if (st.toLowerCase() === 'zero lifter' || st.toLowerCase() === 'zero-lifter') st = 'Zero Lifter';
      if (st.toLowerCase() === 'need to grow') st = 'Need to Grow';
      if (st.toLowerCase() === 'de-growing' || st.toLowerCase() === 'degrowing') st = 'De-growing';
      if (st.toLowerCase() === 'growing') st = 'Growing';
      if (st.toLowerCase() === 'prospective') st = 'Prospective';
      if (st.toLowerCase() === 'churn') st = 'De-growing';

      const cIdx = getCatIdx(m.catABCD);
      const calcSO = matrix.SO[st] ? matrix.SO[st][cIdx] : 2;
      const calcASM = matrix.ASM[st] ? matrix.ASM[st][cIdx] : 0.5;
      const calcRSM = matrix.RSM[st] ? matrix.RSM[st][cIdx] : 0;
      const calcZH = matrix.ZH[st] ? matrix.ZH[st][cIdx] : 0;

      if (calcSO === excelSO) matchSO++;
      if (calcASM === excelASM) matchASM++;
      if (calcRSM === excelRSM) matchRSM++;
      if (calcZH === excelZH) matchZH++;

      if (calcSO !== excelSO || calcASM !== excelASM || calcRSM !== excelRSM || calcZH !== excelZH) {
        if (mismatches.length < 15) {
          mismatches.push({
            dealer: name,
            sfa,
            excel: { prio: excelPrio, status: excelStatus, so: excelSO, asm: excelASM, rsm: excelRSM, zh: excelZH },
            master: { prio: m.prioRank, status: m.status, catABCD: m.catABCD },
            calc: { so: calcSO, asm: calcASM, rsm: calcRSM, zh: calcZH }
          });
        }
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`MASTER TO VISITS TAB MATCHING (${totalVisits} total dealers):`);
  console.log(`Priority Rank Match: ${matchPrio} / ${totalVisits} (${((matchPrio/totalVisits)*100).toFixed(1)}%)`);
  console.log(`SO Visits Match:     ${matchSO} / ${totalVisits} (${((matchSO/totalVisits)*100).toFixed(1)}%)`);
  console.log(`ASM Visits Match:    ${matchASM} / ${totalVisits} (${((matchASM/totalVisits)*100).toFixed(1)}%)`);
  console.log(`RSM Visits Match:    ${matchRSM} / ${totalVisits} (${((matchRSM/totalVisits)*100).toFixed(1)}%)`);
  console.log(`ZH Visits Match:     ${matchZH} / ${totalVisits} (${((matchZH/totalVisits)*100).toFixed(1)}%)`);
  console.log(`========================================`);

  console.log('\nSample Mismatches between Master evaluation & Visits tab:');
  console.dir(mismatches, { depth: null });
}

main().catch(console.error);
