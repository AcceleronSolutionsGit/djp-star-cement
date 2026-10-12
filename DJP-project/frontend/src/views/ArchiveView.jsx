import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Database, Archive, CalendarDays, BarChart2, Shield, Trash2, RefreshCw, Users, ClipboardList, AlertTriangle } from 'lucide-react';

export default function ArchiveView({ onShowToast, selectedPeriod }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [period, setPeriod] = useState(selectedPeriod || '');

  const loadSummary = async () => {
    setLoading(true);
    try {
      const data = await api.getArchiveSummary(period);
      if (data.success) {
        setSummary(data.summary);
      }
    } catch (err) {
      onShowToast?.(err.message || 'Failed to load archive summary', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSummary();
  }, [period]);

  const handleDeleteArchives = async () => {
    const scopeMsg = period ? `for period ${period}` : 'for ALL TIME';
    if (!window.confirm(`Are you sure you want to permanently delete archive records ${scopeMsg}?\n\nThis cannot be undone.`)) {
      return;
    }

    setDeleting(true);
    try {
      const res = await api.deleteArchives(period || null);
      onShowToast?.(res.message || 'Archive data deleted successfully', 'success');
      await loadSummary();
    } catch (err) {
      onShowToast?.(err.message || 'Failed to delete archives', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const statCards = [
    {
      label: 'Preserved Plans',
      count: summary?.plansTotal ?? (summary?.salesPlans || 0),
      sub: `${(summary?.salesPlans || 0).toLocaleString()} plans, ${(summary?.salesPlanDetails || 0).toLocaleString()} visits`,
      icon: ClipboardList,
      color: '#059669',
      bg: '#D1FAE5'
    },
    {
      label: 'Master Data Preserved',
      count: summary?.masterTotal ?? ((summary?.masterDealers || 0) + (summary?.masterEmployees || 0)),
      sub: `${(summary?.masterDealers || 0).toLocaleString()} dealers, ${(summary?.masterEmployees || 0).toLocaleString()} employees`,
      icon: Users,
      color: '#2563EB',
      bg: '#EFF6FF'
    },
    {
      label: 'Visits & Targets',
      count: summary?.visitsTotal ?? ((summary?.visitLogs || 0) + (summary?.dealerTargets || 0)),
      sub: `${(summary?.visitLogs || 0).toLocaleString()} logs, ${(summary?.dealerTargets || 0).toLocaleString()} targets`,
      icon: CalendarDays,
      color: '#7C3AED',
      bg: '#F5F3FF'
    },
    {
      label: 'Sales & History',
      count: summary?.historyTotal ?? (summary?.salesHistory || 0),
      sub: `${(summary?.salesHistory || 0).toLocaleString()} sales records`,
      icon: BarChart2,
      color: '#D97706',
      bg: '#FEF3C7'
    }
  ];

  const archiveDetails = [
    { title: 'Sales Plans Archive', table: 'sales_plans_archive', count: summary?.salesPlans || 0, desc: 'Beat plans generated for SO, ASM, RSM, ZH' },
    { title: 'Plan Details Archive', table: 'sales_plan_details_archive', count: summary?.salesPlanDetails || 0, desc: 'Date-wise scheduled visits per dealer' },
    { title: 'Master Dealers Archive', table: 'master_dealers_archive', count: summary?.masterDealers || 0, desc: 'Dealers, prospects and classification states' },
    { title: 'Master Employees Archive', table: 'master_employees_archive', count: summary?.masterEmployees || 0, desc: 'Sales officers, managers and hierarchy' },
    { title: 'Dealer SO Mapping Archive', table: 'master_dealer_so_mapping_archive', count: summary?.masterDealerSoMapping || 0, desc: 'Territory and employee hierarchy relationships' },
    { title: 'SFA Execution Logs Archive', table: 'visit_execution_logs_archive', count: summary?.visitLogs || 0, desc: 'Field visit check-ins and attendance records' },
    { title: 'Dealer Visit Targets Archive', table: 'dealer_visit_targets_archive', count: summary?.dealerTargets || 0, desc: 'Monthly PJP visit targets and visit frequencies' },
    { title: 'Sales History Archive', table: 'sales_history_archive', count: summary?.salesHistory || 0, desc: 'Historical monthly volume and lifting data' },
  ];

  const totalCount = summary?.totalArchived || 0;

  return (
    <div>
      <div className="content-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={20} color="var(--star-red)" /> Data Archives
            </h3>
            <p className="card-subtitle">
              Cold-storage repository for historical data. Whenever active data is purged, all plans, master records and visits created are safely archived here.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <input 
              type="month" 
              className="form-control"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              style={{ width: '180px' }}
              title="Filter archive by period month"
            />
            <button 
              className={`btn ${!period ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setPeriod('')}
              style={{ padding: '6px 12px', fontSize: '.82rem' }}
            >
              All Time
            </button>
            <button 
              className="btn btn-outline"
              onClick={loadSummary}
              disabled={loading}
              style={{ padding: '6px 12px', fontSize: '.82rem' }}
              title="Refresh archive statistics"
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>
            <button
              className="btn btn-outline"
              onClick={handleDeleteArchives}
              disabled={deleting || loading || totalCount === 0}
              style={{
                color: 'var(--star-red)',
                borderColor: 'var(--star-red)',
                padding: '6px 14px',
                fontSize: '.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontWeight: 600
              }}
              title="Permanently delete historical archives"
            >
              <Trash2 size={15} />
              <span>{deleting ? 'Deleting Archives…' : 'Delete Archives'}</span>
            </button>
          </div>
        </div>

        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: '#64748B' }}>
            <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px', display: 'block', color: 'var(--star-red)' }} />
            Loading archive statistics…
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginTop: '24px' }}>
              {statCards.map((stat, i) => {
                const Icon = stat.icon;
                return (
                  <div key={i} style={{ padding: '20px', borderRadius: '12px', background: stat.bg, display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid rgba(0,0,0,0.05)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ background: 'rgba(255,255,255,0.7)', padding: '8px', borderRadius: '8px' }}>
                        <Icon size={22} color={stat.color} />
                      </div>
                      <span style={{ fontSize: '.72rem', fontWeight: 600, color: stat.color, background: 'rgba(255,255,255,0.8)', padding: '2px 8px', borderRadius: 999 }}>
                        Archived
                      </span>
                    </div>
                    <div>
                      <div style={{ fontSize: '1.9rem', fontWeight: 800, color: stat.color, lineHeight: 1.1 }}>
                        {stat.count?.toLocaleString() || 0}
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginTop: 4 }}>
                        {stat.label}
                      </div>
                      <div style={{ fontSize: '0.74rem', color: '#64748B', marginTop: 2 }}>
                        {stat.sub}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: '28px' }}>
              <h4 style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span>Archive Tables Breakdown</span>
                <span style={{ fontSize: '.78rem', color: 'var(--text-tertiary)', fontWeight: 500 }}>
                  Total: {totalCount.toLocaleString()} rows in cold storage
                </span>
              </h4>
              <div className="table-responsive" style={{ border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                <table>
                  <thead>
                    <tr>
                      <th style={{ background: '#F8FAFC' }}>Archive Category</th>
                      <th style={{ background: '#F8FAFC' }}>Table Name</th>
                      <th style={{ background: '#F8FAFC' }}>Description</th>
                      <th style={{ background: '#F8FAFC', textAlign: 'right' }}>Preserved Records</th>
                    </tr>
                  </thead>
                  <tbody>
                    {archiveDetails.map((item, idx) => (
                      <tr key={idx} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA' }}>
                        <td style={{ fontWeight: 600 }}>{item.title}</td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '.78rem', color: 'var(--text-secondary)' }}>
                          {item.table}
                        </td>
                        <td style={{ fontSize: '.8rem', color: 'var(--text-tertiary)' }}>{item.desc}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: item.count > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                          {item.count.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        <div style={{ marginTop: '28px', padding: '16px 18px', background: '#F8FAFC', borderRadius: '8px', border: '1px solid #E2E8F0', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
          <Shield size={20} color="#059669" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <h4 style={{ margin: '0 0 6px 0', fontSize: '0.88rem', fontWeight: 700, color: '#334155' }}>
              Automated Archival & Purge Safeguard
            </h4>
            <p style={{ margin: 0, fontSize: '0.8rem', color: '#64748B', lineHeight: '1.55' }}>
              When <strong>Purge Old Data</strong> is triggered, all existing sales plans, plan details, employee mappings, dealer targets, and SFA visit execution logs are <strong>automatically copied into these archive tables</strong> before active tables are cleared. 
              To permanently free up database space, you can use the <strong>Delete Archives</strong> button above to delete archive records.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
