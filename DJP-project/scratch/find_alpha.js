import { dbAll } from '../src/config/database.js';

async function findAlpha() {
  const md = await dbAll("SELECT * FROM master_dealers WHERE dealer_name LIKE '%Alpha%' OR sap_code = 'D001'");
  console.log('master_dealers:', md);

  const dvt = await dbAll("SELECT * FROM dealer_visit_targets WHERE dealer_name LIKE '%Alpha%' OR sap_code = 'D001'");
  console.log('dealer_visit_targets:', dvt);
}

findAlpha().catch(console.error);
