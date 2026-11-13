import { dbAll } from '../config/database.js';

async function check() {
  const ub = await dbAll('SELECT DISTINCT period_month, file_type, count(*) as c FROM upload_batches GROUP BY period_month, file_type');
  console.log('upload_batches:', ub);

  const sp = await dbAll('SELECT DISTINCT period_month, cycle_code, count(*) as c FROM sales_plans GROUP BY period_month, cycle_code');
  console.log('sales_plans:', sp);

  const sh = await dbAll('SELECT DISTINCT period_month, count(*) as c FROM sales_history GROUP BY period_month');
  console.log('sales_history periods:', sh);

  const dt = await dbAll('SELECT DISTINCT period_month, count(*) as c FROM dealer_visit_targets GROUP BY period_month');
  console.log('dealer_visit_targets periods:', dt);

  process.exit(0);
}

check().catch(console.error);
