import fs from 'fs';
import path from 'path';

const files = fs.readdirSync('upload-files');
for (const f of files) {
  const stat = fs.statSync(path.join('upload-files', f));
  console.log(`${f}: ${(stat.size / 1024).toFixed(1)} KB`);
}
