import XLSX from 'xlsx';

const file = 'upload-files/PJP Process -Trade.xlsx';
const wb = XLSX.readFile(file);

if (wb.SheetNames.includes('Visits')) {
  const sheet = wb.Sheets['Visits'];
  const data = XLSX.utils.sheet_to_json(sheet);
  console.log('Visits sheet row sample:');
  console.log(data.slice(0, 5));
}
