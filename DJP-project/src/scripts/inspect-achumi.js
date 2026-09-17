import { dbAll } from '../config/database.js';
import XLSX from 'xlsx';

async function main() {
  const code = '1000003100';
  const rssd = 'NEA362';

  const rows = await dbAll(
    'SELECT * FROM sales_history WHERE sap_code = ? OR rssd_code = ? ORDER BY period_year_month DESC',
    [code, rssd]
  );
  console.log('--- DB Sales History for ACHUMI ---');
  console.log('Total DB rows:', rows.length);
  console.log(rows);

  // Inspect Master sheet in PJP Process -Trade.xlsx
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  const masterSheet = wb.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });
  
  console.log('\n--- Master sheet headers (row 0-3) ---');
  for (let i = 0; i < 4; i++) {
    console.log(`Row ${i}:`, masterRows[i]);
  }

  // Find ACHUMI row in Master
  const achumiRowIdx = masterRows.findIndex(r => r && r.some(c => String(c).includes('ACHUMI')));
  console.log('\n--- ACHUMI Row Index in Master sheet:', achumiRowIdx);
  if (achumiRowIdx >= 0) {
    const achumiRow = masterRows[achumiRowIdx];
    const headerRow = masterRows[0]; // Header row
    achumiRow.forEach((val, colIdx) => {
      if (val !== undefined && val !== null) {
        console.log(`Col ${colIdx} (${headerRow ? headerRow[colIdx] : ''}):`, val);
      }
    });
  }
}

main().catch(console.error);
