import fs from 'fs';
import XLSX from 'xlsx';
import { dbAll, dbRun, pool } from '../config/database.js';
import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importProspectDealers } from '../imports/prospect-dealer.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { importSBG } from '../imports/sbg.importer.js';
import { importDealerPerformance } from '../imports/dealer-performance.importer.js';
import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { reconcileUniverse } from '../engines/pjp/reconciliation.service.js';

async function main() {
  console.log('=== RUNNING FULL INGESTION & REFERENCE REGRESSION TEST ===\n');

  const batchCode = `TEST-REGRESSION-${Date.now()}`;

  // Reset tables to test reference inputs cleanly
  await dbRun('DELETE FROM dealer_visit_targets WHERE period_month = ?', ['2026-06']);
  await dbRun('DELETE FROM master_dealers');
  await dbRun('DELETE FROM master_dealer_so_mapping');
  await dbRun('DELETE FROM sales_history');

  // 1. Ingest all 5 sample input documents
  console.log('1. Ingesting 01_Dealer_Mapping_SAMPLE.xlsx...');
  const r1 = await importDealerMapping('upload-files/01_Dealer_Mapping_SAMPLE.xlsx', batchCode);
  console.log(`   Dealer Mapping: total=${r1.totalRows}, valid=${r1.validRows}, errors=${r1.errors.length}`);

  console.log('2. Ingesting 02_Prospects_SAMPLE.xlsx...');
  const r2 = await importProspectDealers('upload-files/02_Prospects_SAMPLE.xlsx', batchCode);
  console.log(`   Prospects: total=${r2.totalRows}, valid=${r2.validRows}, errors=${r2.errors.length}`);

  console.log('3. Ingesting 03_RSAR_Sales_SAMPLE.xlsx...');
  const r3 = await importSalesHistory('upload-files/03_RSAR_Sales_SAMPLE.xlsx', batchCode);
  console.log(`   RSAR Sales: valid=${r3.validRows}, months=${r3.monthsFound.join(', ')}`);

  console.log('4. Ingesting 04_SBG_SAMPLE.xlsx...');
  const r4 = await importSBG('upload-files/04_SBG_SAMPLE.xlsx', batchCode);
  console.log(`   SBG: total=${r4.totalRows}, valid=${r4.validRows}, errors=${r4.errors.length}`);

  console.log('5. Ingesting 05_Dealer_Performance_SAMPLE.xlsx...');
  const r5 = await importDealerPerformance('upload-files/05_Dealer_Performance_SAMPLE.xlsx', batchCode);
  console.log(`   Dealer Performance: total=${r5.totalRows}, recordsInserted=${r5.recordsInserted}`);

  // 2. Run Source Reconciliation
  console.log('\n=== RUNNING SOURCE RECONCILIATION AUDIT ===');
  const { reconciliationReport, canonicalDealers } = await reconcileUniverse({ reportMonth: '2026-06', cycleCode: 'C1' });
  console.log(`Reconciliation summary:`);
  console.log(`  Total raw dealers: ${reconciliationReport.totalReceived}`);
  console.log(`  Normalized: ${reconciliationReport.normalizedCount}`);
  console.log(`  Rejected: ${reconciliationReport.rejectedCount}`);
  console.log(`  Unmatched (prospects missing hierarchy): ${reconciliationReport.unmatchedCount}`);
  console.log(`  Canonical Master dealers: ${canonicalDealers.length}`);
  console.log(`  Issues tracked: ${reconciliationReport.issues.length}`);

  // 3. Execute Canonical PJP Engine
  console.log('\n=== EXECUTING CANONICAL PJP ENGINE ===');
  const pjpRun = await calculatePJP('2026-06', 'C1', { persist: true, debug: false });
  console.log(`Calculated targets for ${pjpRun.results.length} dealers.`);

  // 4. Query Database Persisted Records
  const dbTargets = await dbAll(
    `SELECT * FROM dealer_visit_targets 
     WHERE period_month = '2026-06' AND cycle_code = 'C1' 
     ORDER BY sap_code ASC`
  );

  console.log(`\n=== COMPARISON AGAINST M_SAMPLE_EXPECTED.xlsx ===`);
  let masterMismatches = 0;
  const masterComparison = [];

  if (!fs.existsSync('upload-files/M_SAMPLE_EXPECTED.xlsx')) {
    console.log('  [NOTE] upload-files/M_SAMPLE_EXPECTED.xlsx not found. Database has ' + dbTargets.length + ' targets.');
  } else {
    const expectedMasterWb = XLSX.readFile('upload-files/M_SAMPLE_EXPECTED.xlsx');
    const expectedMasterSheet = expectedMasterWb.Sheets['Report'];
    const expectedMasterRows = XLSX.utils.sheet_to_json(expectedMasterSheet);

    console.log(`Expected Master rows: ${expectedMasterRows.length}, Actual DB rows: ${dbTargets.length}`);

  for (let i = 0; i < expectedMasterRows.length; i++) {
    const exp = expectedMasterRows[i];
    const expCode = String(exp['Customer CODE']).trim();
    const actual = dbTargets.find(t => t.sap_code === expCode || t.sfa_code === expCode);

    if (!actual) {
      console.error(`[ERROR] Dealer ${expCode} missing in generated database results!`);
      masterMismatches++;
      continue;
    }

    const fieldsToCompare = [
      { key: 'Customer CODE', exp: expCode, act: actual.sap_code },
      { key: 'Dealer Name', exp: exp['Dealer Name'], act: actual.dealer_name },
      { key: 'Territory Code', exp: exp['Territory Code'], act: actual.territory_code },
      { key: 'Territory Name', exp: exp['Territory Name'], act: actual.territory_name },
      { key: 'SO Code', exp: exp['SO Code'], act: actual.so_code || actual.so_emp_code },
      { key: 'SO Name', exp: exp['SO Name'], act: actual.so_name },
      { key: 'ASM Code', exp: exp['ASM Code'], act: actual.asm_code },
      { key: 'ASM Name', exp: exp['ASM Name'], act: actual.asm_name },
      { key: 'RSM Code', exp: exp['RSM Code'], act: actual.rsm_code },
      { key: 'RSM Name', exp: exp['RSM Name'], act: actual.rsm_name },
      { key: 'ZH Code', exp: exp['ZH Code'], act: actual.zh_code },
      { key: 'ZH Name', exp: exp['ZH Name'], act: actual.zh_name },
      { key: 'Previous Sales', exp: Number(exp['Previous Sales']), act: Number(actual.previous_sales) },
      { key: 'Current Sales', exp: Number(exp['Current Sales']), act: Number(actual.current_sales) },
      { key: 'Category', exp: exp['Category'], act: actual.dealer_status },
      { key: 'Final Volume', exp: Number(exp['Final Volume']), act: Number(actual.final_volume) },
      { key: 'Score B', exp: Number(exp['Score B']), act: Number(actual.score_b) },
      { key: 'Priority', exp: exp['Priority'], act: actual.priority_label },
      { key: 'SO Visits', exp: Number(exp['SO Visits']), act: Number(actual.so_visits) },
      { key: 'ASM Visits', exp: Number(exp['ASM Visits']), act: Number(actual.asm_visits) },
      { key: 'RSM Visits', exp: Number(exp['RSM Visits']), act: Number(actual.rsm_visits) },
      { key: 'ZH Visits', exp: Number(exp['ZH Visits']), act: Number(actual.zh_visits) }
    ];

    let rowDiscrepancy = false;
    for (const f of fieldsToCompare) {
      if (f.exp !== f.act) {
        console.error(`  [MISMATCH] ${expCode} -> ${f.key}: Expected="${f.exp}" (${typeof f.exp}), Actual="${f.act}" (${typeof f.act})`);
        masterMismatches++;
        rowDiscrepancy = true;
      }
    }

    masterComparison.push({
      Code: expCode,
      Name: exp['Dealer Name'],
      Category: `${actual.dealer_status} (exp: ${exp['Category']})`,
      Volume: `${actual.final_volume} (exp: ${exp['Final Volume']})`,
      ScoreB: `${actual.score_b} (exp: ${exp['Score B']})`,
      Priority: `${actual.priority_label} (exp: ${exp['Priority']})`,
      SO: `${actual.so_visits} (exp: ${exp['SO Visits']})`,
      ASM: `${actual.asm_visits} (exp: ${exp['ASM Visits']})`,
      RSM: `${actual.rsm_visits} (exp: ${exp['RSM Visits']})`,
      ZH: `${actual.zh_visits} (exp: ${exp['ZH Visits']})`,
      Match: rowDiscrepancy ? 'FAIL' : 'PASS'
    });
  }

    console.table(masterComparison);
  }

  console.log(`\n=== COMPARISON AGAINST visits-To Be Achieved_SAMPLE_EXPECTED.xlsx ===`);
  let visitsMismatches = 0;
  let hasExpectedVisits = fs.existsSync('upload-files/visits-To Be Achieved_SAMPLE_EXPECTED.xlsx');
  let expVisitsReportRows = [];

  if (!hasExpectedVisits) {
    console.log('  [NOTE] upload-files/visits-To Be Achieved_SAMPLE_EXPECTED.xlsx not found.');
  } else {
    const expVisitsWb = XLSX.readFile('upload-files/visits-To Be Achieved_SAMPLE_EXPECTED.xlsx');
    const expVisitsReportSheet = expVisitsWb.Sheets['Report'];
    expVisitsReportRows = XLSX.utils.sheet_to_json(expVisitsReportSheet);
    const expVisitsSummarySheet = expVisitsWb.Sheets['Summary'];
    const expVisitsSummaryRows = XLSX.utils.sheet_to_json(expVisitsSummarySheet);

    console.log(`Expected Visits Report rows: ${expVisitsReportRows.length}`);
    console.log('Expected Summary:', expVisitsSummaryRows);
  }

  // Build actual Visits Report rows from dbTargets
  const actualVisitsRows = [];
  const roles = [
    { role: 'SO', getCode: t => t.so_code || t.so_emp_code, getName: t => t.so_name, getVisits: t => Number(t.so_visits) || 0 },
    { role: 'ASM', getCode: t => t.asm_code, getName: t => t.asm_name, getVisits: t => Number(t.asm_visits) || 0 },
    { role: 'RSM', getCode: t => t.rsm_code, getName: t => t.rsm_name, getVisits: t => Number(t.rsm_visits) || 0 }
  ];

  let soVisitsTotal = 0;
  let asmVisitsTotal = 0;
  let rsmVisitsTotal = 0;
  let zhVisitsTotal = 0;

  for (const { role, getCode, getName, getVisits } of roles) {
    for (const t of dbTargets) {
      const visits = getVisits(t);
      if (visits > 0) {
        if (role === 'SO') soVisitsTotal += visits;
        if (role === 'ASM') asmVisitsTotal += visits;
        if (role === 'RSM') rsmVisitsTotal += visits;

        actualVisitsRows.push({
          'Customer CODE': t.sap_code || t.sfa_code || '',
          'Dealer Name': t.dealer_name || '',
          'Territory Code': t.territory_code || '',
          'Territory Name': t.territory_name || t.area || '',
          'Employee Code': getCode(t) || '',
          'Employee Name': getName(t) || '',
          'Role': role,
          'Visits To Be Achieved': visits
        });
      }
    }
  }

  console.log(`Comparing ${expVisitsReportRows.length} expected visit rows with ${actualVisitsRows.length} actual visit rows...`);

  if (expVisitsReportRows.length !== actualVisitsRows.length) {
    console.error(`Row count mismatch: expected ${expVisitsReportRows.length}, actual ${actualVisitsRows.length}`);
    visitsMismatches++;
  }

  for (let i = 0; i < expVisitsReportRows.length; i++) {
    const expRow = expVisitsReportRows[i];
    const actRow = actualVisitsRows[i];
    if (!actRow) {
      console.error(`Missing row ${i}`);
      visitsMismatches++;
      continue;
    }

    const checkFields = ['Customer CODE', 'Dealer Name', 'Territory Code', 'Territory Name', 'Employee Code', 'Employee Name', 'Role', 'Visits To Be Achieved'];
    for (const f of checkFields) {
      if (String(expRow[f]).trim() !== String(actRow[f]).trim()) {
        console.error(`Mismatch in visit row ${i}, field ${f}: expected="${expRow[f]}", actual="${actRow[f]}"`);
        visitsMismatches++;
      }
    }
  }

  console.log(`Actual Role Visit Totals:`);
  console.log(`  SO Total:  ${soVisitsTotal} (Expected: 14) -> ${soVisitsTotal === 14 ? 'PASS' : 'FAIL'}`);
  console.log(`  ASM Total: ${asmVisitsTotal} (Expected: 5)  -> ${asmVisitsTotal === 5 ? 'PASS' : 'FAIL'}`);
  console.log(`  RSM Total: ${rsmVisitsTotal} (Expected: 2)  -> ${rsmVisitsTotal === 2 ? 'PASS' : 'FAIL'}`);
  console.log(`  ZH Total:  ${zhVisitsTotal}  (Expected: 0)  -> ${zhVisitsTotal === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`Active Visit Records count: ${actualVisitsRows.length} (Expected: 13) -> ${actualVisitsRows.length === 13 ? 'PASS' : 'FAIL'}`);

  console.log('\n================================================================');
  if (masterMismatches === 0 && visitsMismatches === 0 && soVisitsTotal === 14 && asmVisitsTotal === 5 && rsmVisitsTotal === 2 && actualVisitsRows.length === 13) {
    console.log('>>> 100% REGRESSION TEST PASSED! ALL VALUES MATCH REFERENCE EXACTLY! <<<');
  } else {
    console.log(`>>> REGRESSION TEST FAILED: master mismatches=${masterMismatches}, visit mismatches=${visitsMismatches}. <<<`);
  }
  console.log('================================================================\n');

  process.exit((masterMismatches === 0 && visitsMismatches === 0) ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error running regression test:', err);
  process.exit(1);
});
