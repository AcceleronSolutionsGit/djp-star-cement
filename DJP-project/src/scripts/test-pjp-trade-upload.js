import fs from 'fs';
import path from 'path';
import { dbGet, dbRun } from '../config/database.js';

const PORT = 3000;
const API_URL = `http://127.0.0.1:${PORT}/api/uploads/file`;
const TEST_DIR = path.resolve('test-artifacts');
const DUMMY_FILE_PATH = path.join(TEST_DIR, 'sales_trade_test.xlsx');

async function ensureTestDir() {
  if (!fs.existsSync(TEST_DIR)) {
    fs.mkdirSync(TEST_DIR, { recursive: true });
  }
  // Create a minimal valid Excel file structure or just a basic CSV pretending to be Excel
  // Since our parser checks headers for PJP_TRADE, let's make it a CSV that Multer will accept
  const csvContent = `SFA Code,Dealer Name,SO Name,SO Visits
D123,Test Dealer,John Doe,4
D124,Test Dealer 2,Jane Doe,2
D125,Test Dealer 3,Jane Doe,1`;
  fs.writeFileSync(DUMMY_FILE_PATH, csvContent);
}

async function runTests() {
  console.log('=== Starting PJP_TRADE Upload Tests ===');
  let passed = 0;
  let failed = 0;

  await ensureTestDir();

  // Helper to construct multipart form
  const createForm = (uploadType, periodMonth, filename) => {
    const form = new FormData();
    const fileStream = fs.readFileSync(DUMMY_FILE_PATH);
    const file = new File([fileStream], filename, { type: 'text/csv' });
    form.append('file', file);
    if (uploadType) form.append('uploadType', uploadType);
    if (periodMonth !== undefined) form.append('periodMonth', periodMonth);
    return form;
  };

  // 1. Missing periodMonth -> Should return HTTP 400
  try {
    console.log('\\n[Test 1] Missing periodMonth');
    const form1 = createForm('PJP_TRADE', undefined, 'pjp_sample.csv');
    const res1 = await fetch(API_URL, { method: 'POST', body: form1 });
    const data1 = await res1.json();
    
    if (res1.status === 400 && data1.error.includes('Period Month is required')) {
      console.log('✅ Pass: Correctly rejected missing periodMonth with HTTP 400.');
      passed++;
    } else {
      console.error(`❌ Fail: Expected HTTP 400, got ${res1.status}. Body:`, data1);
      failed++;
    }
  } catch (err) {
    console.error('❌ Fail: Network error', err.message);
    failed++;
  }

  // 2. Valid periodMonth -> Should succeed
  let test2Batch = null;
  try {
    console.log('\\n[Test 2] Valid periodMonth (2026-06)');
    const form2 = createForm('PJP_TRADE', '2026-06', 'pjp_sample.csv');
    const res2 = await fetch(API_URL, { method: 'POST', body: form2 });
    const data2 = await res2.json();
    
    if (res2.status === 200 && data2.batchCode) {
      test2Batch = data2.batchCode;
      
      // Verify periodMonth was stored in DB
      const row = await dbGet('SELECT period_month FROM upload_batches WHERE batch_code = ?', [test2Batch]);
      if (row && row.period_month === '2026-06') {
        console.log('✅ Pass: Upload succeeded and period_month (2026-06) was stored in database.');
        passed++;
      } else {
        console.error('❌ Fail: Upload succeeded but period_month was not stored in DB. Row:', row);
        failed++;
      }
    } else {
      console.error(`❌ Fail: Expected HTTP 200, got ${res2.status}. Body:`, data2);
      failed++;
    }
  } catch (err) {
    console.error('❌ Fail: Network error', err.message);
    failed++;
  }

  // 3. Regression: Filename contains 'sales' but type is PJP_TRADE
  let test3Batch = null;
  try {
    console.log('\\n[Test 3] Regression: Filename contains "sales"');
    const form3 = createForm('PJP_TRADE', '2026-07', 'sales_trade_test.csv');
    const res3 = await fetch(API_URL, { method: 'POST', body: form3 });
    const data3 = await res3.json();
    
    if (res3.status === 200 && data3.batchCode) {
      test3Batch = data3.batchCode;
      
      // If it erroneously went to SALES_HISTORY, it would have failed or stored as SALES_HISTORY
      const row = await dbGet('SELECT file_type, period_month FROM upload_batches WHERE batch_code = ?', [test3Batch]);
      if (row && row.file_type === 'PJP_TRADE' && row.period_month === '2026-07') {
        console.log('✅ Pass: Backend explicitly respected uploadType PJP_TRADE despite filename.');
        passed++;
      } else {
        console.error('❌ Fail: Backend did not store as PJP_TRADE. Row:', row);
        failed++;
      }
    } else {
      console.error(`❌ Fail: Expected HTTP 200, got ${res3.status}. Body:`, data3);
      failed++;
    }
  } catch (err) {
    console.error('❌ Fail: Network error', err.message);
    failed++;
  }

  console.log(`\\n=== Test Summary: ${passed} Passed, ${failed} Failed ===`);
  
  // Cleanup test data
  if (test2Batch) await dbRun('DELETE FROM upload_batches WHERE batch_code = ?', [test2Batch]);
  if (test3Batch) await dbRun('DELETE FROM upload_batches WHERE batch_code = ?', [test3Batch]);
  
  process.exit(failed > 0 ? 1 : 0);
}

runTests();
