/**
 * PJP Classification Engine — Final Category (column U)
 *
 * Faithful implementation of the client's own formula, taken from the live cell
 * `M.xlsx → Master → U5`. Replayed over that master it reproduces 12,656 of 12,658
 * rows (99.98%); the two exceptions have a blank DOA, which Excel reads as 0 and so
 * drops into the Old tier — reproduced here deliberately.
 *
 *   =IFS(
 *     T="New",                                "Prospective",
 *     T>=$B$2-15,                             "Growing",
 *     T<=DATE(YEAR($B$2)-1,MONTH($B$2)-1,1),  IFS(S=0,"Churn", O=0,"Zero Lifter", AK="yes","Need to Grow", O>=Q,"Growing", O<Q,"De-growing"),
 *     T<=$B$2-180,                            IFS(S=0,"Churn", O=0,"Zero Lifter", AK="yes","Need to Grow", S>O,"De-growing", S<=O,"Growing"),
 *     T>$B$2-180,                             IFS(          O=0,"Zero Lifter", AK="yes","Need to Grow", R>O,"De-growing", R<=O,"Growing"))
 *
 * Symbols:  $B$2 planning anchor (1st of the planning month) · T DOA · O current-month
 * sale · R previous-month sale · Q same month last year · S 6-month average ·
 * AK need-to-grow flag.
 *
 * THE POINT OF THE DOA TIERS. A dealer's age decides which comparison is fair. A
 * counter appointed three weeks ago has no sales history to compare against, so the
 * formula forces it to Growing; a counter appointed inside the last 180 days cannot
 * reach Churn at all. Before this was implemented, a dealer that opened ten weeks
 * earlier was classified Churn on its zero sales, which set its final volume to 0 and
 * its visit frequency to 0 for every role — the newest dealers got no visits at all.
 *
 * TIER ORDER IS LOAD-BEARING. `IFS` returns on first match, and the Old cut-off is
 * *earlier* than the Mid cut-off, so Old must be tested before Mid. A DOA of
 * 2025-08-12 against a 2026-07 anchor is not <= 2025-06-01 (not Old) but is
 * <= 2026-01-02, so it lands in Mid — which is what the client master produces.
 */

const CATEGORY = {
  PROSPECTIVE: 'Prospective',
  GROWING:     'Growing',
  DEGROWING:   'De-growing',
  NEED_TO_GROW:'Need to Grow',
  ZERO_LIFTER: 'Zero Lifter',
  CHURN:       'Churn'
};

const DAY = 86400000;

/**
 * Parse a DOA into a UTC Date.
 * Returns the string 'NEW' for a prospect marker, or null when there is no usable date.
 */
function parseDoa(doa) {
  if (doa === null || doa === undefined || doa === '') return null;
  if (doa instanceof Date) return Number.isNaN(doa.getTime()) ? null : doa;

  const s = String(doa).trim();
  if (!s) return null;
  if (s.toLowerCase() === 'new') return 'NEW';

  // Canonical storage form is YYYY-MM-DD; accept a full timestamp too.
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime())
    ? null
    : new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
}

/** The planning anchor $B$2 — the first day of the planning month. */
function anchorOf(reportMonth) {
  const m = String(reportMonth || '').match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, 1));
}

/**
 * Which DOA tier a dealer falls in. Exported so the tier can be shown in the UI and
 * asserted in tests without re-deriving the cut-offs.
 *
 * @returns {{tier:'PROSPECT'|'BRAND_NEW'|'OLD'|'MID'|'NEW', cutoffs:Object, doaDate:Date|null}}
 */
export function resolveDoaTier(doa, reportMonth) {
  const anchor = anchorOf(reportMonth);
  const t = parseDoa(doa);

  const cutoffs = anchor ? {
    anchor,
    brandNew: new Date(anchor.getTime() - 15 * DAY),                                     // $B$2 - 15
    old:      new Date(Date.UTC(anchor.getUTCFullYear() - 1, anchor.getUTCMonth() - 1, 1)), // DATE(Y-1,M-1,1)
    mid:      new Date(anchor.getTime() - 180 * DAY)                                     // $B$2 - 180
  } : null;

  if (t === 'NEW') return { tier: 'PROSPECT', cutoffs, doaDate: null };

  // No anchor means no tiers can be computed; fall back to the oldest tier, which is
  // the branch with the full set of comparisons.
  if (!cutoffs) return { tier: 'OLD', cutoffs: null, doaDate: t instanceof Date ? t : null };

  // Blank DOA: Excel reads it as 0 (1900-01-00), i.e. older than any real cut-off.
  // Reproduced rather than special-cased, so this engine and the master agree.
  if (!(t instanceof Date)) return { tier: 'OLD', cutoffs, doaDate: null };

  if (t.getTime() >= cutoffs.brandNew.getTime()) return { tier: 'BRAND_NEW', cutoffs, doaDate: t };
  if (t.getTime() <= cutoffs.old.getTime())      return { tier: 'OLD',       cutoffs, doaDate: t };
  if (t.getTime() <= cutoffs.mid.getTime())      return { tier: 'MID',       cutoffs, doaDate: t };
  return { tier: 'NEW', cutoffs, doaDate: t };
}

/**
 * @param {Object}  p
 * @param {string}  p.dealerType             'PROSPECTIVE' marks a prospect row
 * @param {*}       p.doa                    date of activation; 'New' for prospects
 * @param {string}  p.reportMonth            planning month, YYYY-MM — supplies $B$2
 * @param {number}  p.currentSales           O — current-month sale
 * @param {number}  p.previousMonthSales     R — previous-month sale
 * @param {number}  p.sameMonthLastYearSales Q
 * @param {number}  p.sixMonthAverage        S
 * @param {boolean} p.needToGrow             AK, computed in pjp.engine.js stage 4
 * @param {string}  p.status
 * @param {string}  p.custType
 */
export function classifyDealer({
  dealerType,
  doa,
  reportMonth,
  currentSales,
  previousMonthSales,
  sameMonthLastYearSales,
  sixMonthAverage,
  needToGrow,
  status,
  custType
}) {
  const O = Number(currentSales) || 0;
  const R = Number(previousMonthSales) || 0;
  const Q = Number(sameMonthLastYearSales) || 0;
  const S = Number(sixMonthAverage) || 0;
  const AK = needToGrow === true || String(needToGrow).toLowerCase() === 'yes';

  const type = String(dealerType || custType || '').toUpperCase();
  const stat = String(status || '').toUpperCase();

  // ── T = "New" → Prospective ───────────────────────────────────────────────
  // In the master the prospect marker is the literal string "New" in the DOA column.
  // Here prospects arrive typed, so both are accepted.
  if (type === 'PROSPECTIVE' || type === 'PROSPECT' || stat === 'PROSPECTIVE') {
    return { finalCategory: CATEGORY.PROSPECTIVE, doaTier: 'PROSPECT', reason: 'Prospect row' };
  }

  const { tier, cutoffs, doaDate } = resolveDoaTier(doa, reportMonth);
  if (tier === 'PROSPECT') {
    return { finalCategory: CATEGORY.PROSPECTIVE, doaTier: 'PROSPECT', reason: 'DOA = "New"' };
  }

  // Not in the client formula: a dealer SAP itself reports as churned or inactive is
  // not worth planning against whatever its numbers say. Kept as an explicit override
  // and flagged in the reason so it is never mistaken for a formula branch.
  if (stat === 'CHURN' || stat === 'INACTIVE') {
    return { finalCategory: CATEGORY.CHURN, doaTier: tier, reason: `Status in SAP is ${stat} (override, not a column U branch)` };
  }

  const on = d => (d ? d.toISOString().slice(0, 10) : '—');
  const doaStr = on(doaDate) + (doaDate ? '' : ' (blank → treated as very old)');

  // ── T >= $B$2 - 15 → Growing, regardless of sales ─────────────────────────
  // A counter appointed within a fortnight of the planning date has had no chance to
  // sell. Comparing it on sales would classify it Churn and drop it from the plan.
  if (tier === 'BRAND_NEW') {
    return {
      finalCategory: CATEGORY.GROWING,
      doaTier: tier,
      reason: `DOA ${on(doaDate)} on/after ${on(cutoffs.brandNew)} (anchor − 15d) → Growing regardless of sales`
    };
  }

  // ── Old tier: T <= DATE(YEAR-1, MONTH-1, 1) — compares O against Q ────────
  if (tier === 'OLD') {
    if (S === 0)  return { finalCategory: CATEGORY.CHURN,        doaTier: tier, reason: `Old tier (DOA ${doaStr} on/before ${on(cutoffs?.old)}): 6-month average = 0` };
    if (O === 0)  return { finalCategory: CATEGORY.ZERO_LIFTER,  doaTier: tier, reason: `Old tier: current sale = 0 but 6M avg = ${S}` };
    if (AK)       return { finalCategory: CATEGORY.NEED_TO_GROW, doaTier: tier, reason: `Old tier: need-to-grow (high area potential, low counter share)` };
    if (O >= Q)   return { finalCategory: CATEGORY.GROWING,      doaTier: tier, reason: `Old tier: current ${O} >= same month last year ${Q}` };
    return          { finalCategory: CATEGORY.DEGROWING,    doaTier: tier, reason: `Old tier: current ${O} < same month last year ${Q}` };
  }

  // ── Mid tier: T <= $B$2 - 180 — compares S against O ──────────────────────
  if (tier === 'MID') {
    if (S === 0)  return { finalCategory: CATEGORY.CHURN,        doaTier: tier, reason: `Mid tier (DOA ${doaStr} on/before ${on(cutoffs.mid)}): 6-month average = 0` };
    if (O === 0)  return { finalCategory: CATEGORY.ZERO_LIFTER,  doaTier: tier, reason: `Mid tier: current sale = 0 but 6M avg = ${S}` };
    if (AK)       return { finalCategory: CATEGORY.NEED_TO_GROW, doaTier: tier, reason: `Mid tier: need-to-grow` };
    if (S > O)    return { finalCategory: CATEGORY.DEGROWING,    doaTier: tier, reason: `Mid tier: 6M avg ${S} > current ${O}` };
    return          { finalCategory: CATEGORY.GROWING,      doaTier: tier, reason: `Mid tier: 6M avg ${S} <= current ${O}` };
  }

  // ── New tier: T > $B$2 - 180 — compares R against O ───────────────────────
  // There is NO Churn branch here. A dealer under six months old with no sales is a
  // Zero Lifter, not a churned counter — it never had six months in which to lift.
  if (O === 0)    return { finalCategory: CATEGORY.ZERO_LIFTER,  doaTier: tier, reason: `New tier (DOA ${on(doaDate)} after ${on(cutoffs.mid)}): current sale = 0 — Churn is unreachable in this tier` };
  if (AK)         return { finalCategory: CATEGORY.NEED_TO_GROW, doaTier: tier, reason: `New tier: need-to-grow` };
  if (R > O)      return { finalCategory: CATEGORY.DEGROWING,    doaTier: tier, reason: `New tier: previous month ${R} > current ${O}` };
  return            { finalCategory: CATEGORY.GROWING,      doaTier: tier, reason: `New tier: previous month ${R} <= current ${O}` };
}

/**
 * Valid Final Categories (strictly the approved six).
 */
export const VALID_CATEGORIES = [
  'Zero lifter',
  'Zero Lifter',
  'Prospective',
  'De-growing',
  'Growing',
  'Need to Grow',
  'Churn'
];
