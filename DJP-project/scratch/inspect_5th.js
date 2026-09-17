import XLSX from 'xlsx';
const wb = XLSX.readFile('upload-files/file-1788517005955-622109392.xlsx');
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
console.log('Row 1 (Headers):', rows[0]);
console.log('Row 2:', rows[1]);
process.exit(0);
