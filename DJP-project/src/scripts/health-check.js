/**
 * Health check — reads the live database and writes a report Claude can read back.
 *
 * Run it once:
 *
 *   node src/scripts/health-check.js
 *
 * It writes  health-report.json  in the project root. Nothing is modified; every
 * statement here is a SELECT.
 */

import { writeFileSync } from 'node:fs';
import { dbGet, dbAll, pool } from '../config/database.js';

const R = { generatedAt: new Date().toISOString(), checks: {}, problems: [], notes: [] };
const problem = (k, m) => { R.problems.push(`${k}: ${m}`); };
const note    = (k, m) => { R.notes.push(`${k}: ${m}`); };

async function tableExists(t) {
  const r = await dbGet(
    `SELECT COUNT(*) c FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t]).catch(() => null);
  return (r?.c || 0) > 0;
}
async function columnExists(t, c) {
  const r = await dbGet(
    `SELECT COUNT(*) c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [t, c]).catch(() => null);
  return (r?.c || 0) > 0;
}
const safe = async (fn, fallback = null) => { try { return await fn(); } catch (e) { return fallback; } };

async function main() {
  R.database = (await safe(() => dbGet('SELECT DATABASE() AS db')))?.db || '(unknown)';

  // ── 1. the Dealer Performance duplicate problem ────────────────────────────
  const dupes = await safe(() => dbAll(
    `SELECT sap_code, period_year_month, COUNT(*) copies,
            SUM(quantity_mt) summed, MAX(quantity_mt) largest, MIN(quantity_mt) smallest
       FROM dealer_performance_history
      WHERE sap_code IS NOT NULL
      GROUP BY sap_code, period_year_month
     HAVING COUNT(*) > 1
      ORDER BY copies DESC, summed DESC
      LIMIT 50`), []);

  const dupCount = await safe(() => dbGet(
    `SELECT COUNT(*) pairs, COALESCE(SUM(extra),0) surplus FROM (
       SELECT COUNT(*) - 1 AS extra FROM dealer_performance_history
        WHERE sap_code IS NOT NULL
        GROUP BY sap_code, period_year_month HAVING COUNT(*) > 1) t`));

  const idx = await safe(() => dbAll(
    `SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dealer_performance_history'
      GROUP BY INDEX_NAME, NON_UNIQUE`), []);

  R.checks.dealerPerformance = {
    totalRows: (await safe(() => dbGet(`SELECT COUNT(*) c FROM dealer_performance_history`)))?.c ?? null,
    distinctDealers: (await safe(() => dbGet(`SELECT COUNT(DISTINCT sap_code) c FROM dealer_performance_history`)))?.c ?? null,
    periods: (await safe(() => dbAll(
      `SELECT period_year_month p, COUNT(*) n, COUNT(DISTINCT sap_code) dealers
         FROM dealer_performance_history GROUP BY period_year_month ORDER BY p DESC LIMIT 14`), [])),
    duplicatePairs: dupCount?.pairs ?? null,
    surplusRows: dupCount?.surplus ?? null,
    worstOffenders: dupes,
    indexes: idx,
    hasUniqueKey: idx.some(i => Number(i.NON_UNIQUE) === 0 &&
      String(i.cols || '').toLowerCase().includes('sap_code') &&
      String(i.cols || '').toLowerCase().includes('period_year_month'))
  };

  if ((dupCount?.pairs || 0) > 0)
    problem('dealer_performance_history', `${dupCount.pairs} dealer-month pair(s) still have more than one row — the engine is reading their SUM`);
  if (!R.checks.dealerPerformance.hasUniqueKey)
    problem('dealer_performance_history', 'the UNIQUE (sap_code, period_year_month) key is missing — uploads will accumulate again');

  // ── 2. the other schema objects the code needs ─────────────────────────────
  R.checks.schema = {
    generation_runs: await tableExists('generation_runs'),
    generation_runs_started_at: await columnExists('generation_runs', 'started_at'),
    visit_execution_logs_batch_code: await columnExists('visit_execution_logs', 'batch_code'),
    c2_regenerations: await tableExists('c2_regenerations'),
    c2_regeneration_lines: await tableExists('c2_regeneration_lines'),
    approval_matrix: await tableExists('approval_matrix'),
    dealer_visit_targets_phase2: {}
  };
  for (const c of ['counter_share','need_to_grow','area_potential','area_potential_rank',
                   'area_potential_percentile','area_volume','area_volume_rank',
                   'area_volume_percentile','potential_rank','doa'])
    R.checks.schema.dealer_visit_targets_phase2[c] = await columnExists('dealer_visit_targets', c);

  if (!R.checks.schema.generation_runs)                 problem('schema', 'generation_runs is missing — the first Generate Plans will fail');
  if (!R.checks.schema.visit_execution_logs_batch_code) problem('schema', 'visit_execution_logs.batch_code is missing — the SFA upload will fail');
  if (!R.checks.schema.c2_regenerations)                note('schema', 'c2_regenerations missing — C2 Review will have no history (plans still generate)');
  if (!R.checks.schema.approval_matrix)                 note('schema', 'approval_matrix missing — the service falls back to defaults, harmless but noisy');
  for (const [c, ok] of Object.entries(R.checks.schema.dealer_visit_targets_phase2))
    if (!ok) problem('schema', `dealer_visit_targets.${c} is missing — Run DJP will fail`);

  // ── 3. what data is loaded ─────────────────────────────────────────────────
  const counts = {};
  for (const t of ['master_dealers','master_dealer_so_mapping','master_employees','sales_history',
                   'dealer_performance_history','visit_execution_logs','dealer_visit_targets',
                   'djp_recommendations','sales_plans','sales_plan_details','upload_batches'])
    counts[t] = (await safe(() => dbGet(`SELECT COUNT(*) c FROM \`${t}\``)))?.c ?? '(no table)';
  R.checks.rowCounts = counts;

  R.checks.uploads = await safe(() => dbAll(
    `SELECT batch_code, file_type, file_name, status, total_rows, valid_rows, invalid_rows, uploaded_at
       FROM upload_batches ORDER BY uploaded_at DESC LIMIT 15`), []);

  R.checks.generations = await safe(() => dbAll(
    `SELECT generation_code, report_month, cycle_code, status,
            pjp_dealer_count, djp_scheduled_count, started_at, completed_at
       FROM generation_runs ORDER BY started_at DESC LIMIT 10`), []);

  R.checks.targets = await safe(() => dbAll(
    `SELECT period_month, cycle_code, COUNT(*) rows_,
            SUM(CASE WHEN dealer_status IS NULL OR dealer_status='' THEN 1 ELSE 0 END) blank_category
       FROM dealer_visit_targets GROUP BY period_month, cycle_code ORDER BY period_month DESC, cycle_code`), []);

  R.checks.categoryMix = await safe(() => dbAll(
    `SELECT period_month, cycle_code, dealer_status, COUNT(*) n
       FROM dealer_visit_targets
      WHERE period_month = (SELECT MAX(period_month) FROM dealer_visit_targets)
      GROUP BY period_month, cycle_code, dealer_status ORDER BY cycle_code, n DESC`), []);

  // ── 4. the three named dealers, if they are loaded ─────────────────────────
  const NAMED = ['1000000013','1000000021','1000000022'];
  R.checks.namedDealers = [];
  for (const sap of NAMED) {
    const d = await safe(() => dbGet(
      `SELECT sap_code, dealer_name, dm_area, sbg_potential, doa FROM master_dealers WHERE sap_code = ?`, [sap]));
    const dp = await safe(() => dbAll(
      `SELECT period_year_month p, COUNT(*) copies, SUM(quantity_mt) summed, MAX(quantity_mt) largest
         FROM dealer_performance_history WHERE sap_code = ?
        GROUP BY period_year_month ORDER BY p DESC LIMIT 10`, [sap]), []);
    const t = await safe(() => dbAll(
      `SELECT period_month, cycle_code, dealer_status, category, current_sales, previous_sales,
              lysm_sales, dp_six_month_avg, rsar_six_month_avg, counter_share, need_to_grow
         FROM dealer_visit_targets WHERE sap_code = ? ORDER BY period_month DESC, cycle_code LIMIT 4`, [sap]), []);
    R.checks.namedDealers.push({ sap, master: d, dealerPerformance: dp, targets: t });
  }

  // ── 5. is anything obviously stale? ────────────────────────────────────────
  const latestUpload = await safe(() => dbGet(`SELECT MAX(uploaded_at) t FROM upload_batches`));
  const latestGen    = await safe(() => dbGet(`SELECT MAX(started_at) t FROM generation_runs`));
  R.checks.freshness = { latestUpload: latestUpload?.t || null, latestGeneration: latestGen?.t || null };
  if (latestUpload?.t && latestGen?.t && new Date(latestUpload.t) > new Date(latestGen.t))
    problem('freshness', 'the newest upload is NEWER than the last Generate Plans — the screen is showing figures from before that upload');

  writeFileSync('health-report.json', JSON.stringify(R, null, 2));

  console.log('\n' + '='.repeat(70));
  console.log('  HEALTH CHECK');
  console.log('='.repeat(70));
  console.log(`  database ................ ${R.database}`);
  console.log(`  DP duplicate pairs ...... ${R.checks.dealerPerformance.duplicatePairs}`);
  console.log(`  DP surplus rows ......... ${R.checks.dealerPerformance.surplusRows}`);
  console.log(`  DP unique key present ... ${R.checks.dealerPerformance.hasUniqueKey ? 'yes' : 'NO'}`);
  console.log('');
  if (R.problems.length) { console.log('  PROBLEMS:'); R.problems.forEach(p => console.log('   - ' + p)); }
  else console.log('  No problems found.');
  if (R.notes.length) { console.log('  Notes:'); R.notes.forEach(n => console.log('   - ' + n)); }
  console.log('\n  Written: health-report.json  — send this file to Claude.\n');
}

main()
  .catch(e => { console.error('[health-check] Failed:', e.message);
                writeFileSync('health-report.json', JSON.stringify({ error: e.message, stack: e.stack }, null, 2)); })
  .finally(async () => { await pool?.end?.().catch(() => {}); process.exit(0); });
