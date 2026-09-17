import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx', { cellFormulas: true, cellStyles: true });

  const masterSheet = wb.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });
  const headers = masterRows[3]; // Header is at row index 3

  console.log('=== Master Sheet Headers ===');
  headers.forEach((h, idx) => console.log(`Col ${idx} (${XLSX.utils.encode_col(idx)}): ${h}`));

  console.log('\n=== Checking Master Sheet Formulas across 10 non-empty rows ===');
  const range = XLSX.utils.decode_range(masterSheet['!ref']);
  let count = 0;
  for (let R = 4; R <= range.e.r && count < 10; ++R) {
    const row = masterRows[R];
    if (!row || !row[12]) continue; // Needs dealer name
    count++;
    console.log(`\n--- Row ${R + 1} (Dealer: ${row[12]}, Category: ${row[20]}) ---`);
    for (let c = 20; c <= 36; c++) {
      const cellAddr = XLSX.utils.encode_cell({ r: R, c });
      const cell = masterSheet[cellAddr];
      if (cell) {
        console.log(`  Col ${c} (${XLSX.utils.encode_col(c)}) [${headers[c]}]: Val = ${JSON.stringify(cell.v)}, Formula = ${cell.f || 'NONE'}`);
      }
    }
  }

  console.log('\n=== Non-empty rows in Rules Sheet ===');
  if (wb.Sheets['Rules']) {
    const rulesSheet = wb.Sheets['Rules'];
    const rulesRows = XLSX.utils.sheet_to_json(rulesSheet, { header: 1 });
    rulesRows.forEach((r, idx) => {
      if (r && r.some(c => c !== null && c !== undefined && c !== '')) {
        console.log(`Row ${idx}:`, r.filter(c => c !== null && c !== undefined));
      }
    });
  }

  console.log('\n=== Non-empty rows in Rules Approved Sheet ===');
  if (wb.Sheets['Rules Approved']) {
    const appSheet = wb.Sheets['Rules Approved'];
    const appRows = XLSX.utils.sheet_to_json(appSheet, { header: 1 });
    appRows.forEach((r, idx) => {
      if (r && r.some(c => c !== null && c !== undefined && c !== '')) {
        console.log(`Row ${idx}:`, r.filter(c => c !== null && c !== undefined));
      }
    });
  }
}

main().catch(console.error);
