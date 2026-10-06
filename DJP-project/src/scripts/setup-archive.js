import { dbExec, dbRun } from '../config/database.js';

async function setupArchiveTables() {
  console.log('Creating archive tables...');

  const sql = `
    -- 1. visit_execution_logs_archive
    CREATE TABLE IF NOT EXISTS visit_execution_logs_archive (
        id INT PRIMARY KEY,
        visit_date DATE NOT NULL,
        customer_code VARCHAR(100) NOT NULL,
        customer_name VARCHAR(255),
        customer_type VARCHAR(100),
        route VARCHAR(255),
        branch VARCHAR(255),
        employee_code VARCHAR(100) NOT NULL,
        employee_name VARCHAR(255),
        check_in_time VARCHAR(50),
        check_out_time VARCHAR(50),
        duration VARCHAR(50),
        visit_status VARCHAR(50),
        purpose_of_visit TEXT,
        remarks TEXT,
        batch_code VARCHAR(100),
        created_at DATETIME,
        archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_arch_visit_date (visit_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 2. sales_plans_archive
    CREATE TABLE IF NOT EXISTS sales_plans_archive (
        id INT PRIMARY KEY,
        emp_code VARCHAR(100) NOT NULL,
        emp_name VARCHAR(255) NOT NULL,
        period_month VARCHAR(20) NOT NULL,
        status VARCHAR(50),
        submitted_at DATETIME,
        approved_by VARCHAR(100),
        approved_at DATETIME,
        remarks TEXT,
        created_at DATETIME,
        archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_arch_plan_period (period_month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 3. sales_plan_details_archive
    CREATE TABLE IF NOT EXISTS sales_plan_details_archive (
        id INT PRIMARY KEY,
        plan_id INT NOT NULL,
        visit_date DATE NOT NULL,
        dealer_id INT,
        dealer_sap_code VARCHAR(100),
        dealer_name VARCHAR(255) NOT NULL,
        dealer_type VARCHAR(50),
        purpose_of_visit TEXT,
        sequence INT,
        created_at DATETIME,
        archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_arch_detail_plan (plan_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 4. sales_history_archive
    CREATE TABLE IF NOT EXISTS sales_history_archive (
        id INT PRIMARY KEY,
        sap_code VARCHAR(100),
        rssd_code VARCHAR(100),
        linked_dealer_code VARCHAR(100),
        linked_dealer_name VARCHAR(255),
        sub_dealer_name VARCHAR(255),
        zone VARCHAR(100),
        period_year_month VARCHAR(20) NOT NULL,
        quantity_mt DOUBLE,
        batch_code VARCHAR(100),
        created_at DATETIME,
        archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_arch_sales_period (period_year_month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

    -- 5. dealer_visit_targets_archive
    CREATE TABLE IF NOT EXISTS dealer_visit_targets_archive (
        id INT PRIMARY KEY,
        generation_run_code VARCHAR(100),
        period_month VARCHAR(20) NOT NULL,
        cycle_code VARCHAR(20),
        dealer_id INT,
        dealer_name VARCHAR(255),
        sap_code VARCHAR(100),
        sfa_code VARCHAR(100),
        area VARCHAR(100),
        zone VARCHAR(100),
        category VARCHAR(50),
        dealer_status VARCHAR(100),
        so_name VARCHAR(255),
        so_emp_code VARCHAR(100),
        so_visits DOUBLE,
        asm_visits DOUBLE,
        rsm_visits DOUBLE,
        zh_visits DOUBLE,
        total_visits DOUBLE,
        so_visits_pct DOUBLE,
        asm_visits_pct DOUBLE,
        rsm_visits_pct DOUBLE,
        zh_visits_pct DOUBLE,
        batch_code VARCHAR(100),
        created_at DATETIME,
        archived_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_arch_target_period (period_month)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `;

  try {
    await dbExec(sql);
    console.log('Successfully created archive tables!');
  } catch (err) {
    console.error('Error creating archive tables:', err);
  }
  process.exit(0);
}

setupArchiveTables();
