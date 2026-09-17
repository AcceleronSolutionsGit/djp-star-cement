import { dbAll, dbGet } from '../src/config/database.js';

async function check() {
  const count = await dbGet('SELECT COUNT(*) as n FROM dealer_visit_targets');
  console.log('Total targets in DB:', count.n);

  const periods = await dbAll('SELECT period_month, cycle_code, COUNT(*) as cnt FROM dealer_visit_targets GROUP BY period_month, cycle_code');
  console.log('Periods in DB:', periods);

  const sample = await dbAll('SELECT * FROM dealer_visit_targets LIMIT 1');
  if (sample.length > 0) {
    console.log('Sample row columns:', Object.keys(sample[0]));
    console.log('Sample row:', JSON.stringify(sample[0], null, 2));
  }
}

check().catch(console.error);
