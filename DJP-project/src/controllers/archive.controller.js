import { dbAll, dbGet } from '../config/database.js';

export async function getArchiveSummary(req, res) {
  try {
    const period = req.query.periodMonth || null;
    
    // For counts
    const visitLogsQuery = period ? 'SELECT COUNT(*) as count FROM visit_execution_logs_archive WHERE visit_date LIKE ?' : 'SELECT COUNT(*) as count FROM visit_execution_logs_archive';
    const visitParams = period ? [`${period}-%`] : [];

    const plansQuery = period ? 'SELECT COUNT(*) as count FROM sales_plans_archive WHERE period_month = ?' : 'SELECT COUNT(*) as count FROM sales_plans_archive';
    const plansParams = period ? [period] : [];

    const historyQuery = period ? 'SELECT COUNT(*) as count FROM sales_history_archive WHERE period_year_month = ?' : 'SELECT COUNT(*) as count FROM sales_history_archive';
    
    const targetsQuery = period ? 'SELECT COUNT(*) as count FROM dealer_visit_targets_archive WHERE period_month = ?' : 'SELECT COUNT(*) as count FROM dealer_visit_targets_archive';

    const [vLogs, plans, history, targets] = await Promise.all([
      dbGet(visitLogsQuery, visitParams).catch(() => ({count: 0})), // Catch in case tables don't exist yet
      dbGet(plansQuery, plansParams).catch(() => ({count: 0})),
      dbGet(historyQuery, plansParams).catch(() => ({count: 0})),
      dbGet(targetsQuery, plansParams).catch(() => ({count: 0}))
    ]);

    res.json({
      success: true,
      summary: {
        visitLogs: vLogs?.count || 0,
        salesPlans: plans?.count || 0,
        salesHistory: history?.count || 0,
        dealerTargets: targets?.count || 0,
      }
    });
  } catch (err) {
    console.error('Error fetching archive summary:', err);
    res.status(500).json({ error: err.message });
  }
}
