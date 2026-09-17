import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dbExec, dbRun } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initDB() {
  console.log('Initializing MySQL database (star_one_djp)...');
  
  await dbExec('SET FOREIGN_KEY_CHECKS = 0;');

  const tables = [
    'plan_approvals',
    'sales_plan_details',
    'sales_plans',
    'dealer_visit_targets',
    'djp_recommendations',
    'visit_execution_logs',
    'sales_history',
    'master_dealer_so_mapping',
    'master_dealers',
    'master_employees',
    'upload_batches',
    'business_rules'
  ];

  for (const t of tables) {
    await dbExec(`DROP TABLE IF EXISTS \`${t}\`;`);
  }

  const schemaPath = path.resolve(__dirname, '../models/schema.mysql.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  await dbExec(sql);
  await dbExec('SET FOREIGN_KEY_CHECKS = 1;');
  console.log('Database tables recreated successfully.');

  // Seed Default Business Rules
  const defaultRules = [
    { rule_key: 'daily_visit_capacity', rule_name: 'Daily SO Visit Capacity', rule_value: '8', data_type: 'INTEGER', description: 'Default maximum dealer visits allocated per SO per day' },
    { rule_key: 'daily_visit_capacity_asm', rule_name: 'Daily ASM Visit Capacity', rule_value: '4', data_type: 'INTEGER', description: 'Default maximum dealer visits allocated per ASM per day' },
    { rule_key: 'daily_visit_capacity_rsm', rule_name: 'Daily RSM Visit Capacity', rule_value: '2', data_type: 'INTEGER', description: 'Default maximum dealer visits allocated per RSM per day' },
    { rule_key: 'monthly_visit_capacity_zh', rule_name: 'Monthly ZH Visit Capacity', rule_value: '10', data_type: 'INTEGER', description: 'Default maximum visits allocated per ZH per month' },
    { rule_key: 'c1_start_day', rule_name: 'Cycle 1 Start Day', rule_value: '1', data_type: 'INTEGER', description: 'Start day of the month for Cycle 1' },
    { rule_key: 'c1_end_day', rule_name: 'Cycle 1 End Day', rule_value: '15', data_type: 'INTEGER', description: 'End day of the month for Cycle 1' },
    { rule_key: 'c2_start_day', rule_name: 'Cycle 2 Start Day', rule_value: '16', data_type: 'INTEGER', description: 'Start day of the month for Cycle 2' },
    { rule_key: 'c2_end_day', rule_name: 'Cycle 2 End Day', rule_value: '31', data_type: 'INTEGER', description: 'End day of the month for Cycle 2' },
    { rule_key: 'churn_months_threshold', rule_name: 'Churn Threshold (Months)', rule_value: '6', data_type: 'INTEGER', description: 'Number of consecutive months without lifting to categorize as Churn' },
    { rule_key: 'ntg_min_percentile', rule_name: 'NTG Min Percentile', rule_value: '60', data_type: 'INTEGER', description: 'Need to Grow minimum area percentile potential' },
    { rule_key: 'ntg_max_share', rule_name: 'NTG Max Share', rule_value: '20', data_type: 'INTEGER', description: 'Need to Grow maximum counter share %' },
    { rule_key: 'cat_a_min', rule_name: 'Category A Min %ile', rule_value: '60', data_type: 'INTEGER', description: 'Minimum percentile for Category A' },
    { rule_key: 'cat_b_min', rule_name: 'Category B Min %ile', rule_value: '40', data_type: 'INTEGER', description: 'Minimum percentile for Category B' },
    { rule_key: 'cat_c_min', rule_name: 'Category C Min %ile', rule_value: '20', data_type: 'INTEGER', description: 'Minimum percentile for Category C' },
    { rule_key: 'priority_weight_potential', rule_name: 'Score A Potential Weight', rule_value: '40', data_type: 'INTEGER', description: 'Potential weight in priority score' },
    { rule_key: 'priority_weight_share', rule_name: 'Score C Share Weight', rule_value: '20', data_type: 'INTEGER', description: 'Share weight in priority score' },
    { rule_key: 'priority_weight_category', rule_name: 'Score B Category Weight', rule_value: '40', data_type: 'INTEGER', description: 'Category weight in priority score' },
    { rule_key: 'priority_weight_missed_boost', rule_name: 'Missed Visit Priority Boost', rule_value: '15', data_type: 'INTEGER', description: 'Boost points for missed visits' },
    { rule_key: 'scoreb_growing', rule_name: 'Score B Growing', rule_value: '40', data_type: 'INTEGER', description: 'Score B for Growing status' },
    { rule_key: 'scoreb_degrowing', rule_name: 'Score B De-growing', rule_value: '30', data_type: 'INTEGER', description: 'Score B for De-growing status' },
    { rule_key: 'scoreb_need_to_grow', rule_name: 'Score B Need to Grow', rule_value: '25', data_type: 'INTEGER', description: 'Score B for Need to Grow status' },
    { rule_key: 'scoreb_zero_lifter', rule_name: 'Score B Zero Lifter', rule_value: '15', data_type: 'INTEGER', description: 'Score B for Zero Lifter status' },
    { rule_key: 'scoreb_churn', rule_name: 'Score B Churn', rule_value: '10', data_type: 'INTEGER', description: 'Score B for Churn status' },
    { rule_key: 'scoreb_prospective', rule_name: 'Score B Prospective', rule_value: '30', data_type: 'INTEGER', description: 'Score B for Prospective status' }
  ];

  for (const rule of defaultRules) {
    await dbRun(
      'INSERT INTO business_rules (rule_key, rule_name, rule_value, data_type, description) VALUES (?, ?, ?, ?, ?)',
      [rule.rule_key, rule.rule_name, rule.rule_value, rule.data_type, rule.description]
    );
  }

  console.log('Seeded default business rules into MySQL.');
  process.exit(0);
}

initDB().catch((err) => {
  console.error('Error initializing database:', err);
  process.exit(1);
});
