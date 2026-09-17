import { pool } from '../config/database.js';

async function main() {
  console.log('Cleaning old test data from database...');
  // Keep only dealers D001-D005 and P001-P003, remove old legacy test records
  await pool.query("DELETE FROM master_dealers WHERE sap_code NOT IN ('D001', 'D002', 'D003', 'D004', 'D005') AND sfa_code NOT IN ('P001', 'P002', 'P003')");
  await pool.query("DELETE FROM master_dealer_so_mapping WHERE sap_code NOT IN ('D001', 'D002', 'D003', 'D004', 'D005') AND dealer_id NOT IN (SELECT id FROM master_dealers)");
  await pool.query("DELETE FROM sales_history WHERE sap_code NOT IN ('D001', 'D002', 'D003', 'D004', 'D005')");
  await pool.query("DELETE FROM dealer_visit_targets WHERE sap_code NOT IN ('D001', 'D002', 'D003', 'D004', 'D005')");
  console.log('Cleaned old legacy test records.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
