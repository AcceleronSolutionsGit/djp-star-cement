import XLSX from 'xlsx';

async function main() {
  const wbPjp = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  const masterSheet = wbPjp.Sheets['Master '];
  const masterRows = XLSX.utils.sheet_to_json(masterSheet, { header: 1 });

  // Master row 3 is header:
  // Col 10 (K): SFA CODE
  // Col 11 (L): Customer code (SAP Code)
  // Col 12 (M): DEALER NAME
  // Col 6 (G): AREA
  // Col 8 (I): SO/SE NAME
  // Col 2 (C): Zone

  const sfaToSapMap = new Map();
  const nameToSapMap = new Map();

  for (let r = 4; r < masterRows.length; r++) {
    const row = masterRows[r];
    if (!row || !row[12]) continue;

    const sfaCode = (row[10] || '').toString().trim();
    const sapCode = (row[11] || '').toString().trim();
    const dealerName = (row[12] || '').toString().trim();
    const area = (row[6] || '').toString().trim();
    const zone = (row[2] || '').toString().trim();
    const soName = (row[8] || '').toString().trim();

    if (sfaCode && sapCode && sapCode !== '-') {
      sfaToSapMap.set(sfaCode.toUpperCase(), { sapCode, sfaCode, dealerName, area, zone, soName });
    }
    if (dealerName) {
      nameToSapMap.set(`${dealerName}_${area}`.toUpperCase(), { sapCode, sfaCode, dealerName, area, zone, soName });
    }
  }

  console.log(`Found ${sfaToSapMap.size} direct SFA Code -> SAP Code mappings in Master sheet.`);

  // Load Hierarchy file
  const wbH = XLSX.readFile('upload-files/Dealer - SO Territory Hierarchy Mapping.xlsx');
  const hSheet = wbH.Sheets['Sheet1'] || wbH.Sheets[wbH.SheetNames[0]];
  const hRows = XLSX.utils.sheet_to_json(hSheet);

  console.log(`Hierarchy file has ${hRows.length} official dealer-SO mapping rows.`);

  // Check ALOM ENTERPRISE
  console.log('\n--- ALOM ENTERPRISE check in Hierarchy file ---');
  hRows.filter(r => String(r['Dealer Name']).includes('ALOM ENTERPRISE')).forEach(r => console.log(r));
}

main().catch(console.error);
