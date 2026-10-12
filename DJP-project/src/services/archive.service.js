import { dbRun, dbAll, dbGet } from '../config/database.js';

export const ARCHIVABLE_TABLES = [
  'sales_plans',
  'sales_plan_details',
  'plan_approvals',
  'master_dealers',
  'master_employees',
  'master_dealer_so_mapping',
  'visit_execution_logs',
  'dealer_visit_targets',
  'djp_recommendations',
  'sales_history',
  'dealer_performance_history',
  'upload_batches'
];

/**
 * Ensure an archive table exists and has archive_id primary key, archived_at timestamp,
 * and archive_month mapped column.
 */
export async function ensureArchiveTable(table) {
  const archTable = `${table}_archive`;
  await dbRun(`CREATE TABLE IF NOT EXISTS \`${archTable}\` LIKE \`${table}\``);
  const cols = await dbAll(`SHOW COLUMNS FROM \`${archTable}\` LIKE 'archive_id'`);
  if (!cols || cols.length === 0) {
    try { await dbRun(`ALTER TABLE \`${archTable}\` MODIFY id INT NOT NULL`); } catch (_) {}
    try { await dbRun(`ALTER TABLE \`${archTable}\` DROP PRIMARY KEY`); } catch (_) {}
    try { await dbRun(`ALTER TABLE \`${archTable}\` ADD COLUMN archive_id INT AUTO_INCREMENT PRIMARY KEY FIRST`); } catch (_) {}
    try { await dbRun(`ALTER TABLE \`${archTable}\` ADD COLUMN archived_at DATETIME DEFAULT CURRENT_TIMESTAMP`); } catch (_) {}
  }
  const monthCols = await dbAll(`SHOW COLUMNS FROM \`${archTable}\` LIKE 'archive_month'`);
  if (!monthCols || monthCols.length === 0) {
    try {
      await dbRun(`ALTER TABLE \`${archTable}\` ADD COLUMN archive_month VARCHAR(20) NULL, ADD INDEX idx_${archTable}_month (archive_month)`);
    } catch (_) {}
  }
}

/**
 * Archive all current active data into their respective archive tables, tagged with the target month.
 * Called before purging data so plans, master, and visits created are safely preserved.
 */
export async function archiveAllActiveData(targetMonth = null) {
  let month = targetMonth;
  if (!month) {
    try {
      const sp = await dbGet('SELECT period_month FROM sales_plans ORDER BY id DESC LIMIT 1');
      if (sp?.period_month) month = sp.period_month;
    } catch (_) {}
  }
  if (!month) {
    try {
      const vt = await dbGet('SELECT period_month FROM dealer_visit_targets ORDER BY id DESC LIMIT 1');
      if (vt?.period_month) month = vt.period_month;
    } catch (_) {}
  }
  if (!month) {
    try {
      const sh = await dbGet('SELECT MAX(period_year_month) as m FROM sales_history');
      if (sh?.m) month = sh.m;
    } catch (_) {}
  }
  if (!month) {
    month = new Date().toISOString().slice(0, 7);
  }

  const stats = {};
  for (const table of ARCHIVABLE_TABLES) {
    try {
      const countRes = await dbGet(`SELECT COUNT(*) as cnt FROM \`${table}\``);
      const rowCount = countRes?.cnt || 0;
      if (rowCount === 0) {
        stats[table] = 0;
        continue;
      }

      await ensureArchiveTable(table);
      const archTable = `${table}_archive`;

      const srcCols = await dbAll(`SHOW COLUMNS FROM \`${table}\``);
      const colNames = srcCols.map(c => `\`${c.Field}\``).join(', ');

      const insertRes = await dbRun(
        `INSERT INTO \`${archTable}\` (${colNames}, archive_month) SELECT ${colNames}, ? AS archive_month FROM \`${table}\``,
        [month]
      );
      stats[table] = insertRes.affectedRows || rowCount;
      console.log(`[Archive] Preserved ${stats[table]} rows from ${table} into ${archTable} for month ${month}`);
    } catch (err) {
      console.warn(`[Archive] Could not archive table ${table}:`, err.message);
      stats[table] = 0;
    }
  }

  return { month, ...stats };
}

/**
 * Get archive statistics and counts across preserved categories for a specific month or all time.
 */
export async function getArchiveStats(periodMonth = null) {
  // Ensure tables exist before querying
  for (const table of ARCHIVABLE_TABLES) {
    try {
      await ensureArchiveTable(table);
    } catch (_) {}
  }

  const getCount = async (table, dateCol = null) => {
    try {
      if (periodMonth && periodMonth !== 'ALL') {
        const isDatePattern = dateCol === 'visit_date';
        let sql;
        let params;
        if (dateCol) {
          sql = isDatePattern
            ? `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE archive_month = ? OR (archive_month IS NULL AND \`${dateCol}\` LIKE ?)`
            : `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE archive_month = ? OR (archive_month IS NULL AND \`${dateCol}\` = ?)`;
          params = isDatePattern ? [periodMonth, `${periodMonth}%`] : [periodMonth, periodMonth];
        } else {
          sql = `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE archive_month = ?`;
          params = [periodMonth];
        }
        const res = await dbGet(sql, params);
        return res?.cnt || 0;
      }
      const res = await dbGet(`SELECT COUNT(*) as cnt FROM \`${table}\``);
      return res?.cnt || 0;
    } catch (_) {
      return 0;
    }
  };

  const [
    salesPlans,
    salesPlanDetails,
    planApprovals,
    masterDealers,
    masterEmployees,
    masterDealerSoMapping,
    visitLogs,
    dealerTargets,
    djpRecommendations,
    salesHistory,
    dealerPerformanceHistory,
    uploadBatches
  ] = await Promise.all([
    getCount('sales_plans_archive', 'period_month'),
    getCount('sales_plan_details_archive', null),
    getCount('plan_approvals_archive', null),
    getCount('master_dealers_archive', null),
    getCount('master_employees_archive', null),
    getCount('master_dealer_so_mapping_archive', null),
    getCount('visit_execution_logs_archive', 'visit_date'),
    getCount('dealer_visit_targets_archive', 'period_month'),
    getCount('djp_recommendations_archive', null),
    getCount('sales_history_archive', 'period_year_month'),
    getCount('dealer_performance_history_archive', null),
    getCount('upload_batches_archive', null)
  ]);

  const masterRecords = masterDealers + masterEmployees + masterDealerSoMapping;
  const visitRecords = visitLogs + dealerTargets + djpRecommendations;
  const planRecords = salesPlans + salesPlanDetails + planApprovals;
  const historyRecords = salesHistory + dealerPerformanceHistory;
  const total = planRecords + masterRecords + visitRecords + historyRecords + uploadBatches;

  return {
    salesPlans,
    salesPlanDetails,
    planApprovals,
    masterDealers,
    masterEmployees,
    masterDealerSoMapping,
    visitLogs,
    dealerTargets,
    djpRecommendations,
    salesHistory,
    dealerPerformanceHistory,
    uploadBatches,
    // Aggregated groups for dashboard
    plansTotal: planRecords,
    masterTotal: masterRecords,
    visitsTotal: visitRecords,
    historyTotal: historyRecords,
    totalArchived: total,
    periodMonth: periodMonth || 'ALL'
  };
}

/**
 * Permanently delete / clear archives (filtered by periodMonth or complete wipe)
 */
export async function clearAllArchives(periodMonth = null) {
  let totalDeleted = 0;
  await dbRun('SET FOREIGN_KEY_CHECKS = 0');

  try {
    for (const table of ARCHIVABLE_TABLES) {
      const archTable = `${table}_archive`;
      try {
        await ensureArchiveTable(table);
        if (periodMonth && periodMonth !== 'ALL') {
          let dateCol = null;
          if (['sales_plans_archive', 'dealer_visit_targets_archive'].includes(archTable)) {
            dateCol = 'period_month';
          } else if (archTable === 'visit_execution_logs_archive') {
            dateCol = 'visit_date';
          } else if (archTable === 'sales_history_archive') {
            dateCol = 'period_year_month';
          }

          let sql;
          let params;
          if (dateCol) {
            const isDatePattern = dateCol === 'visit_date';
            sql = isDatePattern
              ? `DELETE FROM \`${archTable}\` WHERE archive_month = ? OR (archive_month IS NULL AND \`${dateCol}\` LIKE ?)`
              : `DELETE FROM \`${archTable}\` WHERE archive_month = ? OR (archive_month IS NULL AND \`${dateCol}\` = ?)`;
            params = isDatePattern ? [periodMonth, `${periodMonth}%`] : [periodMonth, periodMonth];
          } else {
            sql = `DELETE FROM \`${archTable}\` WHERE archive_month = ? OR archive_month IS NULL`;
            params = [periodMonth];
          }
          const r = await dbRun(sql, params);
          totalDeleted += r.affectedRows || 0;
        } else {
          const r = await dbRun(`DELETE FROM \`${archTable}\``);
          totalDeleted += r.affectedRows || 0;
        }
      } catch (err) {
        console.warn(`[clearAllArchives] Error clearing ${archTable}:`, err.message);
      }
    }
  } finally {
    try { await dbRun('SET FOREIGN_KEY_CHECKS = 1'); } catch (_) {}
  }

  return { success: true, deleted: totalDeleted };
}
