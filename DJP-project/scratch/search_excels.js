import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';

function searchExcel(filePath) {
  try {
    const wb = XLSX.readFile(filePath);
    for (const sheetName of wb.SheetNames) {
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);
      for (const row of data) {
        const rowStr = JSON.stringify(row);
        if (rowStr.includes('Declining') || rowStr.includes('Stable') || rowStr.includes('Alpha Traders')) {
          console.log(`Match in ${filePath} [${sheetName}]:`, row);
          return;
        }
      }
    }
  } catch (e) {}
}

const dirs = ['scratch', 'test-artifacts', 'upload-files'];
for (const d of dirs) {
  if (!fs.existsSync(d)) continue;
  for (const f of fs.readdirSync(d)) {
    if (f.endsWith('.xlsx')) searchExcel(path.join(d, f));
  }
}
