import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { dbAll, dbGet } from '../config/database.js';

async function main() {
  console.log('=== Running Full PJP Calculation for 2026-06 / C1 ===');
  const pjp = await calculatePJP('2026-06', 'C1', { persist: true });

  const controlQueries = [
    { name: 'SANDHYA HARDWARE STORES', code: '1000000671' },
    { name: 'SREE BHANDER (SP FIRM)', code: '1000000673' },
    { name: 'SAIKIA ENTERPRISE', code: '1000000669' },
    { name: 'MAA HARDWARE (NAGAON)', code: '1000000653' },
    { name: 'MAHABIR HARDWARE (DOOM DOOMIA)', code: null },
    { name: 'HANUMAN BHANDAR (BOKOLIA)', code: null },
    { name: 'ANISUR ZAMAN', code: null },
    { name: 'S S ENTERPRISE (MALDA)', code: 'WBS197' },
    { name: 'MAA DURGA HARDWARE', code: 'NSRE19295' },
    { name: 'BABU HARDWARE', code: null },
    { name: 'J.D. HARDWARE', code: null }
  ];

  console.log('\n================================================================');
  console.log('11 CONTROL RECORDS VALIDATION RESULTS');
  console.log('================================================================');

  const results = [];

  for (const item of controlQueries) {
    let row = null;
    if (item.code) {
      row = await dbGet(
        'SELECT * FROM dealer_visit_targets WHERE sap_code = ? OR sfa_code = ? OR dealer_name LIKE ?',
        [item.code, item.code, `%${item.name}%`]
      );
    } else {
      row = await dbGet(
        'SELECT * FROM dealer_visit_targets WHERE dealer_name LIKE ?',
        [`%${item.name}%`]
      );
    }

    if (row) {
      results.push({
        'Dealer Name': row.dealer_name,
        'Cust Code': row.sap_code || row.sfa_code || '-',
        'Final Category (Category)': row.dealer_status,
        'Grade (Priority)': row.category,
        'SO Visits': row.so_visits,
        'ASM Visits': row.asm_visits,
        'RSM Visits': row.rsm_visits,
        'ZH Visits': row.zh_visits
      });
    } else {
      results.push({
        'Dealer Name': item.name,
        'Cust Code': item.code || 'NOT FOUND IN TARGETS',
        'Final Category (Category)': 'MISSING',
        'Grade (Priority)': 'MISSING',
        'SO Visits': '-',
        'ASM Visits': '-',
        'RSM Visits': '-',
        'ZH Visits': '-'
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
