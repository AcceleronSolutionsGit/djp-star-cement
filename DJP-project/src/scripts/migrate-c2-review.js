/**
 * Migration — C2 regeneration history
 *
 * Adds the two tables the C2 Review screen reads. Without them a regeneration still
 * runs, it just cannot be reviewed afterwards, because the purge removes the previous
 * plan and nothing records what it looked like.
 *
 *   c2_regenerations       one row per regeneration: the adherence figures that drove
 *                          it, the plan and visit counts on each side, and the dealers
 *                          that came out of C1 unvisited
 *   c2_regeneration_lines  the plan itself, captured BEFORE the purge and AFTER the
 *                          rebuild, so the diff is computed from stored fact rather
 *                          than from live tables that may have been edited since
 *
 * Guarded through information_schema rather than IF NOT EXISTS, which is MariaDB-only.
 *
 *   node src/scripts/migrate-c2-review.js
 */

import { dbGet, dbRun, dbExec, pool } from '../config/database.js';

async function tableExists(table) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
  );
  return (row?.c || 0) > 0;
}

async function indexExists(table, index) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [table, index]
  );
  return (row?.c || 0) > 0;
}

export async function migrateC2Review() {
  let created = 0;

  if (!(await tableExists('c2_regenerations'))) {
    await dbExec(`
      CREATE TABLE c2_regenerations (
        id                  INT PRIMARY KEY AUTO_INCREMENT,
        generation_code     VARCHAR(120) NOT NULL,
        period_month        VARCHAR(7)   NOT NULL,
        adherence_as_on     VARCHAR(10)  DEFAULT NULL,
        adherence_planned   INT DEFAULT 0,
        adherence_adhered   INT DEFAULT 0,
        adherence_missed    INT DEFAULT 0,
        adherence_pct       INT DEFAULT 0,
        plans_before        INT DEFAULT 0,
        visits_before       INT DEFAULT 0,
        plans_after         INT DEFAULT 0,
        visits_after        INT DEFAULT 0,
        missed_dealer_codes TEXT DEFAULT NULL,
        status              VARCHAR(20) DEFAULT 'RUNNING',
        started_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at        DATETIME DEFAULT NULL,
        INDEX idx_c2r_period (period_month, started_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        COMMENT='One row per adherence-driven C2 regeneration'
    `);
    console.log('[migrate] + table c2_regenerations');
    created++;
  }

  if (!(await tableExists('c2_regeneration_lines'))) {
    await dbExec(`
      CREATE TABLE c2_regeneration_lines (
        id              BIGINT PRIMARY KEY AUTO_INCREMENT,
        regeneration_id INT NOT NULL,
        phase           VARCHAR(6) NOT NULL,
        emp_code        VARCHAR(100),
        emp_name        VARCHAR(255),
        emp_role        VARCHAR(20),
        visit_date      DATE,
        dealer_sap_code VARCHAR(100),
        dealer_name     VARCHAR(255),
        sequence        INT DEFAULT 1,
        INDEX idx_c2rl_run (regeneration_id, phase),
        INDEX idx_c2rl_emp (regeneration_id, emp_code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        COMMENT='C2 plan lines captured either side of a regeneration'
    `);
    console.log('[migrate] + table c2_regeneration_lines');
    created++;
  }

  for (const [table, index, cols] of [
    ['c2_regenerations', 'idx_c2r_period', '(period_month, started_at)'],
    ['c2_regeneration_lines', 'idx_c2rl_run', '(regeneration_id, phase)']
  ]) {
    if (await tableExists(table) && !(await indexExists(table, index))) {
      await dbRun(`ALTER TABLE ${table} ADD INDEX ${index} ${cols}`).catch(() => {});
    }
  }

  return { created };
}

const isDirect = process.argv[1] && process.argv[1].endsWith('migrate-c2-review.js');
if (isDirect) {
  migrateC2Review()
    .then(r => {
      console.log(r.created > 0
        ? `\n[migrate] done — ${r.created} table(s) created.`
        : '\n[migrate] nothing to do, both tables already present.');
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch(err => { console.error('[migrate] FAILED:', err.message); process.exit(1); });
}
