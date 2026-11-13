import { dbAll } from '../config/database.js';

async function checkSpdByPeriod() {
  const byPeriod = await dbAll(`
    SELECT sp.period_month, spd.dealer_type, count(spd.id) as c
    FROM sales_plans sp
    JOIN sales_plan_details spd ON sp.id = spd.plan_id
    GROUP BY sp.period_month, spd.dealer_type
    ORDER BY sp.period_month ASC, c DESC
  `);
  console.log('sales_plan_details dealer_type by period:');
  console.table(byPeriod);
  process.exit(0);
}

checkSpdByPeriod().catch(console.error);
