/**
 * Generation Controller — Batch-Isolated PJP/DJP Generation
 *
 * Each generation run is a first-class entity that explicitly declares:
 * - which dealer mapping batch to use
 * - which sales history batches to use
 * - which prospect batch to use (optional)
 * - which rules version to use
 *
 * Two generation runs CANNOT contaminate each other.
 * Historical runs remain reproducible.
 */

import { calculatePJP } from '../engines/pjp/pjp.engine.js';
import { generateFullPjpDjpSolution } from '../engines/djp-generator.engine.js';
import { checkAllExcelInputsAvailable } from '../engines/pjp/data-loader.engine.js';
import { AutoPlanGenerator } from '../engines/autoPlanGenerator.js';
import { analyseC1Adherence } from '../engines/sfa-adherence.engine.js';
import { stampPlanRoutingForPeriod } from '../services/planRouting.service.js';
import { openRegeneration, closeRegeneration } from '../services/c2Snapshot.service.js';
import { dbRun, dbAll, dbGet } from '../config/database.js';

/**
 * Shared helper — generate plans for ALL employees across all roles for a given cycle.
 * @param {string} periodMonth  - 'YYYY-MM'
 * @param {string} cycleCode    - 'C1' | 'C2'
 * @param {Object} [planOptions] - options forwarded to AutoPlanGenerator.generatePlan
 */
export async function generatePlansForAllRoles(periodMonth, cycleCode, planOptions = {}) {
  const autoGen = new AutoPlanGenerator();
  const logTag  = `[AutoPlanGen:${cycleCode}]`;

  const ROLES = [
    { role: 'SO',  codeCol: 'so_emp_code' },
    { role: 'ASM', codeCol: 'asm_code'    },
    { role: 'RSM', codeCol: 'rsm_code'    },
    { role: 'ZH',  codeCol: 'zh_code'     }
  ];

  const byRole = {};
  const errors = [];

  for (const { role, codeCol } of ROLES) {
    const people = await dbAll(
      `SELECT DISTINCT ${codeCol} AS emp_code FROM dealer_visit_targets
       WHERE period_month = ? AND cycle_code = ?
         AND ${codeCol} IS NOT NULL AND TRIM(${codeCol}) != ''`,
      [periodMonth, cycleCode]
    );

    let planned = 0, empty = 0, failed = 0, visits = 0;
    for (const p of people) {
      try {
        const r = await autoGen.generatePlan(p.emp_code, periodMonth, role, cycleCode, planOptions);
        if (r?.planId) { planned++; visits += r.totalVisitsScheduled || 0; }
        else empty++;
      } catch (e) {
        failed++;
        errors.push({ role, empCode: p.emp_code, error: e.message });
        console.warn(`${logTag} ${role} plan error [${p.emp_code}]:`, e.message);
      }
    }

    byRole[role] = { employees: people.length, plansCreated: planned, noTargets: empty, failed, visitsScheduled: visits };
    console.log(`${logTag} ${role}: ${planned} plan(s) from ${people.length} employee(s), ${visits} visits.`);
  }

  // Resolve each plan's owner role and its single L1 approver, so the field app
  // can list "my plans" and "plans awaiting my approval" the moment generation
  // finishes. Done once for the whole period rather than per plan.
  let routing = null;
  try {
    routing = await stampPlanRoutingForPeriod(periodMonth, cycleCode);
  } catch (e) {
    console.warn(`${logTag} Plan routing failed:`, e.message);
    errors.push({ role: 'ROUTING', error: e.message });
  }

  const totalPlans  = Object.values(byRole).reduce((s, r) => s + r.plansCreated, 0);
  const totalVisits = Object.values(byRole).reduce((s, r) => s + r.visitsScheduled, 0);
  console.log(`${logTag} Finished — ${totalPlans} plan(s), ${totalVisits} visit(s) across all roles.`);

  return {
    cycleCode,
    totalPlans,
    totalVisits,
    byRole,
    routing: routing ? { stamped: routing.stamped, unrouted: routing.unrouted.length } : null,
    errors
  };
}

/**
 * THE generation pipeline — one code path, used by every entry point.
 *
 *   1. DJP/PJP solution for the cycle  (dealer_visit_targets + djp_recommendations)
 *   2. officer plans for SO / ASM / RSM / ZH
 *   3. L1 approver routing so the field app can show them immediately
 *
 * "Run DJP" and "regenerate after adherence" differ only in what they pass in:
 * the adherence path supplies sfaAdherenceByEmployee, which pushes the dealers
 * missed in C1 to the front of the C2 schedule. Everything downstream is identical,
 * so a plan produced after adherence is the same shape as one produced by a fresh
 * DJP run — same roles, same routing, same app payload.
 *
 * @param {string} periodMonth  YYYY-MM
 * @param {string} cycleCode    C1 | C2
 * @param {Object} [options]
 * @param {Map}    [options.sfaAdherenceByEmployee] adherence context for C2 regeneration
 */
export async function runGenerationPipeline(periodMonth, cycleCode, options = {}) {
  const {
    generationRunCode,
    dealerMappingBatchCode,
    salesHistoryBatchCodes,
    prospectBatchCode,
    sfaAdherenceByEmployee
  } = options;

  console.log(`[Pipeline:${cycleCode}] 1/2 DJP solution for ${periodMonth}...`);
  const djp = await generateFullPjpDjpSolution(periodMonth, cycleCode, {
    generationRunCode,
    dealerMappingBatchCode,
    salesHistoryBatchCodes,
    prospectBatchCode
  });

  console.log(`[Pipeline:${cycleCode}] 2/2 Officer plans${sfaAdherenceByEmployee ? ' (adherence-aware)' : ''}...`);
  const plans = await generatePlansForAllRoles(periodMonth, cycleCode, { sfaAdherenceByEmployee });

  return { cycleCode, djp, plans };
}

/**
 * Create a new generation run record (without executing).
 * POST /api/generation/create
 * Body: { reportMonth, cycleCode, dealerMappingBatchCode, salesHistoryBatchCodes[], prospectBatchCode? }
 */
export async function createGenerationRun(req, res) {
  try {
    const planMonth = req.body.planMonth || req.body.periodMonth || req.body.reportMonth;
    const {
      cycleCode,
      dealerMappingBatchCode,
      salesHistoryBatchCodes,
      prospectBatchCode,
      sfaFeedbackBatchCode
    } = req.body;

    if (!planMonth || typeof planMonth !== 'string') {
      return res.status(400).json({ error: 'planMonth is required. Please specify the planning month in YYYY-MM format.' });
    }
    const match = planMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Expected format is YYYY-MM.` });
    }
    const mNum = parseInt(match[2], 10);
    if (mNum < 1 || mNum > 12) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Month must be between 01 and 12.` });
    }
    const reportMonth = planMonth;

    if (!cycleCode) return res.status(400).json({ error: 'cycleCode is required (C1 or C2)' });
    if (!dealerMappingBatchCode) return res.status(400).json({ error: 'dealerMappingBatchCode is required' });

    // Validate the batches exist
    const mappingBatch = await dbGet('SELECT batch_code, status FROM upload_batches WHERE batch_code = ? AND file_type = ?', [dealerMappingBatchCode, 'DEALER_MAPPING']);
    if (!mappingBatch) return res.status(400).json({ error: `Dealer mapping batch '${dealerMappingBatchCode}' not found` });
    if (mappingBatch.status === 'FAILED') return res.status(400).json({ error: `Dealer mapping batch '${dealerMappingBatchCode}' has status FAILED — cannot use it for generation` });

    // Validate sales batches
    const salesBatchCodes = Array.isArray(salesHistoryBatchCodes) ? salesHistoryBatchCodes : [];
    for (const code of salesBatchCodes) {
      const b = await dbGet('SELECT batch_code, status FROM upload_batches WHERE batch_code = ? AND file_type = ?', [code, 'SALES_HISTORY']);
      if (!b) return res.status(400).json({ error: `Sales history batch '${code}' not found` });
      if (b.status === 'FAILED') return res.status(400).json({ error: `Sales history batch '${code}' has status FAILED` });
    }

    // Snapshot current rules
    const rulesRows = await dbAll('SELECT rule_key, rule_value FROM business_rules');
    const rulesSnapshot = JSON.stringify(Object.fromEntries(rulesRows.map(r => [r.rule_key, r.rule_value])));

    const generationCode = `GEN-${reportMonth.replace('-', '')}-${cycleCode}-${Date.now()}`;

    await dbRun(
      `INSERT INTO generation_runs 
      (generation_code, report_month, cycle_code, dealer_mapping_batch_code, sales_history_batch_codes, prospect_batch_code, sfa_feedback_batch_code, rules_snapshot, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generationCode, reportMonth, cycleCode,
        dealerMappingBatchCode,
        JSON.stringify(salesBatchCodes),
        prospectBatchCode || null,
        sfaFeedbackBatchCode || null,
        rulesSnapshot,
        'PENDING'
      ]
    );

    res.json({
      message: 'Generation run created. Call POST /api/generation/run/:code to execute.',
      generationCode,
      reportMonth,
      cycleCode,
      dealerMappingBatchCode,
      salesHistoryBatchCodes: salesBatchCodes,
      prospectBatchCode: prospectBatchCode || null
    });
  } catch (err) {
    console.error('[createGenerationRun]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Execute a pending generation run.
 * POST /api/generation/run/:code
 */
export async function executeGenerationRun(req, res) {
  const { code } = req.params;

  try {
    const run = await dbGet('SELECT * FROM generation_runs WHERE generation_code = ?', [code]);
    if (!run) return res.status(404).json({ error: `Generation run '${code}' not found` });
    if (run.status === 'RUNNING') return res.status(409).json({ error: `Generation run '${code}' is already running` });
    if (run.status === 'COMPLETED') {
      return res.status(409).json({ error: `Generation run '${code}' already completed. Create a new run to regenerate.` });
    }

    // Mark as running
    await dbRun('UPDATE generation_runs SET status = ? WHERE generation_code = ?', ['RUNNING', code]);

    const salesBatchCodes = JSON.parse(run.sales_history_batch_codes || '[]');
    const periodMonth     = run.report_month;
    // Always generate BOTH C1 and C2 regardless of the stored cycle_code
    const cycles = ['C1', 'C2'];

    let combinedResult = {
      totalDealerTargets: 0, totalVisitsRequired: 0,
      totalDjpSlots: 0, unallocatedCount: 0, capacityViolated: false, validationErrors: []
    };

    const planSummary = {};
    for (const cycleCode of cycles) {
      console.log(`[executeGenerationRun] Generating cycle ${cycleCode}...`);
      const { djp: result, plans } = await runGenerationPipeline(periodMonth, cycleCode, {
        generationRunCode: code,
        dealerMappingBatchCode: run.dealer_mapping_batch_code,
        salesHistoryBatchCodes: salesBatchCodes,
        prospectBatchCode: run.prospect_batch_code
      });

      combinedResult.totalDealerTargets  = Math.max(combinedResult.totalDealerTargets,  result.totalDealerTargets  || 0);
      combinedResult.totalVisitsRequired += result.totalVisitsRequired || 0;
      combinedResult.totalDjpSlots       += result.totalDjpSlots       || 0;
      combinedResult.unallocatedCount    += result.unallocatedCount    || 0;
      if (result.capacityViolated) combinedResult.capacityViolated = true;
      if (result.validationErrors?.length) combinedResult.validationErrors.push(...result.validationErrors);

      planSummary[cycleCode] = plans;
    }

    const validationErrors = combinedResult.validationErrors.length > 0
      ? JSON.stringify(combinedResult.validationErrors.slice(0, 50))
      : null;

    await dbRun(
      `UPDATE generation_runs SET
       status = ?, pjp_dealer_count = ?, pjp_visit_requirement = ?,
       djp_scheduled_count = ?, djp_unallocated_count = ?,
       capacity_violated = ?, validation_errors = ?, completed_at = NOW()
       WHERE generation_code = ?`,
      [
        combinedResult.unallocatedCount > 0 ? 'PARTIAL' : 'COMPLETED',
        combinedResult.totalDealerTargets,
        combinedResult.totalVisitsRequired,
        combinedResult.totalDjpSlots,
        combinedResult.unallocatedCount,
        combinedResult.capacityViolated ? 1 : 0,
        validationErrors,
        code
      ]
    );

    res.json({
      message: combinedResult.unallocatedCount > 0
        ? `Generation completed (C1+C2) with ${combinedResult.unallocatedCount} unallocated visits. All Employee Plans auto-generated.`
        : 'Generation completed successfully (C1 + C2). All Employee Plans auto-generated.',
      generationCode: code,
      reportMonth: periodMonth,
      cyclesGenerated: ['C1', 'C2'],
      ...combinedResult,
      officerPlans: planSummary
    });
  } catch (err) {
    console.error('[executeGenerationRun]', err);
    await dbRun('UPDATE generation_runs SET status = ?, validation_errors = ?, completed_at = NOW() WHERE generation_code = ?', [
      'FAILED', err.message, code
    ]);
    res.status(500).json({ error: err.message });
  }
}

/**
 * List all generation runs.
 * GET /api/generation
 */
export async function listGenerationRuns(req, res) {
  try {
    const runs = await dbAll('SELECT * FROM generation_runs ORDER BY started_at DESC LIMIT 50');
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Get a specific generation run.
 * GET /api/generation/:code
 */
export async function getGenerationRun(req, res) {
  try {
    const run = await dbGet('SELECT * FROM generation_runs WHERE generation_code = ?', [req.params.code]);
    if (!run) return res.status(404).json({ error: 'Generation run not found' });
    res.json({ run });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * Legacy single-shot generate endpoint — now generates BOTH C1 and C2.
 * POST /api/djp/generate-all
 * Automatically selects the latest VALIDATED batch of each type.
 */
export async function generateAllLegacy(req, res) {
  try {
    const planMonth = req.body.planMonth || req.body.periodMonth || req.body.reportMonth;

    if (!planMonth || typeof planMonth !== 'string') {
      return res.status(400).json({ error: 'planMonth is required. Please specify the planning month in YYYY-MM format.' });
    }
    const match = planMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Expected format is YYYY-MM (e.g., '2026-09').` });
    }
    const mNum = parseInt(match[2], 10);
    if (mNum < 1 || mNum > 12) {
      return res.status(400).json({ error: `Invalid planMonth: '${planMonth}'. Month must be between 01 and 12.` });
    }
    const periodMonth = planMonth;

    // Enforce that ALL 5 Excel input files are available before generating DJP
    const inputCheck = await checkAllExcelInputsAvailable();
    if (!inputCheck.allAvailable) {
      return res.status(400).json({
        error: `Cannot generate DJP: All 5 Excel input files must be uploaded and validated first. Currently missing: ${inputCheck.missing.join(', ')}.`
      });
    }

    // Auto-select latest VALIDATED batches
    const mappingBatch = await dbGet(
      `SELECT batch_code FROM upload_batches WHERE file_type = 'DEALER_MAPPING' AND status != 'FAILED' ORDER BY uploaded_at DESC LIMIT 1`
    );
    const salesBatches = await dbAll(
      `SELECT batch_code FROM upload_batches WHERE file_type = 'SALES_HISTORY' AND status != 'FAILED' ORDER BY uploaded_at DESC LIMIT 10`
    );

    if (!mappingBatch) {
      return res.status(400).json({ error: 'No valid DEALER_MAPPING batch found. Upload dealer master data first.' });
    }

    const salesBatchCodes  = salesBatches.map(b => b.batch_code);
    const generationCode   = `GEN-${periodMonth.replace('-', '')}-BOTH-${Date.now()}`;
    const rulesRows        = await dbAll('SELECT rule_key, rule_value FROM business_rules');
    const rulesSnapshot    = JSON.stringify(Object.fromEntries(rulesRows.map(r => [r.rule_key, r.rule_value])));

    await dbRun(
      `INSERT INTO generation_runs
      (generation_code, report_month, cycle_code, dealer_mapping_batch_code, sales_history_batch_codes, rules_snapshot, status)
      VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [generationCode, periodMonth, 'C1+C2', mappingBatch.batch_code, JSON.stringify(salesBatchCodes), rulesSnapshot, 'RUNNING']
    );

    // Generate BOTH C1 and C2
    const cycles = ['C1', 'C2'];
    const cycleResults = {};
    let combinedDealerTargets = 0;
    let combinedDjpSlots      = 0;
    let combinedUnallocated   = 0;

    const planSummary = {};
    for (const cycleCode of cycles) {
      console.log(`[generateAllLegacy] Generating ${cycleCode}...`);
      const { djp: result, plans } = await runGenerationPipeline(periodMonth, cycleCode, {
        generationRunCode: generationCode,
        dealerMappingBatchCode: mappingBatch.batch_code,
        salesHistoryBatchCodes: salesBatchCodes
      });
      cycleResults[cycleCode] = result;
      planSummary[cycleCode]  = plans;
      combinedDealerTargets = Math.max(combinedDealerTargets, result.totalDealerTargets || 0);
      combinedDjpSlots    += result.totalDjpSlots    || 0;
      combinedUnallocated += result.unallocatedCount || 0;
    }

    const status = combinedUnallocated > 0 ? 'PARTIAL' : 'COMPLETED';
    await dbRun(
      `UPDATE generation_runs SET
       status = ?, pjp_dealer_count = ?,
       djp_scheduled_count = ?, djp_unallocated_count = ?, completed_at = NOW()
       WHERE generation_code = ?`,
      [status, combinedDealerTargets, combinedDjpSlots, combinedUnallocated, generationCode]
    );

    res.json({
      message: 'Multi-Role PJP & DJP Solution Generated (C1 + C2)',
      generationCode,
      periodMonth,
      cyclesGenerated: ['C1', 'C2'],
      dealerMappingBatchUsed: mappingBatch.batch_code,
      salesBatchesUsed: salesBatchCodes,
      totalDealerTargets: combinedDealerTargets,
      totalDjpSlots: combinedDjpSlots,
      unallocatedCount: combinedUnallocated,
      c1Result: cycleResults['C1'],
      c2Result: cycleResults['C2'],
      officerPlans: planSummary
    });
  } catch (err) {
    console.error('[generateAllLegacy]', err);
    res.status(500).json({ error: err.message });
  }
}

/**
 * Regenerate ONLY C2 plans after SFA feedback upload (adherence-based).
 * POST /api/generation/regenerate-c2
 * Body: { periodMonth: 'YYYY-MM' }
 *
 * Steps:
 *   1. Analyse C1 adherence (actual vs planned)
 *   2. Purge existing C2 targets, plans and recommendations
 *   3. Run the SAME pipeline "Run DJP" uses — DJP solution → officer plans → L1 routing —
 *      with the adherence context, so dealers missed in C1 lead the C2 schedule
 *
 * C1 is deliberately left alone: it has already been executed and is what the
 * adherence figure was measured against. Regenerating it would destroy the record.
 */
export async function regenerateC2Plans(req, res) {
  try {
    const planMonth = req.body.planMonth || req.body.periodMonth;
    if (!planMonth || typeof planMonth !== 'string') {
      return res.status(400).json({ error: 'periodMonth is required (YYYY-MM).' });
    }
    const match = planMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return res.status(400).json({ error: `Invalid periodMonth: '${planMonth}'. Expected YYYY-MM.` });
    }
    const periodMonth = planMonth;
    const cycleCode   = 'C2';

    console.log(`[regenerateC2Plans] Starting C2 regeneration for ${periodMonth}...`);

    // Step 1: Analyse C1 adherence from SFA logs
    const adherence = await analyseC1Adherence(periodMonth);
    console.log(`[regenerateC2Plans] Adherence: ${adherence.completedCount} completed, ${adherence.missedCount} missed (${adherence.adherencePct}%)`);

    // Step 1b: capture the plan as it stands BEFORE anything is deleted. The purge
    // below is destructive, so this is the only moment the previous C2 still exists.
    // Without it the review screen can show the new schedule but not what changed.
    const regenerationCode = `GEN-${periodMonth.replace('-', '')}-C2REGEN-${Date.now()}`;
    const regenerationId = await openRegeneration(periodMonth, regenerationCode, adherence);

    // Step 2: Purge existing C2 sales_plans for this period
    await dbRun(
      `DELETE FROM sales_plan_details
       WHERE plan_id IN (
         SELECT id FROM sales_plans WHERE period_month = ? AND cycle_code = 'C2'
       )`,
      [periodMonth]
    );
    await dbRun(
      `DELETE FROM sales_plans WHERE period_month = ? AND cycle_code = 'C2'`,
      [periodMonth]
    );
    // Also purge C2 DJP recommendations so they get freshly re-allocated
    await dbRun(
      `DELETE FROM djp_recommendations WHERE period_month = ? AND cycle_code = 'C2'`,
      [periodMonth]
    );
    // ...and the C2 visit targets themselves, which the previous version claimed to
    // delete but never did. Without this, targets from the earlier run survive and
    // the "regenerated" C2 is a merge of two runs rather than a clean rebuild.
    await dbRun(
      `DELETE FROM dealer_visit_targets WHERE period_month = ? AND cycle_code = 'C2'`,
      [periodMonth]
    );
    console.log(`[regenerateC2Plans] Purged existing C2 targets, plans and DJP recommendations.`);

    // Step 3: Re-run DJP generation for C2 (recalculate dealer_visit_targets for C2)
    const mappingBatch = await dbGet(
      `SELECT batch_code FROM upload_batches WHERE file_type = 'DEALER_MAPPING' AND status != 'FAILED' ORDER BY uploaded_at DESC LIMIT 1`
    );
    const salesBatches = await dbAll(
      `SELECT batch_code FROM upload_batches WHERE file_type = 'SALES_HISTORY' AND status != 'FAILED' ORDER BY uploaded_at DESC LIMIT 10`
    );
    const generationCode = regenerationCode;   // minted above, before the purge

    // Record the run. The previous version built this code but never inserted a row,
    // so an adherence-driven regeneration was invisible in the run history and could
    // not be told apart from the original DJP run.
    const rulesRows     = await dbAll('SELECT rule_key, rule_value FROM business_rules');
    const rulesSnapshot = JSON.stringify(Object.fromEntries(rulesRows.map(r => [r.rule_key, r.rule_value])));
    await dbRun(
      `INSERT INTO generation_runs
       (generation_code, report_month, cycle_code, dealer_mapping_batch_code, sales_history_batch_codes, rules_snapshot, status)
       VALUES (?, ?, ?, ?, ?, ?, 'RUNNING')`,
      [
        generationCode, periodMonth, 'C2',
        mappingBatch?.batch_code || null,
        JSON.stringify(salesBatches.map(b => b.batch_code)),
        rulesSnapshot
      ]
    ).catch(e => console.warn('[regenerateC2Plans] run record skipped:', e.message));

    // Step 3: the SAME pipeline "Run DJP" uses — DJP solution, then officer plans for
    // every role, then L1 routing. The only difference is the adherence context.
    const { djp: result, plans } = await runGenerationPipeline(periodMonth, cycleCode, {
      generationRunCode: generationCode,
      dealerMappingBatchCode: mappingBatch?.batch_code,
      salesHistoryBatchCodes: salesBatches.map(b => b.batch_code),
      sfaAdherenceByEmployee: adherence.byEmployee
    });

    await dbRun(
      `UPDATE generation_runs SET
         status = ?, pjp_dealer_count = ?, djp_scheduled_count = ?,
         djp_unallocated_count = ?, completed_at = NOW()
       WHERE generation_code = ?`,
      [
        (result.unallocatedCount || 0) > 0 ? 'PARTIAL' : 'COMPLETED',
        result.totalDealerTargets || 0,
        result.totalDjpSlots || 0,
        result.unallocatedCount || 0,
        generationCode
      ]
    ).catch(e => console.warn('[regenerateC2Plans] run record update skipped:', e.message));

    // Capture the rebuilt plan so the review screen can diff it against the BEFORE side.
    await closeRegeneration(regenerationId, periodMonth, adherence.missedDealers || []);

    const uniquePairs      = adherence.completedCount + adherence.missedCount;
    const dealerLevelPct   = uniquePairs > 0 ? Math.round((adherence.completedCount / uniquePairs) * 100) : 0;

    console.log(`[regenerateC2Plans] Complete — ${plans.totalPlans} officer plan(s), ${plans.totalVisits} visit(s).`);

    res.json({
      message:
        `C2 regenerated for ${periodMonth} from SFA adherence. ` +
        `${adherence.missedCount} missed C1 dealers prioritised. ` +
        `${plans.totalPlans} officer plan(s) generated across ${Object.keys(plans.byRole).length} roles.`,
      periodMonth,
      cycleCode: 'C2',
      generationCode,
      regenerationId,
      adherenceSummary: {
        plannedC1Visits:   adherence.plannedCount,
        uniqueDealerPairs: uniquePairs,
        completedC1Visits: adherence.completedCount,
        missedC1Visits:    adherence.missedCount,
        adherencePct:      adherence.adherencePct,
        dealerLevelPct
      },
      c2GenerationResult: result,
      officerPlans: plans
    });
  } catch (err) {
    console.error('[regenerateC2Plans]', err);
    res.status(500).json({ error: err.message });
  }
}
