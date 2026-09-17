/**
 * Migration Phase 2: Add remaining PJP calculation columns to dealer_visit_targets
 * and master_dealers for §21 Master export support.
 *
 * Run: node src/scripts/migrate-phase2-calc-columns.js
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
};

async function columnExists(conn, table, column) {
  const [rows] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].cnt > 0;
}

async function addCol(conn, table, column, definition, note = '') {
  const exists = await columnExists(conn, table, column);
  if (!exists) {
    await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    console.log(`  [+] ${table}.${column}  ${note}`);
  } else {
    console.log(`  [=] ${table}.${column} already exists`);
  }
}

async function run() {
  const conn = await mysql.createConnection(cfg);
  console.log(`\n[MIGRATION P2] Connected to: ${cfg.database}`);

  try {
    console.log('\n[PHASE A] dealer_visit_targets — calculation result columns');

    // Counter Share (§29: dealer_current_sales / SO_total_current_sales)
    await addCol(conn, 'dealer_visit_targets', 'counter_share',
      'DECIMAL(10,6) DEFAULT 0',
      '← dealer currentSales / SO total currentSales');

    // Need to Grow flag (boolean, §16)
    await addCol(conn, 'dealer_visit_targets', 'need_to_grow',
      "TINYINT(1) DEFAULT 0",
      "← 1 if areaPotentialPercentile>60% AND counterShare<20%");

    // Area Potential (§15: SUM of sbg_potential by Area)
    await addCol(conn, 'dealer_visit_targets', 'area_potential',
      'DECIMAL(15,3) DEFAULT 0',
      '← SUM(sbg_potential) for this dealer Area');
    await addCol(conn, 'dealer_visit_targets', 'area_potential_rank',
      'INT DEFAULT 1',
      '← rank within Area by sbg_potential (descending)');
    await addCol(conn, 'dealer_visit_targets', 'area_potential_percentile',
      'DECIMAL(8,6) DEFAULT 0',
      '← cumulative suffix percentile (see §29)');

    // Area Volume + Grade (§17)
    await addCol(conn, 'dealer_visit_targets', 'area_volume',
      'DECIMAL(15,3) DEFAULT 0',
      '← SUM(finalVolume) for this dealer Area');
    await addCol(conn, 'dealer_visit_targets', 'area_volume_rank',
      'INT DEFAULT 1',
      '← rank of dealer finalVolume within Area (descending)');
    await addCol(conn, 'dealer_visit_targets', 'area_volume_percentile',
      'DECIMAL(8,6) DEFAULT 0',
      '← cumulative suffix percentile (see §29)');

    // SO-level potential rank for Score A (§18)
    await addCol(conn, 'dealer_visit_targets', 'potential_rank',
      'INT DEFAULT 1',
      '← rank of sbg_potential within SO group');

    // Score A/B/C / Total (§18) — score_a/b/c/total_score already exist from phase 1
    // Just ensure they exist (safe no-op if already there)
    await addCol(conn, 'dealer_visit_targets', 'score_a',
      'DECIMAL(10,4) DEFAULT 0');
    await addCol(conn, 'dealer_visit_targets', 'score_b',
      'DECIMAL(10,4) DEFAULT 31');
    await addCol(conn, 'dealer_visit_targets', 'score_c',
      'DECIMAL(10,4) DEFAULT 0');
    await addCol(conn, 'dealer_visit_targets', 'total_score',
      'DECIMAL(10,4) DEFAULT 0');

    // RSAR 6M avg (already done in phase 1)
    await addCol(conn, 'dealer_visit_targets', 'rsar_six_month_avg',
      'DECIMAL(15,3) DEFAULT 0');
    await addCol(conn, 'dealer_visit_targets', 'dp_six_month_avg',
      'DECIMAL(15,3) DEFAULT 0');
    await addCol(conn, 'dealer_visit_targets', 'lysm_sales',
      'DECIMAL(15,3) DEFAULT 0');

    // DOA
    await addCol(conn, 'dealer_visit_targets', 'doa', 'DATE NULL');

    console.log('\n[PHASE B] master_dealers — prospect_status update check');
    await addCol(conn, 'master_dealers', 'prospect_status',
      "VARCHAR(32) DEFAULT 'PROSPECT_NOT_FOUND'");

    console.log('\n[PHASE C] Indexes for query performance');
    const indexDefs = [
      `CREATE INDEX idx_dvt_period_sap ON dealer_visit_targets(period_month, sap_code)`,
      `CREATE INDEX idx_dvt_dealer_id ON dealer_visit_targets(dealer_id)`,
    ];
    for (const sql of indexDefs) {
      try { await conn.query(sql); console.log(`  [+] Index created`); }
      catch (e) { if (e.code === 'ER_DUP_KEYNAME') console.log(`  [=] Index already exists`); else throw e; }
    }

    console.log('\n[MIGRATION P2] ✅ Complete!\n');
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('\n[MIGRATION P2] ❌ FAILED:', err.message);
  process.exit(1);
});
