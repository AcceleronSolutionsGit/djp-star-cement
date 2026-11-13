import { dbAll } from '../config/database.js';

async function checkSpd() {
  const types = await dbAll('SELECT dealer_type, count(*) as c FROM sales_plan_details GROUP BY dealer_type');
  console.log('sales_plan_details dealer_type distribution:', types);
  process.exit(0);
}

checkSpd().catch(console.error);
