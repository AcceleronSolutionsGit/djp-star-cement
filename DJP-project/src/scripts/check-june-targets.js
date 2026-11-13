import { dbAll } from '../config/database.js';

async function checkJune() {
  const sampleJune = await dbAll('SELECT id, sap_code, sfa_code, dealer_name, cust_type FROM dealer_visit_targets WHERE period_month = "2026-06" LIMIT 10');
  console.log('Sample June targets:', sampleJune);
  process.exit(0);
}

checkJune().catch(console.error);
