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
const normName = v => key(v).replace(/\s+\(/g, '(').replace(/[,.-]+/g, ' ').replace(/\s+/g, ' ').trim();
const baseName = v => {
  let s = key(v).replace(/\([^)]*\)/g, '').replace(/[,.-]+/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(STORE|STORES|ENTERPRISE|ENTERPRISES|TRADERS|TRADER|HARDWARE|CEMENT|IRON|STEEL|AGENCY|AGENCIES|CORP|CORPORATION|CO|COMPANY|PVT|LTD|ASSOCIATES)\b/g, '').replace(/\s+/g, ' ').trim();
  return s;
};

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
  const index = new Map();
  
  // 1. Target mapping (most accurate for the month)
  const targetRows = await dbAll(`SELECT sap_code, sfa_code, dealer_name FROM dealer_visit_targets`).catch(() => []);
  for (const d of targetRows) {
    const canonical = norm(d.sap_code) || norm(d.sfa_code);
    if (!canonical) continue;
    for (const c of [d.sap_code, d.sfa_code]) {
      const k = key(c);
      if (k && !index.has(k)) index.set(k, { canonical, name: d.dealer_name });
    }
    if (d.dealer_name) {
      if (!index.has(key(d.dealer_name))) index.set(key(d.dealer_name), { canonical, name: d.dealer_name });
      if (!index.has(normName(d.dealer_name))) index.set(normName(d.dealer_name), { canonical, name: d.dealer_name });
    }
  }

  // 2. Master fallback
  const rows = await dbAll(
    `SELECT sap_code, sfa_code, rssd_code, dealer_name FROM master_dealers`
  ).catch(async () => dbAll(`SELECT sap_code, sfa_code, dealer_name FROM master_dealers`));

  for (const d of rows) {
    const canonical = norm(d.sap_code) || norm(d.sfa_code);
    if (!canonical) continue;
    for (const c of [d.sap_code, d.sfa_code, d.rssd_code]) {
      const k = key(c);
      if (k && !index.has(k)) index.set(k, { canonical, name: d.dealer_name });
    }
    if (d.dealer_name) {
      if (!index.has(key(d.dealer_name))) index.set(key(d.dealer_name), { canonical, name: d.dealer_name });
      if (!index.has(normName(d.dealer_name))) index.set(normName(d.dealer_name), { canonical, name: d.dealer_name });
    }
    const codeInName = String(d.dealer_name || '').match(/\((RSS[BD]?\w+|SDNE\w+|\d{6,}|[A-Z0-9_-]{4,})\)/i);
    if (codeInName && !index.has(key(codeInName[1]))) {
      index.set(key(codeInName[1]), { canonical, name: d.dealer_name });
    }
  }

  // 3. Mapping table fallback
  const mapRows = await dbAll(
    `SELECT sap_code, linked_dealer_code, dealer_name FROM master_dealer_so_mapping`
  ).catch(() => []);
  for (const m of mapRows) {
    const canonical = norm(m.sap_code) || norm(m.linked_dealer_code);
    if (!canonical) continue;
    if (m.sap_code && !index.has(key(m.sap_code))) {
      index.set(key(m.sap_code), { canonical, name: m.dealer_name });
    }
    if (m.linked_dealer_code && !index.has(key(m.linked_dealer_code))) {
      index.set(key(m.linked_dealer_code), { canonical, name: m.dealer_name });
    }
    if (m.dealer_name) {
      if (!index.has(key(m.dealer_name))) index.set(key(m.dealer_name), { canonical, name: m.dealer_name });
      if (!index.has(normName(m.dealer_name))) index.set(normName(m.dealer_name), { canonical, name: m.dealer_name });
    }
  }

  // 4. Sales plan details fallback
  const planRows = await dbAll(
    `SELECT DISTINCT dealer_sap_code, dealer_name FROM sales_plan_details WHERE dealer_sap_code IS NOT NULL AND dealer_sap_code != ''`
  ).catch(() => []);
  for (const p of planRows) {
    const canonical = norm(p.dealer_sap_code);
    if (!canonical) continue;
    if (!index.has(key(canonical))) index.set(key(canonical), { canonical, name: p.dealer_name });
    if (p.dealer_name) {
      if (!index.has(key(p.dealer_name))) index.set(key(p.dealer_name), { canonical, name: p.dealer_name });
      if (!index.has(normName(p.dealer_name))) index.set(normName(p.dealer_name), { canonical, name: p.dealer_name });
    }
  }

  // 4. Coordinate cross-reference (links SFA DNS customer codes to SAP customer codes)
  const coordRows = await dbAll(
    `SELECT dns_customer_code, customer_code, display_code, customer_name FROM master_customer_coordinates`
  ).catch(() => []);
  for (const c of coordRows) {
    const sapHit = index.get(key(c.customer_code)) || index.get(key(c.dns_customer_code)) || index.get(key(c.display_code));
    if (sapHit) {
      if (c.dns_customer_code && !index.has(key(c.dns_customer_code))) index.set(key(c.dns_customer_code), sapHit);
      if (c.customer_code && !index.has(key(c.customer_code))) index.set(key(c.customer_code), sapHit);
      if (c.display_code && !index.has(key(c.display_code))) index.set(key(c.display_code), sapHit);
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
  let periodMonth = opts.periodMonth;
  if (!/^\d{4}-\d{2}$/.test(String(periodMonth || ''))) {
    periodMonth = '2026-10';
  }

  // Safety fallback: if requested period has no plans in DB, fall back to latest active period with plans (e.g. 2026-10)
  const planCheck = await dbGet('SELECT COUNT(*) as cnt FROM sales_plans WHERE period_month = ?', [periodMonth]).catch(() => ({ cnt: 0 }));
  if (!planCheck || planCheck.cnt === 0) {
    const latest = await dbGet('SELECT period_month FROM sales_plans WHERE period_month IS NOT NULL ORDER BY period_month DESC LIMIT 1').catch(() => null);
    periodMonth = (latest && latest.period_month) ? latest.period_month : '2026-10';
  }

  const windows = await loadCycleWindows();
  const cleanCycle = String(opts.cycleCode || '').trim();
  const isBothCycles = !cleanCycle || cleanCycle.toUpperCase() === 'ALL' || cleanCycle.includes('Object') || !['C1', 'C2'].includes(cleanCycle.toUpperCase()) || cleanCycle === 'Whole_Month' || cleanCycle === 'WHOLE_MONTH' || cleanCycle === 'BOTH' || cleanCycle === 'C1_C2' || cleanCycle === 'COMBINED';
  const cycles  = isBothCycles ? ['C1', 'C2'] : [cleanCycle.toUpperCase()];
  let asOnDate = opts.asOnDate;
  if (asOnDate && !String(asOnDate).startsWith(periodMonth)) {
    asOnDate = null;
  }
  if (!asOnDate) {
    asOnDate = isBothCycles ? defaultAsOnDate(periodMonth, 'C2', windows) : defaultAsOnDate(periodMonth, cycles[0], windows);
  }
  const productiveOnly = !!opts.productiveOnly;

  // ── 1. planned visits, per role, from the plans themselves ────────────────
  const planned = await dbAll(
    `SELECT
       sp.id            AS plan_id,
       sp.emp_code, sp.emp_name,
       COALESCE(NULLIF(TRIM(sp.emp_role), ''), 'SO') AS emp_role,
       sp.cycle_code, sp.status,
       spd.visit_date, spd.dealer_sap_code, spd.dealer_name, spd.dealer_id,
       spd.dealer_type, spd.purpose_of_visit
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
    let hit = dealerIndex.get(key(l.customer_code));
    if (!hit && l.customer_name) {
      const match = String(l.customer_name).match(/\((RSS[BD]?\w+|SDNE\w+|\d{6,}|[A-Z0-9_-]{4,})\)/i);
      if (match) hit = dealerIndex.get(key(match[1]));
      if (!hit) hit = dealerIndex.get(key(l.customer_name));
      if (!hit) hit = dealerIndex.get(normName(l.customer_name));
    }
    if (!hit) {
      unresolvedLogs.push({
        employee_code: l.employee_code, employee_name: l.employee_name,
        customer_code: l.customer_code, customer_name: l.customer_name,
        visit_date: String(l.visit_date).slice(0, 10)
      });
      // Retain unmapped log so employee visits can still be matched by code or name
      resolvedLogs.push({
        ...l,
        visit_date: String(l.visit_date).slice(0, 10),
        canonical_code: norm(l.customer_code),
        resolved_from: 'SFA_UNMAPPED'
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
  const addActual = (empKey, dealerKey, row) => {
    if (!empKey || !dealerKey) return;
    const k = `${empKey}|${dealerKey}`;
    if (!actual.has(k)) actual.set(k, { rows: [], dates: new Set() });
    const e = actual.get(k);
    e.rows.push(row);
    e.dates.add(row.visit_date);
  };
  for (const l of resolvedLogs) {
    if (l.canonical_code) {
      addActual(key(l.employee_code), key(l.canonical_code), l);
      addActual(key(l.employee_name), key(l.canonical_code), l);
    }
    if (l.customer_code) {
      addActual(key(l.employee_code), key(l.customer_code), l);
      addActual(key(l.employee_name), key(l.customer_code), l);
    }
    if (l.customer_name) {
      addActual(key(l.employee_code), key(l.customer_name), l);
      addActual(key(l.employee_name), key(l.customer_name), l);
      addActual(key(l.employee_code), normName(l.customer_name), l);
      addActual(key(l.employee_name), normName(l.customer_name), l);
    }
  }

  // Look up area, zone and category (dealer_status) for dealers
  const masterRows = await dbAll(
    `SELECT id, dealer_id, sap_code, sfa_code, rssd_code, dealer_name, dealer_type, counter_strategy, area, zone FROM master_dealers`
  ).catch(() => []);
  const dimRows = await dbAll(
    `SELECT id, dealer_id, dealer_name, sap_code, sfa_code, area, zone, dealer_status, category, period_month,
            cycle_code, cust_type, so_name, so_emp_code, so_visits, asm_name, asm_code, asm_visits,
            rsm_name, rsm_code, rsm_visits, zh_name, zh_code, zh_visits
     FROM dealer_visit_targets 
     ORDER BY (period_month = ?) ASC, period_month ASC, id ASC`,
    [periodMonth]
  ).catch(() => []);
  const empMasterRows = await dbAll(
    `SELECT emp_code, dns_emp_code, emp_name, zone FROM employee_master`
  ).catch(() => []);

  const empZoneMap = new Map();
  for (const e of empMasterRows) {
    const z = (e.zone || '').trim();
    if (e.emp_code) empZoneMap.set(key(e.emp_code), z);
    if (e.dns_emp_code) empZoneMap.set(key(e.dns_emp_code), z);
    if (e.emp_name) empZoneMap.set(key(e.emp_name), z);
  }

  const dealerDims = new Map();
  const indexDim = (kStr, val) => {
    if (!kStr) return;
    const k = key(kStr);
    if (!k) return;
    const existing = dealerDims.get(k);
    if (!existing) {
      dealerDims.set(k, { ...val });
    } else {
      const valCat = val.category;
      const exCat = existing.category;
      const valIsSpecific = valCat && valCat !== 'Other' && valCat !== 'New / Other' && valCat !== 'Growing';
      const exIsSpecific = exCat && exCat !== 'Other' && exCat !== 'New / Other' && exCat !== 'Growing';

      let chosenCat = exCat || valCat || 'Growing';
      if (val.isCurrentPeriod && valCat && valCat !== 'Other' && valCat !== 'New / Other') {
        chosenCat = valCat;
      } else if (!existing.isCurrentPeriod && valIsSpecific) {
        chosenCat = valCat;
      } else if (!exIsSpecific && valIsSpecific) {
        chosenCat = valCat;
      }

      dealerDims.set(k, {
        sap_code: (val.isCurrentPeriod ? val.sap_code : '') || existing.sap_code || val.sap_code || '',
        sfa_code: (val.isCurrentPeriod ? val.sfa_code : '') || existing.sfa_code || val.sfa_code || '',
        area: (val.isCurrentPeriod ? val.area : '') || existing.area || val.area || '',
        zone: (val.isCurrentPeriod ? val.zone : '') || existing.zone || val.zone || '',
        category: chosenCat,
        dealer_name: (val.isCurrentPeriod && val.dealer_name) ? val.dealer_name : (existing.dealer_name || val.dealer_name || ''),
        dealer_type: val.dealer_type || existing.dealer_type || '',
        isCurrentPeriod: Boolean(existing.isCurrentPeriod || val.isCurrentPeriod)
      });
    }
  };

  for (const m of masterRows) {
    const sap = norm(m.sap_code);
    const sfa = norm(m.sfa_code);
    const isProspect = (m.dealer_type === 'PROSPECTIVE' || m.counter_strategy === 'PROSPECT' || sap.startsWith('NS') || sfa.startsWith('NS'));
    const val = {
      sap_code: sap,
      sfa_code: sfa,
      area: m.area || '',
      zone: m.zone || '',
      category: isProspect ? 'Prospective' : 'Growing',
      dealer_name: m.dealer_name || '',
      dealer_type: m.dealer_type || '',
      isCurrentPeriod: false
    };
    if (sap) indexDim(sap, val);
    if (sfa) indexDim(sfa, val);
    if (m.rssd_code) indexDim(m.rssd_code, val);
    if (m.dealer_name) {
      indexDim(m.dealer_name, val);
      indexDim(normName(m.dealer_name), val);
      const codeInName = String(m.dealer_name).match(/\((RSS[BD]?\w+|SD[A-Z0-9]+|[A-Z0-9_-]{4,})\)/i);
      if (codeInName) indexDim(codeInName[1], val);
    }
    if (m.id) {
      indexDim(String(m.id), val);
      indexDim(`dlr_${m.id}`, val);
    }
    if (m.dealer_id) indexDim(m.dealer_id, val);
  }

  for (const d of dimRows) {
    let cat = d.dealer_status || d.category || 'Growing';
    if (cat === 'Other' || cat === 'New / Other') cat = 'Growing';
    const sap = norm(d.sap_code);
    const sfa = norm(d.sfa_code);
    const val = {
      sap_code: sap,
      sfa_code: sfa,
      area: d.area || '',
      zone: d.zone || '',
      category: cat,
      dealer_name: d.dealer_name || '',
      dealer_type: d.cust_type || '',
      isCurrentPeriod: d.period_month === periodMonth
    };
    if (sap) indexDim(sap, val);
    if (sfa) indexDim(sfa, val);
    if (d.dealer_name) {
      indexDim(d.dealer_name, val);
      indexDim(normName(d.dealer_name), val);
      const codeInName = String(d.dealer_name).match(/\((RSS[BD]?\w+|SD[A-Z0-9]+|[A-Z0-9_-]{4,})\)/i);
      if (codeInName) indexDim(codeInName[1], val);
    }
    if (d.id) {
      indexDim(String(d.id), val);
      indexDim(`dlr_${d.id}`, val);
    }
    if (d.dealer_id) indexDim(d.dealer_id, val);
  }

  // ── 4. fold the plan down to one row per (cycle, role, employee, dealer) ──
  const dealerRows = new Map();
  for (const p of planned) {
    const rawSap = norm(p.dealer_sap_code);
    const isDummySap = !rawSap || rawSap.startsWith('C/') || rawSap.startsWith('DLR_') || rawSap.startsWith('PR-') || rawSap.startsWith('NS-DLR-');
    const codeInName = String(p.dealer_name || '').match(/\((RSS[BD]?\w+|SD[A-Z0-9]+|[A-Z0-9_-]{4,})\)/i);

    // Multi-tier dim lookup
    const dim = (!isDummySap && dealerDims.get(key(rawSap)))
             || (p.dealer_name && dealerDims.get(key(p.dealer_name)))
             || (codeInName && dealerDims.get(key(codeInName[1])))
             || (p.dealer_name && dealerDims.get(normName(p.dealer_name)))
             || (p.dealer_id && dealerDims.get(String(p.dealer_id)))
             || (p.dealer_id && dealerDims.get(`dlr_${p.dealer_id}`))
             || (rawSap && dealerDims.get(key(rawSap)))
             || {};

    // Canonical dealer identifier for grouping — always deterministic per dealer, never per visit row
    let canonicalDealer = (!isDummySap ? rawSap : '') || dim.sap_code || dim.sfa_code || (codeInName ? codeInName[1] : '') || normName(p.dealer_name) || p.dealer_name || (p.dealer_id ? `dlr_${p.dealer_id}` : 'dealer');
    canonicalDealer = key(canonicalDealer);

    const k = `${p.cycle_code}|${p.emp_role}|${key(p.emp_code)}|${canonicalDealer}`;
    if (!dealerRows.has(k)) {
      const empZone = empZoneMap.get(key(p.emp_code)) || empZoneMap.get(key(p.emp_name)) || '';
      const zone = dim.zone || empZone || '';

      // Resolve clean SAP code
      let sapCode = (!isDummySap) ? rawSap : (dim.sap_code || '');
      if (!sapCode && dim.sfa_code) sapCode = dim.sfa_code;
      if (!sapCode && codeInName) sapCode = codeInName[1];
      if (!sapCode && p.dealer_name) sapCode = `NS-${normName(p.dealer_name).replace(/[^A-Z0-9]+/g, '-').slice(0, 20)}`;
      if (!sapCode && p.dealer_id) sapCode = `NS-DLR-${p.dealer_id}`;
      if (!sapCode) sapCode = canonicalDealer;

      let sfaCode = dim.sfa_code || (codeInName ? codeInName[1] : '');

      // Resolve category — NEVER return 'Other'
      let category = dim.category;
      if (!category || category === 'Other' || category === 'New / Other') {
        const isProspect = p.dealer_type === 'PROSPECTIVE' || p.dealer_type === 'NON STAR' ||
                           String(p.purpose_of_visit).toUpperCase().includes('PROSPECT') ||
                           String(sapCode).startsWith('NS') || String(sapCode).startsWith('PR-');
        category = isProspect ? 'Prospective' : 'Growing';
      }

      dealerRows.set(k, {
        cycle_code: p.cycle_code,
        role: p.emp_role,
        emp_code: p.emp_code,
        emp_name: p.emp_name,
        dealer_sap_code: sapCode,
        sap_code: sapCode,
        sfa_code: sfaCode,
        dealer_name: dim.dealer_name || p.dealer_name || 'Dealer',
        dealer_id: p.dealer_id,
        category: category,
        area: dim.area || '',
        zone: zone,
        emp_zone: empZone || zone,
        planned: 0,
        planned_dates: []
      });
    }
    const row = dealerRows.get(k);
    row.planned += 1;                                   // every plan line is one planned visit
    row.planned_dates.push(String(p.visit_date).slice(0, 10));
  }

  // ── 4b. include assigned target dealers omitted by daily capacity caps ──
  // Plans generated with a strict daily capacity cap (e.g. 8/day) omit overflow
  // customers from sales_plan_details even though they are active targets in
  // dealer_visit_targets. Include those missing target dealers for active officers
  // so every officer's full customer roster appears in adherence.
  const officerRegistry = new Map();
  const empCodeLookup = new Map();
  for (const p of planned) {
    const r = key(p.emp_role);
    const eKey = `${r}|${key(p.emp_name)}`;
    if (!officerRegistry.has(eKey)) {
      officerRegistry.set(eKey, {
        emp_code: p.emp_code,
        emp_name: p.emp_name,
        role: p.emp_role,
        cycles: new Set()
      });
    }
    officerRegistry.get(eKey).cycles.add(p.cycle_code);
    if (p.emp_code) empCodeLookup.set(`${r}|${key(p.emp_code)}`, eKey);
  }

  const existingOfficerDealers = new Set();
  for (const row of dealerRows.values()) {
    const r = key(row.role);
    const emp = key(row.emp_code);
    if (row.dealer_sap_code) existingOfficerDealers.add(`${row.cycle_code}|${r}|${emp}|${key(row.dealer_sap_code)}`);
    if (row.sfa_code) existingOfficerDealers.add(`${row.cycle_code}|${r}|${emp}|${key(row.sfa_code)}`);
    if (row.dealer_name) existingOfficerDealers.add(`${row.cycle_code}|${r}|${emp}|${normName(row.dealer_name)}`);
  }

  for (const d of dimRows) {
    if (d.period_month !== periodMonth) continue;
    const cyc = key(d.cycle_code || 'C1');
    if (!cycles.includes(cyc)) continue;

    const sap = norm(d.sap_code);
    const sfa = norm(d.sfa_code);
    const rawName = norm(d.dealer_name);
    const canonicalCode = sap || sfa || normName(rawName);
    if (!canonicalCode) continue;

    const custType = key(d.cust_type);
    const isDirectOrNonStar = !custType || custType === 'DEALER' || custType === 'NON STAR' || custType === 'NON-STAR' || custType === 'NON_STAR' || custType === 'PROSPECTIVE' || sap.startsWith('100');
    const isDirectDealer = custType === 'DEALER' || sap.startsWith('100');

    const roleChecks = [
      { role: 'SO',  empCode: d.so_emp_code, empName: d.so_name,  visits: Number(d.so_visits  || 0), allowed: Number(d.so_visits  || 0) > 0 },
      { role: 'ASM', empCode: d.asm_code,    empName: d.asm_name, visits: Number(d.asm_visits || 0), allowed: isDirectOrNonStar && Number(d.asm_visits || 0) > 0 },
      { role: 'RSM', empCode: d.rsm_code,    empName: d.rsm_name, visits: Number(d.rsm_visits || 0), allowed: isDirectDealer && Number(d.rsm_visits || 0) >= 1 }
    ];

    for (const rc of roleChecks) {
      if (!rc.allowed || (!rc.empCode && !rc.empName)) continue;
      const eKey = (rc.empCode && empCodeLookup.get(`${rc.role}|${key(rc.empCode)}`)) || (rc.empName && `${rc.role}|${key(rc.empName)}`);
      const off = eKey ? officerRegistry.get(eKey) : null;
      if (!off || !off.cycles.has(cyc)) continue;

      const empCode = off.emp_code;
      const empK = key(empCode);
      const alreadyPresent = existingOfficerDealers.has(`${cyc}|${rc.role}|${empK}|${key(canonicalCode)}`)
                          || (sfa && existingOfficerDealers.has(`${cyc}|${rc.role}|${empK}|${key(sfa)}`))
                          || (rawName && existingOfficerDealers.has(`${cyc}|${rc.role}|${empK}|${normName(rawName)}`));
      if (alreadyPresent) continue;

      const dim = dealerDims.get(key(canonicalCode)) || (rawName ? dealerDims.get(normName(rawName)) : null) || {};
      const sapCode = dim.sap_code || sap || sfa || `NS-${normName(rawName).replace(/[^A-Z0-9]+/g, '-').slice(0, 20)}`;
      const sfaCode = dim.sfa_code || sfa || '';
      const rowKey = `${cyc}|${off.role}|${empK}|${key(sapCode)}`;
      if (dealerRows.has(rowKey)) continue;

      let cat = d.dealer_status || d.category || dim.category || 'Growing';
      if (cat === 'Other' || cat === 'New / Other') {
        cat = (custType === 'NON STAR' || custType === 'PROSPECTIVE' || sapCode.startsWith('NS')) ? 'Prospective' : 'Growing';
      }

      const empZone = empZoneMap.get(empK) || empZoneMap.get(key(off.emp_name)) || '';
      const zone = d.zone || dim.zone || empZone || '';
      const freq = rc.visits;
      const cycPlanned = freq >= 2 ? (Math.floor(freq / 2) + (freq % 2 > 0 && cyc === 'C1' ? 1 : 0)) : 1;

      dealerRows.set(rowKey, {
        cycle_code: cyc,
        role: off.role,
        emp_code: empCode,
        emp_name: off.emp_name,
        dealer_sap_code: sapCode,
        sap_code: sapCode,
        sfa_code: sfaCode,
        dealer_name: dim.dealer_name || rawName || sapCode,
        dealer_id: d.dealer_id,
        category: cat,
        area: d.area || dim.area || '',
        zone: zone,
        emp_zone: empZone || zone,
        planned: cycPlanned,
        planned_dates: []
      });

      existingOfficerDealers.add(`${cyc}|${rc.role}|${empK}|${key(sapCode)}`);
      if (sfaCode) existingOfficerDealers.add(`${cyc}|${rc.role}|${empK}|${key(sfaCode)}`);
      if (rawName) existingOfficerDealers.add(`${cyc}|${rc.role}|${empK}|${normName(rawName)}`);
    }
  }

  // ── 5. score each row ─────────────────────────────────────────────────────
  const fractions = {};
  for (const c of cycles) fractions[c] = cycleElapsedFraction(c, asOnDate, periodMonth, windows);

  const cycleWindows = {};
  for (const c of cycles) cycleWindows[c] = cycleWindowDates(c, asOnDate, periodMonth, windows);

  const byDealer = [];
  for (const row of dealerRows.values()) {
    const fraction   = fractions[row.cycle_code] ?? 1;
    const mtdPlanned = row.planned * fraction;
    const cWin       = cycleWindows[row.cycle_code] || cycleWindows.C1;

    // Look up hits by SAP code, SFA code, dealer name, or normalized dealer name
    const hitCandidates = [
      actual.get(`${key(row.emp_code)}|${key(row.dealer_sap_code)}`),
      actual.get(`${key(row.emp_name)}|${key(row.dealer_sap_code)}`),
      row.sfa_code ? actual.get(`${key(row.emp_code)}|${key(row.sfa_code)}`) : null,
      row.sfa_code ? actual.get(`${key(row.emp_name)}|${key(row.sfa_code)}`) : null,
      row.dealer_name ? actual.get(`${key(row.emp_code)}|${key(row.dealer_name)}`) : null,
      row.dealer_name ? actual.get(`${key(row.emp_name)}|${key(row.dealer_name)}`) : null,
      row.dealer_name ? actual.get(`${key(row.emp_code)}|${normName(row.dealer_name)}`) : null,
      row.dealer_name ? actual.get(`${key(row.emp_name)}|${normName(row.dealer_name)}`) : null
    ].filter(Boolean);

    // Merge rows and deduplicate by visit_date + customer_code
    const seenVisitKeys = new Set();
    const mergedRows = [];
    for (const h of hitCandidates) {
      for (const r of h.rows) {
        const vKey = `${r.visit_date}|${key(r.customer_code)}|${key(r.customer_name)}`;
        if (!seenVisitKeys.has(vKey)) {
          seenVisitKeys.add(vKey);
          mergedRows.push(r);
        }
      }
    }

    // Match only visits that fall within this cycle's active window (up to asOnDate)
    const matchingRows = mergedRows.filter(r => (!cWin.from || r.visit_date >= cWin.from) && (!cWin.to || r.visit_date <= cWin.to));
    const matchingDates = new Set(matchingRows.map(r => r.visit_date));

    const adheredRaw    = matchingRows.length;
    const adheredDays   = matchingDates.size;
    const adheredCapped = Math.min(adheredRaw, row.planned);

    // Adhered ÷ MTD Due, falling back to the full plan when MTD Due rounds below 1.
    const denominator = mtdPlanned < 1 ? row.planned : mtdPlanned;
    const pct = denominator > 0 ? adheredRaw / denominator : 0;
    const pctCapped = denominator > 0 ? adheredCapped / denominator : 0;

    byDealer.push({
      ...row,
      planned_dates: [...new Set(row.planned_dates)].sort(),
      planned_visits: row.planned,
      mtd_planned: mtdPlanned,
      mtd_due: mtdPlanned,
      adhered: adheredRaw,
      adhered_capped: adheredCapped,
      adhered_days: adheredDays,
      adherence_pct: pct,
      adherence_pct_capped: pctCapped,
      pending: mtdPlanned - adheredRaw,
      visited: adheredRaw > 0,
      visit_dates: [...matchingDates].sort()
    });
  }

  // ── 6. roll up ────────────────────────────────────────────────────────────
  const rollup = (rows) => {
    const planned      = rows.reduce((s, r) => s + (r.planned || 0), 0);
    const mtdPlanned   = rows.reduce((s, r) => s + (r.mtd_planned || 0), 0);
    const adhered      = rows.reduce((s, r) => s + (r.adhered || 0), 0);
    const adheredCap   = rows.reduce((s, r) => s + (r.adhered_capped || 0), 0);
    const denominator  = mtdPlanned < 1 ? planned : mtdPlanned;
    return {
      dealers: rows.length,
      dealers_visited: rows.filter(r => r.visited).length,
      dealers_missed:  rows.filter(r => !r.visited).length,
      planned,
      planned_visits: planned,
      mtd_planned: mtdPlanned,
      mtd_due: mtdPlanned,
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
      zone: rows[0].emp_zone || rows[0].zone || '',
      cycles: [...new Set(rows.map(r => r.cycle_code))].sort(),
      ...rollup(rows),
      missed_dealers: rows.filter(r => !r.visited)
        .map(r => ({ sap_code: r.dealer_sap_code, name: r.dealer_name, planned_dates: r.planned_dates }))
    }))
    .sort((a, b) => a.adherence_pct - b.adherence_pct);

  const byRole = Object.fromEntries(
    ROLES.map(role => {
      const isZh = role === 'ZH';
      const matching = byDealer.filter(r => isZh ? ['ZH', 'ZM', 'ZSH', 'ZONAL HEAD'].includes((r.role || '').toUpperCase()) : (r.role || '').toUpperCase() === role);
      return [role, rollup(matching)];
    })
  );

  const byZone = Object.fromEntries(
    [...new Set(byDealer.map(r => r.zone || r.emp_zone).filter(Boolean))].sort().map(z => [
      z,
      {
        ...rollup(byDealer.filter(r => (r.zone || r.emp_zone) === z)),
        officers: [...new Set(byDealer.filter(r => (r.zone || r.emp_zone) === z).map(r => r.emp_code))].length
      }
    ])
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
    byZone,
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
