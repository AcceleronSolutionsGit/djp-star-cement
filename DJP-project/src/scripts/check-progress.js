import { dbGet, dbAll } from '../config/database.js';

async function check() {
  const salesCount = await dbGet('SELECT COUNT(*) as cnt FROM sales_history');
  console.log('Current sales_history count:', salesCount ? salesCount.cnt : 0);

  const achumiSales = await dbAll(
    'SELECT * FROM sales_history WHERE sap_code = "1000003100" OR linked_dealer_code = "1000003100" OR sub_dealer_name LIKE "%ACHUMI%"'
  );
  console.log('Achumi sales count:', achumiSales.length);
  if (achumiSales.length > 0) {
    console.log('Sample Achumi record:', achumiSales[0]);
  }
}

check();
