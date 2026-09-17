import { loadDealerPerformanceHistory, computeDpMetrics } from '../src/engines/pjp/data-loader.engine.js';
import { calculatePeriods } from '../src/engines/pjp/sales-calculation.engine.js';
import { calculatePJP } from '../src/engines/pjp/pjp.engine.js';

async function testCalc() {
  const periods = calculatePeriods('2026-06');
  console.log('Periods for 2026-06:', periods);

  const dpData = await loadDealerPerformanceHistory(periods.allRequiredPeriods);
  console.log('Loaded DP dealers count:', dpData.size);

  const { avgMap, lysmMap } = computeDpMetrics(
    dpData,
    periods.last6Periods,
    periods.lysmPeriod
  );

  console.log('\nDP Metrics:');
  for (const [code, avg] of avgMap.entries()) {
    console.log(`Dealer ${code}: 6M Avg = ${avg}, LYSM = ${lysmMap.get(code)}`);
  }

  console.log('\nRunning PJP Calculation for 2026-06 (in memory):');
  const pjpRes = await calculatePJP('2026-06', 'C1', { persist: false });
  console.log('\nPJP Results Summary:');
  for (const r of pjpRes.results) {
    console.log({
      sap: r.dealer?.sap_code,
      name: r.dealer?.dealer_name,
      custType: r.dealer?.cust_type,
      CM: r.dealer?.currentSales,
      PM: r.dealer?.previousSales,
      LYSM: r.dealer?.lysmSales,
      sixMonthAvg: r.dealer?.sixMonthAverage,
      dpSixMonthAvg: r.dealer?.dpSixMonthAverage,
      status: r.dealerStatus,
      grade: r.category,
      scoreA: r.scoreA,
      scoreB: r.scoreB,
      scoreC: r.scoreC,
      totalScore: r.totalScore,
      visits: {
        SO: r.visits?.soVisits,
        ASM: r.visits?.asmVisits,
        RSM: r.visits?.rsmVisits,
        ZH: r.visits?.zhVisits,
        total: r.visits?.totalVisits
      }
    });
  }

  process.exit(0);
}

testCalc().catch(e => { console.error(e); process.exit(1); });
