import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  
  const targetSheets = ['Rules Approved', 'Rules', 'Process', 'Steps', 'Visits'];
  
  for (const sheetName of targetSheets) {
    console.log(`\n========================================`);
    console.log(`TAB: "${sheetName}"`);
    console.log(`========================================`);
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`Total rows: ${rows.length}`);
    for (let i = 0; i < Math.min(35, rows.length); i++) {
      if (rows[i] && rows[i].length > 0) {
        const lineStr = rows[i].map(c => (c === undefined || c === null ? '' : String(c).replace(/\r\n|\n/g, ' '))).join(' | ');
        if (lineStr.replace(/\|/g, '').trim() !== '') {
          console.log(`Row ${i}: ${lineStr}`);
        }
      }
    }
  }
}

main().catch(console.error);
