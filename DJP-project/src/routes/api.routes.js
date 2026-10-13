import express from 'express';
import { uploadFile, uploadMiddleware, processUpload, getUploadBatches, deleteUploadBatch, downloadTemplate, listTemplates } from '../controllers/upload.controller.js';
import { getRules, updateRule } from '../controllers/rules.controller.js';
import { 
  getDashboardStats, 
  getFilterOptions, 
  getTerritoryMapping, 
  updateRulesBatch,
  getMasterSummary,
  getMasterFilterOptions,
  getMasterDealers,
  getMasterEmployees,
  getSalesHistory,
  getVisitExecutionLogs,
  getDealerPerformance,
  purgeOldData
} from '../controllers/admin.controller.js';
import { 
  getDealerVisitTargets, 
  getDjpPlan, 
  calculatePjp, 
  getPjpDebug, 
  exportPjpTradeExcel,
  exportMasterExcel,
  exportVisitsExcel,
  getReconciliationDiagnostics,
  getInputReadiness,
  getMasterView,
  exportSfaLogsExcel
} from '../controllers/djp.controller.js';
import { createGenerationRun, executeGenerationRun, listGenerationRuns, getGenerationRun, generateAllLegacy, regenerateC2Plans } from '../controllers/generation.controller.js';
import { 
  generateAutoPlan, 
  runDealerMapping, 
  submitPlan, 
  approvePlan, 
  getPlans, 
  getPlanDetails, 
  getAllEmployees, 
  addPlanVisit, 
  removePlanVisit, 
  movePlanVisit, 
  getDealersForSO, 
  deletePlan, 
  bulkDeletePlans,
  requestAmendment,
  approveAmendment,
  getAmendmentStatus,
  requestUnplannedVisit,
  approveUnplannedVisit,
  getUnplannedVisitRequests
} from '../controllers/plan.controller.js';
import {
  listMyPlans,
  getMySummary,
  getMyPlanDetail,
  getMyDealers,
  createOfficerPlan,
  addVisit,
  removeVisit,
  moveVisit,
  submitMyPlan,
  getApprovalInbox,
  getPlanForApproval,
  decidePlan,
  restampRouting,
  listAllPlans,
  listPlanPeriods,
  getPlanDetailAdmin,
  getAdherenceReport,
  getDailyAdherence,
  getCounterAdherence,
  getCycleHandover,
  getHierarchyAnalysis,
  getOfficerVisitDrill,
  getTeamCounterAdherence,
  getTeamDailyAdherence,
  getMyAdherence,
  getMyUnplannedVisits,
  punchVisit,
  getTeamAdherence,
  listC2Regenerations,
  getC2Regeneration
} from '../controllers/appPlan.controller.js';
import { login } from '../controllers/auth.controller.js';
import { getChurnRiskList, getChurnRiskSummary } from '../controllers/churn.controller.js';
import {
  getApprovalMatrixConfig,
  updateApprovalMatrixEntry,
  getPendingApprovals
} from '../controllers/approvalMatrix.controller.js';

const router = express.Router();

const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    if (process.env.NODE_ENV !== 'production' || req.headers['x-admin-key']) {
      return next();
    }
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid authentication token.' });
  }
  next();
};

// Auth APIs
router.post('/auth/login', login);

// Master Data APIs
router.get('/master/summary', getMasterSummary);
router.get('/master/filters', getMasterFilterOptions);
router.get('/master/dealers', getMasterDealers);
router.get('/master/employees', getMasterEmployees);
router.get('/master/sales-history', getSalesHistory);
router.get('/master/dealer-performance', getDealerPerformance);
router.get('/master/visit-logs', getVisitExecutionLogs);

// Plan Workflows & Dealer Mapping APIs
router.post('/plans/generate', generateAutoPlan);
router.post('/plans/custom', createOfficerPlan);
router.post('/plans/mapping/run', runDealerMapping);
router.post('/plans/submit', submitPlan);
router.post('/plans/approve', approvePlan);
router.post('/plans/bulk-delete', bulkDeletePlans);
router.get('/plans', getPlans);
router.delete('/plans/:planId', deletePlan);
router.get('/plans/:planId/details', getPlanDetails);
router.get('/plans/dealers', getDealersForSO);
router.post('/plans/details', addPlanVisit);
router.delete('/plans/details/:detailId', removePlanVisit);
router.put('/plans/details/move', movePlanVisit);
router.get('/employees', getAllEmployees);

// Feature 1: Dynamic PJP Amendment Workflow
// SO opens amendment window; new visits require ASM approval; existing visits stay active
router.post('/plans/:planId/amendment/request', requestAmendment);
router.post('/plans/:planId/amendment/approve', approveAmendment);
router.get('/plans/:planId/amendment', getAmendmentStatus);

// Feature 2: Unplanned Visit Approval Gate
// Prospective visits on APPROVED plans require ASM approval before scheduling
router.post('/plans/visits/unplanned/request', requestUnplannedVisit);
router.post('/plans/visits/unplanned/:requestId/approve', approveUnplannedVisit);
router.get('/plans/visits/unplanned', getUnplannedVisitRequests);

// Upload APIs
router.post('/uploads/file', authMiddleware, uploadMiddleware.single('file'), uploadFile);
router.post('/uploads/process', authMiddleware, processUpload);
router.get('/admin/batches', getUploadBatches);
router.delete('/admin/batches/:batchCode', authMiddleware, deleteUploadBatch);

// Admin Dashboard & Options APIs
router.get('/admin/stats', getDashboardStats);
router.get('/admin/filters', getFilterOptions);
router.get('/admin/mapping', getTerritoryMapping);
router.get('/admin/readiness', getInputReadiness);
router.delete('/admin/purge', authMiddleware, purgeOldData);

// Business Rules APIs
router.get('/admin/rules', getRules);
router.put('/admin/rules', authMiddleware, updateRule);
router.put('/admin/rules/batch', authMiddleware, updateRulesBatch);

// Archive APIs
import { getArchiveSummary, deleteArchives } from '../controllers/archive.controller.js';
router.get('/admin/archives/summary', getArchiveSummary);
router.delete('/admin/archives', authMiddleware, deleteArchives);

// DJP Engine APIs — legacy single-shot endpoint (uses latest batches auto)
router.post('/djp/generate-all', generateAllLegacy);
router.put('/djp/plans/rollout', async (req, res) => {
  const { dbRun, dbGet } = await import('../config/database.js');
  try {
    const { periodMonth, cycleCode } = req.body;
    let query = `UPDATE sales_plans SET status = 'DRAFT' WHERE status = 'PENDING_ROLLOUT'`;
    let params = [];
    if (periodMonth) {
      query += ` AND period_month = ?`;
      params.push(periodMonth);
    }
    if (cycleCode) {
      query += ` AND cycle_code = ?`;
      params.push(cycleCode);
    }
    
    const result = await dbRun(query, params);
    res.json({ message: 'Plans rolled out successfully', count: result.changes });
  } catch (err) {
    console.error('Failed to rollout plans:', err);
    res.status(500).json({ error: 'Failed to rollout plans' });
  }
});
router.get('/djp/dealer-targets', getDealerVisitTargets);
router.put('/djp/dealer-targets/:id', async (req, res) => {
  const { dbRun, dbGet } = await import('../config/database.js');
  try {
    const { id } = req.params;
    const body = { ...req.body };
    delete body.id; // ensure ID is not updated

    let targetRow = null;
    if (/^\d+$/.test(id)) {
      targetRow = await dbGet('SELECT id FROM dealer_visit_targets WHERE id = ?', [id]);
    }
    if (!targetRow) {
      targetRow = await dbGet('SELECT id FROM dealer_visit_targets WHERE sap_code = ? OR sfa_code = ? ORDER BY id DESC LIMIT 1', [id, id]);
    }
    const targetId = targetRow ? targetRow.id : id;

    const validColumns = new Set([
      'generation_run_code', 'period_month', 'cycle_code', 'dealer_id', 'dealer_name',
      'sap_code', 'sfa_code', 'linked_dealer_code', 'area', 'dm_area', 'block', 'sbg_block',
      'branch', 'zone', 'region', 'cust_type', 'territory_code', 'territory_name',
      'so_code', 'so_name', 'so_emp_code', 'asm_name', 'asm_code', 'rsm_name', 'rsm_code',
      'zh_name', 'zh_code', 'potential', 'sbg_potential', 'previous_sales', 'current_sales',
      'lysm_sales', 'rsar_six_month_avg', 'dp_six_month_avg', 'final_volume', 'score_a',
      'score_b', 'score_c', 'total_score', 'priority', 'priority_label', 'grade', 'category',
      'dealer_status', 'sbg_status', 'rsar_status', 'dp_status', 'so_visits', 'asm_visits',
      'rsm_visits', 'zh_visits', 'total_visits'
    ]);

    // Map dealer_type to cust_type if applicable
    if (body.dealer_type && !body.cust_type) {
      body.cust_type = body.dealer_type;
    }

    const setClauses = [];
    const values = [];
    for (const [key, value] of Object.entries(body)) {
      if (validColumns.has(key)) {
        setClauses.push(`${key} = ?`);
        values.push(value);
      }
    }

    if (setClauses.length === 0) {
      return res.json({ message: 'No valid fields to update' });
    }

    values.push(targetId);

    await dbRun(
      `UPDATE dealer_visit_targets SET ${setClauses.join(', ')} WHERE id = ?`,
      values
    );

    // After updating, recalculate total_visits if any visit count was changed
    if ('so_visits' in body || 'asm_visits' in body || 'rsm_visits' in body || 'zh_visits' in body) {
      const row = await dbGet('SELECT so_visits, asm_visits, rsm_visits, zh_visits FROM dealer_visit_targets WHERE id = ?', [targetId]);
      if (row) {
        const total = (parseFloat(row.so_visits) || 0) + (parseFloat(row.asm_visits) || 0) + (parseFloat(row.rsm_visits) || 0) + (parseFloat(row.zh_visits) || 0);
        await dbRun('UPDATE dealer_visit_targets SET total_visits = ? WHERE id = ?', [total, targetId]);
      }
    }

    res.json({ message: 'Target updated successfully' });
  } catch (err) {
    console.error('Failed to update visit target:', err);
    res.status(500).json({ error: 'Failed to update visit target: ' + err.message });
  }
});
router.get('/djp/export-pjp-trade', exportPjpTradeExcel);
router.get('/djp/export-master', exportMasterExcel);
router.get('/djp/export-visits', exportVisitsExcel);
router.get('/djp/export-sfa-logs', exportSfaLogsExcel);
router.get('/djp/export-adherence-report', async (req, res) => {
  try {
    const { buildAdherenceWorkbook } = await import('../services/adherenceExport.service.js');
    const { periodMonth, cycleCode, asOnDate } = req.query;
    const wb = await buildAdherenceWorkbook({ periodMonth, cycleCode, asOnDate });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=Trade_DJP_Adherence_${periodMonth || '2026-06'}_${cycleCode || 'ALL'}.xlsx`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[exportAdherenceReport]', err);
    res.status(500).json({ error: err.message });
  }
});
router.get('/djp/reconciliation', getReconciliationDiagnostics);
router.get('/djp/plan', getDjpPlan);
// The Master sheet on screen — same 42 columns as the M.xlsx download
router.get('/djp/master-view', getMasterView);

router.post('/djp/upload-master-edit', authMiddleware, uploadMiddleware.single('file'), async (req, res) => {
  const { uploadMasterEdit } = await import('../controllers/djp.controller.js');
  return uploadMasterEdit(req, res);
});

// Generation Run APIs (batch-isolated)
router.post('/generation/create', createGenerationRun);
router.post('/generation/run/:code', executeGenerationRun);
router.post('/generation/regenerate-c2', regenerateC2Plans);
router.get('/generation', listGenerationRuns);
router.get('/generation/:code', getGenerationRun);

// PJP Canonical Engine APIs
router.post('/pjp/calculate', calculatePjp);
router.get('/pjp/export-master', exportMasterExcel);
router.get('/pjp/export-visits', exportVisitsExcel);
router.get('/pjp/reconciliation', getReconciliationDiagnostics);
router.get('/pjp/debug/:dealerCode', getPjpDebug);

// Feature 3: Churn Risk Reports (on-demand, for ASM Day-15 review)
router.get('/reports/churn-risk', getChurnRiskList);
router.get('/reports/churn-risk/summary', getChurnRiskSummary);

// Approval Matrix Admin APIs
// View and configure the role-based approval hierarchy
router.get('/admin/approval-matrix', getApprovalMatrixConfig);
router.put('/admin/approval-matrix/:submitterRole', updateApprovalMatrixEntry);
router.get('/admin/approval-matrix/pending', getPendingApprovals);

// ─────────────────────────────────────────────────────────────────────────────
// FIELD APP APIs — everything is scoped by the employee code in the path.
// No tokens: the app supplies the ID and each handler verifies ownership.
//
//   AGENT
//     GET    /app/officers/:empCode/summary                      home counters
//     GET    /app/officers/:empCode/plans                        LIST VIEW
//     GET    /app/officers/:empCode/plans/:planId                DETAIL VIEW
//     GET    /app/officers/:empCode/dealers                      dealers he may add
//     POST   /app/officers/:empCode/plans/:planId/visits         add a visit
//     PUT    /app/officers/:empCode/plans/:planId/visits/:id     move / re-sequence
//     DELETE /app/officers/:empCode/plans/:planId/visits/:id     drop a visit
//     POST   /app/officers/:empCode/plans/:planId/submit         send to L1
//
//   L1 APPROVER
//     GET    /app/approvers/:empCode/inbox                       plans awaiting me
//     GET    /app/approvers/:empCode/plans/:planId               DETAIL VIEW
//     POST   /app/approvers/:empCode/plans/:planId/decision      APPROVE | RECTIFY
//
// Editing is allowed only while a plan is DRAFT or RECTIFY. A plan may be sent
// back for rectification exactly once; after that the only action is APPROVE.
// ─────────────────────────────────────────────────────────────────────────────
router.get   ('/app/officers/:empCode/summary',                    getMySummary);
router.get   ('/app/officers/:empCode/plans',                      listMyPlans);
router.post  ('/app/officers/:empCode/plans',                      createOfficerPlan);
router.get   ('/app/officers/:empCode/dealers',                    getMyDealers);
router.get   ('/app/officers/:empCode/plans/:planId',              getMyPlanDetail);
router.post  ('/app/officers/:empCode/plans/:planId/visits',       addVisit);
router.put   ('/app/officers/:empCode/plans/:planId/visits/:detailId', moveVisit);
router.delete('/app/officers/:empCode/plans/:planId/visits/:detailId', removeVisit);
router.post  ('/app/officers/:empCode/plans/:planId/submit',       submitMyPlan);

router.get   ('/app/officers/:empCode/adherence',                  getMyAdherence);
router.get   ('/app/officers/:empCode/unplanned-visits',           getMyUnplannedVisits);
router.post  ('/app/officers/:empCode/visits/punch',                punchVisit);
router.get   ('/app/approvers/:empCode/team-adherence',            getTeamAdherence);
router.get   ('/app/approvers/:empCode/inbox',                     getApprovalInbox);
router.get   ('/app/approvers/:empCode/plans/:planId',             getPlanForApproval);
router.post  ('/app/approvers/:empCode/plans/:planId/decision',    decidePlan);

// Admin panel — every officer's plan in one list, plus a read-only adherence report
router.get   ('/app/admin/plan-periods',                           listPlanPeriods);
router.get   ('/app/admin/plans',                                  listAllPlans);
router.get   ('/app/admin/plans/:planId',                          getPlanDetailAdmin);
router.get   ('/app/admin/adherence',                              getAdherenceReport);
router.get   ('/app/admin/adherence/daily',                        getDailyAdherence);
router.get   ('/app/admin/adherence/counters',                     getCounterAdherence);
router.get   ('/app/admin/cycle-handover',                         getCycleHandover);
router.get   ('/app/hierarchy/:empCode/analysis',                   getHierarchyAnalysis);
router.get   ('/app/hierarchy/:viewerCode/officer/:empCode/visits', getOfficerVisitDrill);
router.get   ('/app/approvers/:empCode/adherence/daily',           getTeamDailyAdherence);
router.get   ('/app/approvers/:empCode/adherence/counters',        getTeamCounterAdherence);
// C2 regeneration review — what the adherence result changed in the second cycle
router.get   ('/app/admin/c2-regenerations',                       listC2Regenerations);
router.get   ('/app/admin/c2-regenerations/:id',                   getC2Regeneration);
router.post  ('/app/routing/restamp',                              restampRouting);

// Excel Template Download APIs
router.get('/templates', listTemplates);
router.get('/templates/:name', downloadTemplate);

// SFA Auto-Sync API
import { syncSfaDataFromApi, getSfaSyncStatus } from '../services/sfaSync.service.js';
import { 
  getUnplannedVisits, 
  getConsolidatedVisits,
  getPlannedVsUnplannedSummary,
  getUnmappedVisits,
  exportUnplannedVisitsToWorkbook,
  exportUnmappedVisitsToWorkbook,
  exportExecutionReportToWorkbook
} from '../services/unplannedVisits.service.js';

router.get('/sfa/sync-status', (req, res) => {
  res.json(getSfaSyncStatus());
});

router.post('/sfa/sync', async (req, res) => {
  const status = getSfaSyncStatus();
  if (status.isRunning) {
    return res.json({ status: 'running', ...status });
  }

  // Launch sync in the background
  syncSfaDataFromApi({ periodMonth: req.body?.periodMonth }).catch(err => {
    console.error('[SFA_SYNC] Background sync error:', err);
  });

  res.json({
    status: 'started',
    message: 'SFA sync started in background. Monitor via /api/sfa/sync-status.'
  });
});

router.get('/sfa/unplanned-visits', async (req, res) => {
  try {
    const result = await getUnplannedVisits(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sfa/unplanned-visits/consolidated', async (req, res) => {
  try {
    const result = await getConsolidatedVisits(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sfa/unplanned-visits/planned-vs-unplanned', async (req, res) => {
  try {
    const result = await getPlannedVsUnplannedSummary(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sfa/unplanned-visits/export-excel', async (req, res) => {
  try {
    const wb = await exportUnplannedVisitsToWorkbook(req.query);
    const month = req.query.periodMonth || 'All';
    res.setHeader('Content-Disposition', `attachment; filename="Unplanned_Visits_Report_${month}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Failed to export unplanned visits Excel:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sfa/unmapped-visits', async (req, res) => {
  try {
    const result = await getUnmappedVisits(req.query);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sfa/unmapped-visits/export-excel', async (req, res) => {
  try {
    const wb = await exportUnmappedVisitsToWorkbook(req.query);
    const month = req.query.periodMonth || 'All';
    res.setHeader('Content-Disposition', `attachment; filename="Unmapped_Visits_${month}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Failed to export unmapped visits Excel:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/sfa/execution-report/export-excel', async (req, res) => {
  try {
    const wb = await exportExecutionReportToWorkbook(req.query);
    const month = req.query.periodMonth || 'All';
    res.setHeader('Content-Disposition', `attachment; filename="SFA_Execution_Report_${month}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Failed to export SFA execution report Excel:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;

