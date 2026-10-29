import { importProspectDealers } from '../imports/prospect-dealer.importer.js';

async function testProspectImport() {
  const filePath = 'd:\\OFFICE\\DJP-project\\DJP-project\\New Upload\\prospect cust.xlsx';
  console.log('Testing importProspectDealers on:', filePath);
  try {
    const result = await importProspectDealers(filePath, 'TEST-PROSPECT-BATCH');
    console.log('Import result:', result);
  } catch (err) {
    console.error('Import failed with error:', err);
  }
}

testProspectImport().catch(console.error);
