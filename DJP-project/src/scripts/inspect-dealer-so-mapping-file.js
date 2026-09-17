import XLSX from 'xlsx';

async function main() {
  const filePath = 'upload-files/Dealer - SO Territory Hierarchy Mapping.xlsx';
  console.log(`=== Inspecting ${filePath} ===`);
  const wb = XLSX.readFile(filePath);
  console.log('Sheet Names:', wb.SheetNames);

  for (const name of wb.SheetNames) {
    console.log(`\n--- Sheet: "${name}" ---`);
    const sheet = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`Total rows: ${rows.length}`);
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      if (rows[i] && rows[i].length > 0) {
        console.log(`Row ${i}:`, rows[i]);
      }
    }
  }
}

main().catch(console.error);
