import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { dbAll, dbGet } from '../config/database.js';

async function main() {
  console.log('================================================================');
  console.log('INGESTING AUTHORITATIVE MASTER FILES INTO MYSQL');
  console.log('================================================================');

  const mappingPath = 'upload-files/file-1788286244476-380209937.xlsx';
  const prospectPath = 'upload-files/file-1788285654173-601210103.xlsx';
  const salesPath = 'upload-files/file-1788285709647-776738376.xlsx';

  console.log('[1/3] Importing Dealer Mapping (M.xlsx)...');
  await importDealerMapping(mappingPath, 'BAT-FULL-MAPPING');

  console.log('[2/3] Importing Prospect Dealers...');
  await importProspectDealers(prospectPath, 'BAT-FULL-PROSPECT');

  console.log('[3/3] Importing Sales History (RSAR SALE)...');
  await importSalesHistory(salesPath, 'BAT-FULL-SALES');

  console.log('\n================================================================');
  console.log('RUNNING CANONICAL PJP CALCULATION FOR 2026-06 / C1');
  console.log('================================================================');
  
  const pjp = await calculatePJP('2026-06', 'C1', { persist: true });

  console.log('\n================================================================');
  console.log('CONTROL ASSERTIONS VERIFICATION');
  console.log('================================================================');

  const EXPECTED_ASSERTIONS = [
    { code: '1000000669', name: 'SAIKIA ENTERPRISE', category: 'Growing', grade: 'B', so: 2, asm: 2, rsm: 1, zh: 0 },
    { code: '1000001034', name: 'KALPANA HARDWARE-NGN', category: 'Growing', grade: 'B', so: 2, asm: 2, rsm: 1, zh: 0 },
    { code: '1000002747', name: 'NUNG ENTERPRISE', category: 'Need to Grow', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003202', name: 'BABU HARDWARE', category: 'De-growing', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003596', name: 'J.D. HARDWARE', category: 'Zero Lifter', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000000671', name: 'SANDHYA HARDWARE STORES', category: 'Zero Lifter', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003532', name: 'SWASTIK HARDWARE STORE', category: 'Zero Lifter', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003497', name: 'BISWAKARMA HARDWARE', category: 'Need to Grow', grade: 'C', so: 3, asm: 1, rsm: 0.5, zh: 0 },
    { code: 'WBS197', name: 'S S ENTERPRISE', category: 'Prospective', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: 'NSRE19295', name: 'MAA DURGA HARDWARE', category: 'Prospective', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 }
  ];

  let totalPassed = 0;
  let totalFailed = 0;
  const assertionResults = [];

  for (const exp of EXPECTED_ASSERTIONS) {
    const found = pjp.results.find(r => 
      r.sap_code === exp.code || 
      r.sfa_code === exp.code || 
      r.linked_dealer_code === exp.code || 
      r.dealerCode === exp.code ||
      (r.dealerName && r.dealerName.toUpperCase().includes(exp.name.toUpperCase()))
    );

    if (!found) {
      assertionResults.push({
        'Cust Code': exp.code,
        'Dealer Name': exp.name,
        'Status': '❌ MISSING IN PJP DATA',
        'Category': '-',
        'Grade': '-',
        'SO': '-', 'ASM': '-', 'RSM': '-', 'ZH': '-'
      });
      totalFailed++;
      continue;
    }

    const matchesCat = found.finalCategory === exp.category;
    const matchesGrade = found.grade === exp.grade;
    const matchesSO = Number(found.soVisits) === exp.so;
    const matchesASM = Number(found.asmVisits) === exp.asm;
    const matchesRSM = Number(found.rsmVisits) === exp.rsm;
    const matchesZH = Number(found.zhVisits) === exp.zh;

    const isMatch = matchesCat && matchesGrade && matchesSO && matchesASM && matchesRSM && matchesZH;

    if (isMatch) {
      totalPassed++;
      assertionResults.push({
        'Cust Code': exp.code,
        'Dealer Name': found.dealerName,
        'Status': '✅ PASSED',
        'Category': found.finalCategory,
        'Grade': found.grade,
        'SO': found.soVisits,
        'ASM': found.asmVisits,
        'RSM': found.rsmVisits,
        'ZH': found.zhVisits
      });
    } else {
      totalFailed++;
      assertionResults.push({
        'Cust Code': exp.code,
        'Dealer Name': found.dealerName,
        'Status': '❌ MISMATCH',
        'Category': `${found.finalCategory} (Exp: ${exp.category})`,
        'Grade': `${found.grade} (Exp: ${exp.grade})`,
        'SO': `${found.soVisits} (Exp: ${exp.so})`,
        'ASM': `${found.asmVisits} (Exp: ${exp.asm})`,
        'RSM': `${found.rsmVisits} (Exp: ${exp.rsm})`,
        'ZH': `${found.zhVisits} (Exp: ${exp.zh})`
      });
    }
  }

  console.table(assertionResults);
  console.log(`\nASSERTION SCOREBOARD: ${totalPassed} PASSED, ${totalFailed} FAILED out of ${EXPECTED_ASSERTIONS.length}`);

  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
