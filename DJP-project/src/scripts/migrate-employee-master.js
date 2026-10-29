import { dbRun, dbAll, dbGet } from '../config/database.js';

/**
 * Migration to create and maintain employee_master table based on SFA API.
 */
export async function runEmployeeMasterMigration() {
  console.log('[Migration] Creating employee_master table if not exists...');
  
  await dbRun(`
    CREATE TABLE IF NOT EXISTS employee_master (
      id INT AUTO_INCREMENT PRIMARY KEY,
      emp_code VARCHAR(50) NOT NULL UNIQUE,
      dns_emp_code VARCHAR(50) NULL,
      emp_name VARCHAR(255) NULL,
      dob VARCHAR(50) NULL,
      acedns VARCHAR(10) NULL,
      branch_code VARCHAR(500) NULL,
      doj VARCHAR(50) NULL,
      lower_leaves LONGTEXT NULL,
      reporting_to VARCHAR(500) NULL,
      vertical_value VARCHAR(100) NULL,
      email VARCHAR(255) NULL,
      phone_no VARCHAR(50) NULL,
      hq VARCHAR(100) NULL,
      sale_access VARCHAR(50) NULL,
      designation VARCHAR(150) NULL,
      district VARCHAR(100) NULL,
      state VARCHAR(100) NULL,
      zone VARCHAR(100) NULL,
      region VARCHAR(100) NULL,
      app_access VARCHAR(10) NULL,
      functionality VARCHAR(100) NULL,
      functionality_rel_val VARCHAR(100) NULL,
      level VARCHAR(50) NULL,
      acedns_changed_date VARCHAR(50) NULL,
      download_time VARCHAR(50) NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_em_dns_emp_code (dns_emp_code),
      INDEX idx_em_emp_name (emp_name),
      INDEX idx_em_designation (designation),
      INDEX idx_em_zone (zone),
      INDEX idx_em_state (state),
      INDEX idx_em_acedns (acedns),
      INDEX idx_em_reporting_to (reporting_to)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('[Migration] ✓ Verified employee_master table exists');
}

if (process.argv[1]?.endsWith('migrate-employee-master.js')) {
  runEmployeeMasterMigration()
    .then(() => {
      console.log('Employee master migration finished successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

