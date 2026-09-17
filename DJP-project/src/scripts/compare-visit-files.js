import XLSX from 'xlsx';

async function main() {
  console.log('=== Inspecting full-generated-visit-file.xlsx ===');
  const wbGenerated = XLSX.readFile('upload-files/full-generated-visit-file.xlsx', { cellFormulas: true });
  console.log('Generated Sheet Names:', wbGenerated.SheetNames);
  
  for (const name of wbGenerated.SheetNames) {
    const s = wbGenerated.Sheets[name];
    const data = XLSX.utils.sheet_to_json(s, { header: 1 });
    console.log(`Sheet "${name}": ${data.length} rows`);
    if (data.length > 0) {
      console.log('Header row (row 0 or first non-empty):', data[0] || data[1] || data[2] || data[3]);
      console.log('Sample row 1:', data[1] || data[2] || data[3] || data[4]);
    }
  }

  console.log('\n=== Inspecting PJP Process -Trade.xlsx ===');
  const wbTrade = XLSX.readFile('upload-files/PJP Process -Trade.xlsx', { cellFormulas: true });
  console.log('Trade Sheet Names:', wbTrade.SheetNames);
  
  for (const name of wbTrade.SheetNames) {
    const s = wbTrade.Sheets[name];
    const data = XLSX.utils.sheet_to_json(s, { header: 1 });
    console.log(`Sheet "${name}": ${data.length} rows`);
    if (data.length > 0) {
      // Find header row
      let headerIdx = 0;
      for (let i = 0; i < Math.min(10, data.length); i++) {
        if (data[i] && data[i].length > 5) {
          headerIdx = i;
          break;
        }
      }
      console.log(`Header row (index ${headerIdx}):`, data[headerIdx]);
      if (data.length > headerIdx + 1) {
        console.log(`Sample row (index ${headerIdx + 1}):`, data[headerIdx + 1]);
      }
    }
  }
}

main().catch(console.error);
