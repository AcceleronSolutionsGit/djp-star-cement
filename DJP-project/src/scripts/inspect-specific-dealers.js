import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  const masterSheet = wb.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });

  const targetNames = [
    'KALIMI HARDWARE STORES',
    'MANDAL ENTERPRISE',
    'SHIV SHAKTI HARDWARE',
    'MATADI BUILDERS',
    'RANI SATI TRADING CO.',
    'SHIVA TRADING AND COMPANY'
  ];

  const headers = masterRows[3];

  for (let r = 4; r < masterRows.length; r++) {
    const row = masterRows[r];
    if (!row || !row[12]) continue;

    const name = row[12].toString().trim().toUpperCase();
    if (targetNames.some(t => name.includes(t))) {
      console.log(`\n==================================================`);
      console.log(`Row ${r + 1}: ${row[12]} (SFA: ${row[10]}, Area: ${row[6]}, SO: ${row[8]})`);
      console.log(`==================================================`);
      headers.forEach((h, idx) => {
        const val = row[idx];
        if (val !== undefined && val !== null && val !== '') {
          console.log(`  Col ${String(idx).padStart(2)} [${XLSX.utils.encode_col(idx)}] (${h}): ${JSON.stringify(val)}`);
        }
      });
    }
  }
}

main().catch(console.error);
