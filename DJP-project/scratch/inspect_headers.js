import XLSX from 'xlsx';

const wbM = XLSX.readFile('upload-files/M.xlsx');
const sheetM = wbM.Sheets[wbM.SheetNames[0]];

const headers = [];
const sources = [];
for (let c = 0; c <= 41; c++) {
  const hCell = sheetM[XLSX.utils.encode_cell({ r: 3, c })];
  const sCell = sheetM[XLSX.utils.encode_cell({ r: 2, c })];
  headers.push(hCell ? hCell.v : `col_${c}`);
  sources.push(sCell ? sCell.v : '');
}

console.log('M.xlsx COLUMNS:');
headers.forEach((h, i) => {
  console.log(`${i}: [${sources[i] || 'CALCULATED/NONE'}] -> "${h}"`);
});

const wbV = XLSX.readFile('upload-files/visits-To Be Achieved.xlsx');
const sheetV = wbV.Sheets[wbV.SheetNames[0]];
const vHeaders = [];
for (let c = 0; c <= 19; c++) {
  const hCell = sheetV[XLSX.utils.encode_cell({ r: 1, c })];
  vHeaders.push(hCell ? hCell.v : `col_${c}`);
}
console.log('\nVisits COLUMNS:');
vHeaders.forEach((h, i) => {
  console.log(`${i}: "${h}"`);
});
