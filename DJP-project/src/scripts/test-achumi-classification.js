import { dbAll } from '../config/database.js';
import { classifyDealer } from '../engines/classification.engine.js';

async function testAchumiClassification() {
  const code = '1000003100';
  const dealer = { sap_code: code, dealer_name: 'A ACHUMI HARDWARE & PAINTS' };
  
  const sales = await dbAll(
    `SELECT period_year_month, SUM(quantity_mt) as quantity_mt 
     FROM sales_history 
     WHERE sap_code = ? OR rssd_code = ? OR linked_dealer_code = ? 
     GROUP BY period_year_month 
     ORDER BY period_year_month DESC LIMIT 12`,
    [code, code, code]
  );
  
  console.log('--- Achumi Sales Query Result ---');
  console.log(sales);

  const classification = await classifyDealer(dealer);
  console.log('--- Achumi Classification Result ---');
  console.log(classification);
  process.exit(0);
}

testAchumiClassification();
