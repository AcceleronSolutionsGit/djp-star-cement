/**
 * C2 Regeneration Snapshots
 *
 * Regenerating C2 deletes the existing C2 plans outright, so once it has run there is
 * nothing left to compare against — you can see the new schedule but not what the
 * adherence result actually changed. That is the one question a reviewer asks.
 *
 * This captures the plan on both sides of the purge (BEFORE and AFTER) plus the
 * adherence figures that drove it, so the difference can be shown later without
 * recomputing anything or trusting that nobody edited a plan in between.
 *
 * Snapshots are append-only history. Nothing here writes to a live plan.
 */

import { dbAll, dbGet, dbRun } from '../config/database.js';

const norm = v => String(v ?? '').trim();
const key  = v => norm(v).toUpperCase();

async function tableExists(table) {
  const row = await dbGet(
    `SELECT COUNT(*) AS c FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [table]
  ).catch(() => null);
  return (row?.c || 0) > 0;
}

/**
 * Read the current C2 plan for a period, flattened to plan lines.
 * Called once before the purge and once after the rebuild.
 */
export async function readC2PlanLines(periodMonth) {
  return dbAll(
    `SELECT
       sp.emp_code, sp.emp_name,
       COALESCE(NULLIF(TRIM(sp.emp_role), ''), 'SO') AS emp_role,
       sp.status,
       spd.visit_date, spd.dealer_sap_code, spd.dealer_name, spd.sequence
     FROM sales_plan_details spd
     JOIN sales_plans sp ON sp.id = spd.plan_id
     WHERE sp.period_month = ? AND sp.cycle_code = 'C2'
     ORDER BY sp.emp_code, spd.visit_date, spd.sequence`,
    [periodMonth]
  );
}

/**
 * Open a regeneration record and store the BEFORE lines.
 * Returns the regeneration id, or null if the history tables are not present —
 * a missing snapshot must never stop a regeneration from running.
 */
export async function openRegeneration(periodMonth, generationCode, adherence) {
  if (!(await tableExists('c2_regenerations'))) {
    console.warn('[C2Snapshot] history tables missing — run migrate-c2-review.js. Regeneration continues without a snapshot.');
    return null;
  }

  try {
    const before = await readC2PlanLines(periodMonth);

    const result = await dbRun(
      `INSERT INTO c2_regenerations
         (generation_code, period_month, adherence_as_on, adherence_planned,
          adherence_adhered, adherence_missed, adherence_pct,
          plans_before, visits_before, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING')`,
      [
        generationCode, periodMonth,
        adherence?.asOnDate || null,
        adherence?.plannedCount ?? 0,
        adherence?.completedCount ?? 0,
        adherence?.missedCount ?? 0,
        adherence?.adherencePct ?? 0,
        new Set(before.map(b => b.emp_code)).size,
        before.length
      ]
    );
    const id = result.insertId || result.lastID;

    await storeLines(id, 'BEFORE', before);
    console.log(`[C2Snapshot] Captured ${before.length} BEFORE line(s) for ${periodMonth}.`);
    return id;
  } catch (e) {
    console.warn('[C2Snapshot] BEFORE snapshot failed:', e.message);
    return null;
  }
}

/**
 * Store the AFTER lines and close the record.
 */
export async function closeRegeneration(regenerationId, periodMonth, missedDealers = []) {
  if (!regenerationId) return null;
  try {
    const after = await readC2PlanLines(periodMonth);
    await storeLines(regenerationId, 'AFTER', after);

    // Which dealers came out of the adherence result as missed in C1. Stored on the
    // record so the review does not depend on the SFA log still being there later —
    // the importer wipes visit_execution_logs on the next upload.
    const missedCodes = [...new Set(missedDealers.map(d => norm(d.dealer_sap_code)).filter(Boolean))];

    await dbRun(
      `UPDATE c2_regenerations
       SET plans_after = ?, visits_after = ?, missed_dealer_codes = ?,
           status = 'COMPLETED', completed_at = NOW()
       WHERE id = ?`,
      [
        new Set(after.map(a => a.emp_code)).size,
        after.length,
        JSON.stringify(missedCodes),
        regenerationId
      ]
    );
    console.log(`[C2Snapshot] Captured ${after.length} AFTER line(s).`);
    return regenerationId;
  } catch (e) {
    console.warn('[C2Snapshot] AFTER snapshot failed:', e.message);
    return null;
  }
}

async function storeLines(regenerationId, phase, lines) {
  if (!lines.length) return;
  const chunk = 500;
  for (let i = 0; i < lines.length; i += chunk) {
    const slice = lines.slice(i, i + chunk);
    const placeholders = slice.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
    const params = slice.flatMap(l => [
      regenerationId, phase, l.emp_code, l.emp_name, l.emp_role,
      String(l.visit_date).slice(0, 10), l.dealer_sap_code, l.dealer_name, l.sequence ?? 1
    ]);
    await dbRun(
      `INSERT INTO c2_regeneration_lines
         (regeneration_id, phase, emp_code, emp_name, emp_role, visit_date, dealer_sap_code, dealer_name, sequence)
       VALUES ${placeholders}`,
      params
    );
  }
}

/**
 * Compare the two snapshots of one regeneration.
 *
 * Compared per (employee, dealer), not per line, because a dealer moving from the 22nd
 * to the 17th is the interesting change — the plan did not gain a dealer, it reordered.
 * Visit count changes are reported separately from added and dropped dealers.
 */
export function diffLines(before, after, missedCodes = []) {
  const missed = new Set(missedCodes.map(key));

  const fold = (lines) => {
    const m = new Map();
    for (const l of lines) {
      const k = `${key(l.emp_code)}|${key(l.dealer_sap_code)}`;
      if (!m.has(k)) {
        m.set(k, {
          emp_code: l.emp_code, emp_name: l.emp_name, emp_role: l.emp_role,
          dealer_sap_code: l.dealer_sap_code, dealer_name: l.dealer_name,
          visits: 0, dates: [], firstDate: null, firstSequence: null
        });
      }
      const e = m.get(k);
      e.visits += 1;
      e.dates.push(String(l.visit_date).slice(0, 10));
      if (!e.firstDate || String(l.visit_date).slice(0, 10) < e.firstDate) {
        e.firstDate = String(l.visit_date).slice(0, 10);
        e.firstSequence = l.sequence;
      }
    }
    for (const e of m.values()) e.dates = [...new Set(e.dates)].sort();
    return m;
  };

  const b = fold(before);
  const a = fold(after);
  const changes = [];

  for (const [k, av] of a) {
    const bv = b.get(k);
    if (!bv) {
      changes.push({
        change: 'ADDED', ...av,
        was_missed_in_c1: missed.has(key(av.dealer_sap_code)),
        before_visits: 0, before_dates: []
      });
    } else {
      const movedEarlier = av.firstDate < bv.firstDate;
      const movedLater   = av.firstDate > bv.firstDate;
      const visitsChanged = av.visits !== bv.visits;
      if (movedEarlier || movedLater || visitsChanged) {
        changes.push({
          change: visitsChanged && !movedEarlier && !movedLater
            ? (av.visits > bv.visits ? 'MORE_VISITS' : 'FEWER_VISITS')
            : (movedEarlier ? 'MOVED_EARLIER' : 'MOVED_LATER'),
          ...av,
          was_missed_in_c1: missed.has(key(av.dealer_sap_code)),
          before_visits: bv.visits, before_dates: bv.dates
        });
      }
    }
  }

  for (const [k, bv] of b) {
    if (!a.has(k)) {
      changes.push({
        change: 'DROPPED', ...bv,
        was_missed_in_c1: missed.has(key(bv.dealer_sap_code)),
        before_visits: bv.visits, before_dates: bv.dates,
        visits: 0, dates: []
      });
    }
  }

  const order = { ADDED: 0, MOVED_EARLIER: 1, MORE_VISITS: 2, FEWER_VISITS: 3, MOVED_LATER: 4, DROPPED: 5 };
  changes.sort((x, y) =>
    (y.was_missed_in_c1 - x.was_missed_in_c1) ||
    (order[x.change] - order[y.change]) ||
    String(x.emp_code).localeCompare(String(y.emp_code))
  );

  return {
    changes,
    summary: {
      // "assignments" = one officer visiting one dealer. "dealers" = distinct dealers.
      // A dealer covered by two officers is two assignments but one dealer; keeping
      // the two names apart is what stops the counts reading as contradictory.
      assignments_before: b.size,
      assignments_after: a.size,
      dealers_before: new Set([...b.values()].map(v => key(v.dealer_sap_code))).size,
      dealers_after:  new Set([...a.values()].map(v => key(v.dealer_sap_code))).size,
      added: changes.filter(c => c.change === 'ADDED').length,
      dropped: changes.filter(c => c.change === 'DROPPED').length,
      moved_earlier: changes.filter(c => c.change === 'MOVED_EARLIER').length,
      moved_later: changes.filter(c => c.change === 'MOVED_LATER').length,
      visit_count_changed: changes.filter(c => c.change === 'MORE_VISITS' || c.change === 'FEWER_VISITS').length,
      unchanged: a.size - changes.filter(c => c.change !== 'DROPPED').length,
      // Both of these count DISTINCT dealers, not (officer, dealer) pairs. The folded
      // map is keyed per officer+dealer, so one dealer shared by three officers is
      // three entries — counting those directly against a distinct-dealer total
      // produced nonsense like "48 of 28 covered".
      missed_c1_dealers_on_new_c2:
        new Set([...a.values()].map(v => key(v.dealer_sap_code)).filter(c => missed.has(c))).size,
      missed_c1_dealers_total: missed.size,
      // Kept separately, because "how many officer visits does this affect" is also
      // a fair question — it is just not the same question.
      missed_c1_assignments_on_new_c2:
        [...a.values()].filter(v => missed.has(key(v.dealer_sap_code))).length
    }
  };
}
