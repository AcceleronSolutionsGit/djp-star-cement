import { dbRun, dbAll, dbGet } from '../config/database.js';

export async function runPlanEnhancementsMigration() {
  console.log('[Migration] Starting plan enhancements migration...');

  // 1. Add backdated tracking columns to sales_plan_details if missing
  const cols = await dbAll('DESCRIBE sales_plan_details');
  const colNames = new Set(cols.map(c => c.Field));

  if (!colNames.has('updated_at')) {
    console.log('[Migration] Adding updated_at column to sales_plan_details...');
    await dbRun('ALTER TABLE sales_plan_details ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  }

  if (!colNames.has('is_backdated_edit')) {
    console.log('[Migration] Adding is_backdated_edit column to sales_plan_details...');
    await dbRun('ALTER TABLE sales_plan_details ADD COLUMN is_backdated_edit TINYINT(1) NOT NULL DEFAULT 0');
  }

  if (!colNames.has('edited_after_date')) {
    console.log('[Migration] Adding edited_after_date column to sales_plan_details...');
    await dbRun('ALTER TABLE sales_plan_details ADD COLUMN edited_after_date TINYINT(1) NOT NULL DEFAULT 0');
  }

  // 2. Insert or update edit window rules in business_rules
  const windowRules = [
    { key: 'c1_edit_start_day', name: 'Cycle 1 Edit Window Start Day', val: '1', desc: 'Day of month when C1 plan editing opens (1-5th)' },
    { key: 'c1_edit_end_day',   name: 'Cycle 1 Edit Window End Day',   val: '5', desc: 'Day of month when C1 plan editing closes (1-5th)' },
    { key: 'c2_edit_start_day', name: 'Cycle 2 Edit Window Start Day', val: '15', desc: 'Day of month when C2 plan editing opens (15-17th)' },
    { key: 'c2_edit_end_day',   name: 'Cycle 2 Edit Window End Day',   val: '17', desc: 'Day of month when C2 plan editing closes (15-17th)' },
    { key: 'all_saturdays_working', name: 'All Saturdays Working', val: '1', desc: 'Flag indicating all Saturdays are full working days (1=Yes, 0=No)' }
  ];

  for (const r of windowRules) {
    const existing = await dbGet('SELECT id FROM business_rules WHERE rule_key = ?', [r.key]);
    if (!existing) {
      await dbRun(
        'INSERT INTO business_rules (rule_key, rule_name, rule_value, data_type, description, updated_at) VALUES (?, ?, ?, "INTEGER", ?, NOW())',
        [r.key, r.name, r.val, r.desc]
      );
      console.log(`[Migration] Inserted business rule: ${r.key} = ${r.val}`);
    }
  }

  // 3. Heal dealer_type in master_dealers and sales_plan_details (RSAR vs DEALER)
  console.log('[Migration] Healing RSAR vs DEALER customer types...');
  
  // A: If matched with Sub Dealer in master_customer_coordinates, set to RSAR
  await dbRun(`
    UPDATE master_dealers md
    JOIN master_customer_coordinates mcc 
      ON (md.sfa_code IS NOT NULL AND mcc.dns_customer_code = md.sfa_code)
      OR (md.sap_code IS NOT NULL AND (mcc.dns_customer_code = md.sap_code OR mcc.customer_code = md.sap_code))
    SET md.dealer_type = 'RSAR'
    WHERE mcc.customer_type = 'Sub Dealer' OR mcc.customer_type LIKE '%Sub%'
  `);

  // B: If linked_dealer_code or rssd_code is present, set to RSAR
  await dbRun(`
    UPDATE master_dealers
    SET dealer_type = 'RSAR'
    WHERE (linked_dealer_code IS NOT NULL AND linked_dealer_code != '' AND linked_dealer_code != '-')
       OR (rssd_code IS NOT NULL AND rssd_code != '' AND rssd_code != '-')
  `);

  // C: Regular dealers currently marked as STAR -> set to DEALER
  await dbRun(`
    UPDATE master_dealers
    SET dealer_type = 'DEALER'
    WHERE dealer_type = 'STAR'
  `);

  // D: Sync counter names from master_customer_coordinates into master_dealers where available
  await dbRun(`
    UPDATE master_dealers md
    JOIN master_customer_coordinates mcc 
      ON (md.sfa_code IS NOT NULL AND mcc.dns_customer_code = md.sfa_code)
      OR (md.sap_code IS NOT NULL AND (mcc.dns_customer_code = md.sap_code OR mcc.customer_code = md.sap_code))
    SET md.dealer_name = mcc.customer_name
    WHERE mcc.customer_name IS NOT NULL AND mcc.customer_name != '' AND md.dealer_name LIKE 'SBG-%'
  `);

  // E: Sync sales_plan_details dealer_type and dealer_name
  await dbRun(`
    UPDATE sales_plan_details spd
    JOIN master_dealers md ON (spd.dealer_id = md.id OR (spd.dealer_sap_code IS NOT NULL AND spd.dealer_sap_code = md.sap_code))
    SET 
      spd.dealer_type = md.dealer_type,
      spd.dealer_name = COALESCE(NULLIF(md.dealer_name, ''), spd.dealer_name)
    WHERE spd.dealer_type = 'STAR' OR spd.dealer_type IS NULL OR spd.dealer_type = ''
  `);

  // F: Also check if sales_plan_details matches master_customer_coordinates directly
  await dbRun(`
    UPDATE sales_plan_details spd
    JOIN master_customer_coordinates mcc 
      ON (spd.dealer_sap_code IS NOT NULL AND (mcc.dns_customer_code = spd.dealer_sap_code OR mcc.customer_code = spd.dealer_sap_code))
    SET 
      spd.dealer_type = CASE 
        WHEN mcc.customer_type = 'Sub Dealer' OR mcc.customer_type LIKE '%Sub%' THEN 'RSAR'
        WHEN mcc.customer_type IN ('Dealer', 'Exclusive Dealer') THEN 'DEALER'
        WHEN mcc.customer_type = 'Non Star' THEN 'PROSPECTIVE'
        ELSE spd.dealer_type
      END,
      spd.dealer_name = COALESCE(NULLIF(mcc.customer_name, ''), spd.dealer_name)
    WHERE spd.dealer_type = 'STAR' OR spd.dealer_name LIKE 'SBG-%'
  `);

  console.log('[Migration] Plan enhancements migration complete.');
}

if (process.argv[1]?.endsWith('migrate-plan-enhancements.js')) {
  runPlanEnhancementsMigration()
    .then(() => process.exit(0))
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}

