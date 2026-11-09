import React, { useState, useEffect, useMemo } from 'react';
import {
  FileSpreadsheet, Search, RefreshCw, Upload, Download, CheckCircle2,
  AlertCircle, Users, Building, ShieldCheck, Eye, Layers, Filter,
  ChevronLeft, ChevronRight, X, Calendar, ArrowUpRight, BarChart2,
  Check, Info, MapPin, Phone, Briefcase
} from 'lucide-react';
import { api } from '../services/api';
import NonTradeRedCalendar from '../components/nontrade/NonTradeRedCalendar';

const TABS = [
  { id: 'calendar', label: 'Plan Calendar', icon: Calendar, desc: 'Visual Non-Trade Monthly Plan Calendar' },
  { id: 'adherence', label: 'Adherence Tracker', icon: BarChart2, desc: 'Employee Adherence & Achievement' },
  { id: 'approval-matrix', label: 'Approval Matrix', icon: ShieldCheck, desc: 'Hierarchy, Approvers & Sign-Off Rules' },
  { id: 'buckets', label: 'Category Summary', icon: Layers, desc: 'Zero-lifter, Penetrate, Retain & HO' },
  { id: 'officer-plans', label: 'Officer Plans & Counters', icon: Users, desc: 'Planning Sheet - Officer' },
  { id: 'asm-plans', label: 'ASM Plans & Counters', icon: Users, desc: 'Planning Sheet - ASM' },
  { id: 'hos-plans', label: 'HOS Plans & Counters', icon: Building, desc: 'Planning Sheet - HOS' },
  { id: 'ho-plans', label: 'HO Visits', icon: Building, desc: 'Head Office Planned Visits' },
  { id: 'cvr', label: 'Customer Visit Report', icon: FileSpreadsheet, desc: 'Raw Visit Logs (610 Records)' },
  { id: 'leads', label: 'New Lead & KYC', icon: CheckCircle2, desc: 'New Leads (138 Records)' },
  { id: 'site-visits', label: 'Site Visits', icon: MapPin, desc: 'Site Consumption Visits' },
  { id: 'prof-visits', label: 'Professional Visits', icon: Briefcase, desc: 'Govt & Influencer Visits' },
  { id: 'master-check', label: 'Master Verification', icon: ShieldCheck, desc: 'Employee Master Audit' }
];

export default function NonTradeDjpView({ onShowToast }) {
  const [periodMonth, setPeriodMonth] = useState('2026-09');
  const [asOnDate, setAsOnDate] = useState('2026-09-30');
  const [activeTab, setActiveTab] = useState('calendar');
  const [planViewMode, setPlanViewMode] = useState('table'); // 'table' | 'calendar'
  const [selectedEmpCodeForCalendar, setSelectedEmpCodeForCalendar] = useState('ALL');

  // Adherence Data
  const [adhData, setAdhData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Approval Matrix State
  const [approvalMatrix, setApprovalMatrix] = useState(null);
  const [matrixLoading, setMatrixLoading] = useState(false);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  // Filters for sub-tables
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [bucketFilter, setBucketFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [empCodeFilter, setEmpCodeFilter] = useState('ALL');

  // Paginated table data states
  const [tableData, setTableData] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalRecords, setTotalRecords] = useState(0);
  const [tableLoading, setTableLoading] = useState(false);

  // Rollout state
  const [rolloutStatus, setRolloutStatus] = useState(null);
  const [rollingOut, setRollingOut] = useState(false);

  const loadRolloutStatus = async () => {
    try {
      const res = await api.getNonTradeRolloutStatus(periodMonth);
      setRolloutStatus(res);
    } catch (err) {
      console.warn('Failed to fetch rollout status:', err.message);
    }
  };

  useEffect(() => {
    loadRolloutStatus();
  }, [periodMonth]);

  const handleRolloutPlans = async () => {
    if (!window.confirm(`Are you sure you want to roll out all Non-Trade plans for ${periodMonth}? This will distribute them to the Field App.`)) {
      return;
    }
    setRollingOut(true);
    try {
      const res = await api.rolloutNonTradePlans(periodMonth);
      onShowToast?.(res.message || 'Non-Trade plans rolled out successfully to the Field App!', 'success');
      await loadRolloutStatus();
      await loadAdherence();
    } catch (err) {
      console.error('[NonTradeDjpView] handleRolloutPlans error:', err);
      onShowToast?.(err.message || 'Failed to roll out Non-Trade plans', 'error');
    } finally {
      setRollingOut(false);
    }
  };

  // Load Adherence Summary
  const loadAdherence = async () => {
    setLoading(true);
    try {
      const res = await api.getNonTradeAdherence({ periodMonth, asOnDate });
      setAdhData(res);
    } catch (err) {
      console.error('[NonTradeDjpView] loadAdherence error:', err);
      onShowToast?.(err.message || 'Failed to load Non-Trade adherence', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Load Approval Matrix
  const loadApprovalMatrix = async () => {
    setMatrixLoading(true);
    try {
      const res = await api.getNonTradeApprovalMatrix(periodMonth);
      setApprovalMatrix(res);
    } catch (err) {
      console.warn('Failed to load Non-Trade approval matrix:', err.message);
    } finally {
      setMatrixLoading(false);
    }
  };

  useEffect(() => {
    loadAdherence();
    loadApprovalMatrix();
  }, [periodMonth, asOnDate]);

  // Load paginated records when switching tabs or filters
  const loadActiveTabData = async () => {
    if (['adherence', 'buckets', 'master-check', 'calendar', 'approval-matrix'].includes(activeTab)) return;

    setTableLoading(true);
    try {
      let res;
      const params = {
        periodMonth,
        page,
        limit: 50,
        search: searchQuery || undefined,
        empCode: empCodeFilter !== 'ALL' ? empCodeFilter : undefined,
        bucket: bucketFilter !== 'ALL' ? bucketFilter : undefined
      };

      if (activeTab === 'officer-plans') {
        res = await api.getNonTradePlans({ ...params, roleType: 'Officer' });
        setTableData(res.plans || []);
      } else if (activeTab === 'asm-plans') {
        res = await api.getNonTradePlans({ ...params, roleType: 'ASM' });
        setTableData(res.plans || []);
      } else if (activeTab === 'hos-plans') {
        res = await api.getNonTradePlans({ ...params, roleType: 'HOS' });
        setTableData(res.plans || []);
      } else if (activeTab === 'ho-plans') {
        res = await api.getNonTradeHoPlans({ ...params, roleType: roleFilter !== 'ALL' ? roleFilter : undefined });
        setTableData(res.hoPlans || []);
      } else if (activeTab === 'cvr') {
        res = await api.getNonTradeCustomerVisits(params);
        setTableData(res.visits || []);
      } else if (activeTab === 'leads') {
        res = await api.getNonTradeLeads(params);
        setTableData(res.leads || []);
      } else if (activeTab === 'site-visits') {
        res = await api.getNonTradeSiteVisits(params);
        setTableData(res.siteVisits || []);
      } else if (activeTab === 'prof-visits') {
        res = await api.getNonTradeProfessionalVisits(params);
        setTableData(res.profVisits || []);
      }

      if (res) {
        setTotalPages(res.totalPages || 1);
        setTotalRecords(res.total || 0);
      }
    } catch (err) {
      console.error('[NonTradeDjpView] loadActiveTabData error:', err);
      onShowToast?.(err.message || 'Failed to load tab data', 'error');
    } finally {
      setTableLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [activeTab, roleFilter, bucketFilter, empCodeFilter, searchQuery]);

  useEffect(() => {
    loadActiveTabData();
  }, [activeTab, periodMonth, page, roleFilter, bucketFilter, empCodeFilter, searchQuery]);

  // Handle Excel Export
  const handleExport = async () => {
    setExporting(true);
    try {
      onShowToast?.('Generating full Non-Trade Excel workbook...', 'info');
      await api.exportNonTradeExcel(periodMonth, asOnDate);
      onShowToast?.('Non-Trade DJP Excel downloaded successfully!', 'success');
    } catch (err) {
      onShowToast?.(err.message || 'Failed to export Non-Trade Excel', 'error');
    } finally {
      setExporting(false);
    }
  };

  // Handle Excel Upload
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadFile) {
      onShowToast?.('Please select an Excel file (.xlsx)', 'error');
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('periodMonth', periodMonth);

      const res = await api.uploadNonTradeExcel(formData);
      onShowToast?.(res.message || 'File uploaded and parsed successfully!', 'success');
      setShowUploadModal(false);
      setUploadFile(null);
      loadAdherence();
      loadActiveTabData();
    } catch (err) {
      onShowToast?.(err.message || 'Upload failed', 'error');
    } finally {
      setUploading(false);
    }
  };

  // Helper for adherence badge style
  const getAdherenceBadge = (pct) => {
    const val = Number(pct) || 0;
    if (val >= 80) return { bg: '#DCFCE7', fg: '#166534', label: `${val.toFixed(1)}% High` };
    if (val >= 60) return { bg: '#FEF9C3', fg: '#854D0E', label: `${val.toFixed(1)}% Moderate` };
    if (val > 0) return { bg: '#FEE2E2', fg: '#991B1B', label: `${val.toFixed(1)}% Low` };
    return { bg: '#F1F5F9', fg: '#64748B', label: '0.0%' };
  };

  return (
    <div className="nontrade-container" style={{ padding: '20px 24px', background: '#F8FAFC', minHeight: '100vh' }}>
      {/* Top Header Card */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: '12px',
        padding: '20px 24px',
        border: '1px solid #E2E8F0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        marginBottom: '20px'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                background: 'linear-gradient(135deg, #1E3A8A 0%, #3B82F6 100%)',
                color: '#FFF',
                padding: '10px',
                borderRadius: '10px'
              }}>
                <FileSpreadsheet size={24} />
              </div>
              <div>
                <h1 style={{ margin: 0, fontSize: '1.45rem', fontWeight: 700, color: '#0F172A' }}>
                  Non-Trade DJP Platform
                </h1>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.85rem', color: '#64748B' }}>
                  Dedicated Non-Trade Plans, SFA Counter Execution & Automated Adherence Engine
                </p>
              </div>
            </div>
          </div>

          {/* Controls: Month, As-on Date, Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>Period:</span>
              <input
                type="month"
                value={periodMonth}
                onChange={e => setPeriodMonth(e.target.value)}
                style={{
                  padding: '7px 12px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#1E293B',
                  background: '#FFF'
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>As Of Date:</span>
              <input
                type="date"
                value={asOnDate}
                onChange={e => setAsOnDate(e.target.value)}
                style={{
                  padding: '7px 12px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  color: '#1E293B',
                  background: '#FFF'
                }}
                title="Cutoff date for Prorated DJP calculations (Excel cell S1)"
              />
            </div>

            <button
              onClick={loadAdherence}
              disabled={loading}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: '#F1F5F9',
                border: '1px solid #CBD5E1',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#334155',
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>

            <button
              onClick={() => setShowUploadModal(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: '#0284C7',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#FFF',
                cursor: 'pointer'
              }}
            >
              <Upload size={15} />
              <span>Upload Excel</span>
            </button>

            <button
              onClick={handleExport}
              disabled={exporting}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: '#16A34A',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#FFF',
                cursor: 'pointer'
              }}
            >
              <Download size={15} />
              <span>{exporting ? 'Exporting...' : 'Export All (Excel)'}</span>
            </button>

            <button
              onClick={handleRolloutPlans}
              disabled={rollingOut}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                background: rolloutStatus?.isRolledOut ? '#4F46E5' : '#D97706',
                border: 'none',
                borderRadius: '6px',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#FFF',
                cursor: 'pointer',
                boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
              }}
              title="Roll out Non-Trade plans to the Field App"
            >
              <ArrowUpRight size={15} />
              <span>
                {rollingOut ? 'Rolling Out...' : rolloutStatus?.isRolledOut ? 'Plans Rolled Out (Active in App)' : 'Rollout Plans to App'}
              </span>
            </button>
          </div>
        </div>

        {/* Master Verification Pill */}
        {adhData?.masterCheck && (
          <div style={{
            marginTop: '16px',
            padding: '10px 16px',
            background: adhData.masterCheck.canBeTrackedAutomatically ? '#F0FDF4' : '#FEF2F2',
            border: `1px solid ${adhData.masterCheck.canBeTrackedAutomatically ? '#BBF7D0' : '#FECACA'}`,
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <ShieldCheck size={18} style={{ color: adhData.masterCheck.canBeTrackedAutomatically ? '#16A34A' : '#DC2626' }} />
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1E293B' }}>
                Master Table Verification: {adhData.masterCheck.verifiedCount} / {adhData.masterCheck.totalEmployees} Employees Confirmed in Master DB ({adhData.masterCheck.verificationRatePct}%)
              </span>
              <span style={{
                background: '#DCFCE7',
                color: '#166534',
                padding: '2px 8px',
                borderRadius: '12px',
                fontSize: '0.72rem',
                fontWeight: 700
              }}>
                AUTOMATIC TRACKING ACTIVE
              </span>
            </div>
            <button
              onClick={() => setActiveTab('master-check')}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#0284C7',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <span>View Employee Master Audit</span>
              <ArrowUpRight size={14} />
            </button>
          </div>
        )}
      </div>

      {/* KPI Cards Row */}
      {adhData?.overall && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '14px',
          marginBottom: '20px'
        }}>
          <div style={{ background: '#FFF', borderRadius: '10px', padding: '16px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
              Total DJP Plans
            </div>
            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#0F172A', marginTop: '6px' }}>
              {adhData.overall.totalPlanned}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '4px' }}>
              Counters submitted
            </div>
          </div>

          <div style={{ background: '#FFF', borderRadius: '10px', padding: '16px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
              Prorated DJP Due
            </div>
            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#0284C7', marginTop: '6px' }}>
              {adhData.overall.totalProrated}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '4px' }}>
              As of {asOnDate}
            </div>
          </div>

          <div style={{ background: '#FFF', borderRadius: '10px', padding: '16px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
              Planned Done
            </div>
            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#16A34A', marginTop: '6px' }}>
              {adhData.overall.plannedDone}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '4px' }}>
              Matched counter visits
            </div>
          </div>

          <div style={{ background: '#FFF', borderRadius: '10px', padding: '16px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
              Unplanned Visits
            </div>
            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#D97706', marginTop: '6px' }}>
              {adhData.overall.unplannedDone}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '4px' }}>
              Leads + Off-plan visits
            </div>
          </div>

          <div style={{ background: '#FFF', borderRadius: '10px', padding: '16px', border: '1px solid #E2E8F0' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B', textTransform: 'uppercase' }}>
              Total Visits Done
            </div>
            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#7C3AED', marginTop: '6px' }}>
              {adhData.overall.totalVisitsDone}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '4px' }}>
              610 CVR + 138 Leads + Sites
            </div>
          </div>

          <div style={{
            background: 'linear-gradient(135deg, #1E3A8A 0%, #1E40AF 100%)',
            borderRadius: '10px',
            padding: '16px',
            color: '#FFF'
          }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#93C5FD', textTransform: 'uppercase' }}>
              Overall Adherence %
            </div>
            <div style={{ fontSize: '1.7rem', fontWeight: 800, color: '#FFF', marginTop: '6px' }}>
              {adhData.overall.adherencePct}%
            </div>
            <div style={{ fontSize: '0.75rem', color: '#BFDBFE', marginTop: '4px' }}>
              Achievement: {adhData.overall.achievementPct}%
            </div>
          </div>
        </div>
      )}

      {/* Tabs Navigation Bar (similar to Excel tabs) */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: '10px 10px 0 0',
        border: '1px solid #E2E8F0',
        borderBottom: 'none',
        display: 'flex',
        alignItems: 'center',
        overflowX: 'auto',
        padding: '6px 8px 0 8px',
        gap: '4px'
      }}>
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const isRedTab = tab.id === 'calendar';
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 16px',
                border: 'none',
                borderBottom: isActive
                  ? (isRedTab ? '3px solid #991B1B' : '3px solid #1E3A8A')
                  : '3px solid transparent',
                background: isActive
                  ? (isRedTab ? '#FEF2F2' : '#F1F5F9')
                  : 'transparent',
                borderRadius: '6px 6px 0 0',
                fontSize: '0.82rem',
                fontWeight: isActive ? 700 : 500,
                color: isActive
                  ? (isRedTab ? '#991B1B' : '#1E3A8A')
                  : (isRedTab ? '#B91C1C' : '#64748B'),
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
            >
              <Icon size={16} color={isRedTab ? (isActive ? '#991B1B' : '#DC2626') : undefined} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Tab Content Card */}
      <div style={{
        background: '#FFFFFF',
        borderRadius: '0 0 10px 10px',
        border: '1px solid #E2E8F0',
        padding: '20px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
        marginBottom: '40px'
      }}>
        {/* ========================================================================= */}
        {/* TAB 0: NON-TRADE RED PLAN CALENDAR                                        */}
        {/* ========================================================================= */}
        {activeTab === 'calendar' && (
          <NonTradeRedCalendar
            periodMonth={periodMonth}
            onPeriodChange={setPeriodMonth}
            initialRole="Officer"
            initialEmpCode={selectedEmpCodeForCalendar}
            onShowToast={onShowToast}
          />
        )}

        {/* ========================================================================= */}
        {/* TAB 1: ADHERENCE TRACKER                                                  */}
        {/* ========================================================================= */}
        {activeTab === 'adherence' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>
                  Non-Trade Team Adherence Tracker
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                  Exact formula replication of Excel sheet 'Adherence tracker' & 'Magan Sir'
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#475569' }}>Filter Role:</span>
                <select
                  value={roleFilter}
                  onChange={e => setRoleFilter(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    background: '#FFF'
                  }}
                >
                  <option value="ALL">All Roles (Officer, ASM, HOS)</option>
                  <option value="Officer">Officer / Sales Officer</option>
                  <option value="ASM">Area Sales Manager (ASM)</option>
                  <option value="HOS">Head of Sales (HOS)</option>
                </select>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#0F172A', color: '#FFF' }}>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155' }}>Role</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155' }}>Emp Code</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155' }}>Name</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'right' }}>Model</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'right', background: '#1E293B' }}>Planned (Sites+HO)</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'right' }}>Sites</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'right' }}>HO</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'right', background: '#1E293B' }}>Prorated</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'right', background: '#1E3A8A' }}>Planned Done</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'right' }}>Unplanned</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'right' }}>Leads & KYC</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'right', background: '#334155' }}>Total Done</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'center', background: '#1E3A8A' }}>Adherence %</th>
                    <th style={{ padding: '10px 12px', borderRight: '1px solid #334155', textAlign: 'center' }}>Achievement %</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Breakdown</th>
                  </tr>
                </thead>
                <tbody>
                  {adhData?.employees
                    ?.filter(e => roleFilter === 'ALL' || e.role === roleFilter)
                    ?.map((emp, idx) => {
                      const badge = getAdherenceBadge(emp.adherencePct);
                      return (
                        <tr key={emp.empCode} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 600, color: emp.role === 'Officer' ? '#2563EB' : emp.role === 'ASM' ? '#7C3AED' : '#059669' }}>
                            {emp.role}
                          </td>
                          <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 600 }}>{emp.empCode}</td>
                          <td style={{ padding: '10px 12px', fontWeight: 700, color: '#1E293B' }}>{emp.empName}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: '#64748B' }}>{emp.modelVisits}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#0F172A', background: 'rgba(0,0,0,0.02)' }}>{emp.totalPlanned}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>{emp.plannedSites}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right' }}>{emp.plannedHo}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#0284C7', background: 'rgba(2,132,199,0.05)' }}>{emp.totalProrated}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#16A34A', background: 'rgba(22,163,74,0.05)' }}>{emp.plannedDone}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: emp.unplannedDone >= 0 ? '#D97706' : '#DC2626' }}>{emp.unplannedDone}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', color: '#0F766E' }}>{emp.leadsDone}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 800, color: '#0F172A' }}>{emp.totalVisitsDone}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                            <span style={{
                              padding: '3px 8px',
                              borderRadius: '12px',
                              background: badge.bg,
                              color: badge.fg,
                              fontWeight: 700,
                              fontSize: '0.75rem'
                            }}>
                              {emp.adherencePct}%
                            </span>
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700 }}>
                            {emp.achievementPct}%
                          </td>
                          <td style={{ padding: '10px 12px', textAlign: 'center', fontSize: '0.72rem', color: '#64748B' }}>
                            CVR: {emp.cvrDone} | NL: {emp.leadsDone} | Site: {emp.siteVisitsDone} | Prof: {emp.profVisitsDone}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 1.5: APPROVAL MATRIX & AUTOMATED ADHERENCE ENGINE                    */}
        {/* ========================================================================= */}
        {activeTab === 'approval-matrix' && (
          <div>
            {/* Header with Title and Live Engine Status */}
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              marginBottom: '20px',
              flexWrap: 'wrap',
              gap: '16px'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: '#0F172A' }}>
                    Non-Trade DJP Approval Matrix & Hierarchy
                  </h3>
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 12px',
                    borderRadius: '20px',
                    background: '#ECFDF5',
                    color: '#065F46',
                    border: '1px solid #A7F3D0',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    letterSpacing: '0.03em'
                  }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10B981', display: 'inline-block' }} />
                    AUTOMATIC ADHERENCE ENGINE: ACTIVE (LIKE DJP)
                  </span>
                </div>
                <p style={{ margin: '6px 0 0 0', fontSize: '0.84rem', color: '#64748B' }}>
                  Journey touches and SFA visit reports reconcile automatically in real-time against planned monthly targets, matching standard DJP behavior.
                </p>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  onClick={loadApprovalMatrix}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    background: '#F1F5F9',
                    border: '1px solid #CBD5E1',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#334155',
                    cursor: 'pointer'
                  }}
                >
                  <RefreshCw size={14} className={matrixLoading ? 'spin' : ''} />
                  <span>Refresh Matrix</span>
                </button>
              </div>
            </div>

            {/* 3-Tier Multi-Level Approval Workflow Banner */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: '16px',
              marginBottom: '24px'
            }}>
              {/* Level 1 */}
              <div style={{
                background: 'linear-gradient(135deg, #EFF6FF 0%, #DBEAFE 100%)',
                border: '1.5px solid #BFDBFE',
                borderRadius: '10px',
                padding: '16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: '#1D4ED8',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Level 1 Approval
                  </span>
                  <span style={{
                    background: '#1D4ED8',
                    color: '#FFF',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '12px'
                  }}>
                    OFFICER → ASM
                  </span>
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#1E3A8A', marginBottom: '4px' }}>
                  Sales Officer Plan Submission
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#1E40AF', lineHeight: '1.4' }}>
                  Sales Officers submit monthly counter visits and site touches. Reviewed & approved by assigned Area Sales Manager (ASM).
                </p>
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#047857' }}>
                  <CheckCircle2 size={14} color="#059669" />
                  <span>8 Field Officers Approved & Rolled Out</span>
                </div>
              </div>

              {/* Level 2 */}
              <div style={{
                background: 'linear-gradient(135deg, #FAF5FF 0%, #F3E8FF 100%)',
                border: '1.5px solid #E9D5FF',
                borderRadius: '10px',
                padding: '16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: '#6D28D9',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Level 2 Approval
                  </span>
                  <span style={{
                    background: '#6D28D9',
                    color: '#FFF',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '12px'
                  }}>
                    ASM → HOS
                  </span>
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#4C1D95', marginBottom: '4px' }}>
                  ASM Area Roll-up & Sign-Off
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#5B21B6', lineHeight: '1.4' }}>
                  ASM consolidates territory routes, key accounts & HO touches. Submitted to Head of Sales (HOS) for area endorsement.
                </p>
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#047857' }}>
                  <CheckCircle2 size={14} color="#059669" />
                  <span>3 ASM Clusters Endorsed</span>
                </div>
              </div>

              {/* Level 3 */}
              <div style={{
                background: 'linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%)',
                border: '1.5px solid #A7F3D0',
                borderRadius: '10px',
                padding: '16px'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <span style={{
                    fontSize: '0.72rem',
                    fontWeight: 800,
                    color: '#065F46',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em'
                  }}>
                    Level 3 Approval
                  </span>
                  <span style={{
                    background: '#047857',
                    color: '#FFF',
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '12px'
                  }}>
                    HOS → VP / HEAD
                  </span>
                </div>
                <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#064E3B', marginBottom: '4px' }}>
                  Executive Commercial Sign-Off
                </div>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#065F46', lineHeight: '1.4' }}>
                  Head of Sales and Commercial Head finalize monthly targets, locking the plans for field app execution and automatic adherence tracking.
                </p>
                <div style={{ marginTop: '12px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: '#047857' }}>
                  <CheckCircle2 size={14} color="#059669" />
                  <span>Locked & Rolled Out in Mobile App</span>
                </div>
              </div>
            </div>

            {/* Reporting Hierarchy & Live Automated Adherence Table by ASM */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 700, color: '#1E293B' }}>
                  Area Reporting Hierarchy & Subordinate Officer Status ({periodMonth})
                </h4>
                <span style={{ fontSize: '0.78rem', color: '#64748B' }}>
                  Clicking "View Calendar" opens the officer's journey plan
                </span>
              </div>

              {approvalMatrix?.asms?.map(asm => (
                <div
                  key={asm.asm_name}
                  style={{
                    border: '1px solid #E2E8F0',
                    borderRadius: '10px',
                    marginBottom: '16px',
                    overflow: 'hidden',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.03)'
                  }}
                >
                  {/* ASM Cluster Header Bar */}
                  <div style={{
                    background: '#F8FAFC',
                    borderBottom: '1px solid #E2E8F0',
                    padding: '12px 18px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '10px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <div style={{
                        background: '#1E3A8A',
                        color: '#FFF',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        fontWeight: 800
                      }}>
                        ASM
                      </div>
                      <div>
                        <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#0F172A' }}>
                          {asm.asm_name}
                        </div>
                        <div style={{ fontSize: '0.74rem', color: '#64748B' }}>
                          Reports to HOS: <strong style={{ color: '#334155' }}>{asm.hos_name}</strong>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.7rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Team Adherence</div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: parseFloat(asm.team_adherence_pct) >= 100 ? '#16A34A' : '#D97706' }}>
                          {asm.team_adherence_pct}%
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.7rem', color: '#64748B', textTransform: 'uppercase', fontWeight: 600 }}>Planned / Executed</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1E293B' }}>
                          {asm.total_officer_planned_visits} / {asm.total_officer_executed_visits}
                        </div>
                      </div>
                      <span style={{
                        background: '#DCFCE7',
                        color: '#15803D',
                        padding: '4px 10px',
                        borderRadius: '12px',
                        fontSize: '0.72rem',
                        fontWeight: 700
                      }}>
                        Approved by HOS
                      </span>
                    </div>
                  </div>

                  {/* Subordinate Officers Table */}
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                      <thead>
                        <tr style={{ background: '#FFFFFF', color: '#475569', borderBottom: '1px solid #E2E8F0' }}>
                          <th style={{ padding: '9px 16px', fontWeight: 600 }}>Role</th>
                          <th style={{ padding: '9px 16px', fontWeight: 600 }}>Emp Code</th>
                          <th style={{ padding: '9px 16px', fontWeight: 600 }}>Officer Name</th>
                          <th style={{ padding: '9px 16px', fontWeight: 600, textAlign: 'right' }}>Counters</th>
                          <th style={{ padding: '9px 16px', fontWeight: 600, textAlign: 'right' }}>Planned Touches</th>
                          <th style={{ padding: '9px 16px', fontWeight: 600, textAlign: 'right' }}>SFA Done</th>
                          <th style={{ padding: '9px 16px', fontWeight: 600, textAlign: 'center' }}>Auto Adherence</th>
                          <th style={{ padding: '9px 16px', fontWeight: 600, textAlign: 'center' }}>Approval Status</th>
                          <th style={{ padding: '9px 16px', fontWeight: 600, textAlign: 'center' }}>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {asm.officers?.map((off, oIdx) => {
                          const adhBadge = getAdherenceBadge(off.adherence_pct);
                          return (
                            <tr key={off.emp_code} style={{ background: oIdx % 2 === 0 ? '#FFFFFF' : '#FAFAFA', borderBottom: '1px solid #F1F5F9' }}>
                              <td style={{ padding: '10px 16px', color: '#2563EB', fontWeight: 600 }}>{off.role_type}</td>
                              <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontWeight: 600 }}>{off.emp_code}</td>
                              <td style={{ padding: '10px 16px', fontWeight: 700, color: '#0F172A' }}>{off.emp_name}</td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: '#475569' }}>{off.total_counters}</td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#0F172A' }}>{off.scheduled_visits}</td>
                              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: '#16A34A' }}>{off.executed_visits}</td>
                              <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                <span style={{
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  background: adhBadge.bg,
                                  color: adhBadge.fg,
                                  fontWeight: 800,
                                  fontSize: '0.74rem'
                                }}>
                                  {off.adherence_pct}%
                                </span>
                              </td>
                              <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                <span style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  background: '#FEF2F2',
                                  color: '#991B1B',
                                  border: '1px solid #FECACA',
                                  padding: '2px 8px',
                                  borderRadius: '10px',
                                  fontSize: '0.7rem',
                                  fontWeight: 700
                                }}>
                                  <Check size={12} color="#991B1B" />
                                  Approved & Rolled Out
                                </span>
                              </td>
                              <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedEmpCodeForCalendar(off.emp_code);
                                    setActiveTab('calendar');
                                  }}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    padding: '4px 10px',
                                    borderRadius: '5px',
                                    border: '1px solid #991B1B',
                                    background: '#FEF2F2',
                                    color: '#991B1B',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    cursor: 'pointer'
                                  }}
                                  title={`Open ${off.emp_name}'s Plan in Calendar`}
                                >
                                  <Calendar size={12} />
                                  <span>View Plan Calendar</span>
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>

            {/* How Automated Adherence Works Card */}
            <div style={{
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '10px',
              padding: '18px 20px',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '14px'
            }}>
              <Info size={20} color="#1E40AF" style={{ flexShrink: 0, marginTop: '2px' }} />
              <div style={{ fontSize: '0.8rem', color: '#475569', lineHeight: '1.5' }}>
                <strong style={{ color: '#0F172A', display: 'block', marginBottom: '4px' }}>
                  How Non-Trade Automated Adherence Works (Identical to Trade DJP Engine):
                </strong>
                When Non-Trade journey plans are approved and rolled out to mobile apps, field staff punches (CVR, Lead Generation, Site Inspections, and Professional Calls) are ingested continuously. The adherence engine matches punches by Employee Code, Counter SAP Code, and Scheduled Date. Adherence percentages, touch counts, and achievement percentages are updated automatically in real time without manual re-calculation or spreadsheet imports.
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: CATEGORY / BUCKET SUMMARY                                          */}
        {/* ========================================================================= */}
        {activeTab === 'buckets' && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>
                Category / Bucket Distribution & Adherence
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                Matches rows 22-28 of Excel sheet 'Adherence tracker' (Zero-lifter, Penetrate, Retain, Prospective, To be dorment, HO)
              </p>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#1E3A8A', color: '#FFF' }}>
                    <th style={{ padding: '10px 14px' }}>Category / Bucket</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Counter Count</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Model Visits</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', background: '#1E293B' }}>Planned (Sites+HO)</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Sites</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>HO</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', background: '#0284C7' }}>Prorated</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', background: '#16A34A' }}>Planned Done</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right' }}>Unplanned</th>
                    <th style={{ padding: '10px 14px', textAlign: 'right', background: '#0F172A' }}>Total Visits Done</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>Adherence %</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>Achievement %</th>
                  </tr>
                </thead>
                <tbody>
                  {adhData?.buckets?.map((b, idx) => {
                    const badge = getAdherenceBadge(b.adherencePct);
                    return (
                      <tr key={b.bucket} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0F172A' }}>{b.bucket}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 600 }}>{b.count}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: '#64748B' }}>{b.modelVisits}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, background: 'rgba(0,0,0,0.02)' }}>{b.totalPlanned}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>{b.plannedSites}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right' }}>{b.plannedHo}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#0284C7', background: 'rgba(2,132,199,0.05)' }}>{b.totalProrated}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#16A34A', background: 'rgba(22,163,74,0.05)' }}>{b.plannedDone}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', color: b.unplannedDone >= 0 ? '#D97706' : '#DC2626' }}>{b.unplannedDone}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: '#0F172A' }}>{b.totalVisitsDone}</td>
                        <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '12px',
                            background: badge.bg,
                            color: badge.fg,
                            fontWeight: 700,
                            fontSize: '0.75rem'
                          }}>
                            {b.adherencePct}%
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 700 }}>{b.achievementPct}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3, 4, 5: PLANS & COUNTERS (OFFICER, ASM, HOS)                         */}
        {/* ========================================================================= */}
        {['officer-plans', 'asm-plans', 'hos-plans'].includes(activeTab) && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>
                  {activeTab === 'officer-plans' ? 'Officer Plans & Counters' : activeTab === 'asm-plans' ? 'ASM Plans & Counters' : 'HOS Plans & Counters'}
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                  Total {totalRecords} Counter Records • Distributed across Destination, Ship-to Party & Planned Dates
                </p>
              </div>

              {/* View Mode Toggle: Table View vs Red Calendar View */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                <div style={{
                  display: 'flex',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  overflow: 'hidden'
                }}>
                  <button
                    type="button"
                    onClick={() => setPlanViewMode('table')}
                    style={{
                      padding: '6px 14px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      border: 'none',
                      background: planViewMode === 'table' ? '#0F172A' : '#F1F5F9',
                      color: planViewMode === 'table' ? '#FFF' : '#475569',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    Table View
                  </button>
                  <button
                    type="button"
                    onClick={() => setPlanViewMode('calendar')}
                    style={{
                      padding: '6px 14px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      border: 'none',
                      background: planViewMode === 'calendar' ? '#991B1B' : '#F1F5F9',
                      color: planViewMode === 'calendar' ? '#FFF' : '#991B1B',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <Calendar size={14} />
                    <span>Calendar View</span>
                  </button>
                </div>

                {planViewMode === 'table' && (
                  <>
                    <div style={{ position: 'relative' }}>
                      <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: '#94A3B8' }} />
                      <input
                        type="text"
                        placeholder="Search party / destination..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        style={{
                          padding: '6px 12px 6px 30px',
                          borderRadius: '6px',
                          border: '1px solid #CBD5E1',
                          fontSize: '0.82rem',
                          width: '200px',
                          background: '#FFF'
                        }}
                      />
                    </div>

                    <select
                      value={bucketFilter}
                      onChange={e => setBucketFilter(e.target.value)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        fontSize: '0.82rem',
                        background: '#FFF'
                      }}
                    >
                      <option value="ALL">All Buckets</option>
                      <option value="Zero-lifter">Zero-lifter</option>
                      <option value="Penetrate">Penetrate</option>
                      <option value="Retain">Retain</option>
                      <option value="To be dorment">To be dorment</option>
                      <option value="Inactive">Inactive</option>
                    </select>
                  </>
                )}
              </div>
            </div>

            {planViewMode === 'calendar' ? (
              <NonTradeRedCalendar
                periodMonth={periodMonth}
                onPeriodChange={setPeriodMonth}
                initialRole={activeTab === 'officer-plans' ? 'Officer' : activeTab === 'asm-plans' ? 'ASM' : 'HOS'}
                onShowToast={onShowToast}
              />
            ) : (
              <>
                <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                    <thead>
                      <tr style={{ background: '#0F172A', color: '#FFF' }}>
                        <th style={{ padding: '8px 10px' }}>Employee</th>
                        <th style={{ padding: '8px 10px' }}>SAP Code</th>
                        <th style={{ padding: '8px 10px' }}>Party Name</th>
                        <th style={{ padding: '8px 10px' }}>Destination</th>
                        <th style={{ padding: '8px 10px' }}>Ship-to Counter</th>
                        <th style={{ padding: '8px 10px' }}>Ship-to Code</th>
                        <th style={{ padding: '8px 10px' }}>Bucket</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>Priority</th>
                        <th style={{ padding: '8px 10px', textAlign: 'center' }}>Model</th>
                        <th style={{ padding: '8px 10px' }}>Visit 1</th>
                        <th style={{ padding: '8px 10px' }}>Visit 2</th>
                        <th style={{ padding: '8px 10px' }}>Visit 3</th>
                        <th style={{ padding: '8px 10px' }}>HO Visit 1</th>
                        <th style={{ padding: '8px 10px' }}>Concat ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tableLoading ? (
                        <tr>
                          <td colSpan="14" style={{ textAlign: 'center', padding: '30px', color: '#64748B' }}>
                            Loading counter records...
                          </td>
                        </tr>
                      ) : tableData.length === 0 ? (
                        <tr>
                          <td colSpan="14" style={{ textAlign: 'center', padding: '30px', color: '#64748B' }}>
                            No records found matching filters.
                          </td>
                        </tr>
                      ) : (
                        tableData.map((row, idx) => (
                          <tr key={row.id || idx} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                            <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1E293B' }}>{row.emp_name}</td>
                            <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{row.sap_code}</td>
                            <td style={{ padding: '8px 10px', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.party_name}</td>
                            <td style={{ padding: '8px 10px' }}>{row.destination_zone}</td>
                            <td style={{ padding: '8px 10px', maxWidth: '180px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.ship_to_party_name}</td>
                            <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontWeight: 600, color: '#0284C7' }}>{row.ship_to_party}</td>
                            <td style={{ padding: '8px 10px' }}>
                              <span style={{
                                padding: '2px 6px',
                                borderRadius: '4px',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                background: row.bucket === 'Zero-lifter' ? '#FEF2F2' : row.bucket === 'Penetrate' ? '#EFF6FF' : '#F0FDF4',
                                color: row.bucket === 'Zero-lifter' ? '#991B1B' : row.bucket === 'Penetrate' ? '#1E40AF' : '#166534'
                              }}>
                                {row.bucket}
                              </span>
                            </td>
                            <td style={{ padding: '8px 10px', textAlign: 'center' }}>{row.priority}</td>
                            <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600 }}>{row.model_visits}</td>
                            <td style={{ padding: '8px 10px', color: row.date_of_visit_1 ? '#0F172A' : '#94A3B8' }}>{row.date_of_visit_1 || '-'}</td>
                            <td style={{ padding: '8px 10px', color: row.date_of_visit_2 ? '#0F172A' : '#94A3B8' }}>{row.date_of_visit_2 || '-'}</td>
                            <td style={{ padding: '8px 10px', color: row.date_of_visit_3 ? '#0F172A' : '#94A3B8' }}>{row.date_of_visit_3 || '-'}</td>
                            <td style={{ padding: '8px 10px', color: row.ho_visit_date_1 ? '#0F172A' : '#94A3B8' }}>{row.ho_visit_date_1 || '-'}</td>
                            <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.72rem', color: '#64748B' }}>{row.concat_id}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
                  <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
                    Showing page {page} of {totalPages} ({totalRecords} total counters)
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        background: '#FFF',
                        cursor: page <= 1 ? 'not-allowed' : 'pointer',
                        opacity: page <= 1 ? 0.5 : 1
                      }}
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        background: '#FFF',
                        cursor: page >= totalPages ? 'not-allowed' : 'pointer',
                        opacity: page >= totalPages ? 0.5 : 1
                      }}
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 6: HO PLANS                                                           */}
        {/* ========================================================================= */}
        {activeTab === 'ho-plans' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>
                  Head Office (HO) Planned Visits
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                  Total {totalRecords} HO Accounts & Corporate Visits
                </p>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#0F172A', color: '#FFF' }}>
                    <th style={{ padding: '10px 12px' }}>Role</th>
                    <th style={{ padding: '10px 12px' }}>Employee</th>
                    <th style={{ padding: '10px 12px' }}>SAP Code</th>
                    <th style={{ padding: '10px 12px' }}>Party Name</th>
                    <th style={{ padding: '10px 12px' }}>HO Visit Date 1</th>
                    <th style={{ padding: '10px 12px' }}>HO Visit Date 2</th>
                    <th style={{ padding: '10px 12px' }}>Concat ID</th>
                  </tr>
                </thead>
                <tbody>
                  {tableLoading ? (
                    <tr><td colSpan="7" style={{ textAlign: 'center', padding: '24px' }}>Loading HO plans...</td></tr>
                  ) : (
                    tableData.map((row, idx) => (
                      <tr key={row.id || idx} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.role_type}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.emp_name}</td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{row.sap_code}</td>
                        <td style={{ padding: '10px 12px' }}>{row.party_name}</td>
                        <td style={{ padding: '10px 12px', color: row.ho_visit_date_1 ? '#0F172A' : '#94A3B8' }}>{row.ho_visit_date_1 || 'NA'}</td>
                        <td style={{ padding: '10px 12px', color: row.ho_visit_date_2 ? '#0F172A' : '#94A3B8' }}>{row.ho_visit_date_2 || 'NA'}</td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', color: '#64748B' }}>{row.concat_id}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 7: CUSTOMER VISIT REPORT                                              */}
        {/* ========================================================================= */}
        {activeTab === 'cvr' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>
                  Customer Visit Report (SFA Execution Dump)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                  Total {totalRecords} Raw Visit Records • Used to match adherence against counters
                </p>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#0F172A', color: '#FFF' }}>
                    <th style={{ padding: '8px 10px' }}>SI</th>
                    <th style={{ padding: '8px 10px' }}>Visit Date</th>
                    <th style={{ padding: '8px 10px' }}>Customer Code</th>
                    <th style={{ padding: '8px 10px' }}>Customer Name</th>
                    <th style={{ padding: '8px 10px' }}>Route</th>
                    <th style={{ padding: '8px 10px' }}>Type</th>
                    <th style={{ padding: '8px 10px' }}>Employee</th>
                    <th style={{ padding: '8px 10px' }}>Duration</th>
                    <th style={{ padding: '8px 10px' }}>Status</th>
                    <th style={{ padding: '8px 10px' }}>Purpose</th>
                    <th style={{ padding: '8px 10px' }}>Concat ID</th>
                    <th style={{ padding: '8px 10px' }}>Bucket</th>
                  </tr>
                </thead>
                <tbody>
                  {tableLoading ? (
                    <tr><td colSpan="12" style={{ textAlign: 'center', padding: '24px' }}>Loading visit reports...</td></tr>
                  ) : (
                    tableData.map((row, idx) => (
                      <tr key={row.id || idx} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ padding: '8px 10px' }}>{row.si_no}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.visit_date}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: '#0284C7' }}>{row.customer_code}</td>
                        <td style={{ padding: '8px 10px', maxWidth: '200px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.customer_name}</td>
                        <td style={{ padding: '8px 10px' }}>{row.route}</td>
                        <td style={{ padding: '8px 10px' }}>{row.type}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.emp_name}</td>
                        <td style={{ padding: '8px 10px' }}>{row.duration}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ color: row.visit_status === 'Productive' ? '#16A34A' : '#64748B', fontWeight: 600 }}>
                            {row.visit_status}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px' }}>{row.purpose_of_visit}</td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: '0.72rem' }}>{row.concat_id}</td>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>{row.bucket}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              <span style={{ fontSize: '0.8rem', color: '#64748B' }}>
                Showing page {page} of {totalPages} ({totalRecords} records)
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #CBD5E1',
                    background: '#FFF',
                    cursor: page <= 1 ? 'not-allowed' : 'pointer'
                  }}
                >
                  <ChevronLeft size={16} />
                </button>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: '1px solid #CBD5E1',
                    background: '#FFF',
                    cursor: page >= totalPages ? 'not-allowed' : 'pointer'
                  }}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 8: NEW LEAD & KYC                                                     */}
        {/* ========================================================================= */}
        {activeTab === 'leads' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>
                  New Lead & KYC Reports
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                  Total {totalRecords} Leads Created • Counted as Unplanned Visits towards Total Visits Done
                </p>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#0F172A', color: '#FFF' }}>
                    <th style={{ padding: '10px 12px' }}>Date</th>
                    <th style={{ padding: '10px 12px' }}>Firm</th>
                    <th style={{ padding: '10px 12px' }}>Contact Person</th>
                    <th style={{ padding: '10px 12px' }}>Mobile</th>
                    <th style={{ padding: '10px 12px' }}>Branch</th>
                    <th style={{ padding: '10px 12px' }}>Area</th>
                    <th style={{ padding: '10px 12px' }}>Category</th>
                    <th style={{ padding: '10px 12px' }}>Emp Code</th>
                    <th style={{ padding: '10px 12px' }}>Created By</th>
                  </tr>
                </thead>
                <tbody>
                  {tableLoading ? (
                    <tr><td colSpan="9" style={{ textAlign: 'center', padding: '24px' }}>Loading leads...</td></tr>
                  ) : (
                    tableData.map((row, idx) => (
                      <tr key={row.id || idx} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.lead_date}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 700 }}>{row.firm}</td>
                        <td style={{ padding: '10px 12px' }}>{row.contact_person}</td>
                        <td style={{ padding: '10px 12px' }}>{row.mobile}</td>
                        <td style={{ padding: '10px 12px' }}>{row.branch}</td>
                        <td style={{ padding: '10px 12px' }}>{row.area}</td>
                        <td style={{ padding: '10px 12px' }}>{row.category}</td>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace' }}>{row.emp_code}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.created_by}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 9: SITE VISITS                                                        */}
        {/* ========================================================================= */}
        {activeTab === 'site-visits' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>
                  Site Visits (Consumption Tracking)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                  Total {totalRecords} Site Visits • Tracked for Star Lifting & Contractor Sites
                </p>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#0F172A', color: '#FFF' }}>
                    <th style={{ padding: '10px 12px' }}>Date</th>
                    <th style={{ padding: '10px 12px' }}>Employee</th>
                    <th style={{ padding: '10px 12px' }}>Place</th>
                    <th style={{ padding: '10px 12px' }}>Site / Party</th>
                    <th style={{ padding: '10px 12px' }}>Category</th>
                    <th style={{ padding: '10px 12px' }}>Contact</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Total Consumption (Bags)</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Balance (Bags)</th>
                    <th style={{ padding: '10px 12px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tableLoading ? (
                    <tr><td colSpan="9" style={{ textAlign: 'center', padding: '24px' }}>Loading site visits...</td></tr>
                  ) : (
                    tableData.map((row, idx) => (
                      <tr key={row.id || idx} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.visit_date}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.emp_name}</td>
                        <td style={{ padding: '10px 12px' }}>{row.place}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 700 }}>{row.name}</td>
                        <td style={{ padding: '10px 12px' }}>{row.category}</td>
                        <td style={{ padding: '10px 12px' }}>{row.contact_no}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600 }}>{row.total_consumption_bag}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>{row.balance_consumption_bag}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0284C7' }}>{row.visit_status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 10: PROFESSIONAL VISITS                                               */}
        {/* ========================================================================= */}
        {activeTab === 'prof-visits' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>
                  Professional Visits (Influencers & Govt Engineers)
                </h3>
                <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                  Total {totalRecords} Professional Visits • IOCL, Private Contractors & Consultants
                </p>
              </div>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#0F172A', color: '#FFF' }}>
                    <th style={{ padding: '10px 12px' }}>Date</th>
                    <th style={{ padding: '10px 12px' }}>Employee</th>
                    <th style={{ padding: '10px 12px' }}>Contact Person</th>
                    <th style={{ padding: '10px 12px' }}>Mobile</th>
                    <th style={{ padding: '10px 12px' }}>Type</th>
                    <th style={{ padding: '10px 12px' }}>Organisation</th>
                    <th style={{ padding: '10px 12px' }}>Designation</th>
                    <th style={{ padding: '10px 12px' }}>Branch</th>
                  </tr>
                </thead>
                <tbody>
                  {tableLoading ? (
                    <tr><td colSpan="8" style={{ textAlign: 'center', padding: '24px' }}>Loading professional visits...</td></tr>
                  ) : (
                    tableData.map((row, idx) => (
                      <tr key={row.id || idx} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.visit_date}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>{row.emp_name}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 700 }}>{row.name}</td>
                        <td style={{ padding: '10px 12px' }}>{row.mobile_no}</td>
                        <td style={{ padding: '10px 12px' }}>{row.type}</td>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#1E3A8A' }}>{row.organisation}</td>
                        <td style={{ padding: '10px 12px' }}>{row.designation}</td>
                        <td style={{ padding: '10px 12px' }}>{row.branch}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 11: MASTER EMPLOYEE CHECK AUDIT                                       */}
        {/* ========================================================================= */}
        {activeTab === 'master-check' && (
          <div>
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#0F172A' }}>
                Employee Master Verification Audit
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: '#64748B' }}>
                Verification of Non-Trade team members against Star Cement central database tables (master_employees & employee_master)
              </p>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid #E2E8F0', borderRadius: '8px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#0F172A', color: '#FFF' }}>
                    <th style={{ padding: '10px 14px' }}>Role</th>
                    <th style={{ padding: '10px 14px' }}>Emp Code</th>
                    <th style={{ padding: '10px 14px' }}>Non-Trade Name</th>
                    <th style={{ padding: '10px 14px' }}>Master DB Designation</th>
                    <th style={{ padding: '10px 14px' }}>Zone / HQ</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>In master_employees</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>In employee_master</th>
                    <th style={{ padding: '10px 14px', textAlign: 'center' }}>Adherence Auto-Tracking</th>
                  </tr>
                </thead>
                <tbody>
                  {adhData?.masterCheck?.employees?.map((emp, idx) => (
                    <tr key={emp.empCode} style={{ background: idx % 2 === 0 ? '#FFFFFF' : '#F8FAFC', borderBottom: '1px solid #E2E8F0' }}>
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: emp.role === 'Officer' ? '#2563EB' : emp.role === 'ASM' ? '#7C3AED' : '#059669' }}>
                        {emp.role}
                      </td>
                      <td style={{ padding: '12px 14px', fontFamily: 'monospace', fontWeight: 600 }}>{emp.empCode}</td>
                      <td style={{ padding: '12px 14px', fontWeight: 700, color: '#0F172A' }}>{emp.empName}</td>
                      <td style={{ padding: '12px 14px', color: '#334155', fontWeight: 600 }}>{emp.designation}</td>
                      <td style={{ padding: '12px 14px', color: '#64748B' }}>{emp.hq || emp.zone}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        {emp.inMasterEmployees ? (
                          <span style={{ color: '#16A34A', fontWeight: 700 }}>✓ Verified</span>
                        ) : (
                          <span style={{ color: '#94A3B8' }}>-</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        {emp.inEmployeeMaster ? (
                          <span style={{ color: '#16A34A', fontWeight: 700 }}>✓ Verified</span>
                        ) : (
                          <span style={{ color: '#DC2626', fontWeight: 700 }}>Missing</span>
                        )}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                        <span style={{
                          padding: '3px 10px',
                          borderRadius: '12px',
                          background: emp.isAvailable ? '#DCFCE7' : '#FEE2E2',
                          color: emp.isAvailable ? '#166534' : '#991B1B',
                          fontWeight: 700,
                          fontSize: '0.72rem'
                        }}>
                          {emp.trackingStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          backdropFilter: 'blur(3px)'
        }}>
          <div style={{
            background: '#FFF',
            borderRadius: '12px',
            width: '90%',
            maxWidth: '500px',
            padding: '24px',
            boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Upload size={20} style={{ color: '#0284C7' }} />
                <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 700 }}>Upload Non-Trade Excel</h3>
              </div>
              <button
                onClick={() => setShowUploadModal(false)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#64748B' }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ fontSize: '0.85rem', color: '#64748B', margin: '0 0 16px 0' }}>
              Upload either a Planning Sheet (e.g. <code>DJP- Sep_2026 - NANTU revised.xlsx</code>) or an Execution Sheet (e.g. <code>IS_DJP_30_09_26.xlsx</code>) to automatically refresh counter plans and calculate adherence.
            </p>

            <form onSubmit={handleUploadSubmit}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>
                  Target Period Month
                </label>
                <input
                  type="month"
                  value={periodMonth}
                  onChange={e => setPeriodMonth(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    border: '1px solid #CBD5E1',
                    fontSize: '0.9rem',
                    boxSizing: 'border-box'
                  }}
                />
              </div>

              <div style={{
                border: '2px dashed #CBD5E1',
                borderRadius: '8px',
                padding: '24px',
                textAlign: 'center',
                marginBottom: '20px',
                background: '#F8FAFC'
              }}>
                <FileSpreadsheet size={36} style={{ color: '#64748B', margin: '0 auto 8px auto' }} />
                <div style={{ fontSize: '0.85rem', fontWeight: 600, color: '#1E293B', marginBottom: '4px' }}>
                  {uploadFile ? uploadFile.name : 'Choose Non-Trade Excel file'}
                </div>
                <div style={{ fontSize: '0.75rem', color: '#94A3B8', marginBottom: '12px' }}>
                  Supports .xlsx workbooks
                </div>
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={e => setUploadFile(e.target.files[0] || null)}
                  style={{ fontSize: '0.8rem' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  style={{
                    padding: '8px 16px',
                    borderRadius: '6px',
                    border: '1px solid #CBD5E1',
                    background: '#FFF',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFile}
                  style={{
                    padding: '8px 18px',
                    borderRadius: '6px',
                    border: 'none',
                    background: '#0284C7',
                    color: '#FFF',
                    fontWeight: 600,
                    cursor: uploading || !uploadFile ? 'not-allowed' : 'pointer',
                    opacity: uploading || !uploadFile ? 0.6 : 1
                  }}
                >
                  {uploading ? 'Processing & Ingesting...' : 'Upload & Calculate'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

