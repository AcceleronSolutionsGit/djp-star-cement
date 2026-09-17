/**
 * The Master sheet — one definition, used by BOTH the Excel download and the on-screen
 * view, so the two can never drift apart.
 *
 * Transcribed from the client master `M.xlsx` → sheet `Master ` (note the trailing
 * space in the sheet name; it is real and is preserved).
 *
 *   Row 1   blank
 *   Row 2   B2 = the planning anchor, as a real date (M.xlsx holds 46174 = 2026-06-01)
 *   Row 3   source-of-truth annotations
 *   Row 4   headers  ← frozen here (ySplit = 4)
 *   Row 5+  data
 *
 * 42 columns, A … AP. Column H (Area Strategy) is hidden in the client file and is
 * hidden here too.
 *
 * Three headers carry the month in their text and must move with the planning month:
 *   O  "<prev month> Sales"       planning month − 1
 *   Q  "<same month last year> (Sales)"
 *   R  "<two months back> Sales"  planning month − 2
 * In M.xlsx, with B2 = Jun-26, these read May'26 Sales / May'25 (Sales) / Apr'26 Sales.
 */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM' → { y, m } with m 1-based. */
function ym(periodMonth) {
  const mt = String(periodMonth || '').match(/^(\d{4})-(\d{2})$/);
  if (!mt) return null;
  return { y: +mt[1], m: +mt[2] };
}

/** Shift a YYYY-MM by n months. */
function shift(periodMonth, n) {
  const p = ym(periodMonth);
  if (!p) return null;
  const d = new Date(Date.UTC(p.y, p.m - 1 + n, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/** { y, m } → "May'26" */
const tag = p => `${MON[p.m - 1]}'${String(p.y).slice(2)}`;

/**
 * The three month-dependent header labels, for a given planning month.
 * O = month − 1, R = month − 2, Q = same month as O, one year earlier.
 */
export function monthLabels(periodMonth) {
  const o = shift(periodMonth, -1);
  const r = shift(periodMonth, -2);
  if (!o || !r) return { O: "Current Month Sales", Q: 'LYSM Sales', R: 'Previous Month Sales' };
  const q = { y: o.y - 1, m: o.m };
  return { O: `${tag(o)} Sales`, Q: `${tag(q)} (Sales)`, R: `${tag(r)} Sales` };
}

/** The planning anchor $B$2 — the first day of the planning month. */
export function anchorDate(periodMonth) {
  const p = ym(periodMonth);
  return p ? new Date(Date.UTC(p.y, p.m - 1, 1)) : null;
}

/**
 * Column definitions, in sheet order. One entry per column A … AP.
 *
 *   key    stable identifier, used by the UI
 *   header header text (row 4); month-dependent ones are filled in by buildHeaders()
 *   source row-3 annotation, null where the client file leaves it blank
 *   width  column width, exactly as the client file sets it
 *   fmt    Excel number format — null means General
 *   align  how the UI should align the cell
 *   hidden true only for H, which the client file hides
 */
export const COLUMNS = [
  { col: 'A',  key: 'cust_type',        header: 'Cust Type',                    source: null,                     width: 10.13, fmt: null,   align: 'left'  },
  { col: 'B',  key: 'sl_no',            header: 'Sl.No.',                       source: null,                     width: 11.88, fmt: '0',    align: 'right' },
  { col: 'C',  key: 'zone',             header: 'Zone',                         source: 'DLRWISE (WARROOM)',      width: 18.25, fmt: null,   align: 'left'  },
  { col: 'D',  key: 'zh_name',          header: 'ZONAL HEAD',                   source: 'SALES MAPPING',          width: 22.63, fmt: null,   align: 'left'  },
  { col: 'E',  key: 'rsm_name',         header: 'RSM',                          source: 'SALES MAPPING',          width: 20.5,  fmt: null,   align: 'left'  },
  { col: 'F',  key: 'asm_name',         header: 'ASM',                          source: 'SALES MAPPING',          width: 28.38, fmt: null,   align: 'left'  },
  { col: 'G',  key: 'area',             header: 'AREA',                         source: 'DLRWISE (WARROOM)',      width: 25.0,  fmt: null,   align: 'left'  },
  { col: 'H',  key: 'area_strategy',    header: 'Area Strategy',                source: null,                     width: 28.0,  fmt: null,   align: 'left', hidden: true },
  { col: 'I',  key: 'so_name',          header: 'SO/SE  NAME',                  source: 'SALES MAPPING',          width: 31.0,  fmt: null,   align: 'left'  },
  { col: 'J',  key: 'block',            header: 'Block (Taluka)',               source: 'MARKET MAPPING (SBG)',   width: 27.0,  fmt: null,   align: 'left'  },
  { col: 'K',  key: 'sfa_code',         header: 'SFA CODE',                     source: 'DLRWISE (WARROOM)',      width: 18.75, fmt: null,   align: 'left'  },
  { col: 'L',  key: 'customer_code',    header: 'Customer code',                source: 'DLRWISE (WARROOM)',      width: 17.63, fmt: null,   align: 'left'  },
  { col: 'M',  key: 'dealer_name',      header: 'DEALER NAME',                  source: 'DLRWISE (WARROOM)',      width: 37.5,  fmt: null,   align: 'left'  },
  { col: 'N',  key: 'potential',        header: 'DLR COUNTER POTENTIAL ',       source: 'MARKET MAPPING (SBG)',   width: 22.63, fmt: '0.00', align: 'right' },
  { col: 'O',  key: 'current_sales',    header: null /* month */,               source: 'DLRWISE (WARROOM)',      width: 18.75, fmt: '0.00', align: 'right' },
  { col: 'P',  key: 'counter_share',    header: 'Counter Share%',               source: null,                     width: 9.13,  fmt: '0%',   align: 'right' },
  { col: 'Q',  key: 'lysm_sales',       header: null /* month */,               source: 'DLRWISE (WARROOM)',      width: 18.75, fmt: '0.00', align: 'right' },
  { col: 'R',  key: 'previous_sales',   header: null /* month */,               source: 'DLRWISE (WARROOM)',      width: 22.25, fmt: '0.00', align: 'right' },
  { col: 'S',  key: 'six_month_avg',    header: 'Last 6 months avg sales',      source: 'GET DATA FROM SOUMADEEP', width: 24.5, fmt: '0.00', align: 'right' },
  { col: 'T',  key: 'doa',              header: 'DOA',                          source: 'DLRWISE (WARROOM)',      width: 18.75, fmt: 'm/d/yyyy', align: 'center', type: 'date' },
  { col: 'U',  key: 'final_category',   header: 'Final Category',               source: null,                     width: 17.13, fmt: null,   align: 'left'  },
  { col: 'V',  key: 'potential_rank',   header: 'Rank based on counter potential (SO wise)', source: null,        width: 12.75, fmt: '0',    align: 'right' },
  { col: 'W',  key: 'score_a',          header: 'A. Score based on counter potential (SO wise)\n(Out of 40)',     source: null, width: 19.13, fmt: '0.0', align: 'right' },
  { col: 'X',  key: 'score_b',          header: 'B. Score based on the category\n(Out of 40)',                    source: null, width: 13.25, fmt: '0.0', align: 'right' },
  { col: 'Y',  key: 'score_c',          header: 'C. Score based on the counter share (Out of 20)',                source: null, width: 16.13, fmt: '0.0', align: 'right' },
  { col: 'Z',  key: 'total_score',      header: 'Total Score\n(A+B+C) \n(out of 100)',                            source: null, width: 9.13,  fmt: '0.0', align: 'right' },
  { col: 'AA', key: 'priority_rank',    header: 'Rank based on Total score\n(SO wise)',  source: 'PRIORITY',      width: 10.88, fmt: '0',    align: 'right' },
  { col: 'AB', key: 'so_visits',        header: 'Number of Visits by SO/SR (Based on Percentile)',  source: null, width: 14.5,  fmt: '0.0',  align: 'right' },
  { col: 'AC', key: 'asm_visits',       header: 'Number of visits by ASM (Based on Percentile)',    source: null, width: 14.38, fmt: '0.0',  align: 'right' },
  { col: 'AD', key: 'rsm_visits',       header: 'Number of Visits by RSM (based on percentile) ',   source: null, width: 16.13, fmt: '0.0',  align: 'right' },
  { col: 'AE', key: 'zh_visits',        header: 'Number of visits by ZH (Based on percentile)',     source: null, width: 15.88, fmt: '0.0',  align: 'right' },
  { col: 'AF', key: 'final_volume',     header: 'Final volume',                 source: null,                     width: 9.63,  fmt: '0.00', align: 'right' },
  { col: 'AG', key: 'grade',            header: 'Category based on percentile', source: null,                     width: 11.0,  fmt: null,   align: 'center' },
  { col: 'AH', key: 'area_volume',      header: 'Area Volume',                  source: null,                     width: 8.75,  fmt: '0.00', align: 'right' },
  { col: 'AI', key: 'area_rank',        header: 'Area Rank',                    source: null,                     width: 4.75,  fmt: '0',    align: 'right' },
  { col: 'AJ', key: 'area_vol_pct',     header: 'Area Percentile Based on Total Volume of Sales',  source: null,  width: 13.5,  fmt: '0%',   align: 'right' },
  { col: 'AK', key: 'need_to_grow',     header: "Is 'Need to grow'?",           source: null,                     width: 9.25,  fmt: null,   align: 'center' },
  { col: 'AL', key: 'area_potential',   header: 'Area Potential',               source: null,                     width: 11.88, fmt: '0.00', align: 'right' },
  { col: 'AM', key: 'area_pot_rank',    header: 'Area rank based on potential', source: null,                     width: 8.25,  fmt: '0',    align: 'right' },
  { col: 'AN', key: 'area_pot_pct',     header: 'Area percentile based on potential', source: null,               width: 12.75, fmt: '0%',   align: 'right' },
  { col: 'AO', key: 'concat_category',  header: 'Concat Category',              source: null,                     width: 13.5,  fmt: null,   align: 'left'  },
  { col: 'AP', key: 'concat',           header: 'Concat',                       source: null,                     width: 68.38, fmt: null,   align: 'left'  }
];

export const SHEET_NAME = 'Master ';   // trailing space is deliberate — it matches M.xlsx
export const HEADER_ROW = 4;
export const FIRST_DATA_ROW = 5;

/** Headers for a planning month, with the three month-dependent labels filled in. */
export function buildHeaders(periodMonth) {
  const L = monthLabels(periodMonth);
  return COLUMNS.map(c => {
    if (c.key === 'current_sales')  return L.O;
    if (c.key === 'lysm_sales')     return L.Q;
    if (c.key === 'previous_sales') return L.R;
    return c.header;
  });
}

/** Row 3 — the source annotations. */
export const buildSources = () => COLUMNS.map(c => c.source);

const n  = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const s  = v => (v === null || v === undefined || v === '') ? '' : String(v).trim();

/**
 * Column A uses exactly three values in the client master — RSAR, DEALER, NON STAR —
 * and never the internal word PROSPECTIVE. Anything else is mapped into that vocabulary
 * so the sheet reads the way the client's does.
 */
export function custType(t) {
  const raw  = s(t.cust_type).toUpperCase();
  if (raw === 'RSAR' || raw === 'DEALER' || raw === 'NON STAR') return raw;

  const type = s(t.dealer_type).toUpperCase();
  if (type === 'PROSPECTIVE' || type === 'PROSPECT' || raw === 'PROSPECTIVE') return 'NON STAR';
  if (type === 'RSAR' || type === 'SUB-DEALER' || type === 'RSSD')            return 'RSAR';
  if (raw === 'NON-STAR' || raw === 'NONSTAR')                                return 'NON STAR';
  return 'DEALER';
}

/**
 * The marker the client master puts in column T for a prospect.
 *
 * Verified against M.xlsx: all 46 NON STAR rows carry the literal text `NEW` in the DOA
 * column — uppercase — and those are exactly the 46 rows whose Final Category is
 * Prospective. The master has no blank DOA anywhere.
 *
 * It is not decoration. Column U reads `T="New"` as its first branch, which is how a
 * prospect becomes Prospective in the first place; a blank cell would instead be read
 * as 0 and fall into the Old tier. Writing the marker keeps the sheet self-describing
 * and round-trippable: re-importing our own export classifies the same way.
 */
export const PROSPECT_DOA = 'NEW';

/** 'YYYY-MM-DD' → Date, so Excel stores a real date rather than text. */
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/**
 * One `dealer_visit_targets` row → the 42 Master cells, in column order.
 *
 * Values are returned as real types — numbers as numbers, the DOA as a Date — so the
 * workbook carries data rather than pre-formatted strings. Formatting is applied from
 * COLUMNS[].fmt at write time, exactly as the client file does it.
 */
export function buildRow(t, index) {
  const potential = (t.sbg_potential !== null && t.sbg_potential !== undefined)
    ? Number(t.sbg_potential)
    : (t.potential !== null && t.potential !== undefined ? Number(t.potential) : null);

  const currentSales = n(t.current_sales);
  const grade        = s(t.category || t.grade);
  const category     = s(t.dealer_status);
  const soName       = s(t.so_name);
  const dealerName   = s(t.dealer_name);
  const hasPotential = potential !== null && potential > 0;

  // NON STAR is the master's word for a prospect (see custType). Category is checked
  // too, so a prospect still reads as one if the type column is missing.
  const isProspect = custType(t) === 'NON STAR' || category.toUpperCase() === 'PROSPECTIVE';

  // Counter share comes from the engine; recomputed only if it is absent.
  const counterShare = t.counter_share !== null && t.counter_share !== undefined
    ? Number(t.counter_share)
    : (hasPotential ? currentSales / potential : 0);

  return {
    cust_type:       custType(t),
    sl_no:           index + 1,
    zone:            s(t.zone),
    zh_name:         s(t.zh_name),
    rsm_name:        s(t.rsm_name),
    asm_name:        s(t.asm_name),
    area:            s(t.dm_area || t.area),
    area_strategy:   '',
    so_name:         soName,
    block:           s(t.sbg_block || t.block),
    sfa_code:        s(t.sfa_code),
    customer_code:   s(t.sap_code || t.sfa_code),
    dealer_name:     dealerName,
    potential:       potential,                    // null when SBG has no row — not 0
    current_sales:   currentSales,
    counter_share:   counterShare,
    lysm_sales:      n(t.lysm_sales),
    previous_sales:  n(t.previous_sales),
    six_month_avg:   n(t.dp_six_month_avg ?? t.rsar_six_month_avg),
    // A prospect has no date of appointment — it has not been appointed. The master
    // marks that with the text NEW rather than leaving the cell empty.
    doa:             isProspect ? PROSPECT_DOA : toDate(t.doa),
    final_category:  category,
    potential_rank:  hasPotential ? n(t.potential_rank) || 1 : null,
    score_a:         hasPotential ? n(t.score_a) : null,
    score_b:         n(t.score_b),
    score_c:         hasPotential ? n(t.score_c) : null,
    total_score:     n(t.total_score),
    priority_rank:   n(t.priority) || 1,
    so_visits:       n(t.so_visits),
    asm_visits:      n(t.asm_visits),
    rsm_visits:      n(t.rsm_visits),
    zh_visits:       n(t.zh_visits),
    final_volume:    n(t.final_volume),
    grade:           grade,
    area_volume:     n(t.area_volume),
    area_rank:       n(t.area_volume_rank) || 1,
    area_vol_pct:    n(t.area_volume_percentile),
    need_to_grow:    t.need_to_grow ? 'Yes' : 'No',
    area_potential:  n(t.area_potential),
    area_pot_rank:   n(t.area_potential_rank) || 1,
    area_pot_pct:    n(t.area_potential_percentile),
    concat_category: grade ? `${category}-${grade}` : category,
    concat:          `${dealerName}-${soName}-${category}`
  };
}

/** The same row as a positional array, in column order — what the writer wants. */
export const rowToArray = (row) => COLUMNS.map(c => {
  const v = row[c.key];
  return v === undefined ? null : v;
});

/**
 * Deduplicate to one record per canonical dealer code, preserving order.
 * The client master is strictly one row per Customer code.
 */
export function dedupeTargets(targets) {
  const seen = new Map();
  for (const t of targets) {
    const code = t.sap_code || t.sfa_code;
    if (code && !seen.has(code)) seen.set(code, t);
  }
  return [...seen.values()];
}
