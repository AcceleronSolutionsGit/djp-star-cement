/**
 * SFA Adherence Engine
 *
 * Measures planned visits against the visits the SFA app actually logged, using the
 * method derived from the client's own workbook (Trade DJP Zone wise - 28-06-2026.xlsx).
 * The formulas below were read out of that file and reconcile to the last decimal.
 *
 * ── The method ────────────────────────────────────────────────────────────────
 *
 *   MTD Due        = Planned × (elapsed portion of the cycle as of the "as on" date)
 *   Adhered        = number of SFA visits matching (employee, dealer) in the window
 *   Adherence %    = Adhered ÷ MTD Due, falling back to full Planned when MTD Due < 1
 *   Pending        = MTD Due − Adhered          (negative when someone over-visits)
 *
 * The client's sheet prorates across the whole month:
 *
 *   D5 = C5 * DAY($M$2) / DAY(EOMONTH($M$2,0))
 *
 * We prorate across the CYCLE instead, because plans here are built per cycle and a
 * C1 plan's visits all fall in days 1-15. Prorating a C1 plan by day-of-month would
 * say only half of it is due on the 15th, when in fact all of it is.
 *
 * The two agree: summing the cycles reproduces the client's month figure exactly.
 * On 28-Jun (30 days), C1 is fully elapsed and C2 is 13/15 elapsed, so with plan split
 * evenly the month works out to 0.5 + 0.5×(13/15) = 0.9333 = 28/30. See
 * test/adherence-method.test.mjs, which asserts that identity.
 *
 * ── Two "adhered" numbers, deliberately ───────────────────────────────────────
 * The client keeps both and uses them in different places:
 *   capped   = MIN(actual, planned)  — dashboards, so adherence never exceeds 100%
 *   uncapped = raw count             — per-dealer views, where 500% and negative
 *                                      pending are the point
 * A third, `adheredDays` (distinct visit dates), mirrors the COUNTS column of the
 * client's 'NE + ROE' sheet. All three are returned; none is hidden.
 *
 * ── Dealer identity ───────────────────────────────────────────────────────────
 * The SFA export's Customer Code column carries the SFA code (S141, WBM273,
 * SDNE13791) — SAP codes never appear in it. Plans store the SAP code. Every log row
 * is therefore resolved through master_dealers (sfa_code → sap_code) before matching,
 * and unresolvable rows are reported rather than silently counted as misses.
 */

import { dbAll, dbGet } from '../config/database.js';

const norm = v => String(v ?? '').trim();
const key  = v => norm(v).toUpperCase();

const ROLES = ['SO', 'ASM', 'RSM', 'ZH'];

// ─────────────────────────────────────────────────────────────────────────────
// cycle windows + prorata
// ─────────────────────────────────────────────────────────────────────────────

export async function loadCycleWindows() {
  let r = {};
  try {
    const rows = await dbAll(
      `SELECT rule_key, rule_value FROM business_rules
       WHERE rule_key IN ('c1_start_day','c1_end_day','c2_start_day','c2_end_day')`
    );
    r = Object.fromEntries(rows.map(x => [x.rule_key, x.rule_value]));
  } catch (e) { /* defaults below */ }

  return {
    C1: { start: parseInt(r.c1_start_day || '1', 10),  end: parseInt(r.c1_end_day || '15', 10) },
    C2: { start: parseInt(r.c2_start_day || '16', 10), end: parseInt(r.c2_end_day || '31', 10) }
  };
}

export function daysInMonth(periodMonth) {
  const [y, m] = periodMonth.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * The SFA feedback lands on the 15th, so that is the natural "as on" date for a C1
 * review. For C2 — and for a whole-month view — the month end is the default.
 */
export function defaultAsOnDate(periodMonth, cycleCode, windows) {
  const dim = daysInMonth(periodMonth);
  const day = cycleCode === 'C1'
    ? Math.min(windows.C1.end, dim)
    : dim;
  return `${periodMonth}-${String(day).padStart(2, '0')}`;
}

/**
 * How much of a cycle has elapsed as of the as-on date, as a 0..1 fraction.
 *
 *   before the cycle opens          → 0
 *   on or after the cycle's last day → 1
 *   part way through                 → elapsed days ÷ cycle length
 */
export function cycleElapsedFraction(cycleCode, asOnDate, periodMonth, windows) {
  const dim  = daysInMonth(periodMonth);
  const win  = windows[cycleCode] || windows.C1;
  const start = win.start;
  const end   = Math.min(win.end, dim);
  const length = end - start + 1;
  if (length <= 0) return 0;

  const asOnMonth = String(asOnDate).slice(0, 7);
  let day;
  if (asOnMonth < periodMonth) day = 0;
  else if (asOnMonth > periodMonth) day = dim;
  else day = parseInt(String(asOnDate).slice(8, 10), 10);

  const elapsed = day - start + 1;
  if (elapsed <= 0) return 0;
  if (elapsed >= length) return 1;
  return elapsed / length;
}

/** The date range a cycle's visits may fall in, clipped to the as-on date. */
function cycleWindowDates(cycleCode, asOnDate, periodMonth, windows) {
  const dim = daysInMonth(periodMonth);
  const win = windows[cycleCode] || windows.C1;
  const from = `${periodMonth}-${String(win.start).padStart(2, '0')}`;
  const lastDay = Math.min(win.end, dim);
  const cycleEnd = `${periodMonth}-${String(lastDay).padStart(2, '0')}`;
  const to = asOnDate < cycleEnd ? asOnDate : cycleEnd;
  return { from, to };
}

// ─────────────────────────────────────────────────────────────────────────────
// dealer identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * customer_code → canonical SAP code.
 *
 * Accepts the SAP code, the SFA code or the RSSD code, because the SFA export is not
 * consistent about which it sends. Returns a Map plus the name, so an unresolved code
 * can be reported with something a human recognises.
 */
export async function buildDealerCodeIndex() {
  const rows = await dbAll(
    `SELECT sap_code, sfa_code, rssd_code, dealer_name FROM master_dealers`
  ).catch(async () => dbAll(`SELECT sap_code, sfa_code, dealer_name FROM master_dealers`));

  const index = new Map();
  for (const d of rows) {
    const canonical = norm(d.sap_code) || norm(d.sfa_code);
    if (!canonical) continue;
    for (const c of [d.sap_code, d.sfa_code, d.rssd_code]) {
      const k = key(c);
      if (k && !index.has(k)) index.set(k, { canonical, name: d.dealer_name });
    }
  }
  return index;
}

// ─────────────────────────────────────────────────────────────────────────────
// the analysis
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} opts
 * @param {string} opts.periodMonth  'YYYY-MM'
 * @param {string} [opts.cycleCode]  'C1' | 'C2'; omit for both
 * @param {string} [opts.asOnDate]   'YYYY-MM-DD'; defaults to the 15th for C1, month end otherwise
 * @param {boolean} [opts.productiveOnly]  count only Productive visits (default false — the
 *                                          client's COUNTIFS does not filter on status)
 */
export async function analyseAdherence(opts = {}) {
  const periodMonth = opts.periodMonth;
  if (!/^\d{4}-\d{2}$/.test(String(periodMonth || ''))) {
    throw new Error(`periodMonth must be YYYY-MM, received '${periodMonth}'`);
  }

  const windows = await loadCycleWindows();
  const cycles  = opts.cycleCode ? [String(opts.cycleCode).toUpperCase()] : ['C1', 'C2'];
  const asOnDate = opts.asOnDate || defaultAsOnDate(periodMonth, cycles[0], windows);
  const productiveOnly = !!opts.productiveOnly;

  // ── 1. planned visits, per role, from the plans themselves ────────────────
  const planned = await dbAll(
    `SELECT
       sp.id            AS plan_id,
       sp.emp_code, sp.emp_name,
       COALESCE(NULLIF(TRIM(sp.emp_role), ''), 'SO') AS emp_role,
       sp.cycle_code, sp.status,
       spd.visit_date, spd.dealer_sap_code, spd.dealer_name, spd.dealer_id
     FROM sales_plan_details spd
     JOIN sales_plans sp ON sp.id = spd.plan_id
     WHERE sp.period_month = ?
       AND sp.cycle_code IN (${cycles.map(() => '?').join(',')})
     ORDER BY sp.emp_code, spd.visit_date`,
    [periodMonth, ...cycles]
  );

  // ── 2. actual visits ──────────────────────────────────────────────────────
  const ranges = cycles.map(c => cycleWindowDates(c, asOnDate, periodMonth, windows));
  const from = ranges.reduce((a, r) => (a && a < r.from ? a : r.from), null);
  const to   = ranges.reduce((a, r) => (a && a > r.to ? a : r.to), null);

  const logs = await dbAll(
    `SELECT employee_code, employee_name, customer_code, customer_name, visit_date, visit_status
     FROM visit_execution_logs
     WHERE visit_date >= ? AND visit_date <= ?`,
    [from, to]
  );

  // ── 3. resolve dealer identity on the log side ────────────────────────────
  const dealerIndex = await buildDealerCodeIndex();
  const unresolvedLogs = [];
  const resolvedLogs = [];

  for (const l of logs) {
    if (productiveOnly && !/^productive$/i.test(norm(l.visit_status))) continue;
    const hit = dealerIndex.get(key(l.customer_code));
    if (!hit) {
      unresolvedLogs.push({
        employee_code: l.employee_code, employee_name: l.employee_name,
        customer_code: l.customer_code, customer_name: l.customer_name,
        visit_date: String(l.visit_date).slice(0, 10)
      });
      continue;
    }
    resolvedLogs.push({
      ...l,
      visit_date: String(l.visit_date).slice(0, 10),
      canonical_code: hit.canonical,
      resolved_from: key(l.customer_code) === key(hit.canonical) ? 'SAP' : 'SFA'
    });
  }

  // Index actual visits by employee identity + dealer. The client matches the employee
  // on NAME; our plans carry a code. Accept either, so a log that only has one still lands.
  const actual = new Map();   // "empKey|dealer" -> { rows: [], dates: Set }
  const addActual = (empKey, dealer, row) => {
    if (!empKey || !dealer) return;
    const k = `${empKey}|${dealer}`;
    if (!actual.has(k)) actual.set(k, { rows: [], dates: new Set() });
    const e = actual.get(k);
    e.rows.push(row);
    e.dates.add(row.visit_date);
  };
  for (const l of resolvedLogs) {
    addActual(key(l.employee_code), key(l.canonical_code), l);
    addActual(key(l.employee_name), key(l.canonical_code), l);
  }

  // ── 4. fold the plan down to one row per (cycle, role, employee, dealer) ──
  const dealerRows = new Map();
  for (const p of planned) {
    const dealer = key(p.dealer_sap_code);
    if (!dealer) continue;
    const k = `${p.cycle_code}|${p.emp_role}|${key(p.emp_code)}|${dealer}`;
    if (!dealerRows.has(k)) {
      dealerRows.set(k, {
        cycle_code: p.cycle_code,
        role: p.emp_role,
        emp_code: p.emp_code,
        emp_name: p.emp_name,
        dealer_sap_code: norm(p.dealer_sap_code),
        dealer_name: p.dealer_name,
        dealer_id: p.dealer_id,
        planned: 0,
        planned_dates: []
      });
    }
    const row = dealerRows.get(k);
    row.planned += 1;                                   // every plan line is one planned visit
    row.planned_dates.push(String(p.visit_date).slice(0, 10));
  }

  // ── 5. score each row ─────────────────────────────────────────────────────
  const fractions = {};
  for (const c of cycles) fractions[c] = cycleElapsedFraction(c, asOnDate, periodMonth, windows);

  const byDealer = [];
  for (const row of dealerRows.values()) {
    const fraction   = fractions[row.cycle_code] ?? 1;
    const mtdPlanned = row.planned * fraction;

    const hit = actual.get(`${key(row.emp_code)}|${key(row.dealer_sap_code)}`)
             || actual.get(`${key(row.emp_name)}|${key(row.dealer_sap_code)}`);

    const adheredRaw    = hit ? hit.rows.length : 0;
    const adheredDays   = hit ? hit.dates.size  : 0;
    const adheredCapped = Math.min(adheredRaw, row.planned);

    // Adhered ÷ MTD Due, falling back to the full plan when MTD Due rounds below 1.
    const denominator = mtdPlanned < 1 ? row.planned : mtdPlanned;
    const pct = denominator > 0 ? adheredRaw / denominator : 0;
    const pctCapped = denominator > 0 ? adheredCapped / denominator : 0;

    byDealer.push({
      ...row,
      planned_dates: [...new Set(row.planned_dates)].sort(),
      mtd_planned: mtdPlanned,
      adhered: adheredRaw,
      adhered_capped: adheredCapped,
      adhered_days: adheredDays,
      adherence_pct: pct,
      adherence_pct_capped: pctCapped,
      pending: mtdPlanned - adheredRaw,
      visited: adheredRaw > 0,
      visit_dates: hit ? [...hit.dates].sort() : []
    });
  }

  // ── 6. roll up ────────────────────────────────────────────────────────────
  const rollup = (rows) => {
    const planned      = rows.reduce((s, r) => s + r.planned, 0);
    const mtdPlanned   = rows.reduce((s, r) => s + r.mtd_planned, 0);
    const adhered      = rows.reduce((s, r) => s + r.adhered, 0);
    const adheredCap   = rows.reduce((s, r) => s + r.adhered_capped, 0);
    const denominator  = mtdPlanned < 1 ? planned : mtdPlanned;
    return {
      dealers: rows.length,
      dealers_visited: rows.filter(r => r.visited).length,
      dealers_missed:  rows.filter(r => !r.visited).length,
      planned,
      mtd_planned: mtdPlanned,
      adhered,
      adhered_capped: adheredCap,
      adherence_pct:        denominator > 0 ? adhered / denominator : 0,
      adherence_pct_capped: denominator > 0 ? adheredCap / denominator : 0,
      pending: mtdPlanned - adhered,
      coverage_pct: rows.length > 0 ? rows.filter(r => r.visited).length / rows.length : 0
    };
  };

  const group = (rows, keyFn) => {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  };

  const byEmployee = [...group(byDealer, r => `${r.role}|${key(r.emp_code)}`).entries()]
    .map(([, rows]) => ({
      emp_code: rows[0].emp_code,
      emp_name: rows[0].emp_name,
      role: rows[0].role,
      cycles: [...new Set(rows.map(r => r.cycle_code))].sort(),
      ...rollup(rows),
      missed_dealers: rows.filter(r => !r.visited)
        .map(r => ({ sap_code: r.dealer_sap_code, name: r.dealer_name, planned_dates: r.planned_dates }))
    }))
    .sort((a, b) => a.adherence_pct - b.adherence_pct);

  const byRole = Object.fromEntries(
    ROLES.map(role => [role, rollup(byDealer.filter(r => r.role === role))])
         .filter(([, v]) => v.dealers > 0)
  );

  const byCycle = Object.fromEntries(
    cycles.map(c => [c, { ...rollup(byDealer.filter(r => r.cycle_code === c)), elapsed_fraction: fractions[c] }])
  );

  // ── 7. diagnostics ────────────────────────────────────────────────────────
  const plannedPairs = new Set(byDealer.map(r => `${key(r.emp_code)}|${key(r.dealer_sap_code)}`));
  const plannedNames = new Set(byDealer.map(r => `${key(r.emp_name)}|${key(r.dealer_sap_code)}`));
  const unplannedVisits = resolvedLogs.filter(l => {
    const a = `${key(l.employee_code)}|${key(l.canonical_code)}`;
    const b = `${key(l.employee_name)}|${key(l.canonical_code)}`;
    return !plannedPairs.has(a) && !plannedNames.has(b);
  });

  const sfaCodedVisits = resolvedLogs.filter(l => l.resolved_from === 'SFA');

  const totals = rollup(byDealer);

  console.log(
    `[SFA_ADHERENCE] ${periodMonth} ${cycles.join('+')} as on ${asOnDate} — ` +
    `planned ${totals.planned}, MTD due ${totals.mtd_planned.toFixed(1)}, ` +
    `adhered ${totals.adhered} (capped ${totals.adhered_capped}), ` +
    `${(totals.adherence_pct_capped * 100).toFixed(1)}% capped / ${(totals.adherence_pct * 100).toFixed(1)}% raw`
  );
  if (unresolvedLogs.length > 0) {
    console.warn(`[SFA_ADHERENCE] ${unresolvedLogs.length} logged visit(s) have a customer code that matches no dealer.`);
  }

  return {
    periodMonth,
    cycles,
    asOnDate,
    windows,
    elapsedFraction: fractions,
    totals,
    byCycle,
    byRole,
    byEmployee,
    byDealer,
    diagnostics: {
      sfa_visits_in_window: logs.length,
      resolved_visits: resolvedLogs.length,
      resolved_via_sfa_code: sfaCodedVisits.length,
      unresolved_visits: unresolvedLogs.length,
      unresolved_detail: unresolvedLogs.slice(0, 100),
      unplanned_visits: unplannedVisits.length,
      unplanned_detail: unplannedVisits.slice(0, 100).map(l => ({
        employee_code: l.employee_code, employee_name: l.employee_name,
        customer_code: l.customer_code, canonical_code: l.canonical_code,
        customer_name: l.customer_name, visit_date: l.visit_date
      }))
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backwards-compatible C1 wrapper
//
// regenerateC2Plans and AutoPlanGenerator consume the older shape — a byEmployee Map
// of { completed, missed } records. That contract is preserved exactly so C2
// regeneration keeps working, while the richer analysis above is available alongside it
// on the returned object as `detail`.
// ─────────────────────────────────────────────────────────────────────────────
export async function analyseC1Adherence(periodMonth, options = {}) {
  const result = await analyseAdherence({ ...options, periodMonth, cycleCode: 'C1' });

  const byEmployee = new Map();
  const completedDealers = [];
  const missedDealers = [];

  for (const r of result.byDealer) {
    const record = {
      emp_code: r.emp_code,
      emp_name: r.emp_name,
      dealer_sap_code: r.dealer_sap_code,
      dealer_name: r.dealer_name,
      dealer_id: r.dealer_id,
      planned_date: r.planned_dates[0] || null
    };
    const empKey = key(r.emp_code);
    if (!byEmployee.has(empKey)) byEmployee.set(empKey, { completed: [], missed: [] });

    if (r.visited) {
      completedDealers.push(record);
      byEmployee.get(empKey).completed.push(record);
    } else {
      missedDealers.push(record);
      byEmployee.get(empKey).missed.push(record);
    }
  }

  return {
    periodMonth,
    asOnDate: result.asOnDate,
    byEmployee,
    completedDealers,
    missedDealers,
    plannedCount:   result.totals.planned,
    completedCount: completedDealers.length,
    missedCount:    missedDealers.length,
    // Reported the way the client computes it: capped adhered ÷ MTD due.
    adherencePct:   Math.round(result.totals.adherence_pct_capped * 100),
    detail: result
  };
}

/**
 * Build a Set of dealer SAP codes that were already visited in C1
 * for a specific employee. Used by AutoPlanGenerator during C2 regen.
 *
 * @param {Map} adherenceByEmployee - byEmployee map from analyseC1Adherence()
 * @param {string} empCode
 * @returns {{ visitedDealerCodes: Set<string>, missedDealerCodes: Set<string> }}
 */
export function getAdherenceForEmployee(adherenceByEmployee, empCode) {
  const empKey = key(empCode);
  const data   = adherenceByEmployee.get(empKey) || { completed: [], missed: [] };

  const visitedDealerCodes = new Set(
    data.completed.map(d => key(d.dealer_sap_code || d.dealer_name))
  );
  const missedDealerCodes = new Set(
    data.missed.map(d => key(d.dealer_sap_code || d.dealer_name))
  );

  return { visitedDealerCodes, missedDealerCodes };
}
