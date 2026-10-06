import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Database, Archive, CalendarDays, BarChart2, Shield } from 'lucide-react';

export default function ArchiveView({ onShowToast, selectedPeriod }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState(selectedPeriod || '');

  const loadSummary = async () => {
    setLoading(true);
    try {
      const data = await api.getArchiveSummary(period);
      if (data.success) {
        setSummary(data.summary);
      }
    } catch (err) {
      onShowToast(err.message || 'Failed to load archive summary', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, [period]);

  const statCards = [
    { label: 'SFA Execution Logs', count: summary?.visitLogs, icon: CalendarDays, color: '#4F46E5', bg: '#EEF2FF' },
    { label: 'Sales Plans', count: summary?.salesPlans, icon: Archive, color: '#059669', bg: '#D1FAE5' },
    { label: 'Sales History', count: summary?.salesHistory, icon: BarChart2, color: '#D97706', bg: '#FEF3C7' },
    { label: 'Dealer Targets', count: summary?.dealerTargets, icon: Shield, color: '#DC2626', bg: '#FEE2E2' },
  ];

  return (
    <div>
      <div className="content-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={20} /> Data Archives
            </h3>
            <p className="card-subtitle">
              Overview of historical data stored in archive tables. Data is safely stored here after being rolled over from active working tables.
            </p>
          </div>
          <div>
            <input 
              type="month" 
              className="form-control"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{ width: '200px' }}
            />
            <button className="btn btn-outline" onClick={() => setPeriod('')} style={{ marginLeft: '10px' }}>
              All Time
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>Loading archive statistics...</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '24px' }}>
            {statCards.map((stat, i) => {
              const Icon = stat.icon;
              return (
                <div key={i} style={{ padding: '20px', borderRadius: '12px', background: stat.bg, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ background: 'rgba(255,255,255,0.6)', padding: '8px', borderRadius: '8px' }}>
                      <Icon size={24} color={stat.color} />
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '2rem', fontWeight: 700, color: stat.color }}>{stat.count?.toLocaleString() || 0}</div>
                    <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#475569' }}>{stat.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: '30px', padding: '16px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0' }}>
          <h4 style={{ margin: '0 0 8px 0', fontSize: '0.9rem', color: '#334155' }}>How does Archiving work?</h4>
          <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748B', lineHeight: '1.5' }}>
            Historical data such as SFA logs and Sales Plans are periodically moved out of active tables to ensure the DJP system remains fast and optimized for current operations. 
            You can run the backend archival script <code>node src/scripts/archive-monthly-data.js YYYY-MM</code> to securely roll over data into these cold-storage tables.
          </p>
        </div>
      </div>
    </div>
  );
}
