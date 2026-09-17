/**
 * Migration — App Plan Workflow (agent edit → submit → L1 approve / rectify once)
 *
 * Adds everything the mobile app needs on top of the existing sales_plans table:
 *
 *   emp_role                 role of the plan owner (SO / ASM / RSM / ZH)
 *   l1_approver_emp_code     the ONE person who can approve this plan
 *   l1_approver_name         display name for the app
 *   l1_approver_role         role of that person (ASM / RSM / ZH / ADMIN)
 *   rectification_count      how many times L1 has sent it back (hard cap: 1)
 *   rectify_requested_by     emp code of the L1 who sent it back
 *   rectify_requested_at     when
 *   rectify_remarks          what the agent has to fix
 *   resubmitted_at           when the agent sent it back up
 *   last_edited_by/at        audit of agent edits
 *
 * Status vocabulary after this migration:
 *   DRAFT      generated, agent may edit and submit
 *   SUBMITTED  waiting on L1, agent locked out
 *   RECTIFY    sent back once, agent may edit and re-submit
 *   APPROVED   final
 *   REJECTED   retained for backwards compatibility, not produced by the app flow
 *
 * Written as JS rather than .sql because `ADD COLUMN IF NOT EXISTS` is MariaDB-only
 * and silently fails on MySQL 8. This checks information_schema and is safe to
 * re-run on either engine.
 *
 *   node src/scripts/migrate-app-plan-workflow.js
 */

import { dbAll, dbRun, dbGet, pool } from '../config/database.js';

const COLUMNS = [
  ['sales_plans', 'emp_role',              "VARCHAR(20) DEFAULT 'SO'"],
  ['sales_plans', 'required_approver_role', 'VARCHAR(20) DEFAULT NULL'],
  ['sales_plans', 'approver_emp_code',      'VARCHAR(100) DEFAULT NULL'],
  ['sales_plans', 'l1_approver_emp_code',   'VARCHAR(100) DEFAULT NULL'],
  ['sales_plans', 'l1_approver_name',       'VARCHAR(255) DEFAULT NULL'],
  ['sales_plans', 'l1_approver_role',       'VARCHAR(20) DEFAULT NULL'],
  ['sales_plans', 'rectification_count',    'INT DEFAULT 0'],
  ['sales_plans', 'rectify_requested_by',   'VARCHAR(100) DEFAULT NULL'],
  ['sales_plans', 'rectify_requested_at',   'DATETIME DEFAULT NULL'],
  ['sales_plans', 'rectify_remarks',        'TEXT DEFAULT NULL'],
  ['sales_plans', 'resubmitted_at',         'DATETIME DEFAULT NULL'],
  ['sales_plans', 'last_edited_by',         'VARCHAR(100) DEFAULT NULL'],
  ['sales_plans', 'last_edited_at',         'DATETIME DEFAULT NULL'],
  ['sales_plan_details', 'visit_status',    "VARCHAR(20) DEFAULT 'ACTIVE'"],
  ['sales_plan_details', 'added_by',        'VARCHAR(100) DEFAULT NULL'],
  ['sales_plan_details', 'source',          "VARCHAR(20) DEFAULT 'AUTO'"]
];

const INDEXES = [
  ['sales_plans', 'idx_sp_owner_period', '(emp_code, period_month, cycle_code)'],
  ['sales_plans', 'idx_sp_l1_inbox',     '(l1_approver_emp_code, status)'],
  ['sales_plans', 'idx_sp_status',       '(status)'],
  ['sales_plan_details', 'idx_spd_plan_date', '(plan_id, visit_date)']
];

async function columnExists(table, column) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return (row?.c || 0) > 0;
}

async function indexExists(table, index) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return (row?.c || 0) > 0;
}

async function tableExists(table) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return (row?.c || 0) > 0;
}

export async function migrateAppPlanWorkflow() {
  let added = 0, skipped = 0;

  for (const [table, column, definition] of COLUMNS) {
    if (!(await tableExists(table))) {
      console.warn(`[migrate] table ${table} does not exist — skipping ${column}`);
      continue;
    }
    if (await columnExists(table, column)) { skipped++; continue; }
    await dbRun(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    console.log(`[migrate] + ${table}.${column}`);
    added++;
  }

  for (const [table, index, cols] of INDEXES) {
    if (!(await tableExists(table))) continue;
    if (await indexExists(table, index)) { skipped++; continue; }
    try {
      await dbRun(`ALTER TABLE ${table} ADD INDEX ${index} ${cols}`);
      console.log(`[migrate] + index ${table}.${index}`);
      added++;
    } catch (e) {
      console.warn(`[migrate] index ${index} failed: ${e.message}`);
    }
  }

  // plan_approvals must accept the RECTIFY and RESUBMIT action types
  if (await tableExists('plan_approvals')) {
    if (!(await columnExists('plan_approvals', 'approver_role'))) {
      await dbRun(`ALTER TABLE plan_approvals ADD COLUMN approver_role VARCHAR(20) DEFAULT NULL`);
      console.log('[migrate] + plan_approvals.approver_role');
      added++;
    }
    const col = await dbGet(
      `SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'plan_approvals' AND COLUMN_NAME = 'action_type'`
    );
    if (col?.t && /^enum/i.test(col.t) && !/RECTIFY/i.test(col.t)) {
      await dbRun(
        `ALTER TABLE plan_approvals MODIFY action_type
         ENUM('SUBMITTED','APPROVED','REJECTED','RECTIFY','RESUBMITTED','AMENDMENT_APPROVED','AMENDMENT_REJECTED') NOT NULL`
      );
      console.log('[migrate] ~ plan_approvals.action_type widened for RECTIFY / RESUBMITTED');
      added++;
    }
  }

  // Existing rows: anything already APPROVED/REJECTED keeps its state; DRAFT rows
  // with no role get the default so the app can route them.
  await dbRun(`UPDATE sales_plans SET emp_role = 'SO' WHERE emp_role IS NULL OR TRIM(emp_role) = ''`);
  await dbRun(`UPDATE sales_plans SET rectification_count = 0 WHERE rectification_count IS NULL`);

  return { added, skipped };
}

const isDirect = process.argv[1] && process.argv[1].endsWith('migrate-app-plan-workflow.js');
if (isDirect) {
  migrateAppPlanWorkflow()
    .then(r => {
      console.log(`\n[migrate] done — ${r.added} change(s) applied, ${r.skipped} already present.`);
      return pool.end();
    })
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[migrate] FAILED:', err.message);
      process.exit(1);
    });
}
