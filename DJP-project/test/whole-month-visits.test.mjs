import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { exportVisitsExcel } from '../src/controllers/djp.controller.js';

async function driveExport(periodMonth, cycleCode) {
  let headers = {};
  let sentBuffer = null;
  let statusCode = 200;

  const req = {
    query: { periodMonth, cycleCode }
  };
  const res = {
    setHeader(k, v) { headers[k] = v; return this; },
    status(c) { statusCode = c; return this; },
    json(obj) { throw new Error(`API error: ${JSON.stringify(obj)}`); },
    send(buf) { sentBuffer = buf; return this; }
  };

  await exportVisitsExcel(req, res);
  assert.equal(statusCode, 200, `Expected 200 status code, got ${statusCode}`);
  assert.ok(sentBuffer && sentBuffer.length > 0, 'No Excel buffer returned');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(sentBuffer);
  return { wb, headers, bufferSize: sentBuffer.length };
}

async function runTests() {
  console.log('================================================================');
  console.log('TEST SUITE: Whole Month & Cycle-Specific Visits Excel Export');
  console.log('================================================================\n');

  // Test 1: Whole Month (cycleCode='ALL')
  console.log('[Test 1] Testing Whole Month export with cycleCode="ALL"...');
  const { wb: wbAll, headers: hAll, bufferSize: sizeAll } = await driveExport('2026-10', 'ALL');

  assert.ok(
    hAll['Content-Disposition'].includes('visits-To_Be_Achieved_2026-10_Whole_Month.xlsx'),
    `Filename mismatch: ${hAll['Content-Disposition']}`
  );
  console.log(`  ✓ Content-Disposition header: ${hAll['Content-Disposition']}`);
  console.log(`  ✓ Excel buffer generated: ${(sizeAll / 1024 / 1024).toFixed(2)} MB`);

  const wsVisits = wbAll.getWorksheet('Visits');
  const wsSfa = wbAll.getWorksheet('SFA Report');

  assert.ok(wsVisits, "Sheet 'Visits' missing");
  assert.ok(wsSfa, "Sheet 'SFA Report' missing");
  console.log(`  ✓ Sheets found: ['Visits', 'SFA Report']`);

  // Fixed headers check
  const FIXED_HEADERS = [
    'Zone', 'Cust Type', 'Area', 'Block', 'ZONAL HEAD', 'RSM', 'ASM', 'SO/SE  NAME',
    'DEALER NAME', 'Customer CODE', 'Priority', 'Category',
    'No. of visits by SO', 'No. of visits by ASM', 'Number of Visit by RSM', 'Number of Visit by ZH'
  ];
  const row2 = wsVisits.getRow(2).values.slice(1);
  for (let i = 0; i < FIXED_HEADERS.length; i++) {
    assert.equal(row2[i], FIXED_HEADERS[i], `Header mismatch at col ${i + 1}`);
  }
  const dateColsCount = row2.length - FIXED_HEADERS.length;
  assert.ok(dateColsCount >= 5, `Expected at least 5 date columns, got ${dateColsCount}`);
  for (let i = 0; i < dateColsCount; i++) {
    assert.equal(row2[FIXED_HEADERS.length + i], `Date of Visit ${i + 1}`);
  }
  console.log(`  ✓ Header layout verified: 16 fixed columns + ${dateColsCount} dynamic Date of Visit columns`);

  // Check visits spanning C1 and C2
  let c1DatesCount = 0;
  let c2DatesCount = 0;
  for (let r = 3; r <= wsVisits.rowCount; r++) {
    const row = wsVisits.getRow(r);
    for (let c = 17; c <= row2.length; c++) {
      const val = row.getCell(c).value;
      if (val) {
        const dStr = val instanceof Date ? val.toISOString().slice(0, 10) : String(val).slice(0, 10);
        const day = parseInt(dStr.slice(8, 10), 10);
        if (day <= 15) c1DatesCount++;
        else c2DatesCount++;
      }
    }
  }
  console.log(`  ✓ Sheet 'Visits' has ${wsVisits.rowCount - 2} active dealer rows`);
  console.log(`  ✓ Sheet 'Visits' contains ${c1DatesCount} C1 dates (days 1-15) and ${c2DatesCount} C2 dates (days 16-31)`);
  assert.ok(c1DatesCount > 0, 'No C1 dates found on Visits sheet');
  assert.ok(c2DatesCount > 0, 'No C2 dates found on Visits sheet');

  // Sheet 2 checks
  console.log(`  ✓ Sheet 'SFA Report' has ${wsSfa.rowCount - 1} scheduled visit rows across both cycles`);
  assert.ok(wsSfa.rowCount > 20000, `Expected >20000 SFA visit rows, got ${wsSfa.rowCount}`);

  const sfaHeaders = [
    'Date of Visit', 'Customer Code', 'Customer Name', 'Type', 'Route', 'Branch',
    'Employee Code', 'Employee Name', 'Check In Time', 'Check Out Time', 'Duration',
    'Visit Status(Productive / Non productive)', 'Purpose Of Visit', 'Remarks'
  ];
  assert.deepEqual(wsSfa.getRow(1).values.slice(1), sfaHeaders, 'SFA Report headers mismatch');
  console.log(`  ✓ Sheet 'SFA Report' exactly matches official 14-column uploadable diary format`);

  // Test 2: Cycle 1 standalone
  console.log('\n[Test 2] Testing C1 export with cycleCode="C1"...');
  const { wb: wbC1, headers: hC1 } = await driveExport('2026-10', 'C1');
  assert.ok(hC1['Content-Disposition'].includes('visits-To_Be_Achieved_2026-10_C1.xlsx'));
  const wsSfaC1 = wbC1.getWorksheet('SFA Report');
  console.log(`  ✓ C1 export produced ${wsSfaC1.rowCount - 1} visits in SFA Report`);
  assert.ok(wsSfaC1.rowCount > 10000, 'Expected >10000 visits in C1');

  // Test 3: Cycle 2 standalone
  console.log('\n[Test 3] Testing C2 export with cycleCode="C2"...');
  const { wb: wbC2, headers: hC2 } = await driveExport('2026-10', 'C2');
  assert.ok(hC2['Content-Disposition'].includes('visits-To_Be_Achieved_2026-10_C2.xlsx'));
  const wsSfaC2 = wbC2.getWorksheet('SFA Report');
  console.log(`  ✓ C2 export produced ${wsSfaC2.rowCount - 1} visits in SFA Report`);
  assert.ok(wsSfaC2.rowCount > 5000, 'Expected >5000 visits in C2');

  console.log('\n================================================================');
  console.log('✓ ALL TESTS PASSED: Whole Month & Cycle Exports 100% Verified!');
  console.log('================================================================\n');
  process.exit(0);
}

runTests().catch(err => {
  console.error('\n✗ Test failed:', err);
  process.exit(1);
});
