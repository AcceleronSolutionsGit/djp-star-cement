/**
 * Migration — the objects the code writes to but nothing ever creates.
 *
 * Both are invisible on this project's existing database, where they were added by
 * hand at some point. On a fresh deploy from schema.sql they are simply absent, and
 * the first thing that touches them fails:
 *
 *   1. generation_runs
 *      Written by createGenerationRun, executeGenerationRun, generateAllLegacy and
 *      regenerateC2Plans; read by listGenerationRuns (which orders by started_at).
 *      It is in neither schema.sql nor any migration.
 *      Without it: the FIRST "Generate Plans" fails.
 *
 *   2. visit_execution_logs.batch_code
 *      sfa-report.importer.js inserts it; schema.sql does not declare it and no
 *      migration adds it.
 *      Without it: uploading the SFA report fails with
 *      "Unknown column 'batch_code' in 'field list'".
 *
 *   3. sales_plan_details.visit_status / source / added_by
 *      Written by appPlan.controller.addVisit and READ by buildDetail, which every
 *      plan-detail screen goes through. schema.sql never declared them.
 *      Without them: opening any plan in the field app or the simulator fails with
 *      "Unknown column 'd.source' in 'field list'".
 *
 * Guarded through information_schema rather than IF NOT EXISTS / ADD COLUMN IF NOT
 * EXISTS, both of which are MariaDB-only and fail on MySQL.
 *
 *   node src/scripts/migrate-missing-objects.js
 */

import { dbGet, dbRun, dbExec, pool } from '../config/database.js';

async function tableExists(table) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
  );
  return (row?.c || 0) > 0;
}

async function columnExists(table, column) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]
  );
  return (row?.c || 0) > 0;
}

export async function migrateMissingObjects() {
  const done = [];

  // ── 1. generation_runs ─────────────────────────────────────────────────────
  if (!(await tableExists('generation_runs'))) {
    await dbExec(`
      CREATE TABLE generation_runs (
        id                        INT PRIMARY KEY AUTO_INCREMENT,
        generation_code           VARCHAR(120) NOT NULL UNIQUE,
        report_month              VARCHAR(7)   NOT NULL,
        cycle_code                VARCHAR(10)  NOT NULL,
        dealer_mapping_batch_code VARCHAR(120) DEFAULT NULL,
        sales_history_batch_codes TEXT         DEFAULT NULL,
        prospect_batch_code       VARCHAR(120) DEFAULT NULL,
        sfa_feedback_batch_code   VARCHAR(120) DEFAULT NULL,
        rules_snapshot            LONGTEXT     DEFAULT NULL,
        status                    VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
        pjp_dealer_count          INT DEFAULT 0,
        djp_scheduled_count       INT DEFAULT 0,
        djp_unallocated_count     INT DEFAULT 0,
        error_message             TEXT DEFAULT NULL,
        started_at                DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at              DATETIME DEFAULT NULL,
        INDEX idx_gr_period (report_month, cycle_code),
        INDEX idx_gr_started (started_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    done.push('created table generation_runs');
  } else {
    // It exists, but an earlier hand-made version may lack the column the list
    // endpoint orders by.
    if (!(await columnExists('generation_runs', 'started_at'))) {
      await dbRun(`ALTER TABLE generation_runs ADD COLUMN started_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
      done.push('added generation_runs.started_at');
    }
    for (const [col, ddl] of [
      ['prospect_batch_code',     'VARCHAR(120) DEFAULT NULL'],
      ['sfa_feedback_batch_code', 'VARCHAR(120) DEFAULT NULL'],
      ['pjp_dealer_count',        'INT DEFAULT 0'],
      ['djp_scheduled_count',     'INT DEFAULT 0'],
      ['djp_unallocated_count',   'INT DEFAULT 0'],
      ['error_message',           'TEXT DEFAULT NULL'],
      ['completed_at',            'DATETIME DEFAULT NULL']
    ]) {
      if (!(await columnExists('generation_runs', col))) {
        await dbRun(`ALTER TABLE generation_runs ADD COLUMN ${col} ${ddl}`);
        done.push(`added generation_runs.${col}`);
      }
    }
  }

  // ── 2. visit_execution_logs.batch_code ─────────────────────────────────────
  if (await tableExists('visit_execution_logs')) {
    if (!(await columnExists('visit_execution_logs', 'batch_code'))) {
      await dbRun(`ALTER TABLE visit_execution_logs ADD COLUMN batch_code VARCHAR(120) DEFAULT NULL`);
      done.push('added visit_execution_logs.batch_code');
    }
  } else {
    console.warn('[migrate] visit_execution_logs does not exist — run the base schema first.');
  }

  // ── 3. sales_plan_details.visit_status / source / added_by ─────────────────
  // The generator writes plain rows; the field app marks what an officer added
  // himself. buildDetail selects all three, so a missing one breaks reading a plan,
  // not just writing one.
  if (await tableExists('sales_plan_details')) {
    for (const [col, ddl] of [
      ['visit_status', "VARCHAR(20) DEFAULT 'ACTIVE'"],
      ['source',       "VARCHAR(20) DEFAULT 'AUTO'"],
      ['added_by',     'VARCHAR(50) DEFAULT NULL']
    ]) {
      if (!(await columnExists('sales_plan_details', col))) {
        await dbRun(`ALTER TABLE sales_plan_details ADD COLUMN ${col} ${ddl}`);
        done.push(`added sales_plan_details.${col}`);
      }
    }
  } else {
    console.warn('[migrate] sales_plan_details does not exist — run the base schema first.');
  }

  return done;
}

// Run directly: node src/scripts/migrate-missing-objects.js
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateMissingObjects()
    .then(done => {
      if (done.length === 0) console.log('[migrate] Nothing to do — everything is already present.');
      else done.forEach(d => console.log(`[migrate] ${d}`));
      return pool?.end?.();
    })
    .catch(e => { console.error('[migrate] Failed:', e.message); process.exit(1); })
    .finally(() => process.exit(0));
}
