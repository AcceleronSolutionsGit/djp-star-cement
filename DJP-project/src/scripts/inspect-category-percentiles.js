import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx', { cellFormulas: true });
  const masterSheet = wb.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });

  console.log('=== Checking Category A/B/C/D & Status distribution in Master tab ===');

  const catCounts = { A: 0, B: 0, C: 0, D: 0, OTHER: 0 };
  const statusCounts = {};

  const sampleDealers = [];

  for (let r = 4; r < masterRows.length; r++) {
    const row = masterRows[r];
    if (!row || !row[12]) continue;

    const dealerName = row[12];
    const sfaCode = row[10];
    const finalCategory = row[20]; // Col U (Status)
    const catPercentile = row[32]; // Col AG (A/B/C/D)
    const finalVolume = row[31];   // Col AF
    const counterPotential = row[13]; // Col N

    catCounts[catPercentile] = (catCounts[catPercentile] || 0) + 1;
    statusCounts[finalCategory] = (statusCounts[finalCategory] || 0) + 1;

    if (sampleDealers.length < 20) {
      // Get formulas
      const fCatCell = masterSheet[XLSX.utils.encode_cell({ r, c: 20 })];
      const fPercentileCell = masterSheet[XLSX.utils.encode_cell({ r, c: 32 })];
      const fAreaVolCell = masterSheet[XLSX.utils.encode_cell({ r, c: 33 })];
      const fAreaPercentileCell = masterSheet[XLSX.utils.encode_cell({ r, c: 35 })];

      sampleDealers.push({
        row: r + 1,
        dealerName,
        sfaCode,
        finalCategory: fCatCell?.v,
        catFormula: fCatCell?.f || 'NONE',
        catPercentile: fPercentileCell?.v,
        percentileFormula: fPercentileCell?.f || 'NONE',
        areaVolFormula: fAreaVolCell?.f || 'NONE',
        areaPercentileFormula: fAreaPercentileCell?.f || 'NONE'
      });
    }
  }

  console.log('\nCategory A/B/C/D Counts in Master sheet:');
  console.dir(catCounts);

  console.log('\nStatus (Final Category) Counts in Master sheet:');
  console.dir(statusCounts);

  console.log('\nSample Dealer Formulas (First 20):');
  console.dir(sampleDealers, { depth: null });
}

main().catch(console.error);
