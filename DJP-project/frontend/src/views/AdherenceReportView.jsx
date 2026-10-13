import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity, Search, RefreshCw, X, Download, FileSpreadsheet,
  ChevronLeft, ChevronRight, ArrowLeft, Filter, Users, Building,
  TrendingUp, AlertCircle, CheckCircle2, SplitSquareVertical,
  LayoutGrid, Layers, Calendar
} from 'lucide-react';
import { api } from '../services/api';

const ROLES = [
  { id: 'SO',  label: 'SO',  fullName: 'Sales Officer / SE', color: '#2563EB' },
  { id: 'ASM', label: 'ASM', fullName: 'Area Sales Manager', color: '#7C3AED' },
  { id: 'RSM', label: 'RSM', fullName: 'Regional Sales Manager', color: '#059669' },
  { id: 'ZH',  label: 'ZH',  fullName: 'Zonal Head / ZM', color: '#D97706' }
];

export default function AdherenceReportView({
  onShowToast,
  selectedPeriod,
  selectedCycle,
  initialRole = 'SO'
}) {
  // Period & cycle controls
  const [month, setMonth] = useState(selectedPeriod || new Date().toISOString().slice(0, 7));
  const [cycle, setCycle] = useState(selectedCycle || 'C1');
  const [asOn, setAsOn] = useState('');

  // Active Role: 'SO' | 'ASM' | 'RSM' | 'ZH'
  const [activeRole, setActiveRole] = useState(initialRole);

  // View Mode: 'summary' | 'detailed'
  const [activeSubTab, setActiveSubTab] = useState('summary');

  // Layout mode: 'tabs' (switch between summary & detailed) | 'split' (side-by-side like excel)
  const [layoutMode, setLayoutMode] = useState('tabs');

  // Selected officer for detailed view
  const [selectedOfficerCode, setSelectedOfficerCode] = useState(null);

  // Data states
  const [adhData, setAdhData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showMatrixModal, setShowMatrixModal] = useState(false);

  // Search & filter states for Summary
  const [summarySearch, setSummarySearch] = useState('');
  const [summaryBandFilter, setSummaryBandFilter] = useState('ALL');

  // Search & filter states for Detailed
  const [detailSearch, setDetailSearch] = useState('');
  const [detailCategoryFilter, setDetailCategoryFilter] = useState('ALL');
  const [detailAreaFilter, setDetailAreaFilter] = useState('ALL');

  // Load Adherence Report
  const loadAdherence = async () => {
    setLoading(true);
    try {
      const res = await api.getAdherenceReport(month, {
        cycle: cycle === 'ALL' ? undefined : cycle,
        asOn: asOn || undefined
      });
      setAdhData(res);
      onShowToast?.(`Adherence loaded for ${month} (${cycle || 'ALL'})`, 'success');
    } catch (err) {
      console.error('[AdherenceReportView] error:', err);
      onShowToast?.(err.message || 'Failed to load adherence report', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdherence();
  }, [month, cycle, asOn]);

  // All officers for currently selected role
  const roleOfficers = useMemo(() => {
    if (!adhData?.by_employee) return [];
    return adhData.by_employee.filter(e => {
      const r = (e.role || 'SO').toUpperCase();
      if (activeRole === 'ZH') return ['ZH', 'ZM', 'ZSH'].includes(r);
      return r === activeRole.toUpperCase();
    });
  }, [adhData, activeRole]);

  // Set default selected officer when role changes or data loads
  useEffect(() => {
    if (roleOfficers.length > 0) {
      const exists = roleOfficers.find(o => o.emp_code === selectedOfficerCode);
      if (!exists) {
        setSelectedOfficerCode(roleOfficers[0].emp_code);
      }
    } else {
      setSelectedOfficerCode(null);
    }
  }, [roleOfficers, activeRole]);

  // Currently selected officer object
  const currentOfficer = useMemo(() => {
    return roleOfficers.find(o => o.emp_code === selectedOfficerCode) || roleOfficers[0] || null;
  }, [roleOfficers, selectedOfficerCode]);

  // Filtered summary officers list
  const filteredSummaryOfficers = useMemo(() => {
    return roleOfficers.filter(off => {
      const name = (off.emp_name || '').toLowerCase();
      const code = (off.emp_code || '').toLowerCase();
      const needle = summarySearch.toLowerCase().trim();
      const matchesSearch = !needle || name.includes(needle) || code.includes(needle);

      if (!matchesSearch) return false;

      const pct = off.raw_pct != null ? off.raw_pct : (off.capped_pct || 0);
      if (summaryBandFilter === 'CRITICAL') return pct < 70;
      if (summaryBandFilter === 'GOOD') return pct >= 70 && pct < 100;
      if (summaryBandFilter === 'FULL') return pct >= 100;
      return true;
    });
  }, [roleOfficers, summarySearch, summaryBandFilter]);

  // All dealers for currently selected role
  const roleDealers = useMemo(() => {
    if (!adhData?.by_dealer) return [];
    return adhData.by_dealer.filter(d => {
      const r = (d.role || 'SO').toUpperCase();
      if (activeRole === 'ZH') return ['ZH', 'ZM', 'ZSH'].includes(r);
      return r === activeRole.toUpperCase();
    });
  }, [adhData, activeRole]);

  // Dealers belonging to current officer
  const currentOfficerDealers = useMemo(() => {
    if (!currentOfficer) return [];
    return roleDealers.filter(d => {
      return (
        d.emp_code === currentOfficer.emp_code ||
        (d.emp_name && currentOfficer.emp_name && d.emp_name.toLowerCase() === currentOfficer.emp_name.toLowerCase())
      );
    });
  }, [roleDealers, currentOfficer]);

  // Available categories & areas for current officer
  const availableCategories = useMemo(() => {
    const set = new Set();
    currentOfficerDealers.forEach(d => {
      if (d.category) set.add(d.category);
    });
    return Array.from(set).sort();
  }, [currentOfficerDealers]);

  const availableAreas = useMemo(() => {
    const set = new Set();
    currentOfficerDealers.forEach(d => {
      if (d.area) set.add(d.area);
    });
    return Array.from(set).sort();
  }, [currentOfficerDealers]);

  // Filtered dealer list for current officer
  const filteredOfficerDealers = useMemo(() => {
    return currentOfficerDealers.filter(d => {
      const needle = detailSearch.toLowerCase().trim();
      const matchesSearch = !needle ||
        (d.dealer_name && d.dealer_name.toLowerCase().includes(needle)) ||
        (d.sap_code && d.sap_code.toLowerCase().includes(needle)) ||
        (d.area && d.area.toLowerCase().includes(needle));

      if (!matchesSearch) return false;
      if (detailCategoryFilter !== 'ALL' && d.category !== detailCategoryFilter) return false;
      if (detailAreaFilter !== 'ALL' && d.area !== detailAreaFilter) return false;
      return true;
    });
  }, [currentOfficerDealers, detailSearch, detailCategoryFilter, detailAreaFilter]);

  // Group filtered dealers by Category with subtotals
  const groupedDealersByCategory = useMemo(() => {
    const groups = new Map();

    filteredOfficerDealers.forEach(dl => {
      const cat = dl.category || 'Other';
      if (!groups.has(cat)) {
        groups.set(cat, []);
      }
      groups.get(cat).push(dl);
    });

    // Sort categories: "Need to Grow", "De-growing", "Growing", "Zero lifter", "Prospective", "Churn"
    const sortedCats = Array.from(groups.keys()).sort((a, b) => {
      const order = {
        'Need to Grow': 1,
        'Need to grow': 1,
        'De-growing': 2,
        'Growing': 3,
        'Zero lifter': 4,
        'Zero Lifter': 4,
        'Prospective': 5,
        'New / Other': 6,
        'Retain': 7,
        'Churn': 8
      };
      const oa = order[a] || 99;
      const ob = order[b] || 99;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });

    return sortedCats.map(cat => {
      const items = groups.get(cat);
      const planned = items.reduce((s, x) => s + (x.planned || 0), 0);
      const mtd = items.reduce((s, x) => s + (x.mtd_due || 0), 0);
      const adhered = items.reduce((s, x) => s + (x.adhered || 0), 0);
      const mtdRound = Math.round(mtd * 10) / 10;
      const den = mtdRound < 1 ? planned : mtdRound;
      const pct = den > 0 ? Math.round((adhered / den) * 100) : 0;
      const pending = Math.round((mtdRound - adhered) * 10) / 10;

      return {
        category: cat,
        dealers: items,
        totals: {
          planned,
          mtd: mtdRound,
          adhered,
          pct,
          pending
        }
      };
    });
  }, [filteredOfficerDealers]);

  // Officer Grand Total
  const officerGrandTotal = useMemo(() => {
    const planned = filteredOfficerDealers.reduce((s, x) => s + (x.planned || 0), 0);
    const mtd = filteredOfficerDealers.reduce((s, x) => s + (x.mtd_due || 0), 0);
    const adhered = filteredOfficerDealers.reduce((s, x) => s + (x.adhered || 0), 0);
    const mtdRound = Math.round(mtd * 10) / 10;
    const den = mtdRound < 1 ? planned : mtdRound;
    const pct = den > 0 ? Math.round((adhered / den) * 100) : 0;
    const pending = Math.round((mtdRound - adhered) * 10) / 10;
    return {
      planned,
      mtd: mtdRound,
      adhered,
      pct,
      pending,
      count: filteredOfficerDealers.length
    };
  }, [filteredOfficerDealers]);

  // Role Summary Totals
  const roleSummaryTotals = useMemo(() => {
    const planned = filteredSummaryOfficers.reduce((s, x) => s + (x.planned_visits || 0), 0);
    const mtd = filteredSummaryOfficers.reduce((s, x) => s + (x.mtd_due || 0), 0);
    const adhered = filteredSummaryOfficers.reduce((s, x) => s + (x.adhered || 0), 0);
    const mtdRound = Math.round(mtd * 10) / 10;
    const den = mtdRound < 1 ? planned : mtdRound;
    const pct = den > 0 ? Math.round((adhered / den) * 100) : 0;
    const pending = Math.round((mtdRound - adhered) * 10) / 10;
    return {
      planned,
      mtd: mtdRound,
      adhered,
      pct,
      pending,
      officersCount: filteredSummaryOfficers.length
    };
  }, [filteredSummaryOfficers]);

  // Officer navigation handlers
  const handleSelectOfficer = (empCode) => {
    setSelectedOfficerCode(empCode);
    if (layoutMode === 'tabs') {
      setActiveSubTab('detailed');
    }
  };

  const handlePrevOfficer = () => {
    if (!roleOfficers.length) return;
    const idx = roleOfficers.findIndex(o => o.emp_code === selectedOfficerCode);
    const prevIdx = idx <= 0 ? roleOfficers.length - 1 : idx - 1;
    setSelectedOfficerCode(roleOfficers[prevIdx].emp_code);
  };

  const handleNextOfficer = () => {
    if (!roleOfficers.length) return;
    const idx = roleOfficers.findIndex(o => o.emp_code === selectedOfficerCode);
    const nextIdx = idx >= roleOfficers.length - 1 ? 0 : idx + 1;
    setSelectedOfficerCode(roleOfficers[nextIdx].emp_code);
  };

  // Export Handlers
  const handleExportExcel = async () => {
    try {
      setExporting(true);
      onShowToast?.('Generating full zone-wise multi-tab Excel file...', 'info');
      await api.exportAdherenceExcel({
        periodMonth: month,
        cycleCode: cycle,
        asOnDate: asOn || undefined
      });
      onShowToast?.('Excel file downloaded successfully!', 'success');
    } catch (err) {
      console.error('[handleExportExcel]', err);
      onShowToast?.(err.message || 'Excel export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = () => {
    try {
      let csv = '';
      if (activeSubTab === 'summary') {
        csv = `${activeRole}/SE NAME,Planned Visits,MTD Due Visits,Adhered Visits,MTD Adherence %,Pending Visits\n`;
        roleOfficers.forEach(o => {
          csv += `"${o.emp_name || o.emp_code}",${o.planned_visits || 0},${o.mtd_due || 0},${o.adhered || 0},${o.raw_pct || 0}%,${o.pending || 0}\n`;
        });
      } else {
        csv = `${activeRole}/SE NAME,Category,Area,Dealer Name,SAP Code,Planned Visits,MTD Due Visits,Adhered Visits,MTD Adherence %,Pending Visits\n`;
        currentOfficerDealers.forEach(d => {
          csv += `"${currentOfficer?.emp_name || currentOfficer?.emp_code}","${d.category || ''}","${d.area || ''}","${d.dealer_name || ''}","${d.sap_code || ''}",${d.planned || 0},${d.mtd_due || 0},${d.adhered || 0},${d.raw_pct || 0}%,${d.pending || 0}\n`;
        });
      }
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Adherence_${activeRole}_${activeSubTab}_${month}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      onShowToast?.('CSV downloaded successfully!', 'success');
    } catch (err) {
      onShowToast?.('CSV export failed', 'error');
    }
  };

  // Helper for conditional formatting colors
  const getAdherenceStyle = (pct) => {
    if (pct < 70) return { bg: '#FFC7CE', color: '#9C0006', border: '#FFA8B4' };
    if (pct < 100) return { bg: '#FFEB9C', color: '#9C6500', border: '#FDE047' };
    return { bg: '#C6EFCE', color: '#006100', border: '#86EFAC' };
  };

  const getPendingStyle = (pending) => {
    if (pending > 0) return { bg: '#FEE2E2', color: '#991B1B', fontWeight: 'bold' };
    return { bg: '#F0FDF4', color: '#166534' };
  };

  return (
    <div className="adherence-report-container" style={{ padding: '20px 24px', maxWidth: 1680, margin: '0 auto' }}>
      <style>{`
        .excel-table-container {
          border: 1px solid #CBD5E1;
          border-radius: 8px;
          overflow: hidden;
          background: #FFFFFF;
          box-shadow: 0 4px 16px rgba(0,0,0,0.04);
        }
        .excel-table {
          width: 100%;
          border-collapse: collapse;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          font-size: 0.815rem;
          font-variant-numeric: tabular-nums;
        }
        .excel-table th {
          padding: 8px 10px;
          font-size: 0.775rem;
          font-weight: 700;
          text-align: center;
          border: 1px solid #CBD5E1;
          vertical-align: middle;
          line-height: 1.25;
        }
        .excel-table td {
          padding: 6px 10px;
          border: 1px solid #E2E8F0;
          vertical-align: middle;
          white-space: nowrap;
        }
        .excel-table tr.clickable-row {
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .excel-table tr.clickable-row:hover {
          background-color: #FEF9C3 !important;
        }
        .excel-table tr.selected-row {
          background-color: #FEF08A !important;
        }
        .excel-header-peach  { background-color: #FDE9D9; color: #1E293B; }
        .excel-header-blue   { background-color: #DCE6F1; color: #1E293B; }
        .excel-header-yellow { background-color: #FEF08A; color: #854D0E; }
        .excel-header-green  { background-color: #DCFCE7; color: #166534; }
        .excel-header-salmon { background-color: #F8CBAD; color: #9A3412; }

        .role-tab-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 8px 20px;
          font-size: 0.875rem;
          font-weight: 700;
          border-radius: 8px 8px 0 0;
          border: 1px solid #E2E8F0;
          border-bottom: none;
          background: #F8FAFC;
          color: #64748B;
          cursor: pointer;
          transition: all 0.2s ease;
        }
        .role-tab-btn.active {
          background: #FFFFFF;
          color: #0F172A;
          border-color: #CBD5E1;
          box-shadow: 0 -2px 8px rgba(0,0,0,0.04);
        }
        .subtab-btn {
          padding: 6px 18px;
          font-size: 0.825rem;
          font-weight: 600;
          border-radius: 6px;
          cursor: pointer;
          border: none;
          transition: all 0.2s;
        }
        .subtab-btn.active {
          background: var(--star-red, #DC2626);
          color: #FFFFFF;
          box-shadow: 0 2px 6px rgba(220, 38, 38, 0.25);
        }
        .subtab-btn:not(.active) {
          background: transparent;
          color: #64748B;
        }
        .subtab-btn:not(.active):hover {
          background: #F1F5F9;
          color: #0F172A;
        }
      `}</style>

      {/* ── TOP HEADER & FILTER BAR ────────────────────────────────────────── */}
      <div style={{
        background: '#FFFFFF',
        border: '1px solid #E2E8F0',
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 20,
        boxShadow: '0 2px 10px rgba(0,0,0,0.03)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                background: 'linear-gradient(135deg, #EF4444 0%, #B91C1C 100%)',
                color: '#fff',
                padding: '6px 10px',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}>
                <FileSpreadsheet size={18} />
                <span style={{ fontWeight: 800, fontSize: '0.85rem', letterSpacing: '0.04em' }}>ZONE ADHERENCE</span>
              </div>
              <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#0F172A' }}>
                Trade DJP Adherence Tracker
              </h1>
              <span style={{
                background: '#FEF3C7',
                color: '#B45309',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: '0.75rem',
                fontWeight: 700
              }}>
                Excel Reconciled
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#64748B' }}>
              Multi-role planned vs SFA adherence report · Exact MTD prorata formula matching client Excel
            </p>
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setShowMatrixModal(true)}
              title="View Category Counter Distribution & Approved Role Visit Matrix"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.8rem',
                height: 36,
                background: '#EFF6FF',
                color: '#1D4ED8',
                borderColor: '#BFDBFE',
                fontWeight: 600
              }}
            >
              <Layers size={15} /> Visit Matrix & Rules
            </button>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handleExportCsv}
              title="Export Current View as CSV"
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', height: 36 }}
            >
              <Download size={15} /> Export CSV
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleExportExcel}
              disabled={exporting}
              title="Export Complete Multi-Tab Excel Workbook"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.8rem',
                height: 36,
                background: '#16A34A',
                borderColor: '#16A34A'
              }}
            >
              <FileSpreadsheet size={15} className={exporting ? 'spin' : ''} />
              {exporting ? 'Generating Excel…' : 'Export Full Excel'}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={loadAdherence}
              disabled={loading}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', height: 36 }}
            >
              <RefreshCw size={15} className={loading ? 'spin' : ''} />
              {loading ? 'Analysing…' : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Filters grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 12,
          marginTop: 16,
          paddingTop: 16,
          borderTop: '1px solid #F1F5F9'
        }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#64748B', marginBottom: 4 }}>
              PLAN MONTH
            </label>
            <input
              type="month"
              className="form-control"
              value={month}
              onChange={e => { setMonth(e.target.value); setAsOn(''); }}
              style={{ height: 34, fontSize: '0.82rem' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#64748B', marginBottom: 4 }}>
              CYCLE WINDOW
            </label>
            <select
              className="form-control"
              value={cycle}
              onChange={e => { setCycle(e.target.value); setAsOn(''); }}
              style={{ height: 34, fontSize: '0.82rem' }}
            >
              <option value="C1">C1 · Days 1–15 (Feedback Window)</option>
              <option value="C2">C2 · Days 16–End (Amended Window)</option>
              <option value="ALL">Full Month · Days 1–End</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#64748B', marginBottom: 4 }}>
              AS ON DATE
            </label>
            <input
              type="date"
              className="form-control"
              value={asOn}
              onChange={e => setAsOn(e.target.value)}
              style={{ height: 34, fontSize: '0.82rem' }}
            />
            <span style={{ fontSize: '0.68rem', color: '#94A3B8', marginTop: 2, display: 'block' }}>
              {asOn ? 'Custom cut-off' : cycle === 'C1' ? 'Auto: 15th (C1 cutoff)' : 'Auto: Month end'}
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 700, color: '#64748B', marginBottom: 4 }}>
              LAYOUT MODE
            </label>
            <div style={{ display: 'flex', background: '#F1F5F9', padding: 2, borderRadius: 6, height: 34 }}>
              <button
                type="button"
                onClick={() => setLayoutMode('tabs')}
                style={{
                  flex: 1,
                  border: 'none',
                  borderRadius: 4,
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: layoutMode === 'tabs' ? '#FFFFFF' : 'transparent',
                  color: layoutMode === 'tabs' ? '#0F172A' : '#64748B',
                  boxShadow: layoutMode === 'tabs' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                📑 Two Tabs
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('split')}
                style={{
                  flex: 1,
                  border: 'none',
                  borderRadius: 4,
                  fontSize: '0.76rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: layoutMode === 'split' ? '#FFFFFF' : 'transparent',
                  color: layoutMode === 'split' ? '#0F172A' : '#64748B',
                  boxShadow: layoutMode === 'split' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                }}
              >
                ◫ Excel Split View
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── 4 ROLE TABS (ZH, RSM, ASM, SO) ─────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, borderBottom: '2px solid #CBD5E1', paddingLeft: 8 }}>
        {ROLES.map(r => {
          const isActive = activeRole === r.id;
          const officersInRole = (adhData?.by_employee || []).filter(e => {
            const roleStr = (e.role || 'SO').toUpperCase();
            if (r.id === 'ZH') return ['ZH', 'ZM', 'ZSH'].includes(roleStr);
            return roleStr === r.id;
          });
          const rolePlanned = officersInRole.reduce((s, x) => s + (x.planned_visits || 0), 0);
          const roleAdhered = officersInRole.reduce((s, x) => s + (x.adhered || 0), 0);
          const roleMtd = officersInRole.reduce((s, x) => s + (x.mtd_due || 0), 0);
          const rolePct = roleMtd > 0 ? Math.round((roleAdhered / (roleMtd < 1 ? rolePlanned : roleMtd)) * 100) : 0;

          return (
            <button
              key={r.id}
              type="button"
              className={`role-tab-btn ${isActive ? 'active' : ''}`}
              onClick={() => { setActiveRole(r.id); }}
              style={{
                borderTop: isActive ? `3px solid ${r.color}` : '1px solid #E2E8F0',
                paddingBottom: isActive ? 10 : 8
              }}
            >
              <span style={{ fontSize: '1rem', fontWeight: 800, color: isActive ? r.color : '#64748B' }}>
                {r.label}
              </span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#64748B' }}>
                {r.fullName.split(' ')[0]}
              </span>
              <span style={{
                background: isActive ? '#EEF2FF' : '#E2E8F0',
                color: isActive ? '#3730A3' : '#475569',
                padding: '1px 6px',
                borderRadius: 999,
                fontSize: '0.7rem',
                fontWeight: 700
              }}>
                {officersInRole.length}
              </span>
              {officersInRole.length > 0 && (
                <span style={{
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: rolePct >= 100 ? '#16A34A' : rolePct >= 70 ? '#CA8A04' : '#DC2626'
                }}>
                  {rolePct}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ── SUB-TABS (Summary vs Detailed) when in Tabs mode ────────────────── */}
      {layoutMode === 'tabs' && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#FFFFFF',
          padding: '12px 16px',
          border: '1px solid #CBD5E1',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          marginBottom: 16
        }}>
          <div style={{ display: 'flex', gap: 8, background: '#F8FAFC', padding: 4, borderRadius: 8, border: '1px solid #E2E8F0' }}>
            <button
              type="button"
              className={`subtab-btn ${activeSubTab === 'summary' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('summary')}
            >
              Summary ({roleOfficers.length} {activeRole} Officers)
            </button>
            <button
              type="button"
              className={`subtab-btn ${activeSubTab === 'detailed' ? 'active' : ''}`}
              onClick={() => setActiveSubTab('detailed')}
            >
              Detailed Breakdown ({currentOfficer?.emp_name || 'Select Officer'})
            </button>
          </div>

          <div style={{ fontSize: '0.78rem', color: '#64748B' }}>
            {activeSubTab === 'summary'
              ? '💡 Click any officer row to view dealer-level breakdown'
              : `Showing ${currentOfficerDealers.length} dealers assigned to ${currentOfficer?.emp_name || 'selected officer'}`}
          </div>
        </div>
      )}

      {/* ── ROLE KPI METRICS ────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 12,
        margin: '16px 0'
      }}>
        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
            {activeRole} Officers
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#0F172A', marginTop: 2 }}>
            {roleSummaryTotals.officersCount}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>In active plan window</div>
        </div>

        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#854D0E', textTransform: 'uppercase' }}>
            Planned Visits
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#854D0E', marginTop: 2 }}>
            {roleSummaryTotals.planned}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Full-cycle plan</div>
        </div>

        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#854D0E', textTransform: 'uppercase' }}>
            MTD Due Visits
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#854D0E', marginTop: 2 }}>
            {roleSummaryTotals.mtd}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Prorated to {adhData?.as_on_date?.slice(5) || 'date'}</div>
        </div>

        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#166534', textTransform: 'uppercase' }}>
            Adhered Visits
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#166534', marginTop: 2 }}>
            {roleSummaryTotals.adhered}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Logged via SFA app</div>
        </div>

        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0F172A', textTransform: 'uppercase' }}>
            MTD Adherence %
          </div>
          <div style={{
            fontSize: '1.4rem',
            fontWeight: 800,
            marginTop: 2,
            color: roleSummaryTotals.pct >= 100 ? '#16A34A' : roleSummaryTotals.pct >= 70 ? '#CA8A04' : '#DC2626'
          }}>
            {roleSummaryTotals.pct}%
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>Adhered ÷ MTD Due</div>
        </div>

        <div style={{ background: '#FFFFFF', border: '1px solid #E2E8F0', borderRadius: 8, padding: '12px 16px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#9A3412', textTransform: 'uppercase' }}>
            Pending to Visit
          </div>
          <div style={{
            fontSize: '1.4rem',
            fontWeight: 800,
            marginTop: 2,
            color: roleSummaryTotals.pending > 0 ? '#DC2626' : '#16A34A'
          }}>
            {roleSummaryTotals.pending}
          </div>
          <div style={{ fontSize: '0.72rem', color: '#94A3B8' }}>
            {roleSummaryTotals.pending < 0 ? 'Ahead of schedule' : 'Visits remaining'}
          </div>
        </div>
      </div>

      {/* ── MAIN CONTENT AREA ──────────────────────────────────────────────── */}
      {layoutMode === 'tabs' ? (
        <>
          {activeSubTab === 'summary' && renderSummaryTable()}
          {activeSubTab === 'detailed' && renderDetailedTable()}
        </>
      ) : (
        /* Excel Split View (Side-by-side) */
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(540px, 1.4fr) minmax(420px, 1fr)', gap: 16 }}>
          <div>{renderDetailedTable(true)}</div>
          <div>{renderSummaryTable(true)}</div>
        </div>
      )}

      {/* ── VISIT MATRIX & RULES REFERENCE MODAL ────────────────────────────── */}
      {showMatrixModal && renderMatrixModal()}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER SUMMARY TABLE
  // ─────────────────────────────────────────────────────────────────────────
  function renderSummaryTable(isSplit = false) {
    return (
      <div className="excel-table-container">
        {/* Table title bar */}
        <div style={{
          padding: '12px 16px',
          background: '#F8FAFC',
          borderBottom: '1px solid #CBD5E1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10
        }}>
          <div>
            <div style={{ fontWeight: 800, fontSize: '0.9rem', color: '#0F172A' }}>
              {activeRole} Summary Adherence Table
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
              Click any officer row to load detailed dealer breakdown
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative', width: 200 }}>
              <Search size={14} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
              <input
                type="text"
                placeholder="Search officer name..."
                className="form-control"
                value={summarySearch}
                onChange={e => setSummarySearch(e.target.value)}
                style={{ paddingLeft: 28, height: 30, fontSize: '0.78rem' }}
              />
              {summarySearch && (
                <button
                  type="button"
                  onClick={() => setSummarySearch('')}
                  style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
                >
                  <X size={12} />
                </button>
              )}
            </div>

            <select
              className="form-control"
              value={summaryBandFilter}
              onChange={e => setSummaryBandFilter(e.target.value)}
              style={{ width: 'auto', height: 30, fontSize: '0.78rem' }}
            >
              <option value="ALL">All Levels</option>
              <option value="CRITICAL">Critical (&lt; 70%)</option>
              <option value="GOOD">Normal (70%–99%)</option>
              <option value="FULL">Complete (&gt;= 100%)</option>
            </select>
          </div>
        </div>

        {/* The Excel Table */}
        <div style={{ overflowX: 'auto', maxHeight: isSplit ? '720px' : 'none' }}>
          <table className="excel-table">
            <thead>
              <tr>
                <th className="excel-header-peach" style={{ width: isSplit ? '32%' : '26%' }}>
                  {activeRole}/SE NAME
                </th>
                <th className="excel-header-yellow" style={{ width: '14%' }}>
                  No. of visits Planned by {activeRole} in DJP
                </th>
                <th className="excel-header-yellow" style={{ width: '15%' }}>
                  MTD No: of visits Planned by {activeRole} in DJP
                </th>
                <th className="excel-header-green" style={{ width: '14%' }}>
                  No. of visits Adhered by {activeRole}
                </th>
                <th className="excel-header-green" style={{ width: '15%' }}>
                  MTD {activeRole} % of Visit Adherence
                </th>
                <th className="excel-header-salmon" style={{ width: '16%' }}>
                  {activeRole} Pending to visit as per DJP
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredSummaryOfficers.map((off) => {
                const isSelected = off.emp_code === selectedOfficerCode;
                const pct = off.raw_pct != null ? off.raw_pct : (off.capped_pct || 0);
                const adhStyle = getAdherenceStyle(pct);
                const pendStyle = getPendingStyle(off.pending);

                return (
                  <tr
                    key={off.emp_code}
                    className={`clickable-row ${isSelected ? 'selected-row' : ''}`}
                    onClick={() => handleSelectOfficer(off.emp_code)}
                    title={`Click to view dealers for ${off.emp_name || off.emp_code}`}
                  >
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span>{off.emp_name || off.emp_code}</span>
                        {isSelected && (
                          <span style={{ fontSize: '0.65rem', background: '#2563EB', color: '#fff', padding: '1px 5px', borderRadius: 4 }}>
                            Active
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 400 }}>
                        {off.emp_code} · {off.planned_dealers || 0} dealers
                      </div>
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {off.planned_visits}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600 }}>
                      {off.mtd_due}
                    </td>
                    <td style={{ textAlign: 'right', fontWeight: 600, color: '#166534' }}>
                      {off.adhered}
                    </td>
                    <td style={{
                      textAlign: 'center',
                      fontWeight: 700,
                      backgroundColor: adhStyle.bg,
                      color: adhStyle.color
                    }}>
                      {pct}%
                    </td>
                    <td style={{
                      textAlign: 'right',
                      backgroundColor: pendStyle.bg,
                      color: pendStyle.color
                    }}>
                      {off.pending}
                    </td>
                  </tr>
                );
              })}

              {filteredSummaryOfficers.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ textAlign: 'center', padding: 28, color: '#94A3B8' }}>
                    No {activeRole} officers match the filter criteria.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: '#F1F5F9', fontWeight: 800, borderTop: '2px solid #94A3B8' }}>
                <td style={{ padding: '10px 10px' }}>
                  {activeRole} Total ({roleSummaryTotals.officersCount} Officers)
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px' }}>
                  {roleSummaryTotals.planned}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px' }}>
                  {roleSummaryTotals.mtd}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px', color: '#166534' }}>
                  {roleSummaryTotals.adhered}
                </td>
                <td style={{
                  textAlign: 'center',
                  padding: '10px 10px',
                  backgroundColor: getAdherenceStyle(roleSummaryTotals.pct).bg,
                  color: getAdherenceStyle(roleSummaryTotals.pct).color
                }}>
                  {roleSummaryTotals.pct}%
                </td>
                <td style={{
                  textAlign: 'right',
                  padding: '10px 10px',
                  backgroundColor: getPendingStyle(roleSummaryTotals.pending).bg,
                  color: getPendingStyle(roleSummaryTotals.pending).color
                }}>
                  {roleSummaryTotals.pending}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER DETAILED TABLE
  // ─────────────────────────────────────────────────────────────────────────
  function renderDetailedTable(isSplit = false) {
    if (!currentOfficer) {
      return (
        <div className="excel-table-container" style={{ padding: 48, textAlign: 'center', color: '#94A3B8' }}>
          <AlertCircle size={32} style={{ margin: '0 auto 12px', color: '#CBD5E1' }} />
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#64748B' }}>No Officer Selected</div>
          <div style={{ fontSize: '0.8rem', marginTop: 4 }}>Select an officer from the Summary tab to see dealer-by-dealer adherence.</div>
        </div>
      );
    }

    return (
      <div className="excel-table-container">
        {/* Officer Selection & Control Bar */}
        <div style={{
          padding: '12px 16px',
          background: '#F8FAFC',
          borderBottom: '1px solid #CBD5E1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {!isSplit && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setActiveSubTab('summary')}
                style={{ padding: '4px 10px', fontSize: '0.78rem', height: 32, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <ArrowLeft size={14} /> Back to Summary
              </button>
            )}

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: '#0F172A' }}>
                  {currentOfficer.emp_name || currentOfficer.emp_code}
                </span>
                <span style={{ fontSize: '0.72rem', background: '#E2E8F0', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace' }}>
                  {currentOfficer.emp_code}
                </span>
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                {activeRole} Detailed Dealer Breakdown · {currentOfficerDealers.length} total dealer targets
              </div>
            </div>
          </div>

          {/* Quick Officer Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              className="btn btn-outline"
              onClick={handlePrevOfficer}
              title="Previous Officer"
              style={{ padding: '4px 8px', height: 32 }}
            >
              <ChevronLeft size={15} />
            </button>

            <select
              className="form-control"
              value={selectedOfficerCode || ''}
              onChange={e => handleSelectOfficer(e.target.value)}
              style={{ height: 32, fontSize: '0.78rem', maxWidth: 220 }}
            >
              {roleOfficers.map(off => (
                <option key={off.emp_code} value={off.emp_code}>
                  {off.emp_name || off.emp_code} ({off.raw_pct || 0}%)
                </option>
              ))}
            </select>

            <button
              type="button"
              className="btn btn-outline"
              onClick={handleNextOfficer}
              title="Next Officer"
              style={{ padding: '4px 8px', height: 32 }}
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>

        {/* Detailed Filters Bar */}
        <div style={{
          padding: '10px 16px',
          background: '#FFFFFF',
          borderBottom: '1px solid #E2E8F0',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap'
        }}>
          <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 160 }}>
            <Search size={13} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
            <input
              type="text"
              placeholder="Search dealer name, SAP code..."
              className="form-control"
              value={detailSearch}
              onChange={e => setDetailSearch(e.target.value)}
              style={{ paddingLeft: 26, height: 28, fontSize: '0.78rem' }}
            />
            {detailSearch && (
              <button
                type="button"
                onClick={() => setDetailSearch('')}
                style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <select
            className="form-control"
            value={detailCategoryFilter}
            onChange={e => setDetailCategoryFilter(e.target.value)}
            style={{ width: 'auto', height: 28, fontSize: '0.78rem' }}
          >
            <option value="ALL">All Categories ({availableCategories.length})</option>
            {availableCategories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <select
            className="form-control"
            value={detailAreaFilter}
            onChange={e => setDetailAreaFilter(e.target.value)}
            style={{ width: 'auto', height: 28, fontSize: '0.78rem' }}
          >
            <option value="ALL">All Areas ({availableAreas.length})</option>
            {availableAreas.map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>

          <div style={{ marginLeft: 'auto', fontSize: '0.75rem', color: '#64748B' }}>
            Showing {filteredOfficerDealers.length} of {currentOfficerDealers.length} dealers
          </div>
        </div>

        {/* The Detailed Table with Grouping by Category */}
        <div style={{ overflowX: 'auto', maxHeight: isSplit ? '720px' : 'none' }}>
          <table className="excel-table">
            <thead>
              <tr>
                <th className="excel-header-peach" style={{ width: '16%' }}>
                  {activeRole}/SE NAME
                </th>
                <th className="excel-header-blue" style={{ width: '11%' }}>
                  Category
                </th>
                <th className="excel-header-blue" style={{ width: '13%' }}>
                  Area
                </th>
                <th className="excel-header-blue" style={{ width: '24%' }}>
                  DEALER NAME
                </th>
                <th className="excel-header-yellow" style={{ width: '9%' }}>
                  No. of visits Planned by {activeRole} in DJP
                </th>
                <th className="excel-header-yellow" style={{ width: '9%' }}>
                  MTD No: of visits Planned by {activeRole} in DJP
                </th>
                <th className="excel-header-green" style={{ width: '9%' }}>
                  No. of visits Adhered by {activeRole}
                </th>
                <th className="excel-header-green" style={{ width: '9%' }}>
                  MTD {activeRole} % of Visit Adherence
                </th>
                <th className="excel-header-salmon" style={{ width: '9%' }}>
                  {activeRole} Pending to visit as per DJP
                </th>
              </tr>
            </thead>
            <tbody>
              {groupedDealersByCategory.map(group => (
                <React.Fragment key={group.category}>
                  {/* Category Dealer Rows */}
                  {group.dealers.map((dl, idx) => {
                    const dlPct = dl.mtd_due > 0 ? (dl.adhered / (dl.mtd_due < 1 ? dl.planned : dl.mtd_due)) * 100 : 0;
                    const roundedPct = Math.round(dlPct);
                    const adhStyle = getAdherenceStyle(roundedPct);
                    const pendStyle = getPendingStyle(dl.pending);

                    return (
                      <tr key={`${dl.sap_code}-${idx}`}>
                        {idx === 0 ? (
                          <td
                            rowSpan={group.dealers.length + 1}
                            style={{
                              verticalAlign: 'top',
                              fontWeight: 700,
                              backgroundColor: '#FFFBF5',
                              borderRight: '1px solid #CBD5E1'
                            }}
                          >
                            <div style={{ position: 'sticky', top: 40 }}>
                              {currentOfficer.emp_name || currentOfficer.emp_code}
                              <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontWeight: 400 }}>
                                {currentOfficer.emp_code}
                              </div>
                            </div>
                          </td>
                        ) : null}

                        <td style={{ fontWeight: 600, color: '#475569' }}>
                          {group.category}
                        </td>
                        <td style={{ color: '#475569', fontSize: '0.78rem' }}>
                          {dl.area || '—'}
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: '#0F172A' }}>
                            {dl.dealer_name}
                          </div>
                          <div style={{ fontSize: '0.68rem', color: '#94A3B8', fontFamily: 'monospace' }}>
                            SAP: {dl.sap_code} {dl.visit_dates?.length > 0 && `· Visited: ${dl.visit_dates.join(', ')}`}
                          </div>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {dl.planned}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>
                          {dl.mtd_due}
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: '#166534' }}>
                          {dl.adhered}
                        </td>
                        <td style={{
                          textAlign: 'center',
                          fontWeight: 700,
                          backgroundColor: adhStyle.bg,
                          color: adhStyle.color
                        }}>
                          {roundedPct}%
                        </td>
                        <td style={{
                          textAlign: 'right',
                          backgroundColor: pendStyle.bg,
                          color: pendStyle.color
                        }}>
                          {dl.pending}
                        </td>
                      </tr>
                    );
                  })}

                  {/* Category Subtotal Row (e.g. "De-growing Total", "Growing Total") */}
                  <tr style={{ background: '#F1F5F9', fontWeight: 800 }}>
                    <td colSpan={3} style={{ fontStyle: 'italic', color: '#1E293B', paddingLeft: 16 }}>
                      {group.category} Total ({group.dealers.length} dealers)
                    </td>
                    <td style={{ textAlign: 'right' }}>{group.totals.planned}</td>
                    <td style={{ textAlign: 'right' }}>{group.totals.mtd}</td>
                    <td style={{ textAlign: 'right', color: '#166534' }}>{group.totals.adhered}</td>
                    <td style={{
                      textAlign: 'center',
                      backgroundColor: getAdherenceStyle(group.totals.pct).bg,
                      color: getAdherenceStyle(group.totals.pct).color
                    }}>
                      {group.totals.pct}%
                    </td>
                    <td style={{
                      textAlign: 'right',
                      backgroundColor: getPendingStyle(group.totals.pending).bg,
                      color: getPendingStyle(group.totals.pending).color
                    }}>
                      {group.totals.pending}
                    </td>
                  </tr>
                </React.Fragment>
              ))}

              {filteredOfficerDealers.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: 36, color: '#94A3B8' }}>
                    No dealers scheduled or matched for this officer under current filters.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              {/* Grand Total Row for Current Officer */}
              <tr style={{ background: '#E2E8F0', fontWeight: 800, borderTop: '2px solid #64748B' }}>
                <td colSpan={4} style={{ padding: '10px 10px', fontSize: '0.85rem' }}>
                  Total for {currentOfficer.emp_name || currentOfficer.emp_code} ({officerGrandTotal.count} dealers)
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px' }}>
                  {officerGrandTotal.planned}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px' }}>
                  {officerGrandTotal.mtd}
                </td>
                <td style={{ textAlign: 'right', padding: '10px 10px', color: '#166534' }}>
                  {officerGrandTotal.adhered}
                </td>
                <td style={{
                  textAlign: 'center',
                  padding: '10px 10px',
                  backgroundColor: getAdherenceStyle(officerGrandTotal.pct).bg,
                  color: getAdherenceStyle(officerGrandTotal.pct).color
                }}>
                  {officerGrandTotal.pct}%
                </td>
                <td style={{
                  textAlign: 'right',
                  padding: '10px 10px',
                  backgroundColor: getPendingStyle(officerGrandTotal.pending).bg,
                  color: getPendingStyle(officerGrandTotal.pending).color
                }}>
                  {officerGrandTotal.pending}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER VISIT MATRIX & RULES MODAL
  // ─────────────────────────────────────────────────────────────────────────
  function renderMatrixModal() {
    return (
      <div style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20
      }}>
        <div style={{
          background: '#FFFFFF',
          borderRadius: 16,
          maxWidth: 960,
          width: '100%',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden'
        }}>
          {/* Modal Header */}
          <div style={{
            padding: '18px 24px',
            borderBottom: '1px solid #E2E8F0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#F8FAFC'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{
                background: '#EFF6FF',
                color: '#1D4ED8',
                padding: '6px 10px',
                borderRadius: 8,
                display: 'flex'
              }}>
                <Layers size={18} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#0F172A' }}>
                  PJP Visit Frequency Matrix & Category Rules
                </h3>
                <p style={{ margin: 0, fontSize: '0.78rem', color: '#64748B', marginTop: 2 }}>
                  Canonical matrix (deduplicated) · Need to Grow (Score 25) · 1,708 Total Reference Counters
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowMatrixModal(false)}
              style={{
                border: 'none',
                background: '#F1F5F9',
                borderRadius: '50%',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: '#64748B'
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Modal Body */}
          <div style={{ padding: '20px 24px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
            {/* Table 1: Category Counter Distribution */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1E293B' }}>
                  1. Category Definition & Counter Volume Distribution
                </div>
                <span style={{ fontSize: '0.72rem', background: '#DCFCE7', color: '#166534', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
                  Total 1,708 Counters
                </span>
              </div>
              <div style={{ border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
                <table className="excel-table">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="excel-header-peach" style={{ textAlign: 'left', minWidth: 160 }}>Category</th>
                      <th colSpan={4} className="excel-header-peach">Number of counters by Volume Tier</th>
                      <th rowSpan={2} className="excel-header-peach" style={{ width: 90 }}>Total</th>
                    </tr>
                    <tr>
                      <th className="excel-header-peach" style={{ width: 120 }}>A · Top 40%</th>
                      <th className="excel-header-peach" style={{ width: 120 }}>B · 40–60%</th>
                      <th className="excel-header-peach" style={{ width: 120 }}>C · 20–40%</th>
                      <th className="excel-header-peach" style={{ width: 120 }}>D · Bottom 20%</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 700, color: '#1E40AF', background: '#EFF6FF' }}>Need to Grow</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>33</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, background: '#F8FAFC' }}>33</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, color: '#1E293B' }}>Zero lifter</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>205</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, background: '#F8FAFC' }}>207</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, color: '#1E293B' }}>Prospective</td>
                      <td style={{ textAlign: 'center' }}>3</td>
                      <td style={{ textAlign: 'center' }}>7</td>
                      <td style={{ textAlign: 'center' }}>9</td>
                      <td style={{ textAlign: 'center' }}>36</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, background: '#F8FAFC' }}>55</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, color: '#1E293B' }}>De-growing</td>
                      <td style={{ textAlign: 'center' }}>50</td>
                      <td style={{ textAlign: 'center' }}>53</td>
                      <td style={{ textAlign: 'center' }}>112</td>
                      <td style={{ textAlign: 'center' }}>606</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, background: '#F8FAFC' }}>821</td>
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 700, color: '#1E293B' }}>Growing</td>
                      <td style={{ textAlign: 'center' }}>80</td>
                      <td style={{ textAlign: 'center' }}>65</td>
                      <td style={{ textAlign: 'center' }}>131</td>
                      <td style={{ textAlign: 'center' }}>316</td>
                      <td style={{ textAlign: 'right', fontWeight: 800, background: '#F8FAFC' }}>592</td>
                    </tr>
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#F1F5F9', fontWeight: 800 }}>
                      <td style={{ padding: '8px 10px' }}>Total Counters</td>
                      <td style={{ textAlign: 'center' }}>166</td>
                      <td style={{ textAlign: 'center' }}>125</td>
                      <td style={{ textAlign: 'center' }}>254</td>
                      <td style={{ textAlign: 'center' }}>1,163</td>
                      <td style={{ textAlign: 'right', color: '#DC2626' }}>1,708</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Table 2: 4-Role Visit Allocation Matrix */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontWeight: 800, fontSize: '0.88rem', color: '#1E293B' }}>
                  2. Role-Wise Visit Frequency Matrix & Priority Scores
                </div>
                <span style={{ fontSize: '0.72rem', background: '#EFF6FF', color: '#1D4ED8', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
                  Deduplicated Canonical Matrix (SO / ASM / RSM / ZH)
                </span>
              </div>
              <div style={{ border: '1px solid #CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
                <table className="excel-table">
                  <thead>
                    <tr>
                      <th className="excel-header-peach" style={{ width: 90 }}>Role</th>
                      <th className="excel-header-yellow" style={{ width: 70 }}>Score</th>
                      <th className="excel-header-peach" style={{ textAlign: 'left', minWidth: 140 }}>Category</th>
                      <th className="excel-header-peach" style={{ width: 85 }}>Grade A</th>
                      <th className="excel-header-peach" style={{ width: 85 }}>Grade B</th>
                      <th className="excel-header-peach" style={{ width: 85 }}>Grade C</th>
                      <th className="excel-header-peach" style={{ width: 85 }}>Grade D</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* SO */}
                    <tr>
                      <td rowSpan={5} style={{ textAlign: 'center', fontWeight: 800, background: '#EFF6FF', color: '#1D4ED8', verticalAlign: 'middle' }}>
                        SO
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>40</td>
                      <td style={{ fontWeight: 600 }}>Zero lifter</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>3</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>30</td>
                      <td style={{ fontWeight: 600 }}>Prospective</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>3</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                    </tr>
                    <tr style={{ background: '#FEF3C7' }}>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#B45309' }}>25</td>
                      <td style={{ fontWeight: 800, color: '#B45309' }}>Need to Grow</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>2</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>2</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>3</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>2</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>20</td>
                      <td style={{ fontWeight: 600 }}>De-growing</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>3</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>10</td>
                      <td style={{ fontWeight: 600 }}>Growing</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>3</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                    </tr>

                    {/* ASM */}
                    <tr style={{ borderTop: '2px solid #CBD5E1' }}>
                      <td rowSpan={5} style={{ textAlign: 'center', fontWeight: 800, background: '#F5F3FF', color: '#6D28D9', verticalAlign: 'middle' }}>
                        ASM
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>40</td>
                      <td style={{ fontWeight: 600 }}>Zero lifter</td>
                      <td style={{ textAlign: 'center' }}>3</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>0.5</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>30</td>
                      <td style={{ fontWeight: 600 }}>Prospective</td>
                      <td style={{ textAlign: 'center' }}>3</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>0.5</td>
                    </tr>
                    <tr style={{ background: '#FEF3C7' }}>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#B45309' }}>25</td>
                      <td style={{ fontWeight: 800, color: '#B45309' }}>Need to Grow</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>3</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>2</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>1</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>0.5</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>20</td>
                      <td style={{ fontWeight: 600 }}>De-growing</td>
                      <td style={{ textAlign: 'center' }}>3</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>0.5</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>10</td>
                      <td style={{ fontWeight: 600 }}>Growing</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>0.5</td>
                    </tr>

                    {/* RSM */}
                    <tr style={{ borderTop: '2px solid #CBD5E1' }}>
                      <td rowSpan={5} style={{ textAlign: 'center', fontWeight: 800, background: '#ECFDF5', color: '#047857', verticalAlign: 'middle' }}>
                        RSM
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>40</td>
                      <td style={{ fontWeight: 600 }}>Zero lifter</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>0.5</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>30</td>
                      <td style={{ fontWeight: 600 }}>Prospective</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>0.5</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>
                    <tr style={{ background: '#FEF3C7' }}>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#B45309' }}>25</td>
                      <td style={{ fontWeight: 800, color: '#B45309' }}>Need to Grow</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>3</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>1</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>0.5</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>20</td>
                      <td style={{ fontWeight: 600 }}>De-growing</td>
                      <td style={{ textAlign: 'center' }}>2</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>0.5</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>10</td>
                      <td style={{ fontWeight: 600 }}>Growing</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center' }}>0.5</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>

                    {/* ZSH / ZH */}
                    <tr style={{ borderTop: '2px solid #CBD5E1' }}>
                      <td rowSpan={5} style={{ textAlign: 'center', fontWeight: 800, background: '#FFFBEB', color: '#B45309', verticalAlign: 'middle' }}>
                        ZSH (ZH)
                      </td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>40</td>
                      <td style={{ fontWeight: 600 }}>Zero lifter</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>30</td>
                      <td style={{ fontWeight: 600 }}>Prospective</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>
                    <tr style={{ background: '#FEF3C7' }}>
                      <td style={{ textAlign: 'center', fontWeight: 800, color: '#B45309' }}>25</td>
                      <td style={{ fontWeight: 800, color: '#B45309' }}>Need to Grow</td>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>1</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>20</td>
                      <td style={{ fontWeight: 600 }}>De-growing</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>
                    <tr>
                      <td style={{ textAlign: 'center', fontWeight: 700 }}>10</td>
                      <td style={{ fontWeight: 600 }}>Growing</td>
                      <td style={{ textAlign: 'center' }}>1</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                      <td style={{ textAlign: 'center', color: '#94A3B8' }}>—</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Note badge */}
            <div style={{
              background: '#F0FDF4',
              border: '1px solid #BBF7D0',
              borderRadius: 8,
              padding: '10px 14px',
              fontSize: '0.78rem',
              color: '#166534',
              display: 'flex',
              alignItems: 'center',
              gap: 8
            }}>
              <CheckCircle2 size={16} />
              <span>
                <strong>Matrix Deduplication Active:</strong> All duplicate alias keys ('Zero Lifter', 'Prospectiv', 'Need to grow') have been eliminated from the visit frequency engine. Every role has strictly 6 canonical categories.
              </span>
            </div>
          </div>

          {/* Modal Footer */}
          <div style={{
            padding: '12px 24px',
            borderTop: '1px solid #E2E8F0',
            display: 'flex',
            justifyContent: 'flex-end',
            background: '#F8FAFC'
          }}>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowMatrixModal(false)}
              style={{ fontSize: '0.82rem', padding: '6px 18px' }}
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }
}
