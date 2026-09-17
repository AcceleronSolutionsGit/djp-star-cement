import XLSX from 'xlsx';

const wbM = XLSX.readFile('upload-files/M.xlsx');
const sheetM = wbM.Sheets[wbM.SheetNames[0]];
const rowsM = XLSX.utils.sheet_to_json(sheetM, { range: 3 });

const prospectives = rowsM.filter(r => r['Final Category'] === 'Prospective');
console.log('Found', prospectives.length, 'Prospective rows in M.xlsx');
console.log('First Prospective sample:');
console.log(prospectives[0]);
