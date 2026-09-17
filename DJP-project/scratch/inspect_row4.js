import XLSX from 'xlsx';

const wbM = XLSX.readFile('upload-files/M.xlsx');
const sheetM = wbM.Sheets[wbM.SheetNames[0]];

const row4 = [];
for (let c = 0; c <= 41; c++) {
  const cell = sheetM[XLSX.utils.encode_cell({ r: 4, c })];
  row4.push(cell ? cell.v : null);
}

const headers = [];
for (let c = 0; c <= 41; c++) {
  const hCell = sheetM[XLSX.utils.encode_cell({ r: 3, c })];
  headers.push(hCell ? hCell.v : `col_${c}`);
}

console.log('ROW 4 (Sample Dealer B014):');
headers.forEach((h, i) => {
  console.log(`${i}: ${h.replace(/\n/g, ' ')} = ${JSON.stringify(row4[i])}`);
});
