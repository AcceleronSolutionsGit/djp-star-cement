import XLSX from 'xlsx';

const wbM = XLSX.readFile('upload-files/M.xlsx');
const sheetM = wbM.Sheets[wbM.SheetNames[0]];
const rowsM = XLSX.utils.sheet_to_json(sheetM, { range: 3 });

const custTypesM = {};
const categoriesM = {};
for (const r of rowsM) {
  const ct = r['Cust Type'] || 'NULL';
  custTypesM[ct] = (custTypesM[ct] || 0) + 1;
  const cat = r['Final Category'] || 'NULL';
  categoriesM[cat] = (categoriesM[cat] || 0) + 1;
}

console.log('M.xlsx Total rows:', rowsM.length);
console.log('M.xlsx Cust Types:', custTypesM);
console.log('M.xlsx Final Categories:', categoriesM);

const wbV = XLSX.readFile('upload-files/visits-To Be Achieved.xlsx');
const sheetV = wbV.Sheets[wbV.SheetNames[0]];
const rowsV = XLSX.utils.sheet_to_json(sheetV, { range: 1 });

const custTypesV = {};
const categoriesV = {};
for (const r of rowsV) {
  const ct = r['Cust Type'] || 'NULL';
  custTypesV[ct] = (custTypesV[ct] || 0) + 1;
  const cat = r['Category'] || 'NULL';
  categoriesV[cat] = (categoriesV[cat] || 0) + 1;
}

console.log('\nVisits Total rows:', rowsV.length);
console.log('Visits Cust Types:', custTypesV);
console.log('Visits Categories:', categoriesV);
