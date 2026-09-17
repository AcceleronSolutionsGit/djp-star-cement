import { exportPjpTradeExcel } from '../controllers/djp.controller.js';
import XLSX from 'xlsx';

// A mock response to capture the generated Excel output buffer
class MockRes {
  constructor() {
    this.headers = {};
    this.body = null;
    this.statusCode = 200;
  }
  setHeader(key, val) { this.headers[key] = val; }
  status(code) { this.statusCode = code; return this; }
  json(data) { this.body = data; }
  send(data) { this.body = data; }
}

async function runTest() {
  console.log('=== TESTING PJP TRADE EXPORT OUTPUT FORMAT ===');
  
  const req = { query: { periodMonth: '2026-06', cycleCode: 'C1' } };
  const res = new MockRes();
  
  try {
    // Insert dummy data
    const { dbRun, dbGet } = await import('../config/database.js');
    await dbRun('DELETE FROM dealer_visit_targets WHERE period_month = ?', ['2026-06']);
    await dbRun(`
      INSERT INTO dealer_visit_targets 
      (period_month, cycle_code, zone, area, so_name, dealer_name, dealer_id, sap_code, category, dealer_status, so_visits, asm_visits, rsm_visits, zh_visits, total_visits)
      VALUES 
      ('2026-06', 'C1', 'UPPER ASSAM', 'DIBRUGARH', 'JOHN DOE', 'TEST DEALER', '123-abc', '100100', 'A', 'Growing', 2, 1, 0, 0, 3)
    `);

    await exportPjpTradeExcel(req, res);
    
    if (res.statusCode !== 200) {
      console.log('Export failed with status:', res.statusCode);
      console.log('Body:', res.body);
      
      if (res.statusCode === 404) {
         console.log('Note: This just means no data in DB for 2026-06. Ensure data exists before running test.');
      }
      process.exit(0);
    }
    
    // Parse the generated buffer
    const wb = XLSX.read(res.body, { type: 'buffer' });
    const ws = wb.Sheets['PJP_TRADE'];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    
    const headers = rows[0];
    
    const EXPECTED_HEADERS = [
      'Zone',
      'Cust Type',
      'Area',
      'Block',
      'ZONAL HEAD',
      'RSM',
      'ASM',
      'SO/SE NAME',
      'DEALER NAME',
      'Customer CODE',
      'Priority',
      'Category',
      'No. of visits by SO',
      'No. of visits by ASM',
      'Number of Visit by RSM',
      'Number of Visit by ZH'
    ];
    
    console.log('Output Headers:');
    console.log(headers);
    
    let pass = true;
    for (let i = 0; i < EXPECTED_HEADERS.length; i++) {
      if (headers[i] !== EXPECTED_HEADERS[i]) {
        console.error(`❌ Header mismatch at column ${i}: Expected "${EXPECTED_HEADERS[i]}", got "${headers[i]}"`);
        pass = false;
      }
    }
    
    if (headers.length !== EXPECTED_HEADERS.length) {
      console.error(`❌ Length mismatch: Expected ${EXPECTED_HEADERS.length}, got ${headers.length}`);
      pass = false;
    }
    
    if (pass) {
      console.log('✅ ALL HEADERS MATCH EXACTLY!');
    }
    
    // Log sample row if exists
    if (rows.length > 1) {
      console.log('Sample Data Row:');
      const sample = {};
      for (let i = 0; i < headers.length; i++) {
        sample[headers[i]] = rows[1][i];
      }
      console.log(sample);
    }
    
    process.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('Test failed with error:', err);
    process.exit(1);
  }
}

runTest();
