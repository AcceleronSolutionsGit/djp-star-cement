import XLSX from 'xlsx';
import { importDealerPerformance } from '../src/imports/dealer-performance.importer.js';
import { calculatePJP } from '../src/engines/pjp/pjp.engine.js';
import { dbAll, dbRun } from '../src/config/database.js';

async function testUnmapped() {
  console.log('--- TESTING DEALER IN DEALER PERFORMANCE ONLY (NOT IN SBG OR DEALER MAPPING) ---');

  // Create an Excel file with an extra dealer D999 (Zeta Traders)
  const rows = [
    [
      'REGION', 'AREA', 'CODE', 'SAP', 'DEALERS NAME', 'DOA',
      'Targeted Dealer', 'EXCLUSIVE DEALER', "June'26 Tgt", 'Prorata Tgt',
      '30-Jun-26', 'Shortfall', 'Prorata Achv %', "June'26 SALE",
      "May'26 DEALER", "June'26 SALE", 'VARIENCE', 'GROWTH %',
      'June-26 Vs May-26', 'June-25 SALE', 'May-25 Dealer', 'June-25 SALE',
      'LYSM VARIENCE', 'LYSM GROWTH %', 'June-25 SALE', 'Jan-26 SALE',
      'Feb-26 SALE', 'Mar-26 SALE', 'Apr-26 SALE', 'May-26 SALE',
      'Jun-26 SALE', 'Last 6 Months Avg Sales'
    ],
    [
      'East', 'Guwahati', 'S999', 'D999', 'Zeta Traders', '15-Mar-2024',
      'Yes', 'Yes', 30, 28, 25, 3, 89.2, 25, 20, 25, 5, 125,
      'Growing', 15, 15, 15, 10, 166.7, 15, 18, 19, 20, 22, 20,
      25, 20.67
    ]
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Dealer Performance');
  const testFilePath = 'upload-files/05_Dealer_Performance_unmapped_test.xlsx';
  XLSX.writeFile(wb, testFilePath);

  // Import Dealer Performance
  await importDealerPerformance(testFilePath, 'TEST_UNMAPPED');

  // Check master_dealers
  const md = await dbAll('SELECT sap_code, sfa_code, dealer_name, so_name, asm_name, rsm_name, zh_name, block, sbg_potential FROM master_dealers WHERE sap_code = "D999"');
  console.log('\nMaster Dealer record created:');
  console.table(md);

  // Calculate PJP
  console.log('\nRunning PJP calculation:');
  const res = await calculatePJP('2026-06', 'C1', { persist: false });
  const zeta = res.results.find(r => (r.dealer?.sap_code === 'D999' || r.dealer?.dealerCode === 'D999'));
  console.log('\nZeta Traders PJP result:');
  console.log({
    dealerCode: zeta?.dealer?.dealerCode,
    name: zeta?.dealer?.dealer_name,
    area: zeta?.dealer?.area,
    zone: zeta?.dealer?.zone,
    soName: zeta?.dealer?.so_name,
    block: zeta?.dealer?.block,
    potential: zeta?.dealer?.sbg_potential,
    CM: zeta?.dealer?.currentSales,
    PM: zeta?.dealer?.previousSales,
    LYSM: zeta?.dealer?.lysmSales,
    dp6M: zeta?.dealer?.dpSixMonthAverage,
    status: zeta?.dealerStatus,
    grade: zeta?.category,
    scoreA: zeta?.scoreA,
    scoreB: zeta?.scoreB,
    scoreC: zeta?.scoreC,
    totalScore: zeta?.totalScore,
    visits: zeta?.visits
  });

  // Clean up test dealer from DB
  await dbRun('DELETE FROM master_dealers WHERE sap_code = "D999"');
  await dbRun('DELETE FROM dealer_performance_history WHERE sap_code = "D999"');
  console.log('\nCleaned up test dealer.');
  process.exit(0);
}

testUnmapped().catch(e => { console.error(e); process.exit(1); });
