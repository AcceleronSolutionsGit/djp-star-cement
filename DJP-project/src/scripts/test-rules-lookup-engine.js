import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  
  // Load Visits tab (which is identical to full-generated-visit-file.xlsx)
  const visitSheet = wb.Sheets['Visits'];
  const visitRows = XLSX.utils.sheet_to_json(visitSheet, { header: 1 });

  // Load Master tab
  const masterSheet = wb.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });

  // Rules Approved Matrix
  // Matrix format: [A, B, C, D]
  const matrix = {
    SO: {
      'Zero lifter':  [1, 2, 3, 2],
      'Prospective':  [1, 2, 3, 2],
      'De-growing':   [2, 2, 3, 2],
      'Growing':      [2, 2, 3, 2],
      'Need to Grow': [2, 2, 3, 2]
    },
    ASM: {
      'Zero lifter':  [3, 2, 1, 0.5],
      'Prospective':  [3, 2, 1, 0.5],
      'De-growing':   [3, 2, 1, 0.5],
      'Growing':      [2, 2, 1, 0.5],
      'Need to Grow': [3, 2, 1, 0.5]
    },
    RSM: {
      'Zero lifter':  [2, 0.5, 0.5, 0],
      'Prospective':  [2, 1, 0.5, 0],
      'De-growing':   [2, 1, 0.5, 0],
      'Growing':      [1, 1, 0.5, 0],
      'Need to Grow': [3, 1, 0.5, 0]
    },
    ZH: {
      'Zero lifter':  [1, 0, 0, 0],
      'Prospective':  [1, 0, 0, 0],
      'De-growing':   [1, 0, 0, 0],
      'Growing':      [1, 0, 0, 0],
      'Need to Grow': [1, 0, 0, 0]
    }
  };

  function getCategoryIndex(cat) {
    const c = (cat || '').toUpperCase().trim();
    if (c === 'A') return 0;
    if (c === 'B') return 1;
    if (c === 'C') return 2;
    if (c === 'D') return 3;
    return 3; // Default to D if unknown
  }

  // Build lookup map from Master tab
  // Master row 3 is header:
  // Col 10 (J): SFA Code
  // Col 12 (L): Dealer Name
  // Col 20 (U): Final Category (Status e.g. De-growing, Growing, Zero lifter, Prospective, Need to Grow)
  // Col 32 (AG): Category based on percentile (A, B, C, D)
  const masterMap = new Map();
  for (let r = 4; r < masterRows.length; r++) {
    const row = masterRows[r];
    if (!row || !row[12]) continue;
    const sfa = (row[10] || '').toString().trim().toUpperCase();
    const name = (row[12] || '').toString().trim().toUpperCase();
    const status = (row[20] || 'De-growing').toString().trim();
    const catPercentile = (row[32] || 'D').toString().trim();

    const info = { status, catPercentile, rawRow: row };
    if (sfa) masterMap.set(sfa, info);
    if (name) masterMap.set(name, info);
  }

  console.log(`Master Map contains ${masterMap.size} keys.`);

  let totalDealers = 0;
  let matchSO = 0, matchASM = 0, matchRSM = 0, matchZH = 0;
  const mismatches = [];

  for (let i = 2; i < visitRows.length; i++) {
    const r = visitRows[i];
    if (!r || r.length < 7) continue;
    totalDealers++;

    const sfa = (r[6] || '').toString().trim().toUpperCase();
    const name = (r[5] || '').toString().trim().toUpperCase();
    const excelSO = Number(r[9] || 0);
    const excelASM = Number(r[10] || 0);
    const excelRSM = Number(r[11] || 0);
    const excelZH = Number(r[12] || 0);
    const excelCat = (r[8] || '').toString().trim(); // Category in Visits sheet e.g. De-growing

    const mInfo = masterMap.get(sfa) || masterMap.get(name);
    let status = excelCat;
    let catPercentile = 'D';

    if (mInfo) {
      status = mInfo.status || excelCat;
      catPercentile = mInfo.catPercentile || 'D';
    }

    // Standardize status name
    let normStatus = status;
    if (normStatus.toLowerCase() === 'zero lifter' || normStatus.toLowerCase() === 'zero-lifter') normStatus = 'Zero lifter';
    if (normStatus.toLowerCase() === 'need to grow') normStatus = 'Need to Grow';
    if (normStatus.toLowerCase() === 'de-growing' || normStatus.toLowerCase() === 'degrowing') normStatus = 'De-growing';
    if (normStatus.toLowerCase() === 'growing') normStatus = 'Growing';
    if (normStatus.toLowerCase() === 'prospective') normStatus = 'Prospective';
    if (normStatus.toLowerCase() === 'churn') normStatus = 'De-growing';

    const cIdx = getCategoryIndex(catPercentile);

    const calcSO = matrix.SO[normStatus] ? matrix.SO[normStatus][cIdx] : 2;
    const calcASM = matrix.ASM[normStatus] ? matrix.ASM[normStatus][cIdx] : 0.5;
    const calcRSM = matrix.RSM[normStatus] ? matrix.RSM[normStatus][cIdx] : 0;
    const calcZH = matrix.ZH[normStatus] ? matrix.ZH[normStatus][cIdx] : 0;

    if (calcSO === excelSO) matchSO++;
    if (calcASM === excelASM) matchASM++;
    if (calcRSM === excelRSM) matchRSM++;
    if (calcZH === excelZH) matchZH++;

    if (calcSO !== excelSO || calcASM !== excelASM || calcRSM !== excelRSM || calcZH !== excelZH) {
      if (mismatches.length < 15) {
        mismatches.push({
          dealer: name,
          sfa,
          excelStatus: excelCat,
          masterStatus: mInfo?.status,
          catPercentile,
          cIdx,
          excelVisits: { SO: excelSO, ASM: excelASM, RSM: excelRSM, ZH: excelZH },
          calcVisits: { SO: calcSO, ASM: calcASM, RSM: calcRSM, ZH: calcZH }
        });
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Testing Lookup Matrix on Excel Dealers (${totalDealers} total):`);
  console.log(`SO Visits Match:   ${matchSO} / ${totalDealers} (${((matchSO/totalDealers)*100).toFixed(1)}%)`);
  console.log(`ASM Visits Match:  ${matchASM} / ${totalDealers} (${((matchASM/totalDealers)*100).toFixed(1)}%)`);
  console.log(`RSM Visits Match:  ${matchRSM} / ${totalDealers} (${((matchRSM/totalDealers)*100).toFixed(1)}%)`);
  console.log(`ZH Visits Match:   ${matchZH} / ${totalDealers} (${((matchZH/totalDealers)*100).toFixed(1)}%)`);
  console.log(`========================================`);

  console.log('\nSample Mismatches using Lookup Matrix:');
  console.dir(mismatches, { depth: null });
}

main().catch(console.error);
