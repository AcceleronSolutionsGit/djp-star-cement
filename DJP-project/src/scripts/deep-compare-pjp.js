import XLSX from 'xlsx';

async function main() {
  const wbGen = XLSX.readFile('upload-files/full-generated-visit-file.xlsx', { cellFormulas: true });
  const wbTrade = XLSX.readFile('upload-files/PJP Process -Trade.xlsx', { cellFormulas: true });

  const genSheet = wbGen.Sheets['Sheet1'];
  const genRows = XLSX.utils.sheet_to_json(genSheet, { header: 1 });

  const visitSheet = wbTrade.Sheets['Visits'];
  const visitRows = XLSX.utils.sheet_to_json(visitSheet, { header: 1 });

  const masterSheet = wbTrade.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });

  console.log(`full-generated-visit-file.xlsx rows: ${genRows.length}`);
  console.log(`PJP Process -Trade.xlsx 'Visits' tab rows: ${visitRows.length}`);
  console.log(`PJP Process -Trade.xlsx 'Master ' tab rows: ${masterRows.length}`);

  console.log('\n--- First 5 rows of full-generated-visit-file.xlsx ---');
  for (let i = 0; i < Math.min(8, genRows.length); i++) {
    console.log(`Gen Row ${i}:`, genRows[i]);
  }

  console.log('\n--- First 5 rows of Visits tab in PJP Process -Trade.xlsx ---');
  for (let i = 0; i < Math.min(8, visitRows.length); i++) {
    console.log(`Visits Row ${i}:`, visitRows[i]);
  }

  // Let's inspect formulas in Master tab for Row 4 (first data row, index 3)
  console.log('\n--- Header row of Master tab (row index 3) ---');
  console.log(masterRows[3]);

  console.log('\n--- Sample data row in Master tab (row index 4) with values & formulas ---');
  const range = XLSX.utils.decode_range(masterSheet['!ref']);
  for (let C = range.s.c; C <= range.e.c; ++C) {
    const cellAddr = XLSX.utils.encode_cell({ r: 4, c: C });
    const cell = masterSheet[cellAddr];
    const header = masterRows[3][C] || `Col_${C}`;
    if (cell) {
      console.log(`Col ${C} [${header}]: val = ${JSON.stringify(cell.v)}, formula = ${cell.f || 'NONE'}`);
    }
  }
}

main().catch(console.error);
