import express from 'express';
import {
  getNonTradeAdherenceHandler,
  getNonTradePlansHandler,
  getNonTradeHoPlansHandler,
  getNonTradeCustomerVisitsHandler,
  getNonTradeLeadsHandler,
  getNonTradeSiteVisitsHandler,
  getNonTradeProfessionalVisitsHandler,
  getNonTradeEmployeeMasterCheckHandler,
  uploadNonTradeExcelHandler,
  exportNonTradeExcelHandler,
  rolloutNonTradePlansHandler,
  getNonTradeRolloutStatusHandler,
  getNonTradeCalendarHandler,
  nontradeUploadMiddleware
} from '../controllers/nontrade.controller.js';

const router = express.Router();

router.get('/calendar', getNonTradeCalendarHandler);
router.get('/adherence', getNonTradeAdherenceHandler);
router.get('/plans', getNonTradePlansHandler);
router.put('/plans/rollout', rolloutNonTradePlansHandler);
router.get('/plans/rollout-status', getNonTradeRolloutStatusHandler);
router.get('/ho-plans', getNonTradeHoPlansHandler);
router.get('/customer-visits', getNonTradeCustomerVisitsHandler);
router.get('/leads', getNonTradeLeadsHandler);
router.get('/site-visits', getNonTradeSiteVisitsHandler);
router.get('/professional-visits', getNonTradeProfessionalVisitsHandler);
router.get('/employee-master-check', getNonTradeEmployeeMasterCheckHandler);
router.post('/upload', nontradeUploadMiddleware, uploadNonTradeExcelHandler);
router.get('/export', exportNonTradeExcelHandler);

export default router;

