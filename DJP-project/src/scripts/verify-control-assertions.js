import { calculatePJP } from '../engines/pjp/pjp.engine.js';

const EXPECTED_ASSERTIONS = [
  { code: '1000000669', name: 'SAIKIA ENTERPRISE', category: 'Growing', grade: 'B', so: 2, asm: 2, rsm: 1, zh: 0 },
  { code: '1000001034', name: 'KALPANA HARDWARE-NGN', category: 'Growing', grade: 'B', so: 2, asm: 2, rsm: 1, zh: 0 },
  { code: '1000002747', name: 'NUNG ENTERPRISE', category: 'Need to Grow', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
  { code: '1000003202', name: 'BABU HARDWARE', category: 'De-growing', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
  { code: '1000003596', name: 'J.D. HARDWARE', category: 'De-growing', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
  { code: '1000000671', name: 'SANDHYA HARDWARE STORES', category: 'Zero Lifter', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
  { code: '1000003532', name: 'SWASTIK HARDWARE STORE', category: 'Zero Lifter', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
  { code: '1000003497', name: 'BISWAKARMA HARDWARE', category: 'Need to Grow', grade: 'C', so: 3, asm: 1, rsm: 0.5, zh: 0 },
  { code: 'WBS197', name: 'S S ENTERPRISE', category: 'Prospective', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 },
  { code: 'NSRE19295', name: 'MAA DURGA HARDWARE', category: 'Prospective', grade: 'D', so: 2, asm: 0.5, rsm: 0, zh: 0 }
];

async function main() {
  console.log('=== RUNNING PJP ENGINE & ASSERTING CONTROL RECORDS ===');
  const { results } = await calculatePJP('2026-06', 'C1', { persist: false });

  let totalPassed = 0;
  let totalFailed = 0;
  const assertionResults = [];

  for (const exp of EXPECTED_ASSERTIONS) {
    const found = results.find(r => 
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
        'Details': 'Dealer not found in active database population'
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
  console.log(`\nCONTROL ASSERTIONS RESULT: ${totalPassed} Passed, ${totalFailed} Failed.`);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
