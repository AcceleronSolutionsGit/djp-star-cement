import { dbExec } from '../config/database.js';

export async function runNonTradeMigration() {
  console.log('[Non-Trade Migration] Creating Non-Trade DJP tables...');

  const schema = `
    CREATE TABLE IF NOT EXISTS nontrade_plans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period_month VARCHAR(10) NOT NULL DEFAULT '2026-09',
      role_type VARCHAR(20) NOT NULL, -- 'Officer', 'ASM', 'HOS'
      emp_code VARCHAR(50) NOT NULL,
      emp_name VARCHAR(255) NOT NULL,
      asm_emp_code VARCHAR(50) NULL,
      asm_name VARCHAR(255) NULL,
      hos_emp_code VARCHAR(50) NULL,
      hos_name VARCHAR(255) NULL,
      sap_code VARCHAR(50) NULL,
      party_name VARCHAR(255) NULL,
      destination_zone VARCHAR(255) NULL,
      area VARCHAR(100) NULL,
      ship_to_party_name VARCHAR(255) NULL,
      ship_to_party VARCHAR(50) NULL,
      segment VARCHAR(50) NULL,
      bucket VARCHAR(50) NULL,
      priority INT DEFAULT 0,
      model_visits DECIMAL(5,2) DEFAULT 0,
      date_of_visit_1 VARCHAR(20) NULL,
      date_of_visit_2 VARCHAR(20) NULL,
      date_of_visit_3 VARCHAR(20) NULL,
      ho_visit_date_1 VARCHAR(20) NULL,
      ho_visit_date_2 VARCHAR(20) NULL,
      remarks TEXT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING_ROLLOUT',
      concat_id VARCHAR(100) NULL,
      source_file VARCHAR(255) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_nt_period_role (period_month, role_type),
      INDEX idx_nt_emp (emp_code),
      INDEX idx_nt_concat (concat_id),
      INDEX idx_nt_bucket (bucket),
      INDEX idx_nt_shipto (ship_to_party)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS nontrade_ho_plans (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period_month VARCHAR(10) NOT NULL DEFAULT '2026-09',
      role_type VARCHAR(20) NOT NULL, -- 'Officer', 'ASM', 'HOS'
      emp_code VARCHAR(50) NOT NULL,
      emp_name VARCHAR(255) NULL,
      sap_code VARCHAR(50) NOT NULL,
      party_name VARCHAR(255) NULL,
      ho_visit_date_1 VARCHAR(20) NULL,
      ho_visit_date_2 VARCHAR(20) NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'PENDING_ROLLOUT',
      concat_id VARCHAR(100) NULL,
      source_file VARCHAR(255) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ntho_period_role (period_month, role_type),
      INDEX idx_ntho_emp (emp_code),
      INDEX idx_ntho_concat (concat_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS nontrade_customer_visit_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period_month VARCHAR(10) NOT NULL DEFAULT '2026-09',
      si_no INT NULL,
      visit_date VARCHAR(20) NULL,
      customer_code VARCHAR(100) NULL,
      customer_name VARCHAR(255) NULL,
      route VARCHAR(255) NULL,
      type VARCHAR(100) NULL,
      branch VARCHAR(100) NULL,
      emp_code VARCHAR(50) NOT NULL,
      emp_name VARCHAR(255) NULL,
      check_in_time VARCHAR(50) NULL,
      check_out_time VARCHAR(50) NULL,
      duration VARCHAR(100) NULL,
      visit_status VARCHAR(100) NULL,
      remarks TEXT NULL,
      purpose_of_visit VARCHAR(255) NULL,
      sap_code VARCHAR(50) NULL,
      concat_id VARCHAR(100) NULL,
      bucket VARCHAR(100) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ntcvr_period (period_month),
      INDEX idx_ntcvr_emp (emp_code),
      INDEX idx_ntcvr_concat (concat_id),
      INDEX idx_ntcvr_bucket (bucket)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS nontrade_leads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period_month VARCHAR(10) NOT NULL DEFAULT '2026-09',
      lead_date VARCHAR(20) NULL,
      firm VARCHAR(255) NULL,
      contact_person VARCHAR(255) NULL,
      mobile VARCHAR(50) NULL,
      branch VARCHAR(100) NULL,
      area VARCHAR(100) NULL,
      address TEXT NULL,
      category VARCHAR(100) NULL,
      sub_category VARCHAR(100) NULL,
      emp_code VARCHAR(50) NOT NULL,
      created_by VARCHAR(255) NULL,
      department VARCHAR(100) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ntlead_period (period_month),
      INDEX idx_ntlead_emp (emp_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS nontrade_site_visits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period_month VARCHAR(10) NOT NULL DEFAULT '2026-09',
      visit_date VARCHAR(20) NULL,
      emp_code VARCHAR(50) NOT NULL,
      emp_name VARCHAR(255) NULL,
      branch VARCHAR(100) NULL,
      place VARCHAR(100) NULL,
      name VARCHAR(255) NULL,
      category VARCHAR(100) NULL,
      contact_no VARCHAR(50) NULL,
      total_consumption_bag DECIMAL(12,2) NULL,
      balance_consumption_bag DECIMAL(12,2) NULL,
      visit_status VARCHAR(100) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ntsv_period (period_month),
      INDEX idx_ntsv_emp (emp_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS nontrade_professional_visits (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period_month VARCHAR(10) NOT NULL DEFAULT '2026-09',
      visit_date VARCHAR(20) NULL,
      emp_code VARCHAR(50) NOT NULL,
      emp_name VARCHAR(255) NULL,
      branch VARCHAR(100) NULL,
      zone VARCHAR(100) NULL,
      name VARCHAR(255) NULL,
      mobile_no VARCHAR(50) NULL,
      type VARCHAR(100) NULL,
      organisation VARCHAR(255) NULL,
      designation VARCHAR(100) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_ntpv_period (period_month),
      INDEX idx_ntpv_emp (emp_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    CREATE TABLE IF NOT EXISTS nontrade_uploads (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period_month VARCHAR(10) NOT NULL,
      file_type VARCHAR(50) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      record_count INT DEFAULT 0,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  await dbExec(schema);

  // Check and add status column to existing tables if needed
  const { dbAll, dbRun } = await import('../config/database.js');
  const ntCols = await dbAll('DESCRIBE nontrade_plans');
  if (!ntCols.some(c => c.Field === 'status')) {
    await dbRun("ALTER TABLE nontrade_plans ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'PENDING_ROLLOUT'");
    await dbRun("ALTER TABLE nontrade_plans ADD INDEX idx_nt_status (status)");
    console.log('[Non-Trade Migration] Added status column to nontrade_plans.');
  }

  const nthoCols = await dbAll('DESCRIBE nontrade_ho_plans');
  if (!nthoCols.some(c => c.Field === 'status')) {
    await dbRun("ALTER TABLE nontrade_ho_plans ADD COLUMN status VARCHAR(50) NOT NULL DEFAULT 'PENDING_ROLLOUT'");
    await dbRun("ALTER TABLE nontrade_ho_plans ADD INDEX idx_ntho_status (status)");
    console.log('[Non-Trade Migration] Added status column to nontrade_ho_plans.');
  }

  console.log('[Non-Trade Migration] Tables created successfully.');

  // Automatically seed baseline execution and sync live SFA visits
  try {
    const { seedNonTradeBaselineExecution, syncNonTradeVisitsFromSfa, ensureNonTradePlansForMonth } = await import('../services/nontrade.service.js');
    console.log('[Non-Trade Migration] Ensuring baseline plans and live SFA execution for September and October...');
    await ensureNonTradePlansForMonth('2026-09');
    await seedNonTradeBaselineExecution('2026-09');
    await syncNonTradeVisitsFromSfa('2026-09');

    await ensureNonTradePlansForMonth('2026-10');
    await seedNonTradeBaselineExecution('2026-10');
    await syncNonTradeVisitsFromSfa('2026-10');
    console.log('[Non-Trade Migration] Baseline execution & SFA sync complete.');
  } catch (seedErr) {
    console.warn('[Non-Trade Migration] Seeding warning:', seedErr.message);
  }
}

if (process.argv[1]?.endsWith('migrate-nontrade-tables.js')) {
  runNonTradeMigration().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

