import React, { useState, useEffect, useMemo } from 'react';
import {
  ClipboardList, Search, RefreshCw, X, CalendarDays, AlertTriangle,
  CheckCircle2, Activity, Users, Download, GitCompare, ArrowUp, ArrowDown,
  PlusCircle, MinusCircle, History, ChevronLeft, ChevronRight
} from 'lucide-react';
import { api } from '../services/api';

/**
 * Officer Plans & Adherence
 *
 * Two things the admin panel could not do before:
 *   1. see every officer's generated plan in one list, and drill into any of them
 *   2. run the adherence check on its own, without regenerating C2
 *
 * The adherence tab follows the client's own method: MTD due is the planned visit
 * count prorated by how much of the cycle has elapsed at the as-on date, and
 * adherence is adhered ÷ MTD due. Capped and raw percentages are both shown because
 * the client keeps both — capped never exceeds 100%, raw does, and a negative pending
 * is how over-visiting surfaces.
 */

const STATUS_ORDER = ['DRAFT', 'SUBMITTED', 'RECTIFY', 'APPROVED', 'REJECTED'];

const STATUS_STYLE = {
  DRAFT:     { bg: 'var(--color-info-bg)',    fg: 'var(--color-info)'    },
  SUBMITTED: { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)' },
  RECTIFY:   { bg: 'var(--color-pink-bg)',    fg: 'var(--color-pink)'    },
  APPROVED:  { bg: 'var(--color-success-bg)', fg: 'var(--color-success)' },
  REJECTED:  { bg: 'var(--color-danger-bg)',  fg: 'var(--color-danger)'  }
};

function StatusPill({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.DRAFT;
  return (
    <span style={{
      background: s.bg, color: s.fg, padding: '3px 10px',
      borderRadius: 'var(--radius-full)', fontSize: '.72rem',
      fontWeight: 700, letterSpacing: '.02em', whiteSpace: 'nowrap'
    }}>{status}</span>
  );
}

const CHANGE_STYLE = {
  ADDED:         { bg: 'var(--color-success-bg)', fg: 'var(--color-success)', label: 'added' },
  DROPPED:       { bg: 'var(--color-danger-bg)',  fg: 'var(--color-danger)',  label: 'dropped' },
  MOVED_EARLIER: { bg: 'var(--color-info-bg)',    fg: 'var(--color-info)',    label: 'moved earlier' },
  MOVED_LATER:   { bg: 'var(--color-warning-bg)', fg: 'var(--color-warning)', label: 'moved later' },
  MORE_VISITS:   { bg: 'var(--color-purple-bg)',  fg: 'var(--color-purple)',  label: 'more visits' },
  FEWER_VISITS:  { bg: 'var(--color-pink-bg)',    fg: 'var(--color-pink)',    label: 'fewer visits' }
};

function ChangeChip({ change }) {
  const s = CHANGE_STYLE[change] || CHANGE_STYLE.ADDED;
  return (
    <span style={{
      background: s.bg, color: s.fg, padding: '3px 10px',
      borderRadius: 'var(--radius-full)', fontSize: '.7rem',
      fontWeight: 700, whiteSpace: 'nowrap'
    }}>{s.label}</span>
  );
}

function PaginationControls({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  itemName = 'records'
}) {
  const startItem = totalItems === 0 ? 0 : (page - 1) * pageSize + 1;
  const endItem = Math.min(page * pageSize, totalItems);

  const getPageNumbers = () => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const pages = [1];
    if (page > 3) pages.push('...');
    const start = Math.max(2, page - 1);
    const end = Math.min(totalPages - 1, page + 1);
    for (let i = start; i <= end; i++) pages.push(i);
    if (page < totalPages - 2) pages.push('...');
    pages.push(totalPages);
    return pages;
  };

  return (
    <div className="op-pagination">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <span>
          Showing <strong>{startItem}</strong>–<strong>{endItem}</strong> of <strong>{totalItems}</strong> {itemName}
        </span>
        {onPageSizeChange && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.78rem' }}>
            <span>Per page:</span>
            <select
              className="form-control"
              style={{ width: 'auto', padding: '3px 8px', height: '28px', fontSize: '.78rem' }}
              value={pageSize}
              onChange={e => onPageSizeChange(Number(e.target.value))}
            >
              {pageSizeOptions.map(sz => (
                <option key={sz} value={sz}>{sz}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button
          type="button"
          className="op-page-btn"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          title="Previous Page"
        >
          <ChevronLeft size={14} /> Prev
        </button>

        {getPageNumbers().map((p, idx) => (
          p === '...' ? (
            <span key={`ell-${idx}`} style={{ padding: '0 6px', color: 'var(--text-tertiary)' }}>…</span>
          ) : (
            <button
              key={p}
              type="button"
              className={`op-page-btn ${page === p ? 'active' : ''}`}
              onClick={() => onPageChange(p)}
            >
              {p}
            </button>
          )
        ))}

        <button
          type="button"
          className="op-page-btn"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          title="Next Page"
        >
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={tone ? { color: tone } : undefined}>{value}</div>
      {sub && <div className="kpi-subtext">{sub}</div>}
    </div>
  );
}

export default function OfficerPlansView({ onShowToast, selectedPeriod, selectedCycle }) {
  const [tab, setTab] = useState('plans');

  // ── plans tab ──────────────────────────────────────────────────────────────
  const [month, setMonth]   = useState(selectedPeriod || new Date().toISOString().slice(0, 7));
  const [cycle, setCycle]   = useState(selectedCycle || 'ALL');
  const [status, setStatus] = useState('ALL');
  const [role, setRole]     = useState('ALL');
  const [search, setSearch] = useState('');
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(false);

  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // ── adherence tab & pagination ──────────────────────────────────────────────
  const [adh, setAdh] = useState(null);
  const [adhLoading, setAdhLoading] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenResult, setRegenResult] = useState(null);
  const [expandedEmp, setExpandedEmp] = useState(null);
  const [adhCycle, setAdhCycle] = useState('C1');
  const [asOn, setAsOn] = useState('');   // blank = engine default (15th for C1, month end otherwise)
  const [showUnplanned, setShowUnplanned] = useState(false);
  const [adhViewMode, setAdhViewMode] = useState('officer'); // 'officer' | 'dealer'
  const [adhOfficerSearch, setAdhOfficerSearch] = useState('');
  const [adhRoleFilter, setAdhRoleFilter] = useState('ALL');
  const [adhBandFilter, setAdhBandFilter] = useState('ALL');
  const [adhPage, setAdhPage] = useState(1);
  const [adhPageSize, setAdhPageSize] = useState(10);
  const [adhDealerSearch, setAdhDealerSearch] = useState('');
  const [adhDealerPage, setAdhDealerPage] = useState(1);
  const [adhDealerPageSize, setAdhDealerPageSize] = useState(15);

  // ── unplanned visits tab & pagination ───────────────────────────────────────
  const [unplannedList, setUnplannedList] = useState([]);
  const [unplannedTotal, setUnplannedTotal] = useState(0);
  const [unplannedLoading, setUnplannedLoading] = useState(false);
  const [unplannedOfficerFilter, setUnplannedOfficerFilter] = useState('ALL');
  const [unplannedSearch, setUnplannedSearch] = useState('');
  const [unplannedPage, setUnplannedPage] = useState(1);
  const [unplannedPageSize, setUnplannedPageSize] = useState(15);

  // ── C2 review tab ──────────────────────────────────────────────────────────
  const [regens, setRegens] = useState(null);
  const [regen, setRegen] = useState(null);
  const [regenViewLoading, setRegenViewLoading] = useState(false);
  const [expandedOfficer, setExpandedOfficer] = useState(null);
  const [changeFilter, setChangeFilter] = useState('ALL');

  // Adherence filtered & paginated officers
  const filteredOfficers = useMemo(() => {
    if (!adh?.by_employee) return [];
    return adh.by_employee.filter(e => {
      if (adhRoleFilter !== 'ALL' && e.role !== adhRoleFilter) return false;
      if (adhBandFilter === 'CRITICAL' && e.capped_pct >= 70) return false;
      if (adhBandFilter === 'GOOD' && (e.capped_pct < 70 || e.capped_pct >= 100)) return false;
      if (adhBandFilter === 'FULL' && e.capped_pct < 100) return false;
      if (adhOfficerSearch.trim()) {
        const q = adhOfficerSearch.toLowerCase();
        const matchName = (e.emp_name || '').toLowerCase().includes(q);
        const matchCode = (e.emp_code || '').toLowerCase().includes(q);
        if (!matchName && !matchCode) return false;
      }
      return true;
    });
  }, [adh, adhRoleFilter, adhBandFilter, adhOfficerSearch]);

  const totalOfficerPages = Math.max(1, Math.ceil(filteredOfficers.length / adhPageSize));
  const paginatedOfficers = useMemo(() => {
    const start = (adhPage - 1) * adhPageSize;
    return filteredOfficers.slice(start, start + adhPageSize);
  }, [filteredOfficers, adhPage, adhPageSize]);

  // Adherence filtered & paginated dealers
  const filteredAdhDealers = useMemo(() => {
    if (!adh?.by_dealer) return [];
    if (!adhDealerSearch.trim()) return adh.by_dealer;
    const q = adhDealerSearch.toLowerCase();
    return adh.by_dealer.filter(d =>
      (d.dealer_name || '').toLowerCase().includes(q) ||
      (d.sap_code || '').toLowerCase().includes(q) ||
      (d.emp_name || '').toLowerCase().includes(q) ||
      (d.emp_code || '').toLowerCase().includes(q)
    );
  }, [adh, adhDealerSearch]);

  const totalDealerPages = Math.max(1, Math.ceil(filteredAdhDealers.length / adhDealerPageSize));
  const paginatedAdhDealers = useMemo(() => {
    const start = (adhDealerPage - 1) * adhDealerPageSize;
    return filteredAdhDealers.slice(start, start + adhDealerPageSize);
  }, [filteredAdhDealers, adhDealerPage, adhDealerPageSize]);

  // Load unplanned visits for admin tab
  const loadAdminUnplannedVisits = async () => {
    setUnplannedLoading(true);
    try {
      const res = await api.getUnplannedVisits({
        periodMonth: month,
        employeeCode: unplannedOfficerFilter,
        search: unplannedSearch,
        limit: unplannedPageSize,
        offset: (unplannedPage - 1) * unplannedPageSize
      });
      setUnplannedList(res.visits || []);
      setUnplannedTotal(res.total || 0);
    } catch (err) {
      onShowToast?.(err.message || 'Failed to fetch unplanned visits', 'error');
      setUnplannedList([]);
      setUnplannedTotal(0);
    } finally {
      setUnplannedLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'unplanned') {
      loadAdminUnplannedVisits();
    }
    // eslint-disable-next-line
  }, [tab, month, unplannedOfficerFilter, unplannedPage, unplannedPageSize]);

  const exportUnplannedCsv = () => {
    if (!unplannedList.length) {
      onShowToast?.('No unplanned visits to export', 'error');
      return;
    }
    const head = 'Visit Date,Employee Code,Employee Name,Customer Code,Mapped SAP Code,Customer Name,Customer Type,Route,Branch,Check In,Check Out,Duration,Status,Plan Type,Reason,Remarks\n';
    const body = unplannedList.map(u => [
      u.visit_date, u.employee_code, `"${u.employee_name || ''}"`,
      u.customer_code, u.mapped_sap_code || '', `"${u.customer_name || ''}"`,
      u.customer_type || '', `"${u.route || ''}"`, `"${u.branch || ''}"`,
      u.check_in_time || '', u.check_out_time || '', u.duration || '',
      u.visit_status || '', 'UNPLANNED', `"${u.reason || ''}"`, `"${(u.remarks || '').replace(/"/g, '""')}"`
    ].join(',')).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Unplanned_Visits_${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const loadPlans = async () => {
    setLoading(true);
    try {
      const res = await api.getAllOfficerPlans({ month, cycle, status, role, search });
      setData(res);
    } catch (e) {
      onShowToast?.(e.message || 'Failed to load plans', 'error');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (tab === 'plans') loadPlans(); /* eslint-disable-next-line */ }, [tab, month, cycle, status, role]);

  useEffect(() => {
    if (tab === 'adherence') {
      runAdherence(true);
    }
    // eslint-disable-next-line
  }, [tab, month, adhCycle]);

  const openDetail = async (planId) => {
    setDetailLoading(true);
    setDetail({ loading: true });
    try {
      const res = await api.getOfficerPlanDetail(planId);
      setDetail(res.plan);
    } catch (e) {
      onShowToast?.(e.message || 'Failed to load plan detail', 'error');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const runAdherence = async (isAuto = false) => {
    setAdhLoading(true);
    try {
      const res = await api.getAdherenceReport(month, { cycle: adhCycle, asOn: asOn || undefined });
      setAdh(res);
      if (!isAuto) {
        onShowToast?.(
          `${month} ${res.cycles.join('+')} as on ${res.as_on_date}: ` +
          `${res.totals.adhered} adhered against ${res.totals.mtd_due} due — ${res.adherence.capped_pct}%.`,
          'success'
        );
      }
    } catch (e) {
      onShowToast?.(e.message || 'Adherence report failed', 'error');
      setAdh(null);
    } finally {
      setAdhLoading(false);
    }
  };

  // Adherence → C2 regeneration → officer plans, in one action. This is the same
  // pipeline "Run DJP" uses; the only difference is that the missed C1 dealers are
  // fed in so they lead each officer's C2 schedule. C1 is left untouched.
  const regenerateFromAdherence = async () => {
    if (!window.confirm(
      `Rebuild C2 for ${month} from the adherence result?\n\n` +
      `Existing C2 targets, plans and recommendations for this month are replaced, and fresh ` +
      `plans are generated for every SO, ASM, RSM and ZH. C1 is not touched.`
    )) return;

    setRegenLoading(true);
    try {
      const res = await api.regenerateC2Plans(month);
      setRegenResult(res);
      onShowToast?.(res.message || 'C2 regenerated', 'success');
      await runAdherence();
    } catch (e) {
      onShowToast?.(e.message || 'C2 regeneration failed', 'error');
    } finally {
      setRegenLoading(false);
    }
  };

  const loadRegens = async () => {
    setRegenViewLoading(true);
    try {
      const res = await api.listC2Regenerations(month);
      setRegens(res);
      // Open the newest one straight away — that is almost always the one being reviewed.
      if (res.regenerations.length > 0) await openRegen(res.regenerations[0].id);
      else setRegen(null);
    } catch (e) {
      onShowToast?.(e.message || 'Failed to load C2 regenerations', 'error');
      setRegens(null); setRegen(null);
    } finally {
      setRegenViewLoading(false);
    }
  };

  const openRegen = async (id) => {
    try {
      const res = await api.getC2Regeneration(id);
      setRegen(res);
      setExpandedOfficer(null);
      setChangeFilter('ALL');
    } catch (e) {
      onShowToast?.(e.message || 'Failed to load the regeneration', 'error');
    }
  };

  useEffect(() => { if (tab === 'c2' && !regens) loadRegens(); /* eslint-disable-next-line */ }, [tab]);

  const visibleChanges = useMemo(() => {
    if (!regen) return [];
    return changeFilter === 'ALL' ? regen.changes : regen.changes.filter(c => c.change === changeFilter);
  }, [regen, changeFilter]);

  const exportPlansCsv = () => {
    if (!data?.plans?.length) { onShowToast?.('Nothing to export', 'error'); return; }
    const head = 'Plan ID,Period,Cycle,Emp Code,Emp Name,Role,Status,Visits,Dealers,Days,Approver Code,Approver Name,Approver Role,Rectifications,Submitted At,Approved At\n';
    const body = data.plans.map(p => [
      p.plan_id, p.period_month, p.cycle_code, p.employee.emp_code, `"${p.employee.emp_name || ''}"`,
      p.employee.role, p.status, p.counts.visits, p.counts.dealers, p.counts.working_days,
      p.approver.emp_code || '', `"${p.approver.name || ''}"`, p.approver.role || '',
      p.rectification.count, p.timestamps.submitted_at || '', p.timestamps.approved_at || ''
    ].join(',')).join('\n');
    const blob = new Blob([head + body], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Officer_Plans_${month}_${cycle}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const totals = data?.totals;
  const roles = useMemo(() => Object.keys(totals?.by_role || {}), [totals]);

  return (
    <div>
      <style>{`
        .op-tabs { display:flex; gap:4px; margin-bottom:18px; border-bottom:1px solid var(--border); }
        .op-tab { padding:10px 18px; background:none; border:none; cursor:pointer;
                  font-size:.88rem; font-weight:600; color:var(--text-tertiary);
                  border-bottom:2px solid transparent; display:flex; align-items:center; gap:7px; }
        .op-tab.active { color:var(--star-red); border-bottom-color:var(--star-red); }
        .op-row:hover { background:var(--bg-hover); cursor:pointer; }
        .op-bar { height:7px; border-radius:var(--radius-full); background:var(--bg-hover); overflow:hidden; min-width:70px; }
        .op-bar > i { display:block; height:100%; border-radius:var(--radius-full); }
        .op-note { display:flex; gap:10px; padding:12px 14px; border-radius:var(--radius-md);
                   font-size:.82rem; line-height:1.5; margin-bottom:16px; align-items:flex-start; }
        .op-day { border:1px solid var(--border-subtle); border-radius:var(--radius-md); margin-bottom:10px; overflow:hidden; }
        .op-day-head { display:flex; justify-content:space-between; align-items:center;
                       padding:9px 14px; background:var(--bg-hover); font-weight:700; font-size:.82rem; }
        .op-visit { display:flex; justify-content:space-between; align-items:center; gap:12px;
                    padding:9px 14px; border-top:1px solid var(--border-subtle); font-size:.82rem; }
        .op-pagination { display:flex; align-items:center; justify-content:space-between;
                         padding:12px 16px; border-top:1px solid var(--border-subtle);
                         font-size:.82rem; color:var(--text-secondary); flex-wrap:wrap; gap:12px; }
        .op-page-btn { padding:4px 10px; border:1px solid var(--border); background:var(--card-bg, #fff);
                       color:var(--text-primary); border-radius:var(--radius-sm, 6px); cursor:pointer;
                       font-size:.78rem; font-weight:500; display:inline-flex; align-items:center; gap:3px; }
        .op-page-btn:hover:not(:disabled) { background:var(--bg-hover); border-color:var(--border-strong, #ccc); }
        .op-page-btn:disabled { opacity:.4; cursor:not-allowed; }
        .op-page-btn.active { background:var(--star-red); color:#fff; border-color:var(--star-red); font-weight:700; }
        .subview-toggle { display:inline-flex; border:1px solid var(--border); border-radius:var(--radius-md); overflow:hidden; }
        .subview-btn { padding:5px 12px; background:var(--card-bg, #fff); border:none; cursor:pointer; font-size:.78rem; font-weight:600; color:var(--text-secondary); }
        .subview-btn.active { background:var(--star-red); color:#fff; }
      `}</style>

      <div className="op-tabs">
        <button className={`op-tab ${tab === 'plans' ? 'active' : ''}`} onClick={() => setTab('plans')}>
          <ClipboardList size={16} /> Officer Plans
        </button>
        <button className={`op-tab ${tab === 'adherence' ? 'active' : ''}`} onClick={() => setTab('adherence')}>
          <Activity size={16} /> Adherence
        </button>
        <button className={`op-tab ${tab === 'unplanned' ? 'active' : ''}`} onClick={() => setTab('unplanned')}>
          <AlertTriangle size={16} /> Unplanned Visits
          {unplannedTotal > 0 && (
            <span style={{
              background: 'var(--color-warning-bg, #FEF3C7)',
              color: '#B45309',
              padding: '1px 7px',
              borderRadius: 999,
              fontSize: '.7rem',
              fontWeight: 700
            }}>
              {unplannedTotal}
            </span>
          )}
        </button>
        <button className={`op-tab ${tab === 'c2' ? 'active' : ''}`} onClick={() => setTab('c2')}>
          <GitCompare size={16} /> C2 Review
        </button>
      </div>

      {/* ═══════════════════════════ PLANS ═══════════════════════════ */}
      {tab === 'plans' && (
        <>
          {/* C1 / C2 switch — counts stay live because the backend computes them
              before the cycle filter is applied */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '.78rem', color: 'var(--text-tertiary)', marginRight: 4, fontWeight: 600 }}>
              CYCLE
            </span>
            {[
              { id: 'ALL', label: 'Both cycles' },
              { id: 'C1',  label: 'C1 · days 1–15' },
              { id: 'C2',  label: 'C2 · days 16–end' }
            ].map(c => {
              const active = cycle === c.id;
              const n = data?.cycleCounts?.[c.id];
              return (
                <button key={c.id} onClick={() => setCycle(c.id)}
                  style={{
                    padding: '7px 15px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                    fontSize: '.8rem', fontWeight: 600,
                    border: `1px solid ${active ? 'var(--star-red)' : 'var(--border)'}`,
                    background: active ? 'var(--star-red)' : 'var(--card-bg)',
                    color: active ? 'var(--text-inverse)' : 'var(--text-secondary)'
                  }}>
                  {c.label}
                  {n !== undefined && (
                    <span style={{ marginLeft: 7, opacity: .75, fontWeight: 500 }}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="filter-card">
            <div className="filter-grid">
              <div className="form-group">
                <label className="form-label">Plan Month</label>
                <input type="month" className="form-control" value={month} onChange={e => setMonth(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Status</label>
                <select className="form-control" value={status} onChange={e => setStatus(e.target.value)}>
                  <option value="ALL">All statuses</option>
                  {STATUS_ORDER.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <select className="form-control" value={role} onChange={e => setRole(e.target.value)}>
                  <option value="ALL">All roles</option>
                  {['SO', 'ASM', 'RSM', 'ZH'].map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Search officer or approver</label>
                <div className="input-with-icon">
                  <Search size={15} className="input-icon" />
                  <input className="form-control" placeholder="Name or code…" value={search}
                         onChange={e => setSearch(e.target.value)}
                         onKeyDown={e => e.key === 'Enter' && loadPlans()} />
                </div>
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <button className="btn btn-primary" onClick={loadPlans} disabled={loading}>
                  <RefreshCw size={15} className={loading ? 'spin' : ''} /> Refresh
                </button>
                <button className="btn btn-outline" onClick={exportPlansCsv}>
                  <Download size={15} /> CSV
                </button>
              </div>
            </div>
          </div>

          {totals && (
            <div className="kpi-grid">
              <Kpi label="Plans generated" value={totals.plans} sub={`${totals.visits} scheduled visits`} />
              <Kpi label="Awaiting approval" value={totals.by_status.SUBMITTED || 0} sub="with the L1 approver" tone="var(--color-warning)" />
              <Kpi label="Sent back" value={totals.by_status.RECTIFY || 0} sub="agent is rectifying" tone="var(--color-pink)" />
              <Kpi label="Approved" value={totals.by_status.APPROVED || 0} sub="final" tone="var(--color-success)" />
              <Kpi label="Roles covered" value={roles.length}
                   sub={roles.map(r => `${r} ${totals.by_role[r]}`).join(' · ') || '—'} />
              <Kpi label="Needs attention" value={totals.unrouted + totals.empty}
                   sub={`${totals.unrouted} unrouted · ${totals.empty} empty`}
                   tone={(totals.unrouted + totals.empty) > 0 ? 'var(--color-danger)' : undefined} />
            </div>
          )}

          {totals?.unrouted > 0 && (
            <div className="op-note" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
              <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>{totals.unrouted} plan(s) have no L1 approver.</strong> They will not appear in anyone's
                approval inbox and the officer cannot submit them. The officer's superior is missing from the
                territory hierarchy — fix the mapping, then re-run routing.
              </span>
            </div>
          )}

          <div className="content-card">
            <div className="card-title-bar">
              <div>
                <div className="card-title">Generated plans</div>
                <div className="card-subtitle">
                  {data ? `${data.returned} of ${data.count} plans` : 'Loading…'} · click a row for the day-wise plan
                </div>
              </div>
            </div>

            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Plan</th><th>Officer</th><th>Role</th><th>Cycle</th>
                    <th style={{ textAlign: 'right' }}>Visits</th>
                    <th style={{ textAlign: 'right' }}>Dealers</th>
                    <th style={{ textAlign: 'right' }}>Days</th>
                    <th>Date range</th><th>L1 Approver</th><th>Status</th><th>Sent back</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.plans || []).map(p => (
                    <tr key={p.plan_id} className="op-row" onClick={() => openDetail(p.plan_id)}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.78rem' }}>#{p.plan_id}</td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{p.employee.emp_name}</div>
                        <div style={{ fontSize: '.72rem', color: 'var(--text-tertiary)' }}>{p.employee.emp_code}</div>
                      </td>
                      <td>{p.employee.role}</td>
                      <td>{p.cycle_code}</td>
                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{p.counts.visits}</td>
                      <td style={{ textAlign: 'right' }}>{p.counts.dealers}</td>
                      <td style={{ textAlign: 'right' }}>{p.counts.working_days}</td>
                      <td style={{ fontSize: '.76rem', color: 'var(--text-secondary)' }}>
                        {p.date_range.from ? `${p.date_range.from} → ${p.date_range.to}` : '—'}
                      </td>
                      <td>
                        {p.approver.emp_code
                          ? <><div style={{ fontSize: '.8rem' }}>{p.approver.name || p.approver.emp_code}</div>
                              <div style={{ fontSize: '.7rem', color: 'var(--text-tertiary)' }}>{p.approver.role}</div></>
                          : <span style={{ color: 'var(--color-danger)', fontSize: '.76rem' }}>unrouted</span>}
                      </td>
                      <td><StatusPill status={p.status} /></td>
                      <td style={{ textAlign: 'center' }}>
                        {p.rectification.count > 0
                          ? <span title={p.rectification.remarks || ''} style={{ color: 'var(--color-pink)', fontWeight: 700 }}>
                              {p.rectification.count}×
                            </span>
                          : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                      </td>
                    </tr>
                  ))}
                  {!loading && (data?.plans || []).length === 0 && (
                    <tr><td colSpan={11} style={{ textAlign: 'center', padding: 36, color: 'var(--text-tertiary)' }}>
                      No plans for these filters. Generate the DJP for this month first.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      {/* ═══════════════════════════ ADHERENCE ═══════════════════════════ */}
      {tab === 'adherence' && (
        <>
          <div className="filter-card">
            <div className="filter-grid">
              <div className="form-group">
                <label className="form-label">Plan Month</label>
                <input type="month" className="form-control" value={month}
                       onChange={e => { setMonth(e.target.value); setAsOn(''); }} />
              </div>
              <div className="form-group">
                <label className="form-label">Cycle</label>
                <select className="form-control" value={adhCycle}
                        onChange={e => { setAdhCycle(e.target.value); setAsOn(''); }}>
                  <option value="C1">C1 · days 1–15</option>
                  <option value="C2">C2 · days 16–end</option>
                  <option value="ALL">Both cycles</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">As on date</label>
                <input type="date" className="form-control" value={asOn}
                       onChange={e => setAsOn(e.target.value)} />
                <span style={{ fontSize: '.72rem', color: 'var(--text-tertiary)' }}>
                  {asOn ? 'manual' : adhCycle === 'C1' ? 'defaults to the 15th — SFA feedback day' : 'defaults to month end'}
                </span>
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <button className="btn btn-primary" onClick={runAdherence} disabled={adhLoading || regenLoading}>
                  <Activity size={15} className={adhLoading ? 'spin' : ''} />
                  {adhLoading ? 'Analysing…' : 'Run adherence'}
                </button>
                <button className="btn btn-outline" onClick={regenerateFromAdherence}
                        disabled={regenLoading || adhLoading} title="Rebuild C2 and regenerate every officer's plan">
                  <RefreshCw size={15} className={regenLoading ? 'spin' : ''} />
                  {regenLoading ? 'Regenerating…' : 'Regenerate C2 + plans'}
                </button>
              </div>
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.5 }}>
              MTD due is the planned visit count prorated by how much of the cycle has elapsed at the
              as-on date. Adherence is adhered ÷ MTD due, falling back to the full plan when MTD due
              is below 1. <strong>Run adherence</strong> changes nothing;
              <strong> Regenerate C2 + plans</strong> rebuilds the second cycle through the same
              pipeline “Run DJP” uses. C1 is never touched.
            </div>
          </div>

          {regenResult && (
            <div className="op-note" style={{ background: 'var(--color-success-bg)', color: 'var(--color-success)' }}>
              <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>
                <strong>{regenResult.message}</strong>
                {regenResult.officerPlans?.byRole && (
                  <div style={{ marginTop: 5, fontSize: '.78rem' }}>
                    {Object.entries(regenResult.officerPlans.byRole).map(([r, v]) => (
                      <span key={r} style={{ marginRight: 14 }}>{r}: {v.plansCreated} plan(s), {v.visitsScheduled} visits</span>
                    ))}
                  </div>
                )}
              </span>
            </div>
          )}

          {adh && (
            <>
              <div className="kpi-grid">
                <Kpi label="Planned visits" value={adh.totals.planned_visits}
                     sub={`${adh.totals.dealers_on_plan} dealers on plan`} />
                <Kpi label="MTD due" value={adh.totals.mtd_due}
                     sub={`as on ${adh.as_on_date}`} />
                <Kpi label="Adhered" value={adh.totals.adhered} tone="var(--color-success)"
                     sub={`capped ${adh.totals.adhered_capped} · ${adh.totals.sfa_visits_in_window} SFA visits in window`} />
                <Kpi label="Adherence (capped)" value={`${adh.adherence.capped_pct}%`}
                     sub={adh.adherence.raw_pct !== adh.adherence.capped_pct ? `raw ${adh.adherence.raw_pct}%` : 'raw is the same'}
                     tone={adh.adherence.capped_pct >= 70 ? 'var(--color-success)' : 'var(--color-warning)'} />
                <Kpi label="Pending" value={adh.totals.pending}
                     sub={adh.totals.pending < 0 ? 'negative — over-visited' : 'MTD due − adhered'}
                     tone={adh.totals.pending < 0 ? 'var(--color-info)' : undefined} />
                <Kpi label="Coverage" value={`${adh.adherence.coverage_pct}%`}
                     sub={`${adh.totals.dealers_visited} visited · ${adh.totals.dealers_missed} missed`} />
              </div>

              {adh.diagnostics.resolved_via_sfa_code > 0 && (
                <div className="op-note" style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}>
                  <CheckCircle2 size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    <strong>{adh.diagnostics.resolved_via_sfa_code} visit(s) were logged with the SFA
                    customer code and resolved to the SAP code the plan uses.</strong>{' '}
                    Before the engine did this they counted as missed.
                  </span>
                </div>
              )}

              {(adh.diagnostics.unresolved_visits > 0 || adh.diagnostics.unplanned_visits > 0) && (
                <div className="op-note" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
                  <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {adh.diagnostics.unresolved_visits > 0 && (
                      <div><strong>{adh.diagnostics.unresolved_visits} visit(s)</strong> carry a customer
                      code that matches no dealer — they cannot be credited to anyone.
                      {adh.diagnostics.unresolved_detail.slice(0, 3).map(u => (
                        <div key={u.customer_code + u.visit_date} style={{ fontFamily: 'var(--font-mono)', fontSize: '.74rem' }}>
                          {u.visit_date} · {u.customer_code} · {u.customer_name}
                        </div>
                      ))}</div>
                    )}
                    {adh.diagnostics.unplanned_visits > 0 && (
                      <div style={{ marginTop: adh.diagnostics.unresolved_visits > 0 ? 6 : 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
                          <div>
                            <strong>{adh.diagnostics.unplanned_visits} visit(s)</strong> were made to dealers
                            not on that person's plan.
                          </div>
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={() => setShowUnplanned(!showUnplanned)}
                            style={{ fontSize: '.74rem', padding: '2px 10px', height: 'auto', background: 'white' }}
                          >
                            {showUnplanned ? 'Hide Unplanned Visits' : `View Unplanned Visits (${adh.diagnostics.unplanned_visits})`}
                          </button>
                        </div>
                        {showUnplanned && adh.diagnostics.unplanned_detail && adh.diagnostics.unplanned_detail.length > 0 && (
                          <div style={{ marginTop: 8, maxHeight: 220, overflowY: 'auto', background: 'white', borderRadius: 6, border: '1px solid var(--border-color)', padding: 8 }}>
                            <table style={{ width: '100%', fontSize: '.75rem', borderCollapse: 'collapse' }}>
                              <thead>
                                <tr style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Date</th>
                                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Officer</th>
                                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Customer Code</th>
                                  <th style={{ textAlign: 'left', padding: '4px 6px' }}>Customer Name</th>
                                </tr>
                              </thead>
                              <tbody>
                                {adh.diagnostics.unplanned_detail.map((u, i) => (
                                  <tr key={u.customer_code + u.visit_date + i} style={{ borderBottom: '1px solid var(--bg-hover)' }}>
                                    <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>{u.visit_date}</td>
                                    <td style={{ padding: '4px 6px' }}>{u.employee_name || u.employee_code}</td>
                                    <td style={{ padding: '4px 6px', fontFamily: 'var(--font-mono)' }}>{u.customer_code}</td>
                                    <td style={{ padding: '4px 6px' }}>{u.customer_name}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </span>
                </div>
              )}

              <div className="content-card">
                <div className="card-title-bar">
                  <div>
                    <div className="card-title">By cycle and role</div>
                    <div className="card-subtitle">
                      elapsed fraction is how much of each cycle had passed on {adh.as_on_date}
                    </div>
                  </div>
                </div>
                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>Scope</th><th style={{ textAlign: 'right' }}>Elapsed</th>
                        <th style={{ textAlign: 'right' }}>Dealers</th>
                        <th style={{ textAlign: 'right' }}>Planned</th>
                        <th style={{ textAlign: 'right' }}>MTD due</th>
                        <th style={{ textAlign: 'right' }}>Adhered</th>
                        <th style={{ textAlign: 'right' }}>Capped %</th>
                        <th style={{ textAlign: 'right' }}>Raw %</th>
                        <th style={{ textAlign: 'right' }}>Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(adh.by_cycle).map(([c, v]) => (
                        <tr key={c}>
                          <td style={{ fontWeight: 700 }}>Cycle {c}</td>
                          <td style={{ textAlign: 'right' }}>{Math.round(v.elapsed_fraction * 100)}%</td>
                          <td style={{ textAlign: 'right' }}>{v.dealers}</td>
                          <td style={{ textAlign: 'right' }}>{v.planned}</td>
                          <td style={{ textAlign: 'right' }}>{v.mtd_due}</td>
                          <td style={{ textAlign: 'right' }}>{v.adhered}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{v.capped_pct}%</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-tertiary)' }}>{v.raw_pct}%</td>
                          <td style={{ textAlign: 'right', color: v.pending < 0 ? 'var(--color-info)' : undefined }}>{v.pending}</td>
                        </tr>
                      ))}
                      {Object.entries(adh.by_role).map(([r, v]) => (
                        <tr key={r}>
                          <td style={{ paddingLeft: 22, color: 'var(--text-secondary)' }}>{r}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-tertiary)' }}>—</td>
                          <td style={{ textAlign: 'right' }}>{v.dealers}</td>
                          <td style={{ textAlign: 'right' }}>{v.planned}</td>
                          <td style={{ textAlign: 'right' }}>{v.mtd_due}</td>
                          <td style={{ textAlign: 'right' }}>{v.adhered}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>{v.capped_pct}%</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-tertiary)' }}>{v.raw_pct}%</td>
                          <td style={{ textAlign: 'right', color: v.pending < 0 ? 'var(--color-info)' : undefined }}>{v.pending}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="content-card">
                <div className="card-title-bar" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div className="card-title">
                      Adherence Diagnostics ({adhViewMode === 'officer' ? `${filteredOfficers.length} Officers` : `${filteredAdhDealers.length} Dealers`})
                    </div>
                    <div className="card-subtitle">
                      {adhViewMode === 'officer'
                        ? 'Sorted by adherence % · click an officer row for missed dealers'
                        : 'Granular dealer targets vs actual visits across routes'}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="subview-toggle">
                      <button
                        type="button"
                        className={`subview-btn ${adhViewMode === 'officer' ? 'active' : ''}`}
                        onClick={() => { setAdhViewMode('officer'); setAdhPage(1); }}
                      >
                        By Officer ({adh.by_employee?.length || 0})
                      </button>
                      <button
                        type="button"
                        className={`subview-btn ${adhViewMode === 'dealer' ? 'active' : ''}`}
                        onClick={() => { setAdhViewMode('dealer'); setAdhDealerPage(1); }}
                      >
                        By Dealer ({adh.by_dealer?.length || 0})
                      </button>
                    </div>
                  </div>
                </div>

                {adhViewMode === 'officer' && (
                  <>
                    <div style={{ display: 'flex', gap: 10, padding: '12px 16px', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap', alignItems: 'center' }}>
                      <div className="input-with-icon" style={{ flex: '1 1 200px', minWidth: 180 }}>
                        <Search size={14} className="input-icon" />
                        <input
                          className="form-control"
                          placeholder="Search officer name or code..."
                          style={{ height: 32, fontSize: '.8rem' }}
                          value={adhOfficerSearch}
                          onChange={e => { setAdhOfficerSearch(e.target.value); setAdhPage(1); }}
                        />
                        {adhOfficerSearch && (
                          <button
                            type="button"
                            onClick={() => { setAdhOfficerSearch(''); setAdhPage(1); }}
                            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      <select
                        className="form-control"
                        style={{ width: 'auto', height: 32, fontSize: '.8rem' }}
                        value={adhRoleFilter}
                        onChange={e => { setAdhRoleFilter(e.target.value); setAdhPage(1); }}
                      >
                        <option value="ALL">All Roles</option>
                        {['SO', 'TSO', 'ASM', 'RSM', 'ZH'].map(r => (
                          <option key={r} value={r}>{r}</option>
                        ))}
                      </select>

                      <select
                        className="form-control"
                        style={{ width: 'auto', height: 32, fontSize: '.8rem' }}
                        value={adhBandFilter}
                        onChange={e => { setAdhBandFilter(e.target.value); setAdhPage(1); }}
                      >
                        <option value="ALL">All Adherence Levels</option>
                        <option value="CRITICAL">Critical (&lt; 70%)</option>
                        <option value="GOOD">Normal (70% – 99%)</option>
                        <option value="FULL">Complete / Over (&gt;= 100%)</option>
                      </select>

                      <div style={{ marginLeft: 'auto', fontSize: '.78rem', color: 'var(--text-secondary)' }}>
                        Showing {paginatedOfficers.length} of {filteredOfficers.length} officers
                      </div>
                    </div>

                    <div className="table-responsive">
                      <table>
                        <thead>
                          <tr>
                            <th>Officer</th><th>Role</th>
                            <th style={{ textAlign: 'right' }}>Planned</th>
                            <th style={{ textAlign: 'right' }}>MTD due</th>
                            <th style={{ textAlign: 'right' }}>Adhered</th>
                            <th style={{ textAlign: 'right' }}>Pending</th>
                            <th style={{ width: 180 }}>Adherence (capped)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedOfficers.map(e => (
                            <React.Fragment key={`${e.role}-${e.emp_code}`}>
                              <tr className="op-row" onClick={() => setExpandedEmp(expandedEmp === e.emp_code ? null : e.emp_code)}>
                                <td>
                                  <div style={{ fontWeight: 600 }}>{e.emp_name || e.emp_code}</div>
                                  <div style={{ fontSize: '.72rem', color: 'var(--text-tertiary)' }}>{e.emp_code}</div>
                                </td>
                                <td>{e.role}</td>
                                <td style={{ textAlign: 'right' }}>{e.planned_visits}</td>
                                <td style={{ textAlign: 'right' }}>{e.mtd_due}</td>
                                <td style={{ textAlign: 'right', color: 'var(--color-success)', fontWeight: 600 }}>
                                  {e.adhered}
                                  {e.adhered !== e.adhered_capped && (
                                    <span style={{ color: 'var(--text-tertiary)', fontWeight: 400 }}> ({e.adhered_capped})</span>
                                  )}
                                </td>
                                <td style={{ textAlign: 'right', color: e.pending < 0 ? 'var(--color-info)' : 'var(--color-danger)', fontWeight: 600 }}>
                                  {e.pending}
                                </td>
                                <td>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                                    <div className="op-bar" style={{ flex: 1 }}>
                                      <i style={{
                                        width: `${Math.min(100, e.capped_pct)}%`,
                                        background: e.capped_pct >= 70 ? 'var(--color-success)'
                                                  : e.capped_pct >= 40 ? 'var(--color-warning)'
                                                  : 'var(--color-danger)'
                                      }} />
                                    </div>
                                    <span style={{ fontWeight: 700, fontSize: '.82rem', minWidth: 46, textAlign: 'right' }}>
                                      {e.capped_pct}%
                                    </span>
                                  </div>
                                </td>
                              </tr>
                              {expandedEmp === e.emp_code && e.missed_dealers.length > 0 && (
                                <tr>
                                  <td colSpan={7} style={{ background: 'var(--bg-hover)', padding: '12px 18px' }}>
                                    <div style={{ fontSize: '.76rem', fontWeight: 700, marginBottom: 7, color: 'var(--text-secondary)' }}>
                                      Missed dealers ({e.missed_dealers.length}) — these get priority in C2
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
                                      {e.missed_dealers.map(d => (
                                        <div key={d.sap_code} style={{ fontSize: '.8rem', padding: '6px 10px', background: 'var(--card-bg, #fff)', border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
                                          <div style={{ fontWeight: 600 }}>{d.name}</div>
                                          <div style={{ fontSize: '.72rem', color: 'var(--text-tertiary)' }}>
                                            SAP: <span style={{ fontFamily: 'var(--font-mono)' }}>{d.sap_code}</span>
                                            {d.planned_date && <span style={{ marginLeft: 8 }}>Planned: {d.planned_date}</span>}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          ))}
                          {filteredOfficers.length === 0 && (
                            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 36, color: 'var(--text-tertiary)' }}>
                              No officers found matching search/filter criteria.
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <PaginationControls
                      page={adhPage}
                      totalPages={totalOfficerPages}
                      totalItems={filteredOfficers.length}
                      pageSize={adhPageSize}
                      onPageChange={setAdhPage}
                      onPageSizeChange={sz => { setAdhPageSize(sz); setAdhPage(1); }}
                      pageSizeOptions={[10, 25, 50, 100]}
                      itemName="officers"
                    />
                  </>
                )}

                {adhViewMode === 'dealer' && (
                  <>
                    <div style={{ display: 'flex', gap: 10, padding: '12px 16px', background: 'var(--bg-hover)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'wrap', alignItems: 'center' }}>
                      <div className="input-with-icon" style={{ flex: '1 1 250px', minWidth: 200 }}>
                        <Search size={14} className="input-icon" />
                        <input
                          className="form-control"
                          placeholder="Search dealer name, SAP code, officer..."
                          style={{ height: 32, fontSize: '.8rem' }}
                          value={adhDealerSearch}
                          onChange={e => { setAdhDealerSearch(e.target.value); setAdhDealerPage(1); }}
                        />
                        {adhDealerSearch && (
                          <button
                            type="button"
                            onClick={() => { setAdhDealerSearch(''); setAdhDealerPage(1); }}
                            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}
                          >
                            <X size={13} />
                          </button>
                        )}
                      </div>

                      <div style={{ marginLeft: 'auto', fontSize: '.78rem', color: 'var(--text-secondary)' }}>
                        Showing {paginatedAdhDealers.length} of {filteredAdhDealers.length} dealers
                      </div>
                    </div>

                    <div className="table-responsive">
                      <table>
                        <thead>
                          <tr>
                            <th>Dealer</th><th>Assigned Officer</th><th>Cycle</th>
                            <th style={{ textAlign: 'right' }}>Planned</th>
                            <th style={{ textAlign: 'right' }}>MTD due</th>
                            <th style={{ textAlign: 'right' }}>Adhered</th>
                            <th style={{ textAlign: 'right' }}>Pending</th>
                            <th style={{ width: 140 }}>Adherence</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paginatedAdhDealers.map((d, idx) => (
                            <tr key={`${d.sap_code}-${d.cycle}-${idx}`}>
                              <td>
                                <div style={{ fontWeight: 600 }}>{d.dealer_name}</div>
                                <div style={{ fontSize: '.72rem', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>SAP: {d.sap_code}</div>
                              </td>
                              <td>
                                <div style={{ fontSize: '.82rem' }}>{d.emp_name || d.emp_code}</div>
                                <div style={{ fontSize: '.7rem', color: 'var(--text-tertiary)' }}>{d.emp_code} ({d.role})</div>
                              </td>
                              <td>{d.cycle}</td>
                              <td style={{ textAlign: 'right' }}>{d.planned}</td>
                              <td style={{ textAlign: 'right' }}>{d.mtd_due}</td>
                              <td style={{ textAlign: 'right', color: 'var(--color-success)', fontWeight: 600 }}>{d.adhered}</td>
                              <td style={{ textAlign: 'right', color: d.pending < 0 ? 'var(--color-info)' : 'var(--color-danger)' }}>{d.pending}</td>
                              <td>
                                <span style={{
                                  fontWeight: 700,
                                  color: d.capped_pct >= 100 ? 'var(--color-success)' : d.capped_pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)'
                                }}>
                                  {d.capped_pct}%
                                </span>
                              </td>
                            </tr>
                          ))}
                          {filteredAdhDealers.length === 0 && (
                            <tr><td colSpan={8} style={{ textAlign: 'center', padding: 36, color: 'var(--text-tertiary)' }}>
                              No dealers found matching the search criteria.
                            </td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <PaginationControls
                      page={adhDealerPage}
                      totalPages={totalDealerPages}
                      totalItems={filteredAdhDealers.length}
                      pageSize={adhDealerPageSize}
                      onPageChange={setAdhDealerPage}
                      onPageSizeChange={sz => { setAdhDealerPageSize(sz); setAdhDealerPage(1); }}
                      pageSizeOptions={[15, 30, 50, 100]}
                      itemName="dealers"
                    />
                  </>
                )}
              </div>
            </>
          )}

          {!adh && !adhLoading && (
            <div className="content-card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
              <Users size={30} style={{ opacity: .35, marginBottom: 10 }} />
              <div>Upload the SFA visit report on the ingestion screen, then run the check.</div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════ UNPLANNED VISITS ═══════════════════════════ */}
      {tab === 'unplanned' && (
        <>
          <div className="filter-card">
            <div className="filter-grid">
              <div className="form-group">
                <label className="form-label">Month</label>
                <input
                  type="month"
                  className="form-control"
                  value={month}
                  onChange={e => { setMonth(e.target.value); setUnplannedPage(1); }}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Officer</label>
                <select
                  className="form-control"
                  value={unplannedOfficerFilter}
                  onChange={e => { setUnplannedOfficerFilter(e.target.value); setUnplannedPage(1); }}
                >
                  <option value="ALL">All Officers</option>
                  {(adh?.by_employee || []).map(e => (
                    <option key={e.emp_code} value={e.emp_code}>
                      {e.emp_name ? `${e.emp_name} (${e.emp_code})` : e.emp_code}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Search</label>
                <div className="input-with-icon">
                  <Search size={14} className="input-icon" />
                  <input
                    className="form-control"
                    placeholder="Customer code, name, route, branch..."
                    value={unplannedSearch}
                    onChange={e => setUnplannedSearch(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        setUnplannedPage(1);
                        loadAdminUnplannedVisits();
                      }
                    }}
                  />
                  {unplannedSearch && (
                    <button
                      type="button"
                      onClick={() => { setUnplannedSearch(''); setUnplannedPage(1); }}
                      style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => { setUnplannedPage(1); loadAdminUnplannedVisits(); }}
                  disabled={unplannedLoading}
                >
                  <RefreshCw size={15} className={unplannedLoading ? 'spin' : ''} /> Refresh
                </button>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={exportUnplannedCsv}
                  disabled={unplannedList.length === 0}
                >
                  <Download size={15} /> Export CSV
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, flexWrap: 'wrap', gap: 8, fontSize: '.78rem' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>
                Visits made to dealers or counters outside the officer's scheduled DJP monthly plan.
              </span>
              <span style={{
                background: 'var(--color-info-bg, #E0F2FE)',
                color: 'var(--color-info, #0369A1)',
                padding: '2px 8px',
                borderRadius: '4px',
                fontWeight: 600
              }}>
                Cutoff: Strictly synced up to T-1 day (yesterday)
              </span>
            </div>
          </div>

          <div className="kpi-grid">
            <Kpi
              label="Total Unplanned Visits"
              value={unplannedTotal}
              sub={`for month ${month}`}
              tone={unplannedTotal > 0 ? 'var(--color-warning)' : 'var(--color-success)'}
            />
            <Kpi
              label="Sync Window"
              value="Till T-1 Day"
              sub="Protects against intraday incomplete logs"
              tone="var(--color-info)"
            />
            <Kpi
              label="Plan Classification"
              value="Unplanned"
              sub="Dealer not on officer's target plan"
            />
          </div>

          <div className="content-card">
            <div className="card-title-bar">
              <div>
                <div className="card-title">Unplanned Visits Log</div>
                <div className="card-subtitle">
                  {unplannedLoading ? 'Loading…' : `${unplannedTotal} visit(s) identified outside scheduled plans`}
                </div>
              </div>
            </div>

            <div className="table-responsive">
              <table>
                <thead>
                  <tr>
                    <th>Visit Date</th>
                    <th>Officer</th>
                    <th>Customer Code</th>
                    <th>Customer Name</th>
                    <th>Area / Branch</th>
                    <th>Route</th>
                    <th>Check In / Out</th>
                    <th>Duration</th>
                    <th>Plan Type</th>
                    <th>Reason</th>
                    <th>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {unplannedList.map((u, i) => (
                    <tr key={u.id || i}>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.78rem', whiteSpace: 'nowrap' }}>
                        {u.visit_date}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.employee_name || u.employee_code}</div>
                        <div style={{ fontSize: '.72rem', color: 'var(--text-tertiary)' }}>{u.employee_code}</div>
                      </td>
                      <td>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: '.78rem' }}>
                          {u.customer_code}
                        </div>
                        {u.mapped_sap_code && (
                          <div style={{ fontSize: '.7rem', color: 'var(--text-tertiary)' }}>
                            SAP: {u.mapped_sap_code}
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{u.customer_name}</div>
                        {u.customer_type && (
                          <span style={{ fontSize: '.7rem', color: 'var(--text-secondary)' }}>
                            {u.customer_type}
                          </span>
                        )}
                      </td>
                      <td>{u.branch || '—'}</td>
                      <td>{u.route || '—'}</td>
                      <td style={{ fontSize: '.78rem', whiteSpace: 'nowrap' }}>
                        {u.check_in_time ? `${u.check_in_time} → ${u.check_out_time || '—'}` : '—'}
                      </td>
                      <td style={{ fontSize: '.78rem' }}>{u.duration || '—'}</td>
                      <td>
                        <span style={{
                          background: 'var(--color-warning-bg, #FEF3C7)',
                          color: '#B45309',
                          padding: '3px 8px',
                          borderRadius: 4,
                          fontSize: '.72rem',
                          fontWeight: 700
                        }}>
                          Unplanned
                        </span>
                      </td>
                      <td style={{ fontSize: '.78rem', color: 'var(--text-secondary)' }}>
                        {u.reason || "Dealer not on officer's plan"}
                      </td>
                      <td style={{ fontSize: '.78rem', color: 'var(--text-tertiary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.remarks || ''}>
                        {u.remarks || '—'}
                      </td>
                    </tr>
                  ))}
                  {!unplannedLoading && unplannedList.length === 0 && (
                    <tr>
                      <td colSpan={11} style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
                        No unplanned visits found for {month}. All visits adhered to beat plans!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <PaginationControls
              page={unplannedPage}
              totalPages={Math.max(1, Math.ceil(unplannedTotal / unplannedPageSize))}
              totalItems={unplannedTotal}
              pageSize={unplannedPageSize}
              onPageChange={setUnplannedPage}
              onPageSizeChange={sz => { setUnplannedPageSize(sz); setUnplannedPage(1); }}
              pageSizeOptions={[15, 30, 50, 100]}
              itemName="unplanned visits"
            />
          </div>
        </>
      )}

      {/* ═══════════════════════════ C2 REVIEW ═══════════════════════════ */}
      {tab === 'c2' && (
        <>
          <div className="filter-card">
            <div className="filter-grid">
              <div className="form-group">
                <label className="form-label">Plan Month</label>
                <input type="month" className="form-control" value={month}
                       onChange={e => { setMonth(e.target.value); setRegen(null); setRegens(null); }} />
              </div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button className="btn btn-primary" onClick={loadRegens} disabled={regenViewLoading}>
                  <History size={15} className={regenViewLoading ? 'spin' : ''} /> Load regenerations
                </button>
              </div>
            </div>
            <div style={{ fontSize: '.78rem', color: 'var(--text-tertiary)', marginTop: 4, lineHeight: 1.5 }}>
              Regenerating C2 deletes the plan it replaces, so the comparison here is made against a
              snapshot taken either side of that purge — not against the live tables, which may have
              been edited since. Only regenerations run after <code>migrate-c2-review.js</code> have one.
            </div>
          </div>

          {regens && regens.regenerations.length === 0 && (
            <div className="content-card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
              <GitCompare size={30} style={{ opacity: .35, marginBottom: 10 }} />
              <div>No C2 regeneration recorded for {month}.</div>
              <div style={{ fontSize: '.8rem', marginTop: 6 }}>
                Run one from the Adherence tab, then come back.
              </div>
            </div>
          )}

          {regens && regens.regenerations.length > 0 && (
            <div className="content-card">
              <div className="card-title-bar">
                <div>
                  <div className="card-title">Regeneration history</div>
                  <div className="card-subtitle">newest first · click a row to see what it changed</div>
                </div>
              </div>
              <div className="table-responsive">
                <table>
                  <thead>
                    <tr>
                      <th>Run</th><th>When</th><th>Adherence that drove it</th>
                      <th style={{ textAlign: 'right' }}>Plans before → after</th>
                      <th style={{ textAlign: 'right' }}>Visits before → after</th>
                      <th style={{ textAlign: 'right' }}>Delta</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {regens.regenerations.map(r => (
                      <tr key={r.id} className="op-row" onClick={() => openRegen(r.id)}
                          style={regen?.regeneration?.id === r.id ? { background: 'var(--bg-hover)' } : undefined}>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.74rem' }}>#{r.id}</td>
                        <td style={{ fontSize: '.78rem' }}>{String(r.started_at).slice(0, 16)}</td>
                        <td style={{ fontSize: '.8rem' }}>
                          {r.adherence.adhered} of {r.adherence.planned} · {r.adherence.pct}%
                          <span style={{ color: 'var(--text-tertiary)' }}> · {r.adherence.missed} missed</span>
                          {r.adherence.as_on && (
                            <span style={{ color: 'var(--text-tertiary)' }}> · as on {r.adherence.as_on}</span>
                          )}
                        </td>
                        <td style={{ textAlign: 'right' }}>{r.before.plans} → {r.after.plans}</td>
                        <td style={{ textAlign: 'right' }}>{r.before.visits} → {r.after.visits}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700,
                                     color: r.visit_delta > 0 ? 'var(--color-success)'
                                          : r.visit_delta < 0 ? 'var(--color-danger)' : undefined }}>
                          {r.visit_delta > 0 ? '+' : ''}{r.visit_delta}
                        </td>
                        <td>
                          {r.first_run
                            ? <span className="badge" title="No earlier C2 existed, so there is nothing to diff against">first run</span>
                            : <StatusPill status={r.status === 'COMPLETED' ? 'APPROVED' : 'DRAFT'} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {regen && (
            <>
              <div className="kpi-grid">
                <Kpi label="Dealers on the new C2" value={regen.summary.dealers_after}
                     sub={`was ${regen.summary.dealers_before} · ${regen.summary.assignments_after} officer visits`} />
                <Kpi label="Added" value={regen.summary.added} tone="var(--color-success)"
                     sub="not on the previous C2" />
                <Kpi label="Dropped" value={regen.summary.dropped} tone="var(--color-danger)"
                     sub="were on it, now gone" />
                <Kpi label="Moved earlier" value={regen.summary.moved_earlier} tone="var(--color-info)"
                     sub={`${regen.summary.moved_later} moved later`} />
                <Kpi label="Missed in C1, now covered" value={regen.summary.missed_c1_dealers_on_new_c2}
                     sub={`of ${regen.summary.missed_c1_dealers_total} missed · ${regen.summary.missed_c1_assignments_on_new_c2} officer visits`}
                     tone={regen.summary.missed_c1_dealers_on_new_c2 < regen.summary.missed_c1_dealers_total
                           ? 'var(--color-warning)' : 'var(--color-success)'} />
                <Kpi label="Unchanged" value={regen.summary.unchanged}
                     sub="same dealer, same first date" />
              </div>

              {regen.regeneration.first_run && (
                <div className="op-note" style={{ background: 'var(--color-info-bg)', color: 'var(--color-info)' }}>
                  <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    There was no earlier C2 to compare against, so every dealer shows as added.
                    The next regeneration for this month will produce a real diff.
                  </span>
                </div>
              )}

              {regen.summary.missed_c1_dealers_on_new_c2 < regen.summary.missed_c1_dealers_total && (
                <div className="op-note" style={{ background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>
                  <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    <strong>
                      {regen.summary.missed_c1_dealers_total - regen.summary.missed_c1_dealers_on_new_c2} dealer(s)
                      missed in C1 did not make it onto the new C2.
                    </strong>{' '}
                    That happens when a dealer's visit frequency is zero for the cycle — a Churn dealer, for
                    instance — so prioritising it has nothing to schedule.
                  </span>
                </div>
              )}

              <div className="content-card">
                <div className="card-title-bar">
                  <div>
                    <div className="card-title">What changed</div>
                    <div className="card-subtitle">
                      carried-over dealers first · compared per employee and dealer, so a reorder shows as a move rather than an add and a drop
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['ALL', 'ADDED', 'MOVED_EARLIER', 'MOVED_LATER', 'DROPPED'].map(f => (
                      <button key={f} onClick={() => setChangeFilter(f)}
                        style={{
                          padding: '5px 12px', borderRadius: 'var(--radius-full)', cursor: 'pointer',
                          fontSize: '.74rem', fontWeight: 600,
                          border: `1px solid ${changeFilter === f ? 'var(--star-red)' : 'var(--border)'}`,
                          background: changeFilter === f ? 'var(--star-red)' : 'var(--card-bg)',
                          color: changeFilter === f ? 'var(--text-inverse)' : 'var(--text-secondary)'
                        }}>
                        {f === 'ALL' ? 'All' : f.replace('_', ' ').toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>Change</th><th>Officer</th><th>Role</th><th>Dealer</th>
                        <th>Was</th><th>Now</th><th style={{ textAlign: 'center' }}>From C1</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleChanges.map((c, i) => (
                        <tr key={`${c.emp_code}-${c.dealer_sap_code}-${i}`}>
                          <td><ChangeChip change={c.change} /></td>
                          <td>
                            <div style={{ fontSize: '.82rem' }}>{c.emp_name || c.emp_code}</div>
                            <div style={{ fontSize: '.7rem', color: 'var(--text-tertiary)' }}>{c.emp_code}</div>
                          </td>
                          <td>{c.emp_role}</td>
                          <td>
                            <div style={{ fontSize: '.82rem' }}>{c.dealer_name}</div>
                            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '.7rem', color: 'var(--text-tertiary)' }}>
                              {c.dealer_sap_code}
                            </div>
                          </td>
                          <td style={{ fontSize: '.76rem', color: 'var(--text-tertiary)' }}>
                            {c.before_dates?.length ? c.before_dates.join(', ') : '—'}
                          </td>
                          <td style={{ fontSize: '.76rem' }}>
                            {c.dates?.length ? c.dates.join(', ') : '—'}
                          </td>
                          <td style={{ textAlign: 'center' }}>
                            {c.was_missed_in_c1
                              ? <span style={{ color: 'var(--color-warning)', fontWeight: 700 }} title="Missed in C1, carried into C2">●</span>
                              : <span style={{ color: 'var(--text-tertiary)' }}>—</span>}
                          </td>
                        </tr>
                      ))}
                      {visibleChanges.length === 0 && (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: 30, color: 'var(--text-tertiary)' }}>
                          {regen.changes.length === 0
                            ? 'The regeneration produced an identical C2 — nothing moved.'
                            : 'No changes of this type.'}
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="content-card">
                <div className="card-title-bar">
                  <div>
                    <div className="card-title">The regenerated C2 plans</div>
                    <div className="card-subtitle">
                      officers with the most carried-over dealers first · click to open the schedule
                    </div>
                  </div>
                </div>
                <div className="table-responsive">
                  <table>
                    <thead>
                      <tr>
                        <th>Officer</th><th>Role</th>
                        <th style={{ textAlign: 'right' }}>Visits</th>
                        <th style={{ textAlign: 'right' }}>Dealers</th>
                        <th style={{ textAlign: 'right' }}>Days</th>
                        <th style={{ textAlign: 'right' }}>Carried over</th>
                        <th style={{ textAlign: 'right' }}>Changes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {regen.officers.map(o => (
                        <React.Fragment key={o.emp_code}>
                          <tr className="op-row" onClick={() => setExpandedOfficer(expandedOfficer === o.emp_code ? null : o.emp_code)}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{o.emp_name || o.emp_code}</div>
                              <div style={{ fontSize: '.72rem', color: 'var(--text-tertiary)' }}>{o.emp_code}</div>
                            </td>
                            <td>{o.role}</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{o.visits}</td>
                            <td style={{ textAlign: 'right' }}>{o.dealers}</td>
                            <td style={{ textAlign: 'right' }}>{o.days}</td>
                            <td style={{ textAlign: 'right', color: o.carried_over > 0 ? 'var(--color-warning)' : undefined, fontWeight: 600 }}>
                              {o.carried_over || '—'}
                            </td>
                            <td style={{ textAlign: 'right' }}>{o.changes.length || '—'}</td>
                          </tr>
                          {expandedOfficer === o.emp_code && (
                            <tr>
                              <td colSpan={7} style={{ background: 'var(--bg-hover)', padding: '14px 18px' }}>
                                {Object.entries(o.lines.reduce((acc, l) => {
                                  (acc[l.visit_date] = acc[l.visit_date] || []).push(l); return acc;
                                }, {})).map(([date, visits]) => (
                                  <div className="op-day" key={date} style={{ background: 'var(--card-bg)' }}>
                                    <div className="op-day-head">
                                      <span><CalendarDays size={14} style={{ verticalAlign: -2, marginRight: 7 }} />{date}</span>
                                      <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>{visits.length} visits</span>
                                    </div>
                                    {visits.map((v, i) => (
                                      <div className="op-visit" key={`${v.dealer_sap_code}-${i}`}>
                                        <div>
                                          <span style={{ color: 'var(--text-tertiary)', marginRight: 9 }}>{v.sequence}.</span>
                                          <strong>{v.dealer_name}</strong>
                                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.72rem', color: 'var(--text-tertiary)', marginLeft: 9 }}>
                                            {v.dealer_sap_code}
                                          </span>
                                        </div>
                                        {v.carried_over && (
                                          <span style={{
                                            background: 'var(--color-warning-bg)', color: 'var(--color-warning)',
                                            padding: '2px 9px', borderRadius: 'var(--radius-full)',
                                            fontSize: '.7rem', fontWeight: 700
                                          }}>missed in C1</span>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {!regens && !regenViewLoading && (
            <div className="content-card" style={{ textAlign: 'center', padding: 48, color: 'var(--text-tertiary)' }}>
              <GitCompare size={30} style={{ opacity: .35, marginBottom: 10 }} />
              <div>Pick a month and load the regenerations.</div>
            </div>
          )}
        </>
      )}

      {/* ═══════════════════════════ DETAIL DRAWER ═══════════════════════════ */}
      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal-dialog fullscreen" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="card-title">
                  {detail.loading ? 'Loading…' : `${detail.employee?.emp_name} — ${detail.period_month} ${detail.cycle_code}`}
                </div>
                {!detail.loading && (
                  <div className="card-subtitle">
                    {detail.employee?.role} · {detail.counts?.visits} visits to {detail.counts?.dealers} dealers
                    across {detail.counts?.working_days} days ·{' '}
                    approver {detail.approver?.name || detail.approver?.emp_code || '—'} ({detail.approver?.role || '—'})
                  </div>
                )}
              </div>
              <button className="btn-icon" onClick={() => setDetail(null)}><X size={19} /></button>
            </div>

            <div className="modal-body">
              {detailLoading && <div style={{ padding: 30, textAlign: 'center' }}>Loading plan…</div>}

              {!detailLoading && detail.days && (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
                    <StatusPill status={detail.status} />
                    {Object.entries(detail.category_mix || {}).map(([k, v]) => (
                      <span key={k} className="badge" style={{ fontSize: '.72rem' }}>{k}: {v}</span>
                    ))}
                  </div>

                  {detail.rectification?.count > 0 && (
                    <div className="op-note" style={{ background: 'var(--color-pink-bg)', color: 'var(--color-pink)' }}>
                      <AlertTriangle size={17} style={{ flexShrink: 0, marginTop: 1 }} />
                      <span>
                        <strong>Sent back by {detail.rectification.requested_by}</strong> on{' '}
                        {String(detail.rectification.requested_at).slice(0, 16)} — “{detail.rectification.remarks}”.
                        {detail.rectification.remaining === 0 && ' No further send-back is available; the next submission must be approved.'}
                      </span>
                    </div>
                  )}

                  {detail.days.map(d => (
                    <div className="op-day" key={d.visit_date}>
                      <div className="op-day-head">
                        <span><CalendarDays size={14} style={{ verticalAlign: -2, marginRight: 7 }} />{d.visit_date}</span>
                        <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>{d.visit_count} visits</span>
                      </div>
                      {d.visits.map(v => (
                        <div className="op-visit" key={v.detail_id}>
                          <div>
                            <span style={{ color: 'var(--text-tertiary)', marginRight: 9 }}>{v.sequence}.</span>
                            <strong>{v.dealer.name}</strong>
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '.72rem', color: 'var(--text-tertiary)', marginLeft: 9 }}>
                              {v.dealer.sap_code}
                            </span>
                            {v.dealer.block && (
                              <span style={{ fontSize: '.74rem', color: 'var(--text-tertiary)', marginLeft: 9 }}>· {v.dealer.block}</span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 7, alignItems: 'center' }}>
                            {v.final_category && <span className="badge">{v.final_category}</span>}
                            {v.grade && <span className="badge">{v.grade}</span>}
                            {v.source === 'AGENT' && (
                              <span style={{ fontSize: '.7rem', color: 'var(--color-info)' }}>added by officer</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}

                  {detail.history?.length > 0 && (
                    <div style={{ marginTop: 20 }}>
                      <div className="card-title" style={{ fontSize: '.88rem', marginBottom: 9 }}>Approval trail</div>
                      {detail.history.map((h, i) => (
                        <div key={i} style={{ display: 'flex', gap: 10, fontSize: '.8rem', padding: '5px 0' }}>
                          {h.action_type === 'APPROVED'
                            ? <CheckCircle2 size={15} style={{ color: 'var(--color-success)' }} />
                            : h.action_type === 'RECTIFY'
                              ? <AlertTriangle size={15} style={{ color: 'var(--color-pink)' }} />
                              : <Activity size={15} style={{ color: 'var(--text-tertiary)' }} />}
                          <span style={{ fontWeight: 600, minWidth: 110 }}>{h.action_type}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>by {h.action_by}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>{String(h.created_at).slice(0, 16)}</span>
                          {h.remarks && <span style={{ color: 'var(--text-tertiary)' }}>— {h.remarks}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
