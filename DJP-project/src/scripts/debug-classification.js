import { loadDealersWithMappings, loadSalesHistory, loadBusinessRules } from '../engines/pjp/data-loader.engine.js';
import { calculatePeriods, aggregateDealerSales, calculateCounterShare } from '../engines/pjp/sales-calculation.engine.js';
import { classifyDealer } from '../engines/pjp/classification.engine.js';

async function test() {
  const reportMonth = '2026-06';
  const periods = calculatePeriods(reportMonth);
  console.log('Periods:', periods);

  const [allDealers, salesByDealer] = await Promise.all([
    loadDealersWithMappings(),
    loadSalesHistory(periods.allRequiredPeriods)
  ]);

  console.log('Dealers count:', allDealers.length);
  console.log('Sales keys count:', salesByDealer.size);

  const dealerSalesAgg = aggregateDealerSales(salesByDealer, periods);
  console.log('Sales agg count:', dealerSalesAgg.size);

  let matchedSalesCount = 0;
  for (const dealer of allDealers) {
    const sales = dealerSalesAgg.get(dealer.dealerCode) || 
                  dealerSalesAgg.get(dealer.sap_code) ||
                  dealerSalesAgg.get(dealer.rssd_code) ||
                  dealerSalesAgg.get(dealer.sfa_code);
    if (sales && (sales.currentSales > 0 || sales.sixMonthAverage > 0)) {
      matchedSalesCount++;
    }
  }
  console.log('Dealers with matched non-zero sales:', matchedSalesCount);

  // Print sample dealer
  const sampleWithSales = allDealers.find(d => {
    const s = dealerSalesAgg.get(d.dealerCode) || dealerSalesAgg.get(d.sap_code);
    return s && s.currentSales > 0;
  });
  console.log('Sample dealer with sales:', sampleWithSales);

  if (sampleWithSales) {
    const s = dealerSalesAgg.get(sampleWithSales.dealerCode) || dealerSalesAgg.get(sampleWithSales.sap_code);
    console.log('Sales data for sample:', s);
    const cls = classifyDealer({
      dealerType: sampleWithSales.dealer_type,
      doa: sampleWithSales.doa,
      reportMonth,
      currentSales: s.currentSales,
      previousMonthSales: s.previousMonthSales,
      sameMonthLastYearSales: s.sameMonthLastYearSales,
      sixMonthAverage: s.sixMonthAverage,
      needToGrow: false
    });
    console.log('Classification result for sample:', cls);
  }

  // Print sample dealer WITHOUT sales
  const sampleNoSales = allDealers[0];
  console.log('Sample dealer 0:', sampleNoSales);
  const cls0 = classifyDealer({
    dealerType: sampleNoSales.dealer_type,
    doa: sampleNoSales.doa,
    reportMonth,
    currentSales: 0,
    previousMonthSales: 0,
    sameMonthLastYearSales: 0,
    sixMonthAverage: 0,
    needToGrow: false
  });
  console.log('Classification for dealer 0:', cls0);

  process.exit(0);
}

test().catch(e => { console.error(e); process.exit(1); });
