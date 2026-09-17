import XLSX from 'xlsx';

const file = 'upload-files/PJP Process -Trade.xlsx';
const wb = XLSX.readFile(file);

console.log('Sheets in PJP Process -Trade:', wb.SheetNames);

if (wb.SheetNames.includes('Rules')) {
  const sheet = wb.Sheets['Rules'];
  console.log('\n--- RULES SHEET ---');
  console.log(XLSX.utils.sheet_to_json(sheet));
}

if (wb.SheetNames.includes('Rules Approved')) {
  const sheet = wb.Sheets['Rules Approved'];
  console.log('\n--- RULES APPROVED SHEET ---');
  console.log(XLSX.utils.sheet_to_json(sheet));
}
