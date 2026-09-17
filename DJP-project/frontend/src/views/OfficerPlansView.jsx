import React, { useState, useEffect, useMemo } from 'react';
import {
  ClipboardList, Search, RefreshCw, X, CalendarDays, AlertTriangle,
  CheckCircle2, Activity, Users, Download, GitCompare, ArrowUp, ArrowDown,
  PlusCircle, MinusCircle, History
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

  // ── adherence tab ──────────────────────────────────────────────────────────
  const [adh, setAdh] = useState(null);
  const [adhLoading, setAdhLoading] = useState(false);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenResult, setRegenResult] = useState(null);
  const [expandedEmp, setExpandedEmp] = useState(null);
  const [adhCycle, setAdhCycle] = useState('C1');
  const [asOn, setAsOn] = useState('');   // blank = engine default (15th for C1, month end otherwise)

  // ── C2 review tab ──────────────────────────────────────────────────────────
  const [regens, setRegens] = useState(null);
  const [regen, setRegen] = useState(null);
  const [regenViewLoading, setRegenViewLoading] = useState(false);
  const [expandedOfficer, setExpandedOfficer] = useState(null);
  const [changeFilter, setChangeFilter] = useState('ALL');

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

  const runAdherence = async () => {
    setAdhLoading(true);
    try {
      const res = await api.getAdherenceReport(month, { cycle: adhCycle, asOn: asOn || undefined });
      setAdh(res);
      onShowToast?.(
        `${month} ${res.cycles.join('+')} as on ${res.as_on_date}: ` +
        `${res.totals.adhered} adhered against ${res.totals.mtd_due} due — ${res.adherence.capped_pct}%.`,
        'success'
      );
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
      `}</style>

      <div className="op-tabs">
        <button className={`op-tab ${tab === 'plans' ? 'active' : ''}`} onClick={() => setTab('plans')}>
          <ClipboardList size={16} /> Officer Plans
        </button>
        <button className={`op-tab ${tab === 'adherence' ? 'active' : ''}`} onClick={() => setTab('adherence')}>
          <Activity size={16} /> Adherence
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
                        <strong>{adh.diagnostics.unplanned_visits} visit(s)</strong> were made to dealers
                        not on that person's plan.
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
                <div className="card-title-bar">
                  <div>
                    <div className="card-title">Adherence by officer</div>
                    <div className="card-subtitle">lowest first · click a row for the missed dealers</div>
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
                      {adh.by_employee.map(e => (
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
                                  Missed dealers — these get priority in C2
                                </div>
                                {e.missed_dealers.map(d => (
                                  <div key={d.sap_code} style={{ fontSize: '.8rem', padding: '3px 0' }}>
                                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)', marginRight: 8 }}>
                                      {d.sap_code}
                                    </span>
                                    {d.name}
                                    {d.planned_date && (
                                      <span style={{ color: 'var(--text-tertiary)', marginLeft: 8 }}>planned {d.planned_date}</span>
                                    )}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      ))}
                      {adh.by_employee.length === 0 && (
                        <tr><td colSpan={7} style={{ textAlign: 'center', padding: 36, color: 'var(--text-tertiary)' }}>
                          No plans found for {adh.period_month} {adh.cycles.join(' + ')}.
                        </td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
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
