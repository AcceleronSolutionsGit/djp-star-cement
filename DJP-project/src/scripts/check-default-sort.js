import { dbAll } from '../config/database.js';

async function checkOrder() {
  const sample = await dbAll(`
    SELECT dvt.id, dvt.dealer_name, dvt.cust_type, dvt.category 
    FROM dealer_visit_targets dvt 
    WHERE period_month = '2026-10' 
    ORDER BY dvt.category ASC, dvt.dealer_name ASC 
    LIMIT 200
  `);
  
  const typesInFirst200 = {};
  for (const s of sample) {
    typesInFirst200[s.cust_type] = (typesInFirst200[s.cust_type] || 0) + 1;
  }
  console.log('Types in first 200 rows:', typesInFirst200);

  // Where does the first RSAR appear in this sort order?
  const allRows = await dbAll(`
    SELECT dvt.id, dvt.cust_type 
    FROM dealer_visit_targets dvt 
    WHERE period_month = '2026-10' 
    ORDER BY dvt.category ASC, dvt.dealer_name ASC
  `);
  const firstRsarIdx = allRows.findIndex(r => r.cust_type === 'RSAR');
  console.log('Index of first RSAR in default sort order:', firstRsarIdx);

  process.exit(0);
}

checkOrder().catch(console.error);
