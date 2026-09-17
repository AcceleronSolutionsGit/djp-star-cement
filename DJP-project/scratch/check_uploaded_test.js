import XLSX from 'xlsx';
import fs from 'fs';

const files = [
  'upload-files/file-1788514877222-221993509.xlsx', // DM
  'upload-files/file-1788514881734-712809795.xlsx', // Prospects?
  'upload-files/file-1788514885984-593167227.xlsx', // RSAR
  'upload-files/file-1788514890041-938885764.xlsx', // SBG
  'upload-files/file-1788514896327-379203815.xlsx'  // DP
];

for (const f of files) {
  if (fs.existsSync(f)) {
    const wb = XLSX.readFile(f);
    console.log(`\n=== ${f} ===`);
    const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    console.log(data);
  } else {
    console.log(`File not found: ${f}`);
  }
}
