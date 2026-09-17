import XLSX from 'xlsx';
import { dbAll } from '../config/database.js';

async function main() {
  const wbGen = XLSX.readFile('upload-files/full-generated-visit-file.xlsx');
  const genSheet = wbGen.Sheets['Sheet1'];
  const genRows = XLSX.utils.sheet_to_json(genSheet, { header: 1 });

  // Header is row index 1
  const excelDealers = [];
  for (let i = 2; i < genRows.length; i++) {
    const r = genRows[i];
    if (!r || r.length < 7) continue;
    excelDealers.push({
      area: r[1],
      block: r[2],
      asm: r[3],
      so_name: r[4],
      dealer_name: r[5],
      sfa_code: r[6],
      priority: r[7],
      category: r[8],
      so_visits: r[9],
      asm_visits: r[10],
      rsm_visits: r[11],
      zh_visits: r[12]
    });
  }

  console.log(`Loaded ${excelDealers.length} dealers from full-generated-visit-file.xlsx`);

  // Query database
  const dbDealers = await dbAll(`SELECT * FROM dealer_visit_targets`);

  console.log(`Loaded ${dbDealers.length} targets from database.sqlite`);

  // Map dbDealers by SFA Code / Dealer Name
  const dbMap = new Map();
  for (const d of dbDealers) {
    if (d.sfa_code) dbMap.set(String(d.sfa_code).trim().toUpperCase(), d);
    if (d.sap_code) dbMap.set(String(d.sap_code).trim().toUpperCase(), d);
    if (d.dealer_name) dbMap.set(String(d.dealer_name).trim().toUpperCase(), d);
  }

  let matchedCount = 0;
  let soMatch = 0;
  let asmMatch = 0;
  let rsmMatch = 0;
  let zhMatch = 0;
  let catMatch = 0;

  const mismatches = [];

  for (const excel of excelDealers) {
    const keySfa = (excel.sfa_code || '').trim().toUpperCase();
    const keyName = (excel.dealer_name || '').trim().toUpperCase();
    const db = dbMap.get(keySfa) || dbMap.get(keyName);

    if (db) {
      matchedCount++;
      const isSo = Number(excel.so_visits) === Number(db.so_visits);
      const isAsm = Number(excel.asm_visits) === Number(db.asm_visits);
      const isRsm = Number(excel.rsm_visits) === Number(db.rsm_visits);
      const isZh = Number(excel.zh_visits) === Number(db.zh_visits);
      const isCat = (excel.category || '').toLowerCase() === (db.dealer_status || db.category || '').toLowerCase();

      if (isSo) soMatch++;
      if (isAsm) asmMatch++;
      if (isRsm) rsmMatch++;
      if (isZh) zhMatch++;
      if (isCat) catMatch++;

      if (!isSo || !isAsm || !isRsm || !isZh || !isCat) {
        if (mismatches.length < 25) {
          mismatches.push({
            name: excel.dealer_name,
            sfa: excel.sfa_code,
            excel: { so: excel.so_visits, asm: excel.asm_visits, rsm: excel.rsm_visits, zh: excel.zh_visits, cat: excel.category },
            db: { so: db.so_visits, asm: db.asm_visits, rsm: db.rsm_visits, zh: db.zh_visits, cat: db.dealer_status || db.category }
          });
        }
      }
    }
  }

  console.log(`\n========================================`);
  console.log(`Matched Dealers: ${matchedCount} / ${excelDealers.length}`);
  if (matchedCount > 0) {
    console.log(`SO Visits Match:   ${soMatch} / ${matchedCount} (${((soMatch/matchedCount)*100).toFixed(1)}%)`);
    console.log(`ASM Visits Match:  ${asmMatch} / ${matchedCount} (${((asmMatch/matchedCount)*100).toFixed(1)}%)`);
    console.log(`RSM Visits Match:  ${rsmMatch} / ${matchedCount} (${((rsmMatch/matchedCount)*100).toFixed(1)}%)`);
    console.log(`ZH Visits Match:   ${zhMatch} / ${matchedCount} (${((zhMatch/matchedCount)*100).toFixed(1)}%)`);
    console.log(`Category Match:    ${catMatch} / ${matchedCount} (${((catMatch/matchedCount)*100).toFixed(1)}%)`);
  }
  console.log(`========================================`);

  console.log('\nSample Mismatches (First 25):');
  console.dir(mismatches, { depth: null });
}

main().catch(console.error);
