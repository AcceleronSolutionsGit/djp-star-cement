import { pool } from '../config/database.js';

async function main() {
  const [existing] = await pool.query("SELECT id FROM business_rules WHERE rule_key = 'score_b'");
  if (existing && existing.length > 0) {
    await pool.query("UPDATE business_rules SET rule_value = '31' WHERE rule_key = 'score_b'");
  } else {
    await pool.query(`
      INSERT INTO business_rules (rule_key, rule_name, rule_value, data_type, description)
      VALUES ('score_b', 'Score B Value', '31', 'INTEGER', 'Configured Score B applicable to dealers')
    `);
  }
  console.log('Score B configured as 31 in business_rules.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
