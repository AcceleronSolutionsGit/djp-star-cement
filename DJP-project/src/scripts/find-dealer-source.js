import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { dbAll } from '../config/database.js';

async function main() {
  console.log('=== Checking database.sqlite for AAD HOME SOLUTION / NEA446 ===');

  const dbRows = await dbAll(
    'SELECT * FROM master_dealer_so_mapping WHERE sap_code LIKE "%NEA446%" OR dealer_name LIKE "%AAD HOME SOLUTION%"'
  );
  console.log('Database master_dealer_so_mapping rows:');
  console.dir(dbRows, { depth: null });

  const target = 'AAD HOME SOLUTION';
  const targetCode = 'NEA446';

  const uploadDir = 'upload-files';
  const files = fs.readdirSync(uploadDir).filter(f => f.endsWith('.xlsx') || f.endsWith('.xls'));

  console.log('\n=== Searching Excel files in upload-files/ ===');

  for (const file of files) {
    const filePath = path.join(uploadDir, file);
    try {
      const wb = XLSX.readFile(filePath);
      for (const sName of wb.SheetNames) {
        const sheet = wb.Sheets[sName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        rows.forEach((r, idx) => {
          const str = JSON.stringify(r);
          if (str.includes(target) || str.includes(targetCode)) {
            console.log(`Found in file: "${file}", Sheet: "${sName}", Row index: ${idx} (Excel row ${idx + 1}):`);
            console.log(r);
          }
        });
      }
    } catch (e) {
      // Ignore unreadable
    }
  }
}

main().catch(console.error);
