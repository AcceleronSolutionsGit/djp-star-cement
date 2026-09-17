import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { dbAll, dbRun } from '../config/database.js';

async function main() {
  console.log('=== Clearing DB & Ingesting Sample Test Kit ===');
  await dbRun('DELETE FROM master_dealers');
  await dbRun('DELETE FROM sales_history');
  await dbRun('DELETE FROM dealer_visit_targets');

  console.log('[1/3] Ingesting Sample_Dealer_Mapping.xlsx...');
  await importDealerMapping('upload-files/Sample_Dealer_Mapping.xlsx', 'BAT-SAMPLE-MAP');

  console.log('[2/3] Ingesting Sample_Prospect_Dealers.xlsx...');
  await importProspectDealers('upload-files/Sample_Prospect_Dealers.xlsx', 'BAT-SAMPLE-PROSP');

  console.log('[3/3] Ingesting Sample_Sales_History.xlsx...');
  await importSalesHistory('upload-files/Sample_Sales_History.xlsx', 'BAT-SAMPLE-SALES');

  console.log('\n=== Calculating Canonical PJP for 2026-06 / C1 ===');
  const pjp = await calculatePJP('2026-06', 'C1', { persist: true });

  console.log('\n================================================================');
  console.log('SAMPLE TEST KIT CONTROL DEALER RESULTS');
  console.log('================================================================');

  const EXPECTED = [
    { code: '1000000669', name: 'SAIKIA ENTERPRISE', cat: 'Growing', grade: 'B', so: 2, asm: 2, rsm: 1, zh: 0 },
    { code: '1000001034', name: 'KALPANA HARDWARE-NGN', cat: 'Growing', grade: 'B', so: 2, asm: 2, rsm: 1, zh: 0 },
    { code: '1000002747', name: 'NUNG ENTERPRISE', cat: 'Need to Grow', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003202', name: 'BABU HARDWARE', cat: 'De-growing', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003596', name: 'J.D. HARDWARE', cat: 'Zero Lifter', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000000671', name: 'SANDHYA HARDWARE STORES', cat: 'Zero Lifter', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003532', name: 'SWASTIK HARDWARE STORE', cat: 'Zero Lifter', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: '1000003497', name: 'BISWAKARMA HARDWARE', cat: 'Need to Grow', grade: 'C', so: 3, asm: 1, rsm: 0.5, zh: 0 },
    { code: 'WBS197', name: 'S S ENTERPRISE', cat: 'Prospective', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
    { code: 'NSRE19295', name: 'MAA DURGA HARDWARE', cat: 'Prospective', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 }
  ];

  const results = [];
  for (const exp of EXPECTED) {
    const res = pjp.results.find(r => r.dealerCode === exp.code || r.sap_code === exp.code || r.sfa_code === exp.code);
    if (res) {
      const isCatMatch = res.finalCategory === exp.cat;
      const isGradeMatch = res.grade === exp.grade;
      const isVisitMatch = res.soVisits === exp.so && res.asmVisits === exp.asm && res.rsmVisits === exp.rsm && res.zhVisits === exp.zh;

      results.push({
        'Cust Code': exp.code,
        'Dealer Name': res.dealerName,
        'Category': res.finalCategory,
        'Grade': res.grade,
        'SO': res.soVisits,
        'ASM': res.asmVisits,
        'RSM': res.rsmVisits,
        'ZH': res.zhVisits,
        'Cat Match': isCatMatch ? '✅' : `❌ (Exp: ${exp.cat})`,
        'Grade Match': isGradeMatch ? '✅' : `❌ (Exp: ${exp.grade})`,
        'Visits Match': isVisitMatch ? '✅' : '❌'
      });
    }
  }

  console.table(results);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
