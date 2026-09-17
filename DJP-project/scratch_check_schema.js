import { dbAll } from './src/config/database.js';

async function checkSchema() {
  try {
    const describe = await dbAll('DESCRIBE master_dealers');
    console.log(JSON.stringify(describe, null, 2));
    
    // Check if migration has run or not
    console.log('\n--- Checking if normalized_dealer_name exists ---');
    const hasNormalized = describe.some(col => col.Field === 'normalized_dealer_name');
    console.log(`Has normalized_dealer_name: ${hasNormalized}`);
    
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

checkSchema();
