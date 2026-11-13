import { dbAll } from '../config/database.js';

async function checkCustTypes() {
  const targets = await dbAll(`
    SELECT cust_type, count(id) as c 
    FROM dealer_visit_targets 
    WHERE period_month = '2026-10' 
    GROUP BY cust_type
  `);
  console.log('October targets cust_type:', targets);

  const targetsAll = await dbAll(`
    SELECT period_month, cust_type, count(id) as c 
    FROM dealer_visit_targets 
    GROUP BY period_month, cust_type
  `);
  console.log('All periods targets cust_type:');
  console.table(targetsAll);

  const masterTypes = await dbAll(`
    SELECT dealer_type, count(id) as c 
    FROM master_dealers 
    GROUP BY dealer_type
  `);
  console.log('master_dealers dealer_type:');
  console.table(masterTypes);

  // Check sales_plan_details dealer_type
  const spdTypes = await dbAll(`
    SELECT spd.dealer_type, count(spd.id) as c
    FROM sales_plan_details spd
    JOIN sales_plans sp ON spd.plan_id = sp.id
    WHERE sp.period_month = '2026-10'
    GROUP BY spd.dealer_type
  `);
  console.log('October sales_plan_details dealer_type:');
  console.table(spdTypes);

  process.exit(0);
}

checkCustTypes().catch(console.error);
