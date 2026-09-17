import XLSX from 'xlsx';

async function main() {
  const wbGen = XLSX.readFile('upload-files/full-generated-visit-file.xlsx');
  const wbTrade = XLSX.readFile('upload-files/PJP Process -Trade.xlsx');

  const genSheet = wbGen.Sheets['Sheet1'];
  const genRows = XLSX.utils.sheet_to_json(genSheet, { header: 1 });

  const visitSheet = wbTrade.Sheets['Visits'];
  const visitRows = XLSX.utils.sheet_to_json(visitSheet, { header: 1 });

  console.log(`genRows: ${genRows.length}, visitRows: ${visitRows.length}`);
  let diffCount = 0;
  for (let i = 0; i < Math.max(genRows.length, visitRows.length); i++) {
    const r1 = JSON.stringify(genRows[i]);
    const r2 = JSON.stringify(visitRows[i]);
    if (r1 !== r2) {
      diffCount++;
      if (diffCount <= 5) {
        console.log(`Diff at row ${i}:`);
        console.log(' Gen:  ', genRows[i]);
        console.log(' Visit:', visitRows[i]);
      }
    }
  }
  console.log(`Total row differences between full-generated-visit-file.xlsx and Visits tab: ${diffCount}`);
}

main().catch(console.error);
