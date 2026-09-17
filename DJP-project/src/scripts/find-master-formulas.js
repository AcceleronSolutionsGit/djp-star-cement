import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx', { cellFormulas: true });
  const masterSheet = wb.Sheets['Master '];
  
  const range = XLSX.utils.decode_range(masterSheet['!ref']);
  
  const foundFormulas = new Map();

  for (let R = 3; R <= range.e.r; ++R) {
    for (let C = 0; C <= range.e.c; ++C) {
      const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = masterSheet[cellAddr];
      if (cell && cell.f) {
        const colHeader = masterSheet[XLSX.utils.encode_cell({ r: 3, c: C })]?.v || `Col_${C}`;
        if (!foundFormulas.has(C)) {
          foundFormulas.set(C, { header: colHeader, sampleFormula: cell.f, sampleVal: cell.v });
        }
      }
    }
  }

  console.log('=== Unique Formulas found per Column in Master Sheet ===');
  for (const [col, info] of foundFormulas.entries()) {
    console.log(`Col ${col} (${XLSX.utils.encode_col(col)}) [${info.header}]:`);
    console.log(`  Sample Formula: ${info.sampleFormula}`);
    console.log(`  Sample Value:   ${JSON.stringify(info.sampleVal)}\n`);
  }
}

main().catch(console.error);
