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
  getMasterView
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
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid authentication token. You are not authorized to perform this action.' });
  }
  const token = authHeader.split(' ')[1];
  if (!token.startsWith('mock-') && !token.startsWith('token-')) {
    return res.status(401).json({ error: 'Unauthorized: Invalid authentication token.' });
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
import { getArchiveSummary } from '../controllers/archive.controller.js';
router.get('/admin/archives/summary', getArchiveSummary);

// DJP Engine APIs — legacy single-shot endpoint (uses latest batches auto)
router.post('/djp/generate-all', generateAllLegacy);
router.get('/djp/dealer-targets', getDealerVisitTargets);
router.put('/djp/dealer-targets/:id', async (req, res) => {
  const { dbRun } = await import('../config/database.js');
  try {
    const { id } = req.params;
    const { so_visits, asm_visits, rsm_visits, zh_visits } = req.body;
    
    // Recalculate total_visits
    const total_visits = (so_visits || 0) + (asm_visits || 0) + (rsm_visits || 0) + (zh_visits || 0);

    await dbRun(
      `UPDATE dealer_visit_targets 
       SET so_visits = ?, asm_visits = ?, rsm_visits = ?, zh_visits = ?, total_visits = ?
       WHERE id = ?`,
      [so_visits, asm_visits, rsm_visits, zh_visits, total_visits, id]
    );

    res.json({ message: 'Visit targets updated successfully' });
  } catch (err) {
    console.error('Failed to update visit targets:', err);
    res.status(500).json({ error: 'Failed to update visit targets' });
  }
});
router.get('/djp/export-pjp-trade', exportPjpTradeExcel);
router.get('/djp/export-master', exportMasterExcel);
router.get('/djp/export-visits', exportVisitsExcel);
router.get('/djp/reconciliation', getReconciliationDiagnostics);
router.get('/djp/plan', getDjpPlan);
// The Master sheet on screen — same 42 columns as the M.xlsx download
router.get('/djp/master-view', getMasterView);

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
router.get   ('/app/officers/:empCode/dealers',                    getMyDealers);
router.get   ('/app/officers/:empCode/plans/:planId',              getMyPlanDetail);
router.post  ('/app/officers/:empCode/plans/:planId/visits',       addVisit);
router.put   ('/app/officers/:empCode/plans/:planId/visits/:detailId', moveVisit);
router.delete('/app/officers/:empCode/plans/:planId/visits/:detailId', removeVisit);
router.post  ('/app/officers/:empCode/plans/:planId/submit',       submitMyPlan);

router.get   ('/app/officers/:empCode/adherence',                  getMyAdherence);
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
import { syncSfaDataFromApi } from '../services/sfaSync.service.js';
router.post('/sfa/sync', async (req, res) => {
  const result = await syncSfaDataFromApi();
  res.json(result);
});

export default router;

