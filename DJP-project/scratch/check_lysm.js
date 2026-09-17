import { dbAll } from '../src/config/database.js';

async function checkLYSM() {
  const rows = await dbAll('SELECT * FROM dealer_performance_history WHERE period_year_month = "2025-06" LIMIT 10');
  console.log('DP rows for 2025-06:');
  console.table(rows);
  process.exit(0);
}

checkLYSM().catch(console.error);
