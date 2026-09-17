import XLSX from 'xlsx';

// Check M.xlsx row 2 for WBS197 column sources
const wbM = XLSX.readFile('upload-files/M.xlsx');
const sheetM = wbM.Sheets[wbM.SheetNames[0]];
const rowsM = XLSX.utils.sheet_to_json(sheetM, { range: 3 });
const wbs = rowsM.find(r => r['SFA CODE'] === 'WBS197');
console.log('WBS197 in M.xlsx:', wbs);
