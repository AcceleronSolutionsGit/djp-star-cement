import { dbAll } from '../src/config/database.js';

async function checkD005() {
  const sh = await dbAll('SELECT sap_code, period_year_month, quantity_mt, batch_code FROM sales_history WHERE sap_code = "D005"');
  console.log('sales_history D005:', sh);
  const dp = await dbAll('SELECT sap_code, period_year_month, quantity_mt, batch_code FROM dealer_performance_history WHERE sap_code = "D005"');
  console.log('dp_history D005:', dp);
  const md = await dbAll('SELECT sap_code, current_sales FROM master_dealers WHERE sap_code = "D005"');
  console.log('master_dealers D005:', md);
  process.exit(0);
}

checkD005().catch(e => { console.error(e); process.exit(1); });
