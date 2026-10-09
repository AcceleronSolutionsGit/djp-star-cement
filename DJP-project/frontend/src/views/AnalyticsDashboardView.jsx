import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Activity, RefreshCw, BarChart2, CheckCircle, Clock } from 'lucide-react';

export default function AnalyticsDashboardView({ onShowToast }) {
  const [stats, setStats] = useState(null);
  const [adherence, setAdherence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(new Date());
  const [expandedEmp, setExpandedEmp] = useState(null);

  const loadData = async () => {
    setLoading(true);
    try {
      const statsRes = await api.getStats();
      const period = statsRes.latestPeriod || new Date().toISOString().slice(0, 7);
      const adherenceRes = await api.getAdherenceReport(period, { cycle: 'ALL' }).catch(() => null);
      
      setStats(statsRes.stats);
      setAdherence(adherenceRes);
      setLastSync(new Date());
    } catch (e) {
      onShowToast?.('Failed to load analytics', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Live update every minute
    const interval = setInterval(() => {
      loadData();
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2><BarChart2 style={{ marginRight: 10, verticalAlign: 'middle' }}/> Live Analytics Dashboard</h2>
        <div>
          <span style={{ fontSize: 12, color: '#666', marginRight: 15 }}>
            <Clock size={12} style={{ marginRight: 4, verticalAlign: 'middle' }}/>
            Last updated: {lastSync.toLocaleTimeString()}
          </span>
          <button className="btn btn-outline" onClick={loadData} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spin' : ''} style={{ marginRight: 6 }}/> Refresh
          </button>
        </div>
      </div>

      {stats && (
        <div className="kpi-grid" style={{ marginBottom: 30 }}>
          <div className="kpi-card">
            <div className="kpi-label">Total Target Dealers</div>
            <div className="kpi-value">{stats.totalDealers}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Target Areas</div>
            <div className="kpi-value">{stats.totalAreas}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">SO Planned Visits</div>
            <div className="kpi-value">{stats.soVisits}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">ASM Planned Visits</div>
            <div className="kpi-value">{stats.asmVisits}</div>
          </div>
        </div>
      )}

      {adherence ? (
        <>
        <div className="content-card">
          <div className="card-title-bar">
            <div>
              <div className="card-title">Adherence Overview</div>
              <div className="card-subtitle">Current month cycle progress</div>
            </div>
          </div>
          <div className="kpi-grid" style={{ padding: 20 }}>
            <div className="kpi-card">
              <div className="kpi-label">MTD Due</div>
              <div className="kpi-value">{adherence.totals.mtd_due}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Adhered</div>
              <div className="kpi-value" style={{ color: 'var(--color-success)' }}>{adherence.totals.adhered}</div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Adherence (Capped)</div>
              <div className="kpi-value" style={{ color: adherence.adherence.capped_pct >= 70 ? 'var(--color-success)' : 'var(--color-warning)' }}>
                {adherence.adherence.capped_pct}%
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Coverage</div>
              <div className="kpi-value">{adherence.adherence.coverage_pct}%</div>
            </div>
          </div>
        </div>

        <div className="content-card" style={{ marginTop: 20 }}>
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
                {adherence.by_employee && adherence.by_employee.map(e => (
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
                    {expandedEmp === e.emp_code && e.missed_dealers && e.missed_dealers.length > 0 && (
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
                {(!adherence.by_employee || adherence.by_employee.length === 0) && (
                  <tr><td colSpan={7} style={{ textAlign: 'center', padding: 36, color: 'var(--text-tertiary)' }}>
                    No plans found for {adherence.period_month}.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </>
      ) : (
        <div className="content-card" style={{ padding: 40, textAlign: 'center', color: '#888' }}>
          <Activity size={32} style={{ marginBottom: 10, opacity: 0.5 }}/>
          <div>Run adherence check to see analytics data.</div>
        </div>
      )}
    </div>
  );
}
