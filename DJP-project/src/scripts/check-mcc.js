import { dbAll } from '../config/database.js';

async function checkMcc() {
  const types = await dbAll('SELECT customer_type, count(id) as c FROM master_customer_coordinates GROUP BY customer_type');
  console.log('master_customer_coordinates customer_type:', types);
  process.exit(0);
}

checkMcc().catch(console.error);

