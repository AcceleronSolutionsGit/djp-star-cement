import XLSX from 'xlsx';

const filePath = 'New Upload/Master Excel Oct.xlsx';
const wb = XLSX.readFile(filePath);
const ws = wb.Sheets['Master '];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

console.log('Total rows:', rows.length);
const headers = rows[3];
console.log('Headers (Row 3):');
headers.forEach((h, i) => {
  if (h !== null && h !== undefined) {
    console.log(`  Col ${i}: "${h}"`);
  }
});

// Analyze Cust Type values and SFA/SAP codes
const custTypeCounts = {};
let hasSfaCount = 0;
let hasSapCount = 0;
let hasBothCount = 0;
let onlySfaCount = 0;
let onlySapCount = 0;
let neitherCount = 0;

for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  if (!r || r.every(c => c === null || String(c).trim() === '')) continue;
  const custType = String(r[0] || '').trim();
  custTypeCounts[custType] = (custTypeCounts[custType] || 0) + 1;

  const sfa = r[10] ? String(r[10]).trim() : null;
  const sap = r[11] ? String(r[11]).trim() : null;

  if (sfa && sap) hasBothCount++;
  else if (sfa && !sap) onlySfaCount++;
  else if (!sfa && sap) onlySapCount++;
  else neitherCount++;
}

console.log('\nCust Type value distribution in file:');
console.log(custTypeCounts);

console.log('\nSFA vs SAP distribution:');
console.log({
  hasBothCount,
  onlySfaCount,
  onlySapCount,
  neitherCount,
  totalValidRows: rows.length - 4
});
