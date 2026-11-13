import { dbAll } from '../config/database.js';

async function checkLogCustomerTypes() {
  const logTypes = await dbAll('SELECT customer_type, count(id) as c FROM visit_execution_logs GROUP BY customer_type');
  console.log('visit_execution_logs customer_type:', logTypes);
  process.exit(0);
}

checkLogCustomerTypes().catch(console.error);

