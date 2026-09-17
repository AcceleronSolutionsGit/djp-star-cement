import { pool } from '../config/database.js';

async function addCol(table, col, def) {
  try {
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
    console.log(`Added ${col} to ${table}`);
  } catch (e) {
    if (e.message.includes('Duplicate column')) {
      // already exists
    } else {
      console.log(`Note on ${table}.${col}: ${e.message}`);
    }
  }
}

async function main() {
  await addCol('master_dealer_so_mapping', 'territory_code', 'VARCHAR(100) NULL');
  await addCol('master_dealer_so_mapping', 'territory_name', 'VARCHAR(255) NULL');
  await addCol('master_dealer_so_mapping', 'rsm_code', 'VARCHAR(100) NULL');
  await addCol('master_dealer_so_mapping', 'zh_code', 'VARCHAR(100) NULL');

  await addCol('master_dealers', 'territory_code', 'VARCHAR(100) NULL');
  await addCol('master_dealers', 'territory_name', 'VARCHAR(255) NULL');
  await addCol('master_dealers', 'rsm_name', 'VARCHAR(255) NULL');
  await addCol('master_dealers', 'rsm_code', 'VARCHAR(100) NULL');
  await addCol('master_dealers', 'zh_name', 'VARCHAR(255) NULL');
  await addCol('master_dealers', 'zh_code', 'VARCHAR(100) NULL');
  await addCol('master_dealers', 'current_sales', 'DOUBLE DEFAULT 0');

  await addCol('dealer_visit_targets', 'territory_code', 'VARCHAR(100) NULL');
  await addCol('dealer_visit_targets', 'territory_name', 'VARCHAR(255) NULL');
  await addCol('dealer_visit_targets', 'so_code', 'VARCHAR(100) NULL');
  await addCol('dealer_visit_targets', 'rsm_code', 'VARCHAR(100) NULL');
  await addCol('dealer_visit_targets', 'zh_code', 'VARCHAR(100) NULL');
  await addCol('dealer_visit_targets', 'potential', 'DOUBLE DEFAULT 0');
  await addCol('dealer_visit_targets', 'previous_sales', 'DOUBLE DEFAULT 0');
  await addCol('dealer_visit_targets', 'current_sales', 'DOUBLE DEFAULT 0');
  await addCol('dealer_visit_targets', 'final_volume', 'DOUBLE DEFAULT 0');
  await addCol('dealer_visit_targets', 'score_a', 'DOUBLE DEFAULT 0');
  await addCol('dealer_visit_targets', 'score_b', 'DOUBLE DEFAULT 0');
  await addCol('dealer_visit_targets', 'score_c', 'DOUBLE DEFAULT 0');
  await addCol('dealer_visit_targets', 'total_score', 'DOUBLE DEFAULT 0');
  await addCol('dealer_visit_targets', 'priority_label', 'VARCHAR(50) NULL');
  await addCol('dealer_visit_targets', 'grade', 'VARCHAR(10) NULL');

  console.log('Columns migration check complete.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
