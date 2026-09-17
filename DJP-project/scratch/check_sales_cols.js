import { dbAll } from '../src/config/database.js';

async function checkSalesCols() {
  const cols = await dbAll('DESCRIBE sales_history');
  console.log('sales_history cols:', cols.map(c => c.Field));

  const sales = await dbAll('SELECT * FROM sales_history LIMIT 10');
  console.log('Sample sales:', sales);

  const targets = await dbAll('SELECT sap_code, sfa_code, dealer_name, category, dealer_status, current_sales, previous_sales, lysm_sales, rsar_six_month_avg, so_visits, asm_visits, rsm_visits, zh_visits FROM dealer_visit_targets');
  console.log('Targets in DB:');
  console.table(targets);
}

checkSalesCols().catch(console.error);
