import { dbAll } from '../src/config/database.js';

async function checkDP() {
  const rows = await dbAll('SELECT * FROM dealer_performance_history WHERE sap_code IN ("D001", "D002", "D003", "D004", "D005") ORDER BY sap_code, period_year_month');
  console.log('DP rows for D001-D005:');
  console.table(rows);

  const periods = await dbAll('SELECT DISTINCT period_year_month FROM dealer_performance_history ORDER BY period_year_month');
  console.log('All DP periods:', periods.map(p => p.period_year_month));

  process.exit(0);
}

checkDP().catch(e => { console.error(e); process.exit(1); });
