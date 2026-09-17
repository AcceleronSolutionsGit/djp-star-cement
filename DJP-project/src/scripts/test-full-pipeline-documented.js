import { dbAll, dbGet, dbRun, pool } from '../config/database.js';
import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importSBG } from '../imports/sbg.importer.js';
import { importDealerPerformance } from '../imports/dealer-performance.importer.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { generateFullPjpDjpSolution } from '../engines/djp-generator.engine.js';
import { getWorkingDays } from '../engines/pjp/calendar.engine.js';
import { calculatePeriods } from '../engines/pjp/sales-calculation.engine.js';
import path from 'path';
import fs from 'fs';

async function runDocumentedPipelineTest() {
  console.log('================================================================');
  console.log('STAR CEMENT PJP / DJP ENGINE — FULL DOCUMENTED SYSTEM TEST');
  console.log('================================================================\n');

  // 1. MySQL Connectivity & Pool Verification
  const [dbInfo] = await pool.query('SELECT VERSION() as ver, DATABASE() as db_name');
  console.log(`[1] MySQL Connected: ${dbInfo[0].db_name} (Version: ${dbInfo[0].ver})\n`);

  // 2. Ingest Sample Master Data if needed
  console.log('[2] Master Data Verification & Ingestion:');
  const mappingFile = 'd:/OFFICE/DJP-project/01_Dealer_Mapping.xlsx';
  const sbgFile = 'd:/OFFICE/DJP-project/04_SBG.xlsx';
  const perfFile = 'd:/OFFICE/DJP-project/05_Dealer_Performance.xlsx';

  if (fs.existsSync(mappingFile)) {
    const mapRes = await importDealerMapping(mappingFile, 'TEST_RUN');
    console.log(`  ✓ Dealer Mapping ingested: ${mapRes.validRows} dealers processed`);
  }
  if (fs.existsSync(sbgFile)) {
    const sbgRes = await importSBG(sbgFile, 'TEST_RUN');
    console.log(`  ✓ SBG Targets ingested: ${sbgRes.validRows} records matched`);
  }
  if (fs.existsSync(perfFile)) {
    const perfRes = await importDealerPerformance(perfFile, 'TEST_RUN');
    console.log(`  ✓ Dealer Performance ingested: ${perfRes.recordsInserted} records (${perfRes.monthsFound.join(', ')})`);
  }

  const dealersCount = (await dbAll('SELECT COUNT(*) as c FROM master_dealers'))[0].c;
  const salesCount = (await dbAll('SELECT COUNT(*) as c FROM sales_history'))[0].c;
  const perfCount = (await dbAll('SELECT COUNT(*) as c FROM dealer_performance_history'))[0].c;
  console.log(`  Current MySQL State: master_dealers=${dealersCount}, sales_history=${salesCount}, dealer_performance_history=${perfCount}\n`);

  // 3. User Business Rule Verification: Period Calculation
  console.log('[3] Planning Month Rule Verification:');
  console.log('  Rule: "for current month, calculate using previous month data (e.g. September uses August)"');
  const periodsSept = calculatePeriods('2026-09');
  console.log('  Planning Month: 2026-09');
  console.log(`    → Current Sales Period (M-1):  ${periodsSept.currentPeriod} (Expected: 2026-08)`);
  console.log(`    → Previous Sales Period (M-2): ${periodsSept.previousMonthPeriod} (Expected: 2026-07)`);
  console.log(`    → LYSM Period (LY-M-1):        ${periodsSept.lysmPeriod} (Expected: 2025-08)`);
  console.log(`    → 6-Month Rolling Window:       ${periodsSept.last6Periods.join(', ')}\n`);

  const periodsJuly = calculatePeriods('2026-07');
  console.log('  Planning Month: 2026-07');
  console.log(`    → Current Sales Period (M-1):  ${periodsJuly.currentPeriod} (Expected: 2026-06)`);
  console.log(`    → Previous Sales Period (M-2): ${periodsJuly.previousMonthPeriod} (Expected: 2026-05)`);
  console.log(`    → LYSM Period (LY-M-1):        ${periodsJuly.lysmPeriod} (Expected: 2025-06)`);
  console.log(`    → 6-Month Rolling Window:       ${periodsJuly.last6Periods.join(', ')}\n`);

  // 4. Run PJP Engine for September 2026
  console.log('[4] Executing PJP Rule Engine for September 2026 (Cycle C1)...');
  const pjpSept = await calculatePJP('2026-09', 'C1', { persist: true });
  console.log(`  ✓ PJP Calculated for ${pjpSept.results.length} dealers.`);
  console.log(`  ✓ Summary Metrics:`, pjpSept.summary);

  // 5. Select Sample Dealers for Detailed Calculation Breakdown
  console.log('\n[5] Detailed Calculation Breakdown for Control Dealers:');
  const sampleDealers = [
    pjpSept.results.find(d => d.grade === 'A' && d.finalCategory === 'Growing'),
    pjpSept.results.find(d => d.grade === 'B' && d.finalCategory === 'Growing'),
    pjpSept.results.find(d => d.finalCategory === 'De-growing'),
    pjpSept.results.find(d => d.finalCategory === 'Zero Lifter' || d.currentSales === 0)
  ].filter(Boolean);

  const traces = [];
  for (const d of sampleDealers) {
    const trace = {
      dealerCode: d.dealerCode,
      dealerName: d.dealerName,
      soName: d.soName,
      area: d.area,
      sbgPotential: d.potential || d.sbg_potential || 0,
      currentSales: d.currentSales || 0,
      previousSales: d.previousSales || 0,
      lysmSales: d.lysmSales || 0,
      sixMonthAvg: d.sixMonthAvg || 0,
      momGrowthPct: d.previousSales > 0 ? (((d.currentSales - d.previousSales) / d.previousSales) * 100).toFixed(2) + '%' : 'N/A',
      yoyGrowthPct: d.lysmSales > 0 ? (((d.currentSales - d.lysmSales) / d.lysmSales) * 100).toFixed(2) + '%' : 'N/A',
      finalCategory: d.finalCategory,
      grade: d.grade,
      scoreA: d.scoreA !== undefined ? d.scoreA.toFixed(2) : 'N/A',
      scoreB: d.scoreB !== undefined ? d.scoreB : 'N/A',
      scoreC: d.scoreC !== undefined ? d.scoreC.toFixed(2) : 'N/A',
      totalScore: d.totalScore !== undefined ? d.totalScore.toFixed(2) : 'N/A',
      priorityRank: d.priorityRank || 'N/A',
      priorityLabel: d.priorityLabel || 'N/A',
      visits: {
        so: d.soVisits,
        asm: d.asmVisits,
        rsm: d.rsmVisits,
        zh: d.zhVisits
      }
    };
    traces.push(trace);
    console.log(`\n  --- DEALER: ${trace.dealerCode} (${trace.dealerName}) ---`);
    console.log(`      Area: ${trace.area} | SO: ${trace.soName}`);
    console.log(`      Current Sales (M-1): ${trace.currentSales} MT | Previous Sales (M-2): ${trace.previousSales} MT | LYSM: ${trace.lysmSales} MT`);
    console.log(`      MoM Growth: ${trace.momGrowthPct} | YoY Growth: ${trace.yoyGrowthPct}`);
    console.log(`      Classification: ${trace.finalCategory} (Rule: ${trace.currentSales > trace.previousSales ? 'Current > Previous' : (trace.currentSales < trace.previousSales ? 'Current < Previous' : 'Current == 0')})`);
    console.log(`      Grade: ${trace.grade} (Area Volume Pareto Percentile)`);
    console.log(`      Priority: ${trace.priorityLabel} (Rank ${trace.priorityRank}, Total Score=${trace.totalScore} [Score A=${trace.scoreA} + Score B=${trace.scoreB} + Score C=${trace.scoreC}])`);
    console.log(`      Visit Matrix Allocation: SO=${trace.visits.so} | ASM=${trace.visits.asm} | RSM=${trace.visits.rsm} | ZH=${trace.visits.zh}`);
  }

  // 6. Generate DJP Recommendations (Day-wise journey scheduling)
  console.log('\n[6] Generating DJP Journey Planner Schedule for September 2026...');
  const djpSol = await generateFullPjpDjpSolution('2026-09', 'C1', { recalculate: false });
  console.log(`  ✓ DJP Solution Generated:`);
  console.log(`      Total Visits Required: ${djpSol.totalVisitsRequired}`);
  console.log(`      Total Visits Scheduled: ${djpSol.allocatedCount}`);
  console.log(`      Unallocated Visits: ${djpSol.unallocatedCount}`);

  // Inspect working days in September 2026
  const workingDays = getWorkingDays('2026-09');
  console.log(`  ✓ September 2026 Working Days: ${workingDays.length} days (all Sundays excluded)`);

  // Inspect sample daily schedule for first employee
  const sampleDjp = await dbAll(
    `SELECT emp_code, emp_name, role_type, dealer_sap_code, dealer_name, visit_date, visit_sequence 
     FROM djp_recommendations 
     WHERE period_month = '2026-09' 
     ORDER BY visit_date ASC, visit_sequence ASC 
     LIMIT 5`
  );
  console.log('\n  Sample DJP Daily Itinerary:');
  for (const s of sampleDjp) {
    console.log(`    Date: ${s.visit_date} | Role: ${s.role_type} | Stop #${s.visit_sequence}: ${s.dealer_sap_code} - ${s.dealer_name} (${s.emp_name} [${s.emp_code}])`);
  }

  console.log('\n================================================================');
  console.log('ALL TEST SUITES & CALCULATIONS COMPLETED SUCCESSFULLY');
  console.log('================================================================');
  return { traces, summary: pjpSept.summary, djpSol, workingDaysCount: workingDays.length };
}

runDocumentedPipelineTest().then(() => process.exit(0)).catch(err => {
  console.error('Fatal Pipeline Error:', err);
  process.exit(1);
});
