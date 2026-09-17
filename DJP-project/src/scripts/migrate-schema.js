/**
 * Schema Migration Script — PJP/DJP Production-Readiness
 * Applies all incremental schema changes to the live database.
 */
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { normalizeString } from '../engines/normalization.engine.js';
dotenv.config();

const conn = await mysql.createConnection({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'star_one_djp',
  multipleStatements: true
});

async function tryAlter(sql, desc) {
  try {
    await conn.execute(sql);
    console.log(`✓ ${desc}`);
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || e.code === 'ER_DUP_KEYNAME' || e.code === 'ER_TABLE_EXISTS_ERROR') {
      console.log(`  (already exists) ${desc}`);
    } else {
      console.error(`✗ FAILED — ${desc}: ${e.message}`);
    }
  }
}

console.log('=== Applying schema migrations ===\n');

// 1. generation_runs table
await tryAlter(`CREATE TABLE IF NOT EXISTS generation_runs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  generation_code VARCHAR(100) NOT NULL UNIQUE,
  report_month VARCHAR(20) NOT NULL,
  cycle_code VARCHAR(20) NOT NULL,
  dealer_mapping_batch_code VARCHAR(100),
  sales_history_batch_codes TEXT,
  prospect_batch_code VARCHAR(100),
  sfa_feedback_batch_code VARCHAR(100),
  rules_snapshot TEXT,
  status VARCHAR(50) DEFAULT 'PENDING',
  pjp_dealer_count INT DEFAULT 0,
  pjp_visit_requirement INT DEFAULT 0,
  djp_scheduled_count INT DEFAULT 0,
  djp_unallocated_count INT DEFAULT 0,
  capacity_violated TINYINT(1) DEFAULT 0,
  validation_errors TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  INDEX idx_gen_month_cycle (report_month, cycle_code),
  INDEX idx_gen_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, 'generation_runs table');

// 2. upload_batches extra columns
await tryAlter(`ALTER TABLE upload_batches ADD COLUMN file_path VARCHAR(500)`, 'upload_batches.file_path');
await tryAlter(`ALTER TABLE upload_batches ADD COLUMN period_month VARCHAR(20)`, 'upload_batches.period_month');
await tryAlter(`ALTER TABLE upload_batches ADD COLUMN duplicate_rows INT DEFAULT 0`, 'upload_batches.duplicate_rows');
await tryAlter(`ALTER TABLE upload_batches ADD COLUMN warning_summary TEXT`, 'upload_batches.warning_summary');

// 3. sales_history unique index
await tryAlter(
  `ALTER TABLE sales_history ADD UNIQUE INDEX idx_sales_unique (sap_code, rssd_code, linked_dealer_code, period_year_month)`,
  'sales_history unique index'
);

// 4. generation_run_code on dealer_visit_targets
await tryAlter(`ALTER TABLE dealer_visit_targets ADD COLUMN generation_run_code VARCHAR(100)`, 'dealer_visit_targets.generation_run_code');
await tryAlter(`ALTER TABLE dealer_visit_targets ADD INDEX idx_dvt_gen_run (generation_run_code)`, 'dealer_visit_targets index');

// 5. generation_run_code on djp_recommendations
await tryAlter(`ALTER TABLE djp_recommendations ADD COLUMN generation_run_code VARCHAR(100)`, 'djp_recommendations.generation_run_code');
await tryAlter(`ALTER TABLE djp_recommendations ADD INDEX idx_djp_gen_run (generation_run_code)`, 'djp_recommendations index');

// 6. master_dealers canonical fields
await tryAlter(`ALTER TABLE master_dealers ADD COLUMN dealer_id VARCHAR(36) UNIQUE`, 'master_dealers.dealer_id');
await tryAlter(`ALTER TABLE master_dealers ADD COLUMN normalized_dealer_name VARCHAR(255)`, 'master_dealers.normalized_dealer_name');
await tryAlter(`ALTER TABLE master_dealers ADD COLUMN normalized_area VARCHAR(100)`, 'master_dealers.normalized_area');
await tryAlter(`ALTER TABLE master_dealers ADD COLUMN block VARCHAR(100)`, 'master_dealers.block');
await tryAlter(`ALTER TABLE master_dealers ADD COLUMN normalized_block VARCHAR(100)`, 'master_dealers.normalized_block');
await tryAlter(`ALTER TABLE master_dealers ADD COLUMN match_status VARCHAR(50)`, 'master_dealers.match_status');
await tryAlter(`ALTER TABLE master_dealers ADD COLUMN match_method VARCHAR(50)`, 'master_dealers.match_method');
await tryAlter(`ALTER TABLE master_dealers ADD COLUMN match_confidence DOUBLE`, 'master_dealers.match_confidence');
await tryAlter(`ALTER TABLE master_dealers MODIFY sap_code VARCHAR(100) NULL`, 'master_dealers.sap_code nullable');
await tryAlter(`ALTER TABLE master_dealers MODIFY dealer_type VARCHAR(50) NOT NULL DEFAULT 'STAR'`, 'master_dealers.dealer_type star default');

// 6b. Indexes for canonical matching
await tryAlter(`ALTER TABLE master_dealers ADD INDEX idx_dealer_norm_composite (normalized_dealer_name, normalized_area, normalized_block)`, 'master_dealers composite index');
await tryAlter(`ALTER TABLE master_dealers ADD INDEX idx_dealer_norm_sfa (sfa_code)`, 'master_dealers sfa index');


// 7. matching_audit table
await tryAlter(`CREATE TABLE IF NOT EXISTS matching_audit (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_code VARCHAR(100) NOT NULL,
  source_file VARCHAR(255),
  source_sheet VARCHAR(255),
  source_row INT,
  source_type VARCHAR(100),
  dealer_id VARCHAR(36),
  sap_code VARCHAR(100),
  sfa_code VARCHAR(100),
  dealer_name VARCHAR(255),
  match_method VARCHAR(50),
  match_confidence DOUBLE,
  match_status VARCHAR(50),
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_audit_batch (batch_code),
  INDEX idx_audit_dealer (dealer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, 'matching_audit table');

console.log('\n=== Backfilling normalized columns for existing master_dealers ===');
try {
  const [dealers] = await conn.execute('SELECT id, dealer_name, area, block FROM master_dealers WHERE normalized_dealer_name IS NULL');
  if (dealers.length > 0) {
    console.log(`Found ${dealers.length} dealers to backfill.`);
    for (const d of dealers) {
      const normName = normalizeString(d.dealer_name);
      const normArea = normalizeString(d.area);
      const normBlock = normalizeString(d.block);
      
      await conn.execute(
        'UPDATE master_dealers SET normalized_dealer_name = ?, normalized_area = ?, normalized_block = ?, match_status = ? WHERE id = ?',
        [normName, normArea, normBlock, 'MATCHED', d.id]
      );
    }
    console.log(`✓ Backfill complete.`);
  } else {
    console.log(`  (no dealers need backfill)`);
  }
} catch (e) {
  console.error(`✗ FAILED backfill: ${e.message}`);
}

await conn.end();
console.log('\n=== Schema migration complete ===');
