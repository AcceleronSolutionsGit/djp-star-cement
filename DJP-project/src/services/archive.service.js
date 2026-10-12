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
 * Ensure an archive table exists and has archive_id primary key and archived_at timestamp.
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
}

/**
 * Archive all current active data into their respective archive tables.
 * Called before purging data so plans, master, and visits created are safely preserved.
 */
export async function archiveAllActiveData() {
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
        `INSERT INTO \`${archTable}\` (${colNames}) SELECT ${colNames} FROM \`${table}\``
      );
      stats[table] = insertRes.affectedRows || rowCount;
      console.log(`[Archive] Preserved ${stats[table]} rows from ${table} into ${archTable}`);
    } catch (err) {
      console.warn(`[Archive] Could not archive table ${table}:`, err.message);
      stats[table] = 0;
    }
  }

  return stats;
}

/**
 * Get archive statistics and counts across preserved categories.
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
      if (periodMonth && dateCol) {
        const isDatePattern = dateCol === 'visit_date';
        const sql = isDatePattern
          ? `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE \`${dateCol}\` LIKE ?`
          : `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE \`${dateCol}\` = ?`;
        const param = isDatePattern ? `${periodMonth}%` : periodMonth;
        const res = await dbGet(sql, [param]);
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
    totalArchived: total
  };
}

/**
 * Permanently delete / clear archives
 */
export async function clearAllArchives(periodMonth = null) {
  let totalDeleted = 0;
  for (const table of ARCHIVABLE_TABLES) {
    const archTable = `${table}_archive`;
    try {
      if (periodMonth) {
        let whereCol = null;
        if (['sales_plans_archive', 'dealer_visit_targets_archive'].includes(archTable)) {
          whereCol = 'period_month';
        } else if (archTable === 'visit_execution_logs_archive') {
          whereCol = 'visit_date';
        } else if (archTable === 'sales_history_archive') {
          whereCol = 'period_year_month';
        }

        if (whereCol) {
          const sql = whereCol === 'visit_date'
            ? `DELETE FROM \`${archTable}\` WHERE \`${whereCol}\` LIKE ?`
            : `DELETE FROM \`${archTable}\` WHERE \`${whereCol}\` = ?`;
          const param = whereCol === 'visit_date' ? `${periodMonth}%` : periodMonth;
          const r = await dbRun(sql, [param]);
          totalDeleted += r.affectedRows || 0;
        }
      } else {
        try {
          await dbRun(`TRUNCATE TABLE \`${archTable}\``);
        } catch (_) {
          const r = await dbRun(`DELETE FROM \`${archTable}\``);
          totalDeleted += r.affectedRows || 0;
        }
      }
    } catch (err) {
      // Table may not exist yet
    }
  }

  return { success: true, deleted: totalDeleted };
}
