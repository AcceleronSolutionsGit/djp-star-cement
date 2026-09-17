import XLSX from 'xlsx';

const file = 'upload-files/Trade DJP Zone wise - 28-06-2026.xlsx';
const wb = XLSX.readFile(file);

console.log('Sheets in Trade DJP Zone wise:', wb.SheetNames);

['Employee list', 'ASM', 'RSM', 'ZH', 'SO'].forEach(s => {
  if (wb.SheetNames.includes(s)) {
    const sheet = wb.Sheets[s];
    const data = XLSX.utils.sheet_to_json(sheet);
    console.log(`\n--- ${s} SHEET (First 3 rows) ---`);
    console.log(data.slice(0, 3));
  }
});
