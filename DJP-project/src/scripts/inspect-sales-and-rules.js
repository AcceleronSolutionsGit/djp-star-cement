import XLSX from 'xlsx';

async function main() {
  console.log('=== Inspecting RSAR SALE NE File ===');
  const salesWb = XLSX.readFile('upload-files/RSAR SALE- NE-APRIL-24 TO JUNE-26.xlsx');
  const neSheet = salesWb.Sheets['NE'];
  const salesRows = XLSX.utils.sheet_to_json(neSheet);
  console.log('Total sales rows in NE sheet:', salesRows.length);
  if (salesRows.length > 0) {
    console.log('Sample sales row keys:', Object.keys(salesRows[0]));
  }
  
  const achumiSales = salesRows.filter(r => {
    const s = String(r['Sub Dealer Name'] || r['SAP Code'] || r['RSSD Code'] || '').toLowerCase();
    return s.includes('achumi') || String(r['SAP Code']) === '1000003100' || String(r['RSSD Code']) === 'NEA362';
  });
  console.log('ACHUMI sales rows count:', achumiSales.length);
  if (achumiSales.length > 0) {
    console.log('Sample ACHUMI sales row:', achumiSales[0]);
  }

  console.log('\n=== Inspecting PJP Process -Trade.xlsx tabs ===');
  const pjpWb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  
  for (const name of pjpWb.SheetNames) {
    const s = pjpWb.Sheets[name];
    const data = XLSX.utils.sheet_to_json(s);
    console.log(`Sheet: "${name}", Rows: ${data.length}`);
    if (data.length > 0) {
      console.log(`  Sample row keys:`, Object.keys(data[0]));
    }
  }
}

main().catch(console.error);
