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
 * Check if a table exists in MySQL or SQLite
 */
async function tableExists(tableName) {
  try {
    const res = await dbAll(`SHOW TABLES LIKE '${tableName}'`).catch(async () => {
      return await dbAll(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`, [tableName]).catch(() => []);
    });
    return Boolean(res && res.length > 0);
  } catch {
    return false;
  }
}

/**
 * Get existing column names for a table
 */
async function getTableColumns(tableName) {
  try {
    const rawCols = await dbAll(`SHOW COLUMNS FROM \`${tableName}\``).catch(async () => {
      const pragmaCols = await dbAll(`PRAGMA table_info(\`${tableName}\`)`).catch(() => []);
      return pragmaCols.map(c => ({ Field: c.name }));
    });
    return (rawCols || []).map(c => (c.Field || c.field || c.COLUMN_NAME || c.column_name || '').toLowerCase());
  } catch {
    return [];
  }
}

/**
 * Ensure an archive table exists and has archive_id primary key, archived_at timestamp,
 * and archive_month mapped column.
 */
export async function ensureArchiveTable(table) {
  const archTable = `${table}_archive`;
  try {
    await dbRun(`CREATE TABLE IF NOT EXISTS \`${archTable}\` LIKE \`${table}\``).catch(() => {});
  } catch (_) {}

  try {
    const cols = await getTableColumns(archTable);
    if (!cols.includes('archive_id')) {
      try { await dbRun(`ALTER TABLE \`${archTable}\` MODIFY id INT NOT NULL`); } catch (_) {}
      try { await dbRun(`ALTER TABLE \`${archTable}\` DROP PRIMARY KEY`); } catch (_) {}
      try { await dbRun(`ALTER TABLE \`${archTable}\` ADD COLUMN archive_id INT AUTO_INCREMENT PRIMARY KEY FIRST`); } catch (_) {}
      try { await dbRun(`ALTER TABLE \`${archTable}\` ADD COLUMN archived_at DATETIME DEFAULT CURRENT_TIMESTAMP`); } catch (_) {}
    }
    if (!cols.includes('archive_month')) {
      try { await dbRun(`ALTER TABLE \`${archTable}\` ADD COLUMN archive_month VARCHAR(20) NULL`); } catch (_) {}
      try { await dbRun(`ALTER TABLE \`${archTable}\` ADD INDEX idx_${archTable}_month (archive_month)`); } catch (_) {}
    }
  } catch (_) {}
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
      const exists = await tableExists(table);
      if (!exists) {
        stats[table] = 0;
        continue;
      }

      const countRes = await dbGet(`SELECT COUNT(*) as cnt FROM \`${table}\``);
      const rowCount = countRes?.cnt || 0;
      if (rowCount === 0) {
        stats[table] = 0;
        continue;
      }

      await ensureArchiveTable(table);
      const archTable = `${table}_archive`;

      const srcCols = await dbAll(`SHOW COLUMNS FROM \`${table}\``).catch(async () => {
        const pragma = await dbAll(`PRAGMA table_info(\`${table}\`)`).catch(() => []);
        return pragma.map(p => ({ Field: p.name }));
      });
      const colNames = srcCols.map(c => `\`${c.Field}\``).join(', ');

      const archCols = await getTableColumns(archTable);
      const hasMonth = archCols.includes('archive_month');

      let insertRes;
      if (hasMonth) {
        insertRes = await dbRun(
          `INSERT INTO \`${archTable}\` (${colNames}, archive_month) SELECT ${colNames}, ? AS archive_month FROM \`${table}\``,
          [month]
        );
      } else {
        insertRes = await dbRun(
          `INSERT INTO \`${archTable}\` (${colNames}) SELECT ${colNames} FROM \`${table}\``
        );
      }

      stats[table] = insertRes?.affectedRows || insertRes?.changes || rowCount;
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
  const getCount = async (table) => {
    try {
      const exists = await tableExists(table);
      if (!exists) return 0;

      const cols = await getTableColumns(table);

      if (periodMonth && periodMonth !== 'ALL') {
        const conditions = [];
        const params = [];

        if (cols.includes('archive_month')) {
          conditions.push('`archive_month` = ?');
          params.push(periodMonth);
        }
        if (cols.includes('period_month')) {
          conditions.push('`period_month` = ?');
          params.push(periodMonth);
        }
        if (cols.includes('period_year_month')) {
          conditions.push('`period_year_month` = ?');
          params.push(periodMonth);
        }
        if (cols.includes('visit_date')) {
          conditions.push('`visit_date` LIKE ?');
          params.push(`${periodMonth}%`);
        }

        if (conditions.length === 0) {
          return 0;
        }

        const sql = `SELECT COUNT(*) as cnt FROM \`${table}\` WHERE ${conditions.join(' OR ')}`;
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
    getCount('sales_plans_archive'),
    getCount('sales_plan_details_archive'),
    getCount('plan_approvals_archive'),
    getCount('master_dealers_archive'),
    getCount('master_employees_archive'),
    getCount('master_dealer_so_mapping_archive'),
    getCount('visit_execution_logs_archive'),
    getCount('dealer_visit_targets_archive'),
    getCount('djp_recommendations_archive'),
    getCount('sales_history_archive'),
    getCount('dealer_performance_history_archive'),
    getCount('upload_batches_archive')
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
  try { await dbRun('SET FOREIGN_KEY_CHECKS = 0'); } catch (_) {}
  try { await dbRun('PRAGMA foreign_keys = OFF'); } catch (_) {}

  try {
    for (const table of ARCHIVABLE_TABLES) {
      const archTable = `${table}_archive`;
      try {
        const exists = await tableExists(archTable);
        if (!exists) {
          continue;
        }

        const cols = await getTableColumns(archTable);

        if (periodMonth && periodMonth !== 'ALL') {
          const conditions = [];
          const params = [];

          if (cols.includes('archive_month')) {
            conditions.push('`archive_month` = ?');
            params.push(periodMonth);
          }
          if (cols.includes('period_month')) {
            conditions.push('`period_month` = ?');
            params.push(periodMonth);
          }
          if (cols.includes('period_year_month')) {
            conditions.push('`period_year_month` = ?');
            params.push(periodMonth);
          }
          if (cols.includes('visit_date')) {
            conditions.push('`visit_date` LIKE ?');
            params.push(`${periodMonth}%`);
          }

          if (conditions.length > 0) {
            const sql = `DELETE FROM \`${archTable}\` WHERE ${conditions.join(' OR ')}`;
            const r = await dbRun(sql, params);
            const count = r?.affectedRows || r?.changes || 0;
            totalDeleted += count;
            console.log(`[clearAllArchives] Deleted ${count} rows from ${archTable} for period ${periodMonth}`);
          }
        } else {
          let r;
          try {
            r = await dbRun(`TRUNCATE TABLE \`${archTable}\``);
          } catch (_) {
            r = await dbRun(`DELETE FROM \`${archTable}\``);
          }
          const count = r?.affectedRows || r?.changes || 0;
          totalDeleted += count;
          console.log(`[clearAllArchives] Cleared all rows from ${archTable}`);
        }
      } catch (err) {
        console.warn(`[clearAllArchives] Error clearing ${archTable}:`, err.message);
      }
    }
  } finally {
    try { await dbRun('SET FOREIGN_KEY_CHECKS = 1'); } catch (_) {}
    try { await dbRun('PRAGMA foreign_keys = ON'); } catch (_) {}
  }

  return { success: true, deleted: totalDeleted };
}
