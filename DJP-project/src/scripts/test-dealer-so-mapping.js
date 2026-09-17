import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';
import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { dbAll, dbGet } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTests() {
  console.log('====================================================');
  console.log('INTEGRATION TEST: DEALER SO MAPPING IMPORT & MAPPING');
  console.log('====================================================\n');

  // Create mock Excel file with the 3 test records
  const testData = [
    {
      'Dealer SAP Code': 1000000013,
      'Dealer Name': 'BANKA BEHARI PAUL',
      'Branch': 'AGARTALA',
      'Region': 'NE 2',
      'SO Name': 'SANDIP DEY-AGARTALA',
      'SO E Code': 1101046,
      'ASM Name': 'BIKRAM KUMAR HALDER',
      'ASM Code': 11001772,
      'linked dealer code': null
    },
    {
      'Dealer SAP Code': 1000000021,
      'Dealer Name': 'AJOY BHATTACHARJEE',
      'Branch': 'AGARTALA',
      'Region': 'NE 2',
      'SO Name': 'KISHAN DAS',
      'SO E Code': 1200178,
      'ASM Name': 'BIKRAM KUMAR HALDER',
      'ASM Code': 11001772,
      'linked dealer code': null
    },
    {
      'Dealer SAP Code': 1000000022,
      'Dealer Name': 'ANJAN DEBNATH',
      'Branch': 'AGARTALA',
      'Region': 'NE 2',
      'SO Name': 'KISHAN DAS',
      'SO E Code': 1200178,
      'ASM Name': 'BIKRAM KUMAR HALDER',
      'ASM Code': 11001772,
      'linked dealer code': null
    }
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(testData);
  XLSX.utils.book_append_sheet(wb, ws, 'Dealer SO Mapping');
  const testFilePath = path.join(__dirname, '../../upload-files/test-dealer-so-mapping.xlsx');
  XLSX.writeFile(wb, testFilePath);

  console.log('[1] Importing test Dealer SO Mapping...');
  const res = await importDealerMapping(testFilePath, 'TEST_MAPPING_BATCH');
  console.log('Import result:', res);

  console.log('\n[2] Verifying Test 1 (1000000013)...');
  const d1 = await dbGet(`
    SELECT d.sap_code, d.dealer_name, d.branch, d.region, d.linked_dealer_code,
           m.so_name, m.so_emp_code, m.asm_name, m.asm_code
    FROM master_dealers d
    LEFT JOIN master_dealer_so_mapping m ON d.id = m.dealer_id
    WHERE d.sap_code = '1000000013'
  `);
  console.log('Record 1:', d1);

  if (
    d1 &&
    d1.sap_code === '1000000013' &&
    d1.so_emp_code === '1101046' &&
    d1.asm_code === '11001772' &&
    d1.branch === 'AGARTALA' &&
    d1.region === 'NE 2' &&
    d1.linked_dealer_code === null
  ) {
    console.log('✅ Test 1 PASSED');
  } else {
    console.error('❌ Test 1 FAILED');
  }

  console.log('\n[3] Verifying Test 2 (1000000021)...');
  const d2 = await dbGet(`
    SELECT d.sap_code, d.dealer_name, d.branch, d.region, d.linked_dealer_code,
           m.so_name, m.so_emp_code, m.asm_name, m.asm_code
    FROM master_dealers d
    LEFT JOIN master_dealer_so_mapping m ON d.id = m.dealer_id
    WHERE d.sap_code = '1000000021'
  `);
  console.log('Record 2:', d2);

  if (d2 && d2.sap_code === '1000000021' && d2.so_emp_code === '1200178' && d2.asm_code === '11001772') {
    console.log('✅ Test 2 PASSED');
  } else {
    console.error('❌ Test 2 FAILED');
  }

  console.log('\n[4] Verifying Test 3 (1000000022)...');
  const d3 = await dbGet(`
    SELECT d.sap_code, d.dealer_name, d.branch, d.region, d.linked_dealer_code,
           m.so_name, m.so_emp_code, m.asm_name, m.asm_code
    FROM master_dealers d
    LEFT JOIN master_dealer_so_mapping m ON d.id = m.dealer_id
    WHERE d.sap_code = '1000000022'
  `);
  console.log('Record 3:', d3);

  if (d3 && d3.sap_code === '1000000022' && d3.so_emp_code === '1200178' && d3.asm_code === '11001772') {
    console.log('✅ Test 3 PASSED');
  } else {
    console.error('❌ Test 3 FAILED');
  }

  console.log('\n[5] Verifying Employee Master records...');
  const asmCount = await dbAll("SELECT * FROM master_employees WHERE emp_code = '11001772'");
  console.log(`ASM 11001772 count: ${asmCount.length} (Expected: 1)`);

  if (asmCount.length === 1) {
    console.log('✅ Single canonical ASM record maintained.');
  } else {
    console.error('❌ Duplicate ASM records created.');
  }

  process.exit(0);
}

runTests().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
