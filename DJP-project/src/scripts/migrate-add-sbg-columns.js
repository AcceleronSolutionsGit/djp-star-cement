/**
 * Migration: Add SBG/Dealer Mapping separation columns (MySQL)
 *
 * Safe idempotent migration — uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS (MySQL 8+)
 * and CREATE TABLE IF NOT EXISTS.
 *
 * Run: node src/scripts/migrate-add-sbg-columns.js
 */

import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const cfg = {
  host:     process.env.DB_HOST     || '127.0.0.1',
  port:     parseInt(process.env.DB_PORT || '3306', 10),
  user:     process.env.DB_USER     || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME     || 'star_one_djp',
  multipleStatements: true
};

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].cnt > 0;
}

async function tableExists(conn, table) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [table]
  );
  return rows[0].cnt > 0;
}

async function addCol(conn, table, column, definition, description = '') {
  const exists = await columnExists(conn, table, column);
  if (!exists) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`  [+] ${table}.${column}  ${description}`);
  } else {
    console.log(`  [=] ${table}.${column} already exists`);
  }
}

async function run() {
  const conn = await mysql.createConnection(cfg);
  console.log(`\n[MIGRATION] Connected to MySQL database: ${cfg.database}`);

  try {
    // ─────────────────────────────────────────────────
    // PHASE 1: master_dealers — source separation columns
    // ─────────────────────────────────────────────────
    console.log('\n[PHASE 1] master_dealers — source-separation columns');

    // Dealer Mapping authoritative columns
    await addCol(conn, 'master_dealers', 'dm_area',           "TEXT NULL",       "← Dealer Mapping Area (authoritative)");
    await addCol(conn, 'master_dealers', 'dm_sap_code',       "VARCHAR(64) NULL","← Dealer Mapping SAP CODE");
    await addCol(conn, 'master_dealers', 'dm_customer_code',  "VARCHAR(64) NULL","← Dealer Mapping Customer CODE");
    await addCol(conn, 'master_dealers', 'dm_sfa_code',       "VARCHAR(64) NULL","← Dealer Mapping SFA CODE");

    // SBG authoritative columns (NULL = dealer not found in SBG)
    await addCol(conn, 'master_dealers', 'sbg_potential',     "DECIMAL(15,3) NULL", "← SBG Potential (NULL if not found)");
    await addCol(conn, 'master_dealers', 'sbg_block',         "TEXT NULL",          "← SBG Block (NULL if not found)");
    await addCol(conn, 'master_dealers', 'sbg_status',        "VARCHAR(32) DEFAULT 'SBG_NOT_FOUND'", "← SBG match status");

    // Other source statuses
    await addCol(conn, 'master_dealers', 'prospect_status',   "VARCHAR(32) DEFAULT 'PROSPECT_NOT_FOUND'");
    await addCol(conn, 'master_dealers', 'rsar_status',       "VARCHAR(32) DEFAULT 'RSAR_NOT_FOUND'");
    await addCol(conn, 'master_dealers', 'dp_status',         "VARCHAR(32) DEFAULT 'DP_NOT_FOUND'");

    // Ensure other columns exist that engines reference
    await addCol(conn, 'master_dealers', 'branch',            "TEXT NULL");
    await addCol(conn, 'master_dealers', 'block',             "TEXT NULL");
    await addCol(conn, 'master_dealers', 'territory_code',    "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealers', 'territory_name',    "TEXT NULL");
    await addCol(conn, 'master_dealers', 'current_sales',     "DECIMAL(15,3) DEFAULT 0");
    await addCol(conn, 'master_dealers', 'so_name',           "TEXT NULL");
    await addCol(conn, 'master_dealers', 'so_emp_code',       "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealers', 'asm_name',          "TEXT NULL");
    await addCol(conn, 'master_dealers', 'asm_code',          "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealers', 'rsm_name',          "TEXT NULL");
    await addCol(conn, 'master_dealers', 'rsm_code',          "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealers', 'zh_name',           "TEXT NULL");
    await addCol(conn, 'master_dealers', 'zh_code',           "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealers', 'dealer_id',         "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealers', 'normalized_dealer_name', "TEXT NULL");
    await addCol(conn, 'master_dealers', 'normalized_area',   "TEXT NULL");
    await addCol(conn, 'master_dealers', 'normalized_block',  "TEXT NULL");
    await addCol(conn, 'master_dealers', 'match_status',      "VARCHAR(32) NULL");
    await addCol(conn, 'master_dealers', 'match_method',      "VARCHAR(32) NULL");
    await addCol(conn, 'master_dealers', 'match_confidence',  "DECIMAL(5,2) NULL");
    await addCol(conn, 'master_dealers', 'doa',               "DATE NULL");
    await addCol(conn, 'master_dealers', 'counter_potential', "DECIMAL(15,3) DEFAULT 0");
    await addCol(conn, 'master_dealers', 'expected_sale',     "DECIMAL(15,3) DEFAULT 0");
    await addCol(conn, 'master_dealers', 'counter_strategy',  "TEXT NULL");

    // Backfill dm_area from existing area (for data already in DB)
    await conn.query(`
      UPDATE master_dealers 
      SET dm_area = area 
      WHERE dm_area IS NULL AND area IS NOT NULL
    `);
    await conn.query(`
      UPDATE master_dealers 
      SET dm_sap_code = sap_code 
      WHERE dm_sap_code IS NULL AND sap_code IS NOT NULL
    `);
    await conn.query(`
      UPDATE master_dealers 
      SET dm_sfa_code = sfa_code 
      WHERE dm_sfa_code IS NULL AND sfa_code IS NOT NULL
    `);
    console.log('  [*] Backfilled dm_area from area, dm_sap_code from sap_code, dm_sfa_code from sfa_code');

    // ─────────────────────────────────────────────────
    // PHASE 2: master_dealer_so_mapping — ensure all columns exist
    // ─────────────────────────────────────────────────
    console.log('\n[PHASE 2] master_dealer_so_mapping — ensuring columns');
    await addCol(conn, 'master_dealer_so_mapping', 'asm_code',        "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealer_so_mapping', 'rsm_code',        "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealer_so_mapping', 'zh_code',         "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealer_so_mapping', 'branch',          "TEXT NULL");
    await addCol(conn, 'master_dealer_so_mapping', 'block',           "TEXT NULL");
    await addCol(conn, 'master_dealer_so_mapping', 'territory_code',  "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealer_so_mapping', 'territory_name',  "TEXT NULL");
    await addCol(conn, 'master_dealer_so_mapping', 'linked_dealer_code', "VARCHAR(64) NULL");
    await addCol(conn, 'master_dealer_so_mapping', 'rsm_name',        "TEXT NULL");
    await addCol(conn, 'master_dealer_so_mapping', 'zh_name',         "TEXT NULL");

    // ─────────────────────────────────────────────────
    // PHASE 3: dealer_performance_history — NEW TABLE
    // ─────────────────────────────────────────────────
    console.log('\n[PHASE 3] dealer_performance_history — creating if not exists');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS dealer_performance_history (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sap_code VARCHAR(64),
        dealer_name TEXT,
        period_year_month VARCHAR(7) NOT NULL,
        quantity_mt DECIMAL(15,3) DEFAULT 0,
        batch_code VARCHAR(64),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_dph_sap_period (sap_code, period_year_month)
      )
    `);
    console.log('  [+] dealer_performance_history created (or already existed)');

    // ─────────────────────────────────────────────────
    // PHASE 4: sales_history — add batch_code if missing
    // ─────────────────────────────────────────────────
    console.log('\n[PHASE 4] sales_history — ensuring batch_code column');
    await addCol(conn, 'sales_history', 'batch_code', "VARCHAR(64) NULL");

    // ─────────────────────────────────────────────────
    // PHASE 5: dealer_visit_targets — add output columns
    // ─────────────────────────────────────────────────
    console.log('\n[PHASE 5] dealer_visit_targets — adding output columns');
    await addCol(conn, 'dealer_visit_targets', 'dm_area',            "TEXT NULL",              "← Dealer Mapping Area");
    await addCol(conn, 'dealer_visit_targets', 'sbg_block',          "TEXT NULL",              "← SBG Block");
    await addCol(conn, 'dealer_visit_targets', 'sbg_potential',      "DECIMAL(15,3) NULL",     "← SBG Potential");
    await addCol(conn, 'dealer_visit_targets', 'rsar_six_month_avg', "DECIMAL(15,3) DEFAULT 0","← RSAR 6M Average");
    await addCol(conn, 'dealer_visit_targets', 'dp_six_month_avg',   "DECIMAL(15,3) DEFAULT 0","← DP 6M Average");
    await addCol(conn, 'dealer_visit_targets', 'lysm_sales',         "DECIMAL(15,3) DEFAULT 0","← LYSM from RSAR");
    await addCol(conn, 'dealer_visit_targets', 'sbg_status',         "VARCHAR(32) NULL");
    await addCol(conn, 'dealer_visit_targets', 'rsar_status',        "VARCHAR(32) NULL");
    await addCol(conn, 'dealer_visit_targets', 'dp_status',          "VARCHAR(32) NULL");
    await addCol(conn, 'dealer_visit_targets', 'prospect_status',    "VARCHAR(32) NULL");
    await addCol(conn, 'dealer_visit_targets', 'priority_label',     "VARCHAR(32) NULL");
    await addCol(conn, 'dealer_visit_targets', 'branch',             "TEXT NULL");
    await addCol(conn, 'dealer_visit_targets', 'region',             "TEXT NULL");
    await addCol(conn, 'dealer_visit_targets', 'asm_name',           "TEXT NULL");
    await addCol(conn, 'dealer_visit_targets', 'asm_code',           "VARCHAR(64) NULL");
    await addCol(conn, 'dealer_visit_targets', 'rsm_name',           "TEXT NULL");
    await addCol(conn, 'dealer_visit_targets', 'rsm_code',           "VARCHAR(64) NULL");
    await addCol(conn, 'dealer_visit_targets', 'zh_name',            "TEXT NULL");
    await addCol(conn, 'dealer_visit_targets', 'zh_code',            "VARCHAR(64) NULL");
    await addCol(conn, 'dealer_visit_targets', 'generation_run_code',"VARCHAR(64) NULL");
    await addCol(conn, 'dealer_visit_targets', 'previous_sales',     "DECIMAL(15,3) DEFAULT 0");
    await addCol(conn, 'dealer_visit_targets', 'current_sales',      "DECIMAL(15,3) DEFAULT 0");
    await addCol(conn, 'dealer_visit_targets', 'final_volume',       "DECIMAL(15,3) DEFAULT 0");
    await addCol(conn, 'dealer_visit_targets', 'score_a',            "DECIMAL(10,4) DEFAULT 0");
    await addCol(conn, 'dealer_visit_targets', 'score_b',            "DECIMAL(10,4) DEFAULT 31");
    await addCol(conn, 'dealer_visit_targets', 'score_c',            "DECIMAL(10,4) DEFAULT 0");
    await addCol(conn, 'dealer_visit_targets', 'total_score',        "DECIMAL(10,4) DEFAULT 0");
    await addCol(conn, 'dealer_visit_targets', 'priority',           "INT DEFAULT 0");
    await addCol(conn, 'dealer_visit_targets', 'territory_code',     "VARCHAR(64) NULL");
    await addCol(conn, 'dealer_visit_targets', 'territory_name',     "TEXT NULL");
    await addCol(conn, 'dealer_visit_targets', 'so_code',            "VARCHAR(64) NULL");
    await addCol(conn, 'dealer_visit_targets', 'linked_dealer_code', "VARCHAR(64) NULL");
    await addCol(conn, 'dealer_visit_targets', 'block',              "TEXT NULL");
    await addCol(conn, 'dealer_visit_targets', 'cust_type',          "VARCHAR(32) NULL");
    await addCol(conn, 'dealer_visit_targets', 'grade',              "VARCHAR(4) NULL");
    await addCol(conn, 'dealer_visit_targets', 'potential',          "DECIMAL(15,3) NULL");
    await addCol(conn, 'dealer_visit_targets', 'sfa_code',           "VARCHAR(64) NULL");

    // ─────────────────────────────────────────────────
    // PHASE 6: matching_audit — ensure exists
    // ─────────────────────────────────────────────────
    console.log('\n[PHASE 6] matching_audit — creating if not exists');
    await conn.query(`
      CREATE TABLE IF NOT EXISTS matching_audit (
        id INT AUTO_INCREMENT PRIMARY KEY,
        batch_code VARCHAR(64),
        source_file TEXT,
        source_sheet TEXT,
        source_row INT,
        source_type VARCHAR(32),
        dealer_id VARCHAR(64),
        sap_code VARCHAR(64),
        sfa_code VARCHAR(64),
        dealer_name TEXT,
        match_method VARCHAR(32),
        match_confidence DECIMAL(5,2),
        match_status VARCHAR(32),
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('  [+] matching_audit created (or already existed)');

    // ─────────────────────────────────────────────────
    // PHASE 7: Indexes
    // ─────────────────────────────────────────────────
    console.log('\n[PHASE 7] Creating indexes...');
    // Using CREATE INDEX IF NOT EXISTS (MySQL 8.0.31+) — use try/catch for older MySQL
    const indexDefs = [
      `CREATE INDEX idx_md_sbg_status ON master_dealers(sbg_status)`,
      `CREATE INDEX idx_md_dm_area ON master_dealers(dm_area(64))`,
      `CREATE INDEX idx_dvt_period_cycle ON dealer_visit_targets(period_month, cycle_code)`,
    ];
    for (const idxSql of indexDefs) {
      try { await conn.query(idxSql); console.log(`  [+] Index created`); }
      catch (e) { if (e.code === 'ER_DUP_KEYNAME') { console.log(`  [=] Index already exists`); } else throw e; }
    }

    console.log('\n[MIGRATION] ✅ All phases completed successfully!');
    console.log('\nNext steps:');
    console.log('  1. Re-import Dealer Mapping (now writes dm_area, dm_sap_code)');
    console.log('  2. Re-import SBG (now writes sbg_potential, sbg_block)');
    console.log('  3. Re-import Prospects');
    console.log('  4. Re-import RSAR Sales History');
    console.log('  5. Re-import Dealer Performance (now goes to dealer_performance_history)');
    console.log('  6. Regenerate DJP Plans\n');

  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('\n[MIGRATION] ❌ FAILED:', err.message);
  process.exit(1);
});
