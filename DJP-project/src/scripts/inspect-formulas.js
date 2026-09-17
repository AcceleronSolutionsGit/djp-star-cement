import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx', { cellFormulas: true });
  const sheet = wb.Sheets['Master '];
  
  // Row 565 in Excel (which corresponds to row index 564 in 0-indexed array)
  // Let's find which row has ACHUMI
  const range = XLSX.utils.decode_range(sheet['!ref']);
  let achumiR = -1;
  for (let R = range.s.r; R <= range.e.r; ++R) {
    const cell = sheet[XLSX.utils.encode_cell({r: R, c: 12})]; // Col 12 is DEALER NAME (M in Excel, col 12 if 0-indexed column M)
    if (cell && String(cell.v).includes('ACHUMI')) {
      achumiR = R;
      break;
    }
  }

  console.log('ACHUMI Excel Row:', achumiR + 1);

  if (achumiR >= 0) {
    for (let C = range.s.c; C <= range.e.c; ++C) {
      const cellAddress = XLSX.utils.encode_cell({r: achumiR, c: C});
      const cell = sheet[cellAddress];
      const headerCell = sheet[XLSX.utils.encode_cell({r: 3, c: C})];
      const header = headerCell ? headerCell.v : `Col_${C}`;
      if (cell) {
        console.log(`${cellAddress} [${header}]: val = ${cell.v}, formula = ${cell.f || 'NONE'}`);
      }
    }
  }
}

main().catch(console.error);
