import XLSX from 'xlsx';

const wb = XLSX.readFile('upload-files/file-1788514885984-593167227.xlsx');
console.log('03_RSAR_Sales.xlsx content:');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
console.table(rows);
