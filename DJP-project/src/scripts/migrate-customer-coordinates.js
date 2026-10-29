import { dbRun, dbAll } from '../config/database.js';

export async function runCoordinateMigrations() {
  console.log('[Migration] Creating master_customer_coordinates table if not exists...');
  await dbRun(`
    CREATE TABLE IF NOT EXISTS master_customer_coordinates (
      id INT AUTO_INCREMENT PRIMARY KEY,
      dns_customer_code VARCHAR(100) NOT NULL UNIQUE,
      customer_code VARCHAR(100),
      display_code VARCHAR(100),
      customer_name VARCHAR(255),
      customer_type VARCHAR(100),
      phone_no VARCHAR(50),
      route_name VARCHAR(255),
      latitude DOUBLE,
      longitude DOUBLE,
      has_coordinates TINYINT(1) DEFAULT 0,
      branch_code VARCHAR(50),
      state_code VARCHAR(100),
      zone VARCHAR(100),
      address TEXT,
      pin VARCHAR(20),
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_mcc_dns (dns_customer_code),
      INDEX idx_mcc_cust (customer_code),
      INDEX idx_mcc_coords (has_coordinates)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const checkCol = async (tbl, col, def) => {
    try {
      const cols = await dbAll(`SHOW COLUMNS FROM ${tbl}`);
      if (!cols.some(c => c.Field === col)) {
        await dbRun(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`);
        console.log(`[Migration] Added ${col} to ${tbl}`);
      }
    } catch (err) {
      console.warn(`[Migration] Could not alter ${tbl}.${col}:`, err.message);
    }
  };

  const checkIndex = async (tbl, idxName, cols) => {
    try {
      const idxs = await dbAll(`SHOW INDEX FROM ${tbl}`);
      if (!idxs.some(i => i.Key_name === idxName)) {
        await dbRun(`CREATE INDEX ${idxName} ON ${tbl} (${cols})`);
        console.log(`[Migration] Created index ${idxName} on ${tbl}(${cols})`);
      }
    } catch (err) {
      console.warn(`[Migration] Could not create index ${idxName} on ${tbl}:`, err.message);
    }
  };

  // Ensure critical performance indexes exist
  await checkIndex('master_customer_coordinates', 'idx_mcc_dns', 'dns_customer_code');
  await checkIndex('master_customer_coordinates', 'idx_mcc_cust', 'customer_code');
  await checkIndex('master_customer_coordinates', 'idx_mcc_coords', 'has_coordinates');
  await checkIndex('master_dealers', 'idx_dealer_sap', 'sap_code');
  await checkIndex('master_dealers', 'idx_dealer_sfa', 'sfa_code');

  await checkCol('master_dealers', 'latitude', 'DOUBLE NULL');
  await checkCol('master_dealers', 'longitude', 'DOUBLE NULL');
  await checkCol('master_dealers', 'route_name', 'VARCHAR(255) NULL');
  await checkCol('master_dealers', 'has_coordinates', 'TINYINT(1) DEFAULT 0');

  await checkCol('sales_plan_details', 'latitude', 'DOUBLE NULL');
  await checkCol('sales_plan_details', 'longitude', 'DOUBLE NULL');
  await checkCol('sales_plan_details', 'distance_from_prev_km', 'DOUBLE DEFAULT 0');
  await checkCol('sales_plan_details', 'route_name', 'VARCHAR(255) NULL');

  await checkCol('djp_recommendations', 'latitude', 'DOUBLE NULL');
  await checkCol('djp_recommendations', 'longitude', 'DOUBLE NULL');
  await checkCol('djp_recommendations', 'distance_from_prev_km', 'DOUBLE DEFAULT 0');
  await checkCol('djp_recommendations', 'route_name', 'VARCHAR(255) NULL');

  console.log('[Migration] Coordinate schema migration completed.');
}

if (process.argv[1]?.endsWith('migrate-customer-coordinates.js')) {
  runCoordinateMigrations().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
  });
}

