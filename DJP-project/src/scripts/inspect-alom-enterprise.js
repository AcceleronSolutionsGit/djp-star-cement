import { dbAll } from '../config/database.js';

async function main() {
  console.log('=== Checking ALOM ENTERPRISE in database.sqlite ===');

  const dealers = await dbAll('SELECT * FROM master_dealers WHERE dealer_name LIKE "%ALOM ENTERPRISE%"');
  console.log('\nmaster_dealers:');
  console.dir(dealers, { depth: null });

  const mappings = await dbAll('SELECT * FROM master_dealer_so_mapping WHERE dealer_name LIKE "%ALOM ENTERPRISE%"');
  console.log('\nmaster_dealer_so_mapping:');
  console.dir(mappings, { depth: null });

  const targets = await dbAll('SELECT * FROM dealer_visit_targets WHERE dealer_name LIKE "%ALOM ENTERPRISE%"');
  console.log('\ndealer_visit_targets:');
  console.dir(targets, { depth: null });
}

main().catch(console.error);
