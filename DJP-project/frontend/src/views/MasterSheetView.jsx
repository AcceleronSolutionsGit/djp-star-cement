import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Download, Search, ChevronLeft, ChevronRight, AlertTriangle,
  Eye, EyeOff, RefreshCw, Table2
} from 'lucide-react';
import { api } from '../services/api';

/**
 * The Master sheet, on screen exactly as it appears in the M.xlsx download.
 *
 * Same 42 columns in the same order, the same header text (including the three labels
 * that move with the planning month), the same row-3 source annotations, the same
 * widths, and column H hidden by default just as the client file hides it.
 *
 * Both this and the Excel writer read src/services/masterSheet.service.js, so the
 * screen and the file cannot drift apart.
 *
 * Paged at 100 rows because the real master is ~12,600 rows; rendering that at once
 * would lock the browser.
 */

const CAT_TONE = {
  'Growing':      { bg: 'var(--color-success-bg, #E2EFDA)', fg: 'var(--color-success, #1E7B34)' },
  'De-growing':   { bg: 'var(--color-danger-bg, #FCE4E4)',  fg: 'var(--color-danger, #B42318)' },
  'Need to Grow': { bg: 'var(--color-warning-bg, #FFF2CC)', fg: 'var(--color-warning, #B25E09)' },
  'Zero Lifter':  { bg: 'var(--color-info-bg, #DEEBF7)',    fg: 'var(--color-info, #1F5FA9)' },
  'Churn':        { bg: '#EFEFEF',                          fg: '#6B6B6B' },
  'Prospective':  { bg: '#EDE7F6',                          fg: '#5E35B1' }
};

/** Render a value the way Excel would, given the column's number format. */
function formatCell(value, col) {
  if (value === null || value === undefined || value === '') return '';

  if (col.key === 'doa') {
    const d = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return String(value);
    return `${String(d.getUTCDate()).padStart(2, '0')}-` +
           `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}-` +
           `${String(d.getUTCFullYear()).slice(2)}`;
  }

  if (typeof value === 'number') {
    if (col.fmt === '0%')    return `${Math.round(value * 100)}%`;
    if (col.fmt === '0')     return String(Math.round(value));
    if (col.fmt === '0.0')   return value.toFixed(1);
    if (col.fmt === '0.00')  return value.toFixed(2);
    return String(value);
  }
  return String(value);
}

export default function MasterSheetView({ onShowToast, selectedPeriod, selectedCycle }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [page, setPage]         = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [search, setSearch]     = useState('');
  const [query, setQuery]       = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await api.getMasterView({
        month: selectedPeriod, cycle: selectedCycle, page, pageSize, search: query
      });
      setData(res);
    } catch (e) {
      setError(e.message || 'Could not load the Master sheet.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, selectedCycle, page, pageSize, query]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [selectedPeriod, selectedCycle, query]);

  const columns = useMemo(
    () => (data?.columns || []).filter(c => showHidden || !c.hidden),
    [data, showHidden]
  );

  const submitSearch = (e) => { e.preventDefault(); setQuery(search.trim()); };

  const download = async () => {
    setDownloading(true);
    try {
      await api.downloadMasterExcel(selectedPeriod, selectedCycle);
      onShowToast?.('success', 'Master sheet downloaded.');
    } catch (e) {
      onShowToast?.('error', e.message || 'Download failed.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="ms-wrap">
      <style>{`
        .ms-wrap { display:flex; flex-direction:column; gap:14px; }
        .ms-bar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
        .ms-title { display:flex; align-items:center; gap:9px; font-size:17px; font-weight:650; }
        .ms-sub { font-size:12.5px; color:var(--color-text-muted,#667085); }
        .ms-spacer { flex:1 1 auto; }
        .ms-search { display:flex; align-items:center; gap:6px; border:1px solid var(--color-border,#D0D5DD);
                     border-radius:7px; padding:5px 9px; background:var(--color-surface,#fff); }
        .ms-search input { border:0; outline:0; font-size:13px; width:210px; background:transparent;
                           color:inherit; }
        .ms-btn { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--color-border,#D0D5DD);
                  background:var(--color-surface,#fff); color:inherit; border-radius:7px; padding:6px 11px;
                  font-size:13px; cursor:pointer; }
        .ms-btn:hover { background:var(--color-surface-hover,#F4F6F8); }
        .ms-btn.primary { background:#1F3864; border-color:#1F3864; color:#fff; }
        .ms-btn:disabled { opacity:.55; cursor:default; }

        /* The sheet itself */
        .ms-sheet { border:1px solid var(--color-border,#D0D5DD); border-radius:9px; overflow:auto;
                    max-height:calc(100vh - 300px); background:var(--color-surface,#fff); }
        table.ms { border-collapse:separate; border-spacing:0; font-size:12px; white-space:nowrap; }
        table.ms th, table.ms td { border-right:1px solid var(--color-border-subtle,#E7EAEE);
                                   border-bottom:1px solid var(--color-border-subtle,#E7EAEE);
                                   padding:5px 8px; }

        /* Column letters, as in a spreadsheet */
        table.ms thead tr.ms-colrow th { position:sticky; top:0; z-index:6; background:#EDF0F4;
            color:#5A6472; font-size:10.5px; font-weight:600; text-align:center; height:20px; }
        /* Row 3 - source annotations */
        table.ms thead tr.ms-srcrow th { position:sticky; top:20px; z-index:6; background:#F7F8FA;
            color:#8A94A3; font-size:9.5px; font-style:italic; font-weight:500; text-align:center;
            white-space:normal; line-height:1.25; height:26px; }
        /* Row 4 - the headers */
        table.ms thead tr.ms-hdrrow th { position:sticky; top:46px; z-index:6; background:#1F3864;
            color:#fff; font-size:11px; font-weight:600; text-align:center; white-space:normal;
            line-height:1.3; vertical-align:middle; min-height:54px; }

        /* Row numbers down the left, and the two frozen identity columns */
        table.ms td.ms-rownum, table.ms th.ms-rownum { position:sticky; left:0; z-index:5;
            background:#EDF0F4; color:#5A6472; font-size:10.5px; text-align:center; width:46px;
            min-width:46px; font-variant-numeric:tabular-nums; }
        table.ms thead th.ms-rownum { z-index:7; }

        table.ms tbody tr:hover td { background:var(--color-surface-hover,#F4F6F8); }
        table.ms tbody tr:hover td.ms-rownum { background:#E3E8EF; }
        .ms-num { font-variant-numeric:tabular-nums; }
        .ms-chip { display:inline-block; padding:1px 7px; border-radius:9px; font-size:11px; font-weight:600; }
        .ms-hiddencol { background:repeating-linear-gradient(45deg,transparent,transparent 5px,#F0F0F0 5px,#F0F0F0 10px); }

        .ms-foot { display:flex; align-items:center; gap:12px; flex-wrap:wrap; font-size:12.5px;
                   color:var(--color-text-muted,#667085); }
        .ms-note { display:flex; gap:9px; align-items:flex-start; padding:10px 13px; border-radius:8px;
                   font-size:13px; background:var(--color-warning-bg,#FFF4E5); color:var(--color-warning,#8A5300); }
        @media (max-width:640px){ .ms-search input{width:130px;} }
      `}</style>

      {/* ── toolbar ──────────────────────────────────────────────────────── */}
      <div className="ms-bar">
        <div>
          <div className="ms-title"><Table2 size={18} /> Master Sheet</div>
          <div className="ms-sub">
            {data
              ? <>Sheet <code>{JSON.stringify(data.sheet_name)}</code> · {data.period_month} {data.cycle_code}
                  {' '}· anchor <strong>B2 = {data.anchor}</strong>
                  {' '}· {data.total_unfiltered.toLocaleString()} rows · 42 columns</>
              : 'The same 42 columns as the Excel download'}
          </div>
        </div>

        <div className="ms-spacer" />

        <form className="ms-search" onSubmit={submitSearch}>
          <Search size={14} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Dealer, code, area or SO"
            aria-label="Search the Master sheet"
          />
          {query && (
            <button type="button" className="ms-btn" style={{ padding: '1px 7px' }}
                    onClick={() => { setSearch(''); setQuery(''); }}>clear</button>
          )}
        </form>

        <button className="ms-btn" onClick={() => setShowHidden(v => !v)}
                title="Column H (Area Strategy) is hidden in the client's own file">
          {showHidden ? <EyeOff size={14} /> : <Eye size={14} />}
          {showHidden ? 'Hide column H' : 'Show hidden column'}
        </button>

        <button className="ms-btn" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'spin' : ''} /> Refresh
        </button>

        <button className="ms-btn primary" onClick={download} disabled={downloading || !data}>
          <Download size={14} /> {downloading ? 'Preparing…' : 'Download M.xlsx'}
        </button>
      </div>

      {error && (
        <div className="ms-note">
          <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {/* ── the sheet ────────────────────────────────────────────────────── */}
      {data && (
        <>
          <div className="ms-sheet">
            <table className="ms">
              <thead>
                {/* spreadsheet column letters */}
                <tr className="ms-colrow">
                  <th className="ms-rownum" />
                  {columns.map(c => (
                    <th key={`L-${c.col}`} className={c.hidden ? 'ms-hiddencol' : ''}>{c.col}</th>
                  ))}
                </tr>
                {/* row 3 — source annotations */}
                <tr className="ms-srcrow">
                  <th className="ms-rownum">3</th>
                  {columns.map(c => (
                    <th key={`S-${c.col}`} className={c.hidden ? 'ms-hiddencol' : ''}>{c.source || ''}</th>
                  ))}
                </tr>
                {/* row 4 — headers */}
                <tr className="ms-hdrrow">
                  <th className="ms-rownum">4</th>
                  {columns.map(c => (
                    <th key={`H-${c.col}`}
                        style={{ minWidth: Math.round(Math.max(c.width, 6) * 7.2) }}
                        title={`${c.col} · ${c.header}${c.source ? ` · source: ${c.source}` : ''}`}>
                      {String(c.header).split('\n').map((line, i) => (
                        <div key={i}>{line}</div>
                      ))}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => {
                  const sheetRow = data.first_data_row + (data.page - 1) * data.page_size + i;
                  return (
                    <tr key={`${row.customer_code}-${i}`}>
                      <td className="ms-rownum">{sheetRow}</td>
                      {columns.map(c => {
                        const v = row[c.key];
                        const text = formatCell(v, c);

                        if (c.key === 'final_category' && text) {
                          const tone = CAT_TONE[text] || { bg: '#EFEFEF', fg: '#555' };
                          return (
                            <td key={c.col} style={{ textAlign: 'center' }}>
                              <span className="ms-chip" style={{ background: tone.bg, color: tone.fg }}>{text}</span>
                            </td>
                          );
                        }
                        if (c.key === 'need_to_grow') {
                          return (
                            <td key={c.col} style={{ textAlign: 'center',
                                  fontWeight: text === 'Yes' ? 700 : 400,
                                  color: text === 'Yes' ? 'var(--color-warning,#B25E09)' : 'inherit' }}>
                              {text}
                            </td>
                          );
                        }
                        return (
                          <td key={c.col}
                              className={`${typeof v === 'number' ? 'ms-num' : ''} ${c.hidden ? 'ms-hiddencol' : ''}`}
                              style={{ textAlign: c.align }}
                              title={text.length > 24 ? text : undefined}>
                            {text}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── paging ─────────────────────────────────────────────────── */}
          <div className="ms-foot">
            <span>
              Rows <strong>{((data.page - 1) * data.page_size) + 1}</strong>–
              <strong>{Math.min(data.page * data.page_size, data.total)}</strong> of{' '}
              <strong>{data.total.toLocaleString()}</strong>
              {query && <> (filtered from {data.total_unfiltered.toLocaleString()})</>}
            </span>

            <div className="ms-spacer" />

            <label>
              Rows per page{' '}
              <select value={pageSize} onChange={e => { setPageSize(+e.target.value); setPage(1); }}>
                {[50, 100, 250, 500].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>

            <button className="ms-btn" disabled={data.page <= 1 || loading}
                    onClick={() => setPage(p => Math.max(1, p - 1))}>
              <ChevronLeft size={14} /> Previous
            </button>
            <span>Page <strong>{data.page}</strong> of <strong>{data.pages}</strong></span>
            <button className="ms-btn" disabled={data.page >= data.pages || loading}
                    onClick={() => setPage(p => p + 1)}>
              Next <ChevronRight size={14} />
            </button>
          </div>
        </>
      )}

      {!data && !error && !loading && (
        <div className="ms-note">
          <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>No Master data for this month yet. Upload the input files and run Generate Plans.</span>
        </div>
      )}
    </div>
  );
}
