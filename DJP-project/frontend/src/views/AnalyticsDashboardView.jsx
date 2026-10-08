import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Activity, RefreshCw, BarChart2, CheckCircle, Clock } from 'lucide-react';

export default function AnalyticsDashboardView({ onShowToast }) {
  const [stats, setStats] = useState(null);
  const [adherence, setAdherence] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState(new Date());

  const loadData = async () => {
    setLoading(true);
    try {
      const [statsRes, adherenceRes] = await Promise.all([
        api.getStats(),
        api.getAdherenceReport(new Date().toISOString().slice(0, 7), { cycle: 'ALL' }).catch(() => null)
      ]);
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
      ) : (
        <div className="content-card" style={{ padding: 40, textAlign: 'center', color: '#888' }}>
          <Activity size={32} style={{ marginBottom: 10, opacity: 0.5 }}/>
          <div>Run adherence check to see analytics data.</div>
        </div>
      )}
    </div>
  );
}
