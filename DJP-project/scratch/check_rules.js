import { dbAll } from '../src/config/database.js';

async function checkRules() {
  const rules = await dbAll('SELECT * FROM business_rules ORDER BY rule_key');
  console.log(`Found ${rules.length} business rules:`);
  for (const r of rules) {
    console.log(`  ${r.rule_key} = ${r.rule_value} (${r.description || ''})`);
  }
}

checkRules().catch(console.error);
