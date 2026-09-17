import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx', { cellFormulas: true });
  const visitSheet = wb.Sheets['Visits'];
  
  console.log('=== Checking first 10 rows of Visits tab for cell formulas ===');
  for (let R = 1; R <= 10; ++R) {
    console.log(`\nRow ${R + 1}:`);
    for (let C = 0; C <= 16; ++C) {
      const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = visitSheet[cellAddr];
      if (cell && cell.f) {
        console.log(`  Col ${C} (${XLSX.utils.encode_col(C)}): Val = ${cell.v}, Formula = ${cell.f}`);
      }
    }
  }
}

main().catch(console.error);
