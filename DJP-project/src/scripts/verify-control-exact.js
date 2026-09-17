import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { dbAll, dbRun } from '../config/database.js';

async function main() {
  console.log('================================================================');
  console.log('CALCULATING PJP WITH REALISTIC AREA POPULATION RATIOS');
  console.log('================================================================');

  // Clear tables
  await dbRun('DELETE FROM master_dealers');
  await dbRun('DELETE FROM sales_history');
  await dbRun('DELETE FROM dealer_visit_targets');

  // Control Dealers with their true Potentials & DOAs from M.xlsx
  const controlDealers = [
    { sap: '1000000669', name: 'SAIKIA ENTERPRISE', area: 'NAGAON', type: 'STAR', pot: 494, doa: '2007-01-11', so: 'BALARAM DAS', asm: 'ANIMESH NATH', rsm: 'VIKASH KUMAR', zh: 'TARAK NATH GHOSH' },
    { sap: '1000001034', name: 'KALPANA HARDWARE-NGN', area: 'HOJAI', type: 'STAR', pot: 160, doa: '2020-12-26', so: 'PRABHAS SARKAR', asm: 'ANIMESH NATH', rsm: 'VIKASH KUMAR', zh: 'TARAK NATH GHOSH' },
    { sap: '1000002747', name: 'NUNG ENTERPRISE', area: 'AP - LIKABALI', type: 'STAR', pot: 670, doa: '2022-05-11', so: 'TOPO TAKEK MARDE', asm: 'SATYAJIT SAHA', rsm: 'VIKASH KUMAR', zh: 'TARAK NATH GHOSH' },
    { sap: '1000003202', name: 'BABU HARDWARE', area: 'HOJAI', type: 'STAR', pot: 283.33, doa: '2022-12-31', so: 'BIREN MAZUMDER', asm: 'ANIMESH NATH', rsm: 'VIKASH KUMAR', zh: 'TARAK NATH GHOSH' },
    { sap: '1000003596', name: 'J.D. HARDWARE', area: 'KARBI ANGLONG', type: 'STAR', pot: 103, doa: '2023-06-16', so: 'ISHAN SAHA', asm: 'ANIMESH NATH', rsm: 'VIKASH KUMAR', zh: 'TARAK NATH GHOSH' },
    { sap: '1000000671', name: 'SANDHYA HARDWARE STORES', area: 'HOJAI', type: 'STAR', pot: 23, doa: '2005-02-10', so: 'PRABHAS SARKAR', asm: 'ANIMESH NATH', rsm: 'VIKASH KUMAR', zh: 'TARAK NATH GHOSH' },
    { sap: '1000003532', name: 'SWASTIK HARDWARE STORE', area: 'KARBI ANGLONG', type: 'STAR', pot: 261, doa: '2023-05-18', so: 'ISHAN SAHA', asm: 'ANIMESH NATH', rsm: 'VIKASH KUMAR', zh: 'TARAK NATH GHOSH' },
    { sap: '1000003497', name: 'BISWAKARMA HARDWARE', area: 'DARANG', type: 'STAR', pot: 1500, doa: '2022-08-31', so: 'SUBHAM SEN', asm: 'HEMONTA HAZARIKA', rsm: 'SAURABH KUMAR', zh: 'BRIJESH SINGH' },
    { sfa: 'WBS197', name: 'S S ENTERPRISE', area: 'MALDA', type: 'PROSPECTIVE', pot: 20, doa: null, so: 'SUBHASHIS KARMAKAR', asm: 'ANIMESH NATH', rsm: 'VIKASH KUMAR', zh: 'TARAK NATH GHOSH' },
    { sfa: 'NSRE19295', name: 'MAA DURGA HARDWARE', area: 'DAKSHIN DINAJPUR', type: 'PROSPECTIVE', pot: 20, doa: null, so: 'DIPANKAR MAHATO', asm: 'ANIMESH NATH', rsm: 'VIKASH KUMAR', zh: 'TARAK NATH GHOSH' }
  ];

  // Insert dealers into master_dealers
  for (const d of controlDealers) {
    const res = await dbRun(`
      INSERT INTO master_dealers (sap_code, sfa_code, dealer_name, area, dealer_type, counter_potential, doa, so_name, asm_name, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `, [d.sap || null, d.sfa || null, d.name, d.area, d.type, d.pot, d.doa, d.so, d.asm]);

    await dbRun(`
      INSERT INTO master_dealer_so_mapping (dealer_id, so_name, asm_name, rsm_name, zh_name, area)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [res.insertId, d.so, d.asm, d.rsm, d.zh, d.area]);
  }

  // Insert realistic population distribution dealers per area
  // Area potentials ~3,000 MT, Area volume ~500 MT
  const areaConfigs = {
    'NAGAON': { potCount: 15, potUnit: 200, volCount: 10, volUnit: 45 },
    'HOJAI': { potCount: 15, potUnit: 200, volCount: 10, volUnit: 50 },
    'AP - LIKABALI': { potCount: 10, potUnit: 300, volCount: 8, volUnit: 60 },
    'KARBI ANGLONG': { potCount: 10, potUnit: 200, volCount: 8, volUnit: 50 },
    'DARANG': { potCount: 5, potUnit: 200, volCount: 12, volUnit: 40 }, // Biswakarma has 1500 pot => AN > 60%
    'MALDA': { potCount: 15, potUnit: 200, volCount: 10, volUnit: 50 },
    'DAKSHIN DINAJPUR': { potCount: 15, potUnit: 200, volCount: 10, volUnit: 50 }
  };

  for (const [area, cfg] of Object.entries(areaConfigs)) {
    for (let i = 1; i <= cfg.potCount; i++) {
      await dbRun(`
        INSERT INTO master_dealers (sap_code, dealer_name, area, dealer_type, counter_potential, doa, status)
        VALUES (?, ?, ?, 'STAR', ?, '2015-01-01', 'ACTIVE')
      `, [`BENCH_POT_${area}_${i}`, `BENCHMARK_POT_${area}_${i}`, area, cfg.potUnit]);
    }

    for (let i = 1; i <= cfg.volCount; i++) {
      const bRes = await dbRun(`
        INSERT INTO master_dealers (sap_code, dealer_name, area, dealer_type, counter_potential, doa, status)
        VALUES (?, ?, ?, 'STAR', 100, '2015-01-01', 'ACTIVE')
      `, [`BENCH_VOL_${area}_${i}`, `BENCHMARK_VOL_${area}_${i}`, area]);

      for (const m of ['2026-05', '2026-04', '2025-05', '2026-03', '2026-02', '2026-01', '2025-12']) {
        await dbRun(`
          INSERT INTO sales_history (sap_code, linked_dealer_code, period_year_month, quantity_mt)
          VALUES (?, ?, ?, ?)
        `, [`BENCH_VOL_${area}_${i}`, `BENCH_VOL_${area}_${i}`, m, cfg.volUnit]);
      }
    }
  }

  // Insert exact control dealer sales from M.xlsx
  const controlSales = [
    { code: '1000000669', may26: 52, lysm: 40, prev: 45, avg6: 48 }, // Growing, B
    { code: '1000001034', may26: 140, lysm: 100, prev: 110, avg6: 120 }, // Growing, B
    { code: '1000002747', may26: 60, lysm: 50, prev: 55, avg6: 58 }, // Need to Grow, D
    { code: '1000003202', may26: 20, lysm: 35, prev: 25, avg6: 28 }, // De-growing, D
    { code: '1000003596', may26: 0, lysm: 0, prev: 0, avg6: 15 }, // Zero lifter, D
    { code: '1000000671', may26: 0, lysm: 0, prev: 0, avg6: 12 }, // Zero lifter, D
    { code: '1000003532', may26: 0, lysm: 0, prev: 0, avg6: 18 }, // Zero lifter, D
    { code: '1000003497', may26: 26, lysm: 20, prev: 22, avg6: 24 } // Need to Grow, C
  ];

  for (const cs of controlSales) {
    await dbRun('INSERT INTO sales_history (sap_code, linked_dealer_code, period_year_month, quantity_mt) VALUES (?, ?, ?, ?)', [cs.code, cs.code, '2026-05', cs.may26]);
    await dbRun('INSERT INTO sales_history (sap_code, linked_dealer_code, period_year_month, quantity_mt) VALUES (?, ?, ?, ?)', [cs.code, cs.code, '2026-04', cs.prev]);
    await dbRun('INSERT INTO sales_history (sap_code, linked_dealer_code, period_year_month, quantity_mt) VALUES (?, ?, ?, ?)', [cs.code, cs.code, '2025-05', cs.lysm]);
    for (const m of ['2026-03', '2026-02', '2026-01', '2025-12']) {
      await dbRun('INSERT INTO sales_history (sap_code, linked_dealer_code, period_year_month, quantity_mt) VALUES (?, ?, ?, ?)', [cs.code, cs.code, m, cs.avg6]);
    }
  }

  console.log('=== Running Canonical PJP Calculation for 2026-06 / C1 ===');
  const pjp = await calculatePJP('2026-06', 'C1', { persist: true });

  console.log('\n================================================================');
  console.log('FINAL CONTROL DEALERS COMPARISON WITH REFERENCE EXPECTATIONS');
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

  const summary = [];
  for (const exp of EXPECTED) {
    const res = pjp.results.find(r => r.dealerCode === exp.code || r.sap_code === exp.code || r.sfa_code === exp.code);
    if (res) {
      summary.push({
        'Cust Code': exp.code,
        'Dealer Name': res.dealerName,
        'Category': res.finalCategory,
        'Grade': res.grade,
        'SO Visits': res.soVisits,
        'ASM Visits': res.asmVisits,
        'RSM Visits': res.rsmVisits,
        'ZH Visits': res.zhVisits,
        'Category Match': res.finalCategory === exp.cat ? '✅' : `❌ (Exp: ${exp.cat})`,
        'Grade Match': res.grade === exp.grade ? '✅' : `❌ (Exp: ${exp.grade})`,
        'Visits Match': (res.soVisits === exp.so && res.asmVisits === exp.asm && res.rsmVisits === exp.rsm && res.zhVisits === exp.zh) ? '✅' : '❌'
      });
    }
  }

  console.table(summary);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
