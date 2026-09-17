import XLSX from 'xlsx';

async function main() {
  const filePath = 'upload-files/file-1788293969313-481918492.xlsx';
  const wb = XLSX.readFile(filePath);
  console.log('Workbook SheetNames:', wb.SheetNames);
  for (const s of wb.SheetNames) {
    const data = XLSX.utils.sheet_to_json(wb.Sheets[s], { header: 1 });
    console.log(`\n--- Sheet: "${s}" (Total rows: ${data.length}) ---`);
    console.log('Row 0:', data[0]);
    if (data.length > 1) console.log('Row 1:', data[1]);
    if (data.length > 2) console.log('Row 2:', data[2]);
    if (data.length > 3) console.log('Row 3:', data[3]);
  }
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
