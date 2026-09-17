import XLSX from 'xlsx';
import path from 'path';

const file = 'upload-files/RSAR SALE- NE-APRIL-24 TO JUNE-26.xlsx';
const wb = XLSX.readFile(file, { cellDates: true });
const sheet = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(sheet);

if (rows.length > 0) {
  console.log('Sample Row Keys:', Object.keys(rows[0]));
}
