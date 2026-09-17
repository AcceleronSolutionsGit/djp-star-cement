/**
 * Migration — stop Dealer Performance uploads from accumulating.
 *
 * dealer-performance.importer.js writes with ON DUPLICATE KEY UPDATE, which only fires
 * when a UNIQUE or PRIMARY key is violated. dealer_performance_history declares none,
 * so the clause never fired and every upload appended a fresh row. Because
 * loadDealerPerformanceHistory aggregates with
 *
 *     SUM(quantity_mt) GROUP BY sap_code, period_year_month
 *
 * a corrected figure was ADDED to the old one rather than replacing it: upload 1200,
 * correct it to 500, re-upload, and the engine read 1700.
 *
 * This does two things:
 *
 *   1. Collapses the duplicates already in the table, keeping the most recent row for
 *      each (sap_code, period_year_month) — the last upload is the intended figure.
 *   2. Adds the unique key, so the upsert in the importer works from now on.
 *
 * Step 1 must come first: the index cannot be created while duplicates exist.
 *
 * The importer now also deletes the pairs it is about to write, so it is correct even
 * without this migration. Run it anyway — it repairs data already accumulated.
 *
 *   node src/scripts/migrate-dp-unique-key.js            # report only
 *   node src/scripts/migrate-dp-unique-key.js --apply    # repair and add the key
 */

import { dbGet, dbAll, dbRun, pool } from '../config/database.js';

const APPLY = process.argv.includes('--apply');

async function indexExists(table, index) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`, [table, index]
  );
  return (row?.c || 0) > 0;
}

export async function migrateDpUniqueKey({ apply = false } = {}) {
  const INDEX = 'uniq_dp_sap_period';

  const dupes = await dbAll(
    `SELECT sap_code, period_year_month, COUNT(*) AS copies, SUM(quantity_mt) AS summed,
            MAX(quantity_mt) AS newest
       FROM dealer_performance_history
      WHERE sap_code IS NOT NULL
      GROUP BY sap_code, period_year_month
     HAVING COUNT(*) > 1
      ORDER BY copies DESC`
  );

  const totalExtra = dupes.reduce((a, d) => a + (d.copies - 1), 0);
  console.log(`[migrate-dp] (dealer, period) pairs with more than one row: ${dupes.length}`);
  console.log(`[migrate-dp] surplus rows to remove: ${totalExtra}`);

  if (dupes.length) {
    console.log('[migrate-dp] worst affected:');
    for (const d of dupes.slice(0, 10))
      console.log(`  ${d.sap_code}  ${d.period_year_month}  ${d.copies} copies  ` +
                  `(the engine has been reading ${d.summed}, not the latest figure)`);
  }

  const haveIndex = await indexExists('dealer_performance_history', INDEX);
  console.log(`[migrate-dp] unique key present: ${haveIndex ? 'yes' : 'NO'}`);

  if (!apply) {
    console.log('\n[migrate-dp] Report only. Re-run with --apply to repair.');
    return { dupes: dupes.length, surplus: totalExtra, indexed: haveIndex, applied: false };
  }

  // 1. Keep the newest row per pair — the most recent upload is the intended value.
  if (dupes.length) {
    await dbRun(
      `DELETE dp FROM dealer_performance_history dp
         JOIN (
           SELECT sap_code, period_year_month, MAX(id) AS keep_id
             FROM dealer_performance_history
            WHERE sap_code IS NOT NULL
            GROUP BY sap_code, period_year_month
         ) k
           ON k.sap_code = dp.sap_code
          AND k.period_year_month = dp.period_year_month
        WHERE dp.id <> k.keep_id`
    );
    console.log(`[migrate-dp] Collapsed ${totalExtra} surplus row(s), keeping the most recent of each.`);
  }

  // 2. Add the key the upsert needs.
  if (!haveIndex) {
    await dbRun(
      `ALTER TABLE dealer_performance_history
         ADD UNIQUE KEY ${INDEX} (sap_code, period_year_month)`
    );
    console.log(`[migrate-dp] Added unique key ${INDEX} (sap_code, period_year_month).`);
  }

  console.log('\n[migrate-dp] Done. Re-upload Dealer Performance, then run Generate Plans.');
  return { dupes: dupes.length, surplus: totalExtra, indexed: true, applied: true };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrateDpUniqueKey({ apply: APPLY })
    .then(() => pool?.end?.())
    .catch(e => { console.error('[migrate-dp] Failed:', e.message); process.exit(1); })
    .finally(() => process.exit(0));
}
