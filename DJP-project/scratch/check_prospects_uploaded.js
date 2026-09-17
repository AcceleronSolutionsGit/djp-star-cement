import XLSX from 'xlsx';

const wb = XLSX.readFile('upload-files/file-1788514882118-945891101.xlsx');
console.log('02_Prospects.xlsx content:');
console.log(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]));
