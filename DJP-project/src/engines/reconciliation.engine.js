import { dbAll, dbGet } from '../config/database.js';

/**
 * Generates a Reconciliation Report for a specific Generation Run.
 * 
 * @param {string} generationRunCode 
 */
export async function generateReconciliationReport(generationRunCode) {
  const run = await dbGet('SELECT * FROM generation_runs WHERE generation_code = ?', [generationRunCode]);
  if (!run) {
    throw new Error(`Generation run ${generationRunCode} not found.`);
  }

  const {
    report_month: periodMonth,
    cycle_code: cycleCode,
    dealer_mapping_batch_code: mappingBatch,
    pjp_dealer_count: targetCount,
    pjp_visit_requirement: requiredVisits,
    djp_scheduled_count: scheduledVisits,
    djp_unallocated_count: unallocatedVisits
  } = run;

  let salesBatches = [];
  try {
    salesBatches = JSON.parse(run.sales_history_batch_codes || '[]');
  } catch (e) {}

  // 1. Visit Allocation Summary
  const allocationSummary = {
    totalRequiredVisits: requiredVisits,
    totalScheduledVisits: scheduledVisits,
    totalUnallocatedVisits: unallocatedVisits
  };

  // Breakdown by Role
  const roleBreakdown = await dbAll(
    `SELECT role_type, COUNT(*) as scheduled_count 
     FROM djp_recommendations 
     WHERE generation_run_code = ? 
     GROUP BY role_type`,
    [generationRunCode]
  );

  // 2. Identity Matching Audit Summary
  const allBatches = [mappingBatch, ...salesBatches].filter(Boolean);
  const auditSummary = {};
  const unmatchedRecords = [];

  if (allBatches.length > 0) {
    const placeholders = allBatches.map(() => '?').join(',');
    
    // Summary counts
    const auditCounts = await dbAll(
      `SELECT source_type, match_status, COUNT(*) as count 
       FROM matching_audit 
       WHERE batch_code IN (${placeholders})
       GROUP BY source_type, match_status`,
      allBatches
    );

    for (const r of auditCounts) {
      if (!auditSummary[r.source_type]) auditSummary[r.source_type] = {};
      auditSummary[r.source_type][r.match_status] = r.count;
    }

    // Get unmatched records details
    const unmatched = await dbAll(
      `SELECT batch_code, source_file, source_row, source_type, sap_code, sfa_code, dealer_name, error_message
       FROM matching_audit
       WHERE batch_code IN (${placeholders}) AND match_status IN ('UNMATCHED', 'AMBIGUOUS', 'NEEDS_REVIEW')
       ORDER BY source_type, source_file, source_row
       LIMIT 100`, // Limit to 100 for report
      allBatches
    );
    unmatchedRecords.push(...unmatched);
  }

  return {
    generationRunCode,
    periodMonth,
    cycleCode,
    allocationSummary,
    roleBreakdown,
    auditSummary,
    unmatchedSample: unmatchedRecords
  };
}
