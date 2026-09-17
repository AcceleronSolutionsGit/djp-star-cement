import XLSX from 'xlsx';

async function main() {
  const wb = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');
  const sheet = wb.Sheets['Rules Approved'];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

  console.log('=== Rules Approved Complete Dump ===');
  rows.forEach((r, idx) => {
    if (r && r.length > 0) {
      console.log(`Row ${String(idx).padStart(2)}:`, r);
    }
  });
}

main().catch(console.error);
