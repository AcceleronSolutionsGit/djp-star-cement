import XLSX from 'xlsx';
import fs from 'fs';

const files = fs.readdirSync('upload-files').filter(f => f.startsWith('file-17885169'));
for (const f of files) {
  const wb = XLSX.readFile(`upload-files/${f}`);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  console.log(`\nFile: ${f}`);
  console.log('Row 1:', rows[0] ? rows[0].slice(0, 8) : []);
  if (rows[1]) console.log('Row 2:', rows[1].slice(0, 8));
}
process.exit(0);
