async function test() {
  // 1. Test filters
  const fRes = await fetch('http://localhost:3000/api/master/filters');
  const filters = await fRes.json();
  console.log('dpPeriods in filters:', filters.dpPeriods);

  // 2. Test default dealer performance
  const dpRes = await fetch('http://localhost:3000/api/master/dealer-performance');
  const dp = await dpRes.json();
  console.log('Default periodInfo:', dp.periodInfo);
  console.log('Default total:', dp.total);
  if (dp.performance && dp.performance.length > 0) {
    console.log('Sample row:', {
      sap_code: dp.performance[0].sap_code,
      dealer_name: dp.performance[0].dealer_name,
      tgt_m: dp.performance[0].tgt_m,
      prorata_tgt: dp.performance[0].prorata_tgt,
      sale_m: dp.performance[0].sale_m,
      shortfall: dp.performance[0].shortfall,
      prorata_achv: dp.performance[0].prorata_achv,
      sale_m1: dp.performance[0].sale_m1,
      variance_m1: dp.performance[0].variance_m1,
      growth_m1: dp.performance[0].growth_m1,
      sale_lysm: dp.performance[0].sale_lysm
    });
  }

  // 3. Test explicit period
  const dpMay = await fetch('http://localhost:3000/api/master/dealer-performance?period=2026-05');
  const dpMayJson = await dpMay.json();
  console.log('May 2026 periodInfo:', dpMayJson.periodInfo);
}

test().catch(console.error);
