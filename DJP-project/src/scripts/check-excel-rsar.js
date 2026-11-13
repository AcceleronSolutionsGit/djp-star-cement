import XLSX from 'xlsx';

const wb = XLSX.readFile('New Upload/Master Excel Oct.xlsx');
const ws = wb.Sheets['Master '];
const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

console.log('Checking first 10 RSAR rows in Master Excel Oct.xlsx:');
let rsarCount = 0;
for (let i = 4; i < rows.length; i++) {
  const r = rows[i];
  if (!r) continue;
  const custType = String(r[0] || '').trim();
  if (custType === 'RSAR') {
    rsarCount++;
    if (rsarCount <= 10) {
      console.log(`RSAR #${rsarCount} (Row ${i}):`);
      console.log('  Cust Type (Col 0):', r[0]);
      console.log('  Dealer Name (Col 12):', r[12]);
      console.log('  SFA Code (Col 10):', r[10]);
      console.log('  Customer code (Col 11):', r[11]);
      console.log('  SO Name (Col 8):', r[8]);
      console.log('  Area (Col 6):', r[6]);
      console.log('  Potential (Col 13):', r[13]);
      console.log('  Sales Sep26 (Col 14):', r[14]);
      console.log('  SO Visits (Col 27):', r[27]);
      console.log('  ASM Visits (Col 28):', r[28]);
    }
  }
}
console.log('Total RSARs in file:', rsarCount);
