import { dbAll } from '../config/database.js';

async function check() {
  const rsarCnt = await dbAll("SELECT count(*) as c FROM master_dealers WHERE dealer_type = 'RSAR'");
  console.log('RSAR count in master_dealers:', rsarCnt[0]?.c);

  const allDealerTypes = await dbAll("SELECT dealer_type, count(*) as c FROM master_dealers GROUP BY dealer_type");
  console.log('Dealer types in master_dealers:', allDealerTypes);

  const targetsCustTypes = await dbAll("SELECT cust_type, count(*) as c FROM dealer_visit_targets GROUP BY cust_type");
  console.log('Cust types in dealer_visit_targets:', targetsCustTypes);

  const targetsDealerStatus = await dbAll("SELECT dealer_status, count(*) as c FROM dealer_visit_targets GROUP BY dealer_status");
  console.log('dealer_status in dealer_visit_targets:', targetsDealerStatus);

  const sampleTargets = await dbAll("SELECT id, dealer_id, sap_code, sfa_code, dealer_name, cust_type, dealer_status, total_visits FROM dealer_visit_targets LIMIT 10");
  console.log('Sample dealer_visit_targets:', sampleTargets);

  process.exit(0);
}

check().catch(console.error);
