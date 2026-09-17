import path from 'path';
import { fileURLToPath } from 'url';
import { importDealerMapping } from '../imports/dealer-mapping.importer.js';
import { importSalesHistory } from '../imports/sales-history.importer.js';
import { dbAll } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const mappingFile = path.join(__dirname, '../../upload-files/file-1788283401406-85577886.xlsx');
  const salesFile = path.join(__dirname, '../../upload-files/file-1788285709647-776738376.xlsx');

  console.log('--- 1. Importing Dealer Mapping from M.xlsx ---');
  const mapRes = await importDealerMapping(mappingFile, 'FRESH_MAP_BATCH');
  console.log('Dealer mapping import result:', mapRes);

  console.log('\n--- 2. Checking Master Dealers Sample ---');
  const sample = await dbAll('SELECT id, dealer_name, dealer_type, sap_code, sfa_code FROM master_dealers WHERE dealer_name LIKE \'%A B HARDWARE%\' LIMIT 3');
  console.log('Sample A B Hardware:', sample);

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
