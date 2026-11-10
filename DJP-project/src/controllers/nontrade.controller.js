import fs from 'fs';
import path from 'path';
import multer from 'multer';
import {
  calculateNonTradeAdherence,
  getNonTradePlans,
  getNonTradeHoPlans,
  getNonTradeCustomerVisits,
  getNonTradeLeads,
  getNonTradeSiteVisits,
  getNonTradeProfessionalVisits,
  checkNonTradeEmployeesInMaster,
  ingestNonTradeWorkbook,
  generateNonTradeExcelExport,
  rolloutNonTradePlans,
  getNonTradeRolloutStatus,
  getNonTradeCalendarData,
  getNonTradeApprovalMatrix,
  rollForwardNonTradePlans,
  syncNonTradeVisitsFromSfa
} from '../services/nontrade.service.js';

// Setup multer upload for Non-Trade Excel files
const uploadDir = path.resolve('upload-files/nontrade');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${cleanName}`);
  }
});

export const nontradeUploadMiddleware = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
}).single('file');

/**
 * GET /api/nontrade/adherence
 * Calculates and returns full adherence and bucket statistics
 */
export async function getNonTradeAdherenceHandler(req, res) {
  try {
    const periodMonth = req.query.periodMonth || '2026-09';
    const asOnDate = req.query.asOnDate || null;
    const result = await calculateNonTradeAdherence(periodMonth, asOnDate);
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] getAdherence error:', err);
    res.status(500).json({ error: err.message || 'Failed to calculate Non-Trade adherence' });
  }
}

/**
 * GET /api/nontrade/plans
 * Paginated counter plans for Officer, ASM, HOS
 */
export async function getNonTradePlansHandler(req, res) {
  try {
    const { periodMonth = '2026-09', roleType, empCode, bucket, search, page = 1, limit = 50 } = req.query;
    const result = await getNonTradePlans({ periodMonth, roleType, empCode, bucket, search, page, limit });
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] getPlans error:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve Non-Trade plans' });
  }
}

/**
 * GET /api/nontrade/ho-plans
 */
export async function getNonTradeHoPlansHandler(req, res) {
  try {
    const { periodMonth = '2026-09', roleType, empCode, search, page = 1, limit = 50 } = req.query;
    const result = await getNonTradeHoPlans({ periodMonth, roleType, empCode, search, page, limit });
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] getHoPlans error:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve HO plans' });
  }
}

/**
 * GET /api/nontrade/customer-visits
 */
export async function getNonTradeCustomerVisitsHandler(req, res) {
  try {
    const { periodMonth = '2026-09', empCode, bucket, search, page = 1, limit = 50 } = req.query;
    const result = await getNonTradeCustomerVisits({ periodMonth, empCode, bucket, search, page, limit });
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] getCustomerVisits error:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve customer visit reports' });
  }
}

/**
 * GET /api/nontrade/leads
 */
export async function getNonTradeLeadsHandler(req, res) {
  try {
    const { periodMonth = '2026-09', empCode, search, page = 1, limit = 50 } = req.query;
    const result = await getNonTradeLeads({ periodMonth, empCode, search, page, limit });
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] getLeads error:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve Non-Trade leads' });
  }
}

/**
 * GET /api/nontrade/site-visits
 */
export async function getNonTradeSiteVisitsHandler(req, res) {
  try {
    const { periodMonth = '2026-09', empCode, search, page = 1, limit = 50 } = req.query;
    const result = await getNonTradeSiteVisits({ periodMonth, empCode, search, page, limit });
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] getSiteVisits error:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve site visits' });
  }
}

/**
 * GET /api/nontrade/professional-visits
 */
export async function getNonTradeProfessionalVisitsHandler(req, res) {
  try {
    const { periodMonth = '2026-09', empCode, search, page = 1, limit = 50 } = req.query;
    const result = await getNonTradeProfessionalVisits({ periodMonth, empCode, search, page, limit });
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] getProfessionalVisits error:', err);
    res.status(500).json({ error: err.message || 'Failed to retrieve professional visits' });
  }
}

/**
 * GET /api/nontrade/employee-master-check
 */
export async function getNonTradeEmployeeMasterCheckHandler(req, res) {
  try {
    const periodMonth = req.query.periodMonth || '2026-09';
    const result = await checkNonTradeEmployeesInMaster(periodMonth);
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] getEmployeeMasterCheck error:', err);
    res.status(500).json({ error: err.message || 'Failed to check employee master status' });
  }
}

/**
 * POST /api/nontrade/upload
 * Handles Excel upload of Non-Trade plans or execution logs
 */
export async function uploadNonTradeExcelHandler(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No Excel file provided for upload' });
    }

    const periodMonth = req.body.periodMonth || '2026-09';
    const stats = await ingestNonTradeWorkbook(req.file.path, periodMonth, req.file.originalname);

    res.json({
      success: true,
      message: `Successfully processed ${req.file.originalname} for ${periodMonth}`,
      stats
    });
  } catch (err) {
    console.error('[nontrade.controller] upload error:', err);
    res.status(500).json({ error: err.message || 'Failed to parse and ingest Non-Trade Excel file' });
  }
}

/**
 * GET /api/nontrade/export
 * Downloads comprehensive multi-tab Excel workbook
 */
export async function exportNonTradeExcelHandler(req, res) {
  try {
    const periodMonth = req.query.periodMonth || '2026-09';
    const asOnDate = req.query.asOnDate || null;
    const wb = await generateNonTradeExcelExport(periodMonth, asOnDate);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="NonTrade_DJP_Adherence_${periodMonth}.xlsx"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('[nontrade.controller] export error:', err);
    res.status(500).json({ error: err.message || 'Failed to export Non-Trade Excel file' });
  }
}

/**
 * PUT /api/nontrade/plans/rollout
 * Rolls out Non-Trade plans to the Field App
 */
export async function rolloutNonTradePlansHandler(req, res) {
  try {
    const periodMonth = req.body?.periodMonth || '2026-09';
    const result = await rolloutNonTradePlans({ periodMonth });
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] rollout error:', err);
    res.status(500).json({ error: err.message || 'Failed to roll out Non-Trade plans' });
  }
}

/**
 * GET /api/nontrade/plans/rollout-status
 * Checks rollout progress and status for Non-Trade plans
 */
export async function getNonTradeRolloutStatusHandler(req, res) {
  try {
    const periodMonth = req.query?.periodMonth || '2026-09';
    const result = await getNonTradeRolloutStatus(periodMonth);
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] rollout status error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch rollout status' });
  }
}

/**
 * GET /api/nontrade/calendar
 * Returns Non-Trade calendar data formatted for the Red-themed calendar
 */
export async function getNonTradeCalendarHandler(req, res) {
  try {
    const { periodMonth, roleType, empCode, bucket, search } = req.query;
    const result = await getNonTradeCalendarData({
      periodMonth: periodMonth || '2026-09',
      roleType: roleType || 'Officer',
      empCode: empCode || 'ALL',
      bucket: bucket || 'ALL',
      search: search || ''
    });
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] calendar error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch Non-Trade calendar data' });
  }
}

/**
 * GET /api/nontrade/approval-matrix
 * Returns Non-Trade approval matrix, rules, and team reporting hierarchy
 */
export async function getNonTradeApprovalMatrixHandler(req, res) {
  try {
    const periodMonth = req.query.periodMonth || '2026-09';
    const result = await getNonTradeApprovalMatrix(periodMonth);
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] approval matrix error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch Non-Trade approval matrix' });
  }
}

/**
 * POST /api/nontrade/plans/roll-forward
 * Roll forward plans and baseline from sourceMonth to targetMonth (e.g. 2026-09 -> 2026-10)
 */
export async function rollForwardNonTradePlansHandler(req, res) {
  try {
    const { sourceMonth = '2026-09', targetMonth = '2026-10', copyVisits = true } = req.body;
    const result = await rollForwardNonTradePlans(sourceMonth, targetMonth, copyVisits);
    res.json(result);
  } catch (err) {
    console.error('[nontrade.controller] roll-forward error:', err);
    res.status(500).json({ error: err.message || 'Failed to roll forward plans' });
  }
}

/**
 * POST /api/nontrade/sync-sfa
 * Synchronize live SFA mobile punches from visit_execution_logs into nontrade_customer_visit_reports
 */
export async function syncNonTradeSfaHandler(req, res) {
  try {
    const { periodMonth = '2026-09' } = req.body;
    const result = await syncNonTradeVisitsFromSfa(periodMonth);
    res.json({
      success: true,
      message: `Successfully synchronized live SFA visits for ${periodMonth}`,
      ...result
    });
  } catch (err) {
    console.error('[nontrade.controller] sync-sfa error:', err);
    res.status(500).json({ error: err.message || 'Failed to sync SFA visits' });
  }
}




