import { dbAll, dbGet } from '../src/config/database.js';

async function check() {
  const total = await dbGet('SELECT COUNT(*) as cnt FROM master_dealers');
  console.log('Total in master_dealers:', total);
  const dealers = await dbAll('SELECT id, sap_code, sfa_code, dealer_name, status FROM master_dealers LIMIT 10');
  console.log('Dealers:', dealers);
  process.exit(0);
}

check().catch(console.error);
