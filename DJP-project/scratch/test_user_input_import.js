import XLSX from 'xlsx';
import { importDealerPerformance } from '../src/imports/dealer-performance.importer.js';
import { dbAll, dbRun } from '../src/config/database.js';

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
    'North', 'Kolkata', 'S001', 'D001', 'Alpha Traders', '01-Jan-2024',
    'Yes', 'Yes', 25, 24, 21, 3, 87.5, 21, 20, 21, 11, 110,
    'Growing', 10, 10, 10, 11, 110, 10, 16, 17, 18, 19, 20, 21, 18.5
  ],
  [
    'North', 'Kolkata', 'S002', 'D002', 'Beta Agencies', '01-Jan-2024',
    'Yes', 'No', 20, 20, 15, 5, 75, 15, 15, 15, 0, 100,
    'Stable', 15, 15, 15, 0, 100, 15, 15, 15, 15, 15, 15, 15, 15
  ],
  [
    'West', 'Pune', 'S003', 'D003', 'Gamma Cement', '01-Jan-2024',
    'Yes', 'Yes', 18, 17, 6, 11, 35.29, 6, 8, 6, -19, -76,
    'Declining', 25, 25, 25, -19, -76, 25, 16, 14, 12, 10, 8, 6, 11
  ],
  [
    'West', 'Pune', 'S004', 'D004', 'Delta Buildmart', '01-Jan-2024',
    'Yes', 'Yes', 22, 21, 19, 2, 90.48, 19, 18, 19, 11, 137.5,
    'Growing', 8, 8, 8, 11, 137.5, 8, 14, 15, 16, 17, 18, 19, 16.5
  ],
  [
    'North', 'Delhi', 'S005', 'D005', 'Epsilon Infra', '01-Jan-2024',
    'Yes', 'No', 15, 14, 0, 14, 0, 0, 0, 0, 0, 0,
    'Churn', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
  ]
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);
XLSX.utils.book_append_sheet(wb, ws, 'Dealer Performance');
const testFilePath = 'upload-files/05_Dealer_Performance_user_test.xlsx';
XLSX.writeFile(wb, testFilePath);
console.log('Saved test file:', testFilePath);

async function testImport() {
  await dbRun('DELETE FROM dealer_performance_history WHERE batch_code = "TEST_USER_INPUT"');
  const res = await importDealerPerformance(testFilePath, 'TEST_USER_INPUT');
  console.log('Import result:', res);

  const imported = await dbAll(
    'SELECT sap_code, dealer_name, period_year_month, quantity_mt FROM dealer_performance_history WHERE batch_code = "TEST_USER_INPUT" ORDER BY sap_code, period_year_month'
  );
  console.log(`Imported ${imported.length} rows:`);
  console.table(imported);
  process.exit(0);
}

testImport().catch(e => { console.error(e); process.exit(1); });
