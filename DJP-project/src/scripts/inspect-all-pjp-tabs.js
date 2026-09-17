import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  
  console.log('Sheet Names:', wb.SheetNames);
  
  for (const sheetName of wb.SheetNames) {
    console.log(`\n========================================`);
    console.log(`TAB: "${sheetName}"`);
    console.log(`========================================`);
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`Total rows: ${rows.length}`);
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      if (rows[i] && rows[i].length > 0) {
        console.log(`Row ${i}:`, rows[i].filter(cell => cell !== undefined && cell !== null && cell !== ''));
      }
    }
  }
}

main().catch(console.error);
