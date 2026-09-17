import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../services/api';
import Select from 'react-select';
import {
  FileSpreadsheet,
  Users,
  Store,
  TrendingUp,
  FileCheck2,
  Search,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  Filter,
  X,
  Layers,
  Sparkles
} from 'lucide-react';

// Searchable Filter Wrapper
const FilterSelect = ({ options = [], value, onChange, placeholder, width = '150px' }) => {
  const safeOptions = Array.isArray(options) ? options : [];
  const formattedOptions = [{ value: 'ALL', label: 'All' }, ...safeOptions.map(o => ({ value: o, label: o }))];
  const selectedOption = formattedOptions.find(o => o.value === value) || formattedOptions[0];

  return (
    <div style={{ width, minWidth: width, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{placeholder}</label>
      <Select
        value={selectedOption}
        onChange={(opt) => onChange(opt ? opt.value : 'ALL')}
        options={formattedOptions}
        placeholder="All"
        isClearable={true}
        styles={{
          control: (base) => ({
            ...base,
            minHeight: '32px',
            height: '32px',
            fontSize: '0.8rem',
            borderRadius: '6px',
            borderColor: 'var(--border-color)',
            boxShadow: 'none',
            '&:hover': { borderColor: 'var(--primary-color)' }
          }),
          valueContainer: (base) => ({ ...base, padding: '0 8px' }),
          input: (base) => ({ ...base, margin: '0', padding: '0' }),
          dropdownIndicator: (base) => ({ ...base, padding: '4px' }),
          option: (base, { isFocused, isSelected }) => ({
            ...base,
            fontSize: '0.8rem',
            padding: '6px 10px',
            backgroundColor: isSelected ? 'var(--primary-color)' : isFocused ? 'var(--bg-light)' : 'transparent',
            color: isSelected ? 'white' : 'inherit',
            cursor: 'pointer'
          }),
          menu: (base) => ({ ...base, zIndex: 9999 })
        }}
      />
    </div>
  );
};

// Helper: Format period month to English Month Name (e.g. '2024-04' -> 'April 2024')
function formatPeriodMonthName(val) {
  if (!val || val === 'ALL') return val;
  const str = String(val).trim();
  const match = str.match(/^(\d{4})-(\d{2})/);
  if (match) {
    const year = match[1];
    const month = parseInt(match[2], 10);
    const months = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    if (month >= 1 && month <= 12) {
      return `${months[month - 1]} ${year}`;
    }
  }
  const shortMatch = str.match(/^([A-Za-z]{3})[- ]?(\d{2,4})/);
  if (shortMatch) {
    const mStr = shortMatch[1].toLowerCase();
    const yStr = shortMatch[2].length === 2 ? `20${shortMatch[2]}` : shortMatch[2];
    const monthMap = {
      jan: 'January', feb: 'February', mar: 'March', apr: 'April',
      may: 'May', jun: 'June', jul: 'July', aug: 'August',
      sep: 'September', oct: 'October', nov: 'November', dec: 'December'
    };
    if (monthMap[mStr]) {
      return `${monthMap[mStr]} ${yStr}`;
    }
  }
  return str;
}

// Helper: Format period month to short Mon'YY (e.g. '2026-06' -> "Jun'26")
function formatShortMonthYear(val) {
  if (!val || val === 'ALL') return val;
  const str = String(val).trim();
  const match = str.match(/^(\d{4})-(\d{2})/);
  if (match) {
    const year = match[1].slice(-2);
    const month = parseInt(match[2], 10);
    const shortMonths = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ];
    if (month >= 1 && month <= 12) {
      return `${shortMonths[month - 1]}'${year}`;
    }
  }
  const shortMatch = str.match(/^([A-Za-z]{3})[- ]?(\d{2,4})/);
  if (shortMatch) {
    const mStr = shortMatch[1];
    const yStr = shortMatch[2].slice(-2);
    return `${mStr.charAt(0).toUpperCase() + mStr.slice(1).toLowerCase()}'${yStr}`;
  }
  return str;
}

// Searchable Period Filter with Human-Readable Month Names & "All Months" option
const PeriodFilterSelect = ({ options = [], value, onChange, placeholder = 'Select Month / All Data', width = '220px' }) => {
  const safeOptions = Array.isArray(options) ? options.filter(Boolean) : [];
  const formattedOptions = [
    { value: 'ALL', label: 'All Months (All Data)' },
    ...safeOptions.map(p => ({
      value: p,
      label: `${formatPeriodMonthName(p)} (${p})`
    }))
  ];
  const selectedOption = formattedOptions.find(o => o.value === value) || (value && value !== 'ALL' ? { value, label: `${formatPeriodMonthName(value)} (${value})` } : formattedOptions[0]);

  return (
    <div style={{ width, minWidth: width, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
      <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{placeholder}</label>
      <Select
        value={selectedOption}
        onChange={(opt) => onChange(opt ? opt.value : 'ALL')}
        options={formattedOptions}
        placeholder="All Months (All Data)"
        isClearable={false}
        styles={{
          control: (base) => ({
            ...base,
            minHeight: '32px',
            height: '32px',
            fontSize: '0.8rem',
            borderRadius: '6px',
            borderColor: 'var(--border-color)',
            boxShadow: 'none',
            '&:hover': { borderColor: 'var(--primary-color)' }
          }),
          valueContainer: (base) => ({ ...base, padding: '0 8px' }),
          input: (base) => ({ ...base, margin: '0', padding: '0' }),
          dropdownIndicator: (base) => ({ ...base, padding: '4px' }),
          option: (base, { isFocused, isSelected }) => ({
            ...base,
            fontSize: '0.8rem',
            padding: '6px 10px',
            backgroundColor: isSelected ? 'var(--primary-color)' : isFocused ? 'var(--bg-light)' : 'transparent',
            color: isSelected ? 'white' : 'inherit',
            cursor: 'pointer'
          }),
          menu: (base) => ({ ...base, zIndex: 9999 })
        }}
      />
    </div>
  );
};

// Helper: Format time fraction to HH:mm:ss
export function formatTimeFraction(val) {
  if (!val || val === '-') return '-';
  if (typeof val === 'string' && /^\d{1,2}:\d{2}(:\d{2})?$/.test(val.trim())) {
    const parts = val.trim().split(':');
    const hh = parts[0].padStart(2, '0');
    const mm = parts[1].padStart(2, '0');
    const ss = (parts[2] || '00').padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  const num = parseFloat(val);
  if (!isNaN(num) && num >= 0 && num <= 1) {
    const totalSeconds = Math.round(num * 86400);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const hh = String(hours % 24).padStart(2, '0');
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }
  return String(val);
}

export default function MasterDataRepositoryView({ onShowToast }) {
  // Active Ingestion Tab persisted in localStorage
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('star_master_subtab') || 'PJP_TRADE';
  });

  const [summary, setSummary] = useState({
    totalPjpTrade: 0,
    totalDealerMapping: 0,
    totalDealerMapping: 0,
    totalProspectDealers: 0,
    totalSalesHistory: 0,
    totalSfaReport: 0,
    totalDealerPerformance: 0
  });

  // Filter options from database
  const [filterOptions, setFilterOptions] = useState({
    dealerZones: [],
    dealerRegions: [],
    dealerAreas: [],
    dealerTypes: ['DEALER', 'NON-STAR', 'SUB-DEALER', 'RSAR'],
    dealerStatuses: ['ACTIVE', 'INACTIVE'],
    salesPeriods: [],
    salesZones: [],
    dpPeriods: [],
    logBranches: [],
    logRoutes: [],
    logEmployees: [],
    logStatuses: [],
    logVisitDates: [],
    logCustomerTypes: [],
    mappingAreas: [],
    mappingRegions: [],
    mappingSos: [],
    pjpZones: [],
    pjpAreas: [],
    pjpSos: [],
    pjpCategories: [],
    pjpStatuses: []
  });

  // Field Filter States for Each Tab
  // 1. PJP_TRADE Filters
  const [pjpFilters, setPjpFilters] = useState({
    zone: 'ALL',
    area: 'ALL',
    soName: 'ALL',
    category: 'ALL',
    status: 'ALL',
    custType: 'ALL',
    cycleCode: 'C1',
    search: ''
  });

  // 2. DEALER_MAPPING Filters
  const [mapFilters, setMapFilters] = useState({
    region: 'ALL',
    area: 'ALL',
    soName: 'ALL',
    strategy: 'ALL',
    custType: 'ALL',
    search: ''
  });

  // 3. PROSPECT_DEALERS Filters
  const [dealerFilters, setDealerFilters] = useState({
    zone: 'ALL',
    region: 'ALL',
    area: 'ALL',
    dealerType: 'ALL',
    status: 'ALL',
    search: ''
  });

  // 4. SALES_HISTORY Filters
  const [salesFilters, setSalesFilters] = useState({
    period: 'ALL',
    zone: 'ALL',
    search: ''
  });

  // 5. SFA_REPORT Filters
  const [sfaFilters, setSfaFilters] = useState({
    visitDate: 'ALL',
    employeeName: 'ALL',
    branch: 'ALL',
    route: 'ALL',
    visitStatus: 'ALL',
    customerType: 'ALL',
    search: ''
  });

  // 6. DEALER_PERFORMANCE Filters
  const [dpFilters, setDpFilters] = useState({
    period: 'ALL',
    zone: 'ALL',
    region: 'ALL',
    area: 'ALL',
    search: ''
  });

  // Pagination & Loading
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [loading, setLoading] = useState(true);

  // Data Store
  const [tabData, setTabData] = useState({
    PJP_TRADE: { items: [], total: 0 },
    DEALER_MAPPING: { items: [], total: 0 },
    PROSPECT_DEALERS: { items: [], total: 0 },
    SALES_HISTORY: { items: [], total: 0 },
    SFA_REPORT: { items: [], total: 0 },
    DEALER_PERFORMANCE: { items: [], total: 0, periodInfo: null }
  });

  // Load summary counts and filter options
  const loadInitialOptions = async () => {
    try {
      const [sumRes, optRes] = await Promise.all([
        api.getMasterSummary(),
        api.getMasterFilters()
      ]);

      if (sumRes.summary) {
        setSummary({
          totalPjpTrade: sumRes.summary.totalTargets ?? 0,
          totalDealerMapping: sumRes.summary.totalMappings ?? 0,
          totalDealerMapping: sumRes.summary.totalMappings ?? 0,
          totalProspectDealers: sumRes.summary.totalProspects ?? 0,
          totalSalesHistory: sumRes.summary.totalSalesRecords ?? 0,
          totalSfaReport: sumRes.summary.totalVisitLogs ?? 0,
          totalDealerPerformance: sumRes.summary.totalDealerPerformance ?? 0
        });
      }

      if (optRes) {
        setFilterOptions(prev => ({
          ...prev,
          ...optRes
        }));
      }
    } catch (err) {
      console.error('Error fetching master summary/filters:', err);
    }
  };

  useEffect(() => {
    loadInitialOptions();
  }, []);

  // Fetch current active ingestion data with all field filters
  const loadCurrentData = async () => {
    setLoading(true);
    const offset = (page - 1) * pageSize;
    try {
      if (activeTab === 'PJP_TRADE') {
        const res = await api.getVisitTargets({
          cycleCode: pjpFilters.cycleCode,
          dealerStatus: pjpFilters.status,
          category: pjpFilters.category,
          custType: pjpFilters.custType,
          zone: pjpFilters.zone,
          area: pjpFilters.area,
          soName: pjpFilters.soName,
          search: pjpFilters.search,
          limit: pageSize,
          offset
        });
        setTabData(prev => ({
          ...prev,
          PJP_TRADE: { items: res.targets || [], total: res.total || 0 }
        }));
      } else if (activeTab === 'DEALER_MAPPING') {
        const res = await api.getTerritoryMappingFiltered({
          area: mapFilters.area,
          region: mapFilters.region,
          soName: mapFilters.soName,
          custType: mapFilters.custType,
          search: mapFilters.search,
          limit: pageSize,
          offset
        });
        setTabData(prev => ({
          ...prev,
          DEALER_MAPPING: { items: res.mappings || [], total: res.total || 0 }
        }));
      } else if (activeTab === 'PROSPECT_DEALERS') {
        const res = await api.getMasterDealers({
          search: dealerFilters.search,
          dealerType: dealerFilters.dealerType,
          status: dealerFilters.status,
          zone: dealerFilters.zone,
          region: dealerFilters.region,
          area: dealerFilters.area,
          counterStrategy: 'PROSPECT',
          limit: pageSize,
          offset
        });
        setTabData(prev => ({
          ...prev,
          PROSPECT_DEALERS: { items: res.dealers || [], total: res.total || 0 }
        }));
      } else if (activeTab === 'SALES_HISTORY') {
        const res = await api.getSalesHistory({
          search: salesFilters.search,
          period: salesFilters.period,
          zone: salesFilters.zone,
          limit: pageSize,
          offset
        });
        setTabData(prev => ({
          ...prev,
          SALES_HISTORY: { items: res.sales || [], total: res.total || 0 }
        }));
      } else if (activeTab === 'SFA_REPORT') {
        const res = await api.getVisitLogs({
          search: sfaFilters.search,
          visitDate: sfaFilters.visitDate,
          employeeName: sfaFilters.employeeName,
          branch: sfaFilters.branch,
          route: sfaFilters.route,
          visitStatus: sfaFilters.visitStatus,
          customerType: sfaFilters.customerType,
          limit: pageSize,
          offset
        });
        setTabData(prev => ({
          ...prev,
          SFA_REPORT: { items: res.logs || [], total: res.total || 0 }
        }));
      } else if (activeTab === 'DEALER_PERFORMANCE') {
        const res = await api.getDealerPerformance({
          search: dpFilters.search,
          period: dpFilters.period,
          zone: dpFilters.zone,
          region: dpFilters.region,
          area: dpFilters.area,
          limit: pageSize,
          offset
        });
        setTabData(prev => ({
          ...prev,
          DEALER_PERFORMANCE: {
            items: res.performance || [],
            total: res.total || 0,
            periodInfo: res.periodInfo || null
          }
        }));
      }
    } catch (err) {
      onShowToast(`Failed to load data for ${activeTab}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      loadCurrentData();
    }, 400);

    return () => clearTimeout(delayDebounceFn);
  }, [
    activeTab,
    page,
    pjpFilters,
    mapFilters,
    dealerFilters,
    salesFilters,
    sfaFilters,
    dpFilters
  ]);

  const currentDataset = tabData[activeTab] || { items: [], total: 0 };
  const totalPages = Math.ceil(currentDataset.total / pageSize) || 1;

  const handleTabChange = (t) => {
    setActiveTab(t);
    localStorage.setItem('star_master_subtab', t);
    setPage(1);
  };

  const getStatusBadgeClass = (status) => {
    if (!status) return 'badge-growing';
    const s = status.toLowerCase();
    if (s === 'stable') return 'badge-stable';
    if (s === 'declining' || s === 'de-growing' || s === 'degrowing') return 'badge-declining';
    if (s === 'zero lifter' || s === 'zerolifter') return 'badge-zero';
    if (s === 'churn') return 'badge-churn';
    if (s === 'need to grow' || s === 'needtogrow') return 'badge-needgrow';
    if (s === 'prospective' || s === 'prospect') return 'badge-prospect';
    return 'badge-growing';
  };

  // Reset Filters for Current Tab
  const handleResetCurrentFilters = () => {
    if (activeTab === 'PJP_TRADE') {
      setPjpFilters({ zone: 'ALL', area: 'ALL', soName: 'ALL', category: 'ALL', status: 'ALL', custType: 'ALL', cycleCode: 'C1', search: '' });
    } else if (activeTab === 'DEALER_MAPPING') {
      setMapFilters({ region: 'ALL', area: 'ALL', soName: 'ALL', strategy: 'ALL', custType: 'ALL', search: '' });
    } else if (activeTab === 'PROSPECT_DEALERS') {
      setDealerFilters({ zone: 'ALL', region: 'ALL', area: 'ALL', dealerType: 'ALL', status: 'ALL', search: '' });
    } else if (activeTab === 'SALES_HISTORY') {
      setSalesFilters({ period: 'ALL', zone: 'ALL', search: '' });
    } else if (activeTab === 'SFA_REPORT') {
      setSfaFilters({ visitDate: 'ALL', employeeName: 'ALL', branch: 'ALL', route: 'ALL', visitStatus: 'ALL', customerType: 'ALL', search: '' });
    } else if (activeTab === 'DEALER_PERFORMANCE') {
      setDpFilters({ period: 'ALL', zone: 'ALL', region: 'ALL', area: 'ALL', search: '' });
    }
    setPage(1);
  };

  return (
    <div>
      {/* Top Ingestion Master KPI Cards */}
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(140px, 1fr))', gap: '12px' }}>
        <div
          className={`kpi-card ${activeTab === 'PJP_TRADE' ? 'red' : ''}`}
          onClick={() => handleTabChange('PJP_TRADE')}
          style={{ cursor: 'pointer', borderTop: activeTab === 'PJP_TRADE' ? '2px solid var(--star-red)' : '' }}
        >
          <div className="kpi-label">Visit Master</div>
          <div className="kpi-value">{summary.totalPjpTrade?.toLocaleString()}</div>
          <div className="kpi-subtext">PJP Process Trade</div>
        </div>

        <div
          className={`kpi-card blue ${activeTab === 'DEALER_MAPPING' ? 'active' : ''}`}
          onClick={() => handleTabChange('DEALER_MAPPING')}
          style={{ cursor: 'pointer', borderTop: activeTab === 'DEALER_MAPPING' ? '2px solid var(--color-info)' : '' }}
        >
          <div className="kpi-label">Dealer - SO Mapping</div>
          <div className="kpi-value">{summary.totalDealerMapping?.toLocaleString()}</div>
          <div className="kpi-subtext">Territory Hierarchy</div>
        </div>

        <div
          className={`kpi-card purple ${activeTab === 'PROSPECT_DEALERS' ? 'active' : ''}`}
          onClick={() => handleTabChange('PROSPECT_DEALERS')}
          style={{ cursor: 'pointer', borderTop: activeTab === 'PROSPECT_DEALERS' ? '2px solid var(--color-purple)' : '' }}
        >
          <div className="kpi-label">Prospect Dealers</div>
          <div className="kpi-value">{summary.totalProspectDealers?.toLocaleString()}</div>
          <div className="kpi-subtext">Non-Star Directory</div>
        </div>

        <div
          className={`kpi-card orange ${activeTab === 'SALES_HISTORY' ? 'active' : ''}`}
          onClick={() => handleTabChange('SALES_HISTORY')}
          style={{ cursor: 'pointer', borderTop: activeTab === 'SALES_HISTORY' ? '2px solid var(--color-warning)' : '' }}
        >
          <div className="kpi-label">Sales History</div>
          <div className="kpi-value">{summary.totalSalesHistory?.toLocaleString()}</div>
          <div className="kpi-subtext">RSAR / ERP Invoicing</div>
        </div>

        <div
          className={`kpi-card teal ${activeTab === 'DEALER_PERFORMANCE' ? 'active' : ''}`}
          onClick={() => handleTabChange('DEALER_PERFORMANCE')}
          style={{ cursor: 'pointer', borderTop: activeTab === 'DEALER_PERFORMANCE' ? '2px solid var(--color-teal, #14b8a6)' : '' }}
        >
          <div className="kpi-label">Dealer Performance</div>
          <div className="kpi-value">{summary.totalDealerPerformance?.toLocaleString()}</div>
          <div className="kpi-subtext">Performance & Targets</div>
        </div>

        <div
          className={`kpi-card green ${activeTab === 'SFA_REPORT' ? 'active' : ''}`}
          onClick={() => handleTabChange('SFA_REPORT')}
          style={{ cursor: 'pointer', borderTop: activeTab === 'SFA_REPORT' ? '2px solid var(--color-success)' : '' }}
        >
          <div className="kpi-label">SFA Execution</div>
          <div className="kpi-value">{summary.totalSfaReport?.toLocaleString()}</div>
          <div className="kpi-subtext">Visit Feedback Logs</div>
        </div>
      </div>

      {/* Sub-Tab Navigation Bar */}
      <div className="content-card" style={{ marginBottom: '12px', padding: '10px 14px' }}>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className={`btn ${activeTab === 'PJP_TRADE' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => handleTabChange('PJP_TRADE')}
            style={{ padding: '6px 13px', fontSize: '0.82rem' }}
          >
            <FileSpreadsheet size={14} />
            <span>Visit Master (PJP)</span>
          </button>

          <button
            className={`btn ${activeTab === 'DEALER_MAPPING' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => handleTabChange('DEALER_MAPPING')}
            style={{ padding: '6px 13px', fontSize: '0.82rem' }}
          >
            <Users size={14} />
            <span>Dealer - SO Hierarchy</span>
          </button>

          <button
            className={`btn ${activeTab === 'PROSPECT_DEALERS' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => handleTabChange('PROSPECT_DEALERS')}
            style={{ padding: '6px 13px', fontSize: '0.82rem' }}
          >
            <Store size={14} />
            <span>Prospect Dealers</span>
          </button>

          <button
            className={`btn ${activeTab === 'SALES_HISTORY' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => handleTabChange('SALES_HISTORY')}
            style={{ padding: '6px 13px', fontSize: '0.82rem' }}
          >
            <TrendingUp size={14} />
            <span>Sales History (RSAR)</span>
          </button>

          <button
            className={`btn ${activeTab === 'DEALER_PERFORMANCE' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => handleTabChange('DEALER_PERFORMANCE')}
            style={{ padding: '6px 13px', fontSize: '0.82rem' }}
          >
            <Sparkles size={14} />
            <span>Dealer Performance</span>
          </button>

          <button
            className={`btn ${activeTab === 'SFA_REPORT' ? 'btn-primary' : 'btn-outline'}`}
            onClick={() => handleTabChange('SFA_REPORT')}
            style={{ padding: '6px 13px', fontSize: '0.82rem' }}
          >
            <FileCheck2 size={14} />
            <span>SFA Visit Feedback</span>
          </button>
        </div>
      </div>

      {/* DEDICATED FIELD-LEVEL FILTER BAR FOR ACTIVE TAB */}
      <div className="content-card" style={{ marginBottom: '16px', padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>

          {/* TAB 1: PJP_TRADE FIELD FILTERS */}
          {activeTab === 'PJP_TRADE' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                <Filter size={14} />
                <span>Filters:</span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Cycle</label>
                <select
                  className="form-control"
                  style={{ width: '140px', minWidth: '140px', flexShrink: 0, padding: '6px 10px', fontSize: '0.8rem' }}
                  value={pjpFilters.cycleCode}
                  onChange={(e) => { setPjpFilters(prev => ({ ...prev, cycleCode: e.target.value })); setPage(1); }}
                >
                  <option value="C1">Cycle 1 (1-15)</option>
                  <option value="C2">Cycle 2 (16-EOM)</option>
                </select>
              </div>

              <FilterSelect options={filterOptions.pjpZones} value={pjpFilters.zone} onChange={v => { setPjpFilters(prev => ({ ...prev, zone: v })); setPage(1); }} placeholder="Zones" width="140px" />

              <FilterSelect options={filterOptions.pjpAreas} value={pjpFilters.area} onChange={v => { setPjpFilters(prev => ({ ...prev, area: v })); setPage(1); }} placeholder="Areas" width="160px" />

              <FilterSelect options={filterOptions.pjpSos} value={pjpFilters.soName} onChange={v => { setPjpFilters(prev => ({ ...prev, soName: v })); setPage(1); }} placeholder="Sales Officers" width="180px" />

              <FilterSelect options={['STAR', 'NON-STAR', 'DEALER', 'PROSPECTIVE']} value={pjpFilters.custType} onChange={v => { setPjpFilters(prev => ({ ...prev, custType: v })); setPage(1); }} placeholder="Cust Type" width="130px" />

              <FilterSelect options={filterOptions.pjpCategories.length > 0 ? filterOptions.pjpCategories : ['A', 'B', 'C', 'D']} value={pjpFilters.category} onChange={v => { setPjpFilters(prev => ({ ...prev, category: v })); setPage(1); }} placeholder="Categories" width="160px" />

              <FilterSelect options={filterOptions.pjpStatuses.length > 0 ? filterOptions.pjpStatuses : ['Growing', 'De-growing', 'Zero lifter', 'Need to Grow', 'Prospective']} value={pjpFilters.status} onChange={v => { setPjpFilters(prev => ({ ...prev, status: v })); setPage(1); }} placeholder="Status" width="170px" />

              <div style={{ position: 'relative', width: '200px', minWidth: '200px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Search</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Dealer / SO / SAP..."
                    value={pjpFilters.search}
                    onChange={(e) => { setPjpFilters(prev => ({ ...prev, search: e.target.value })); setPage(1); }}
                    style={{ paddingLeft: '28px', paddingRight: '8px', fontSize: '0.8rem', width: '100%' }}
                  />
                  <Search size={13} style={{ position: 'absolute', left: '9px', top: '9px', color: 'var(--text-muted)' }} />
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DEALER_MAPPING FIELD FILTERS */}
          {activeTab === 'DEALER_MAPPING' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                <Filter size={14} />
                <span>Filters:</span>
              </div>

              <FilterSelect options={['STAR', 'NON-STAR', 'DEALER', 'PROSPECTIVE']} value={mapFilters.custType} onChange={v => { setMapFilters(prev => ({ ...prev, custType: v })); setPage(1); }} placeholder="Cust Type" width="130px" />

              <FilterSelect options={filterOptions.mappingRegions} value={mapFilters.region} onChange={v => { setMapFilters(prev => ({ ...prev, region: v })); setPage(1); }} placeholder="Regions" width="130px" />

              <FilterSelect options={filterOptions.mappingAreas} value={mapFilters.area} onChange={v => { setMapFilters(prev => ({ ...prev, area: v })); setPage(1); }} placeholder="Areas" width="150px" />

              <FilterSelect options={filterOptions.mappingSos} value={mapFilters.soName} onChange={v => { setMapFilters(prev => ({ ...prev, soName: v })); setPage(1); }} placeholder="Sales Officers" width="160px" />

              <div style={{ position: 'relative', width: '220px', minWidth: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Search</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Dealer / SO / Code..."
                    value={mapFilters.search}
                    onChange={(e) => { setMapFilters(prev => ({ ...prev, search: e.target.value })); setPage(1); }}
                    style={{ paddingLeft: '28px', paddingRight: '8px', fontSize: '0.8rem', width: '100%' }}
                  />
                  <Search size={13} style={{ position: 'absolute', left: '9px', top: '9px', color: 'var(--text-muted)' }} />
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PROSPECT_DEALERS FIELD FILTERS */}
          {activeTab === 'PROSPECT_DEALERS' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                <Filter size={14} />
                <span>Filters:</span>
              </div>

              <FilterSelect options={filterOptions.dealerZones} value={dealerFilters.zone} onChange={v => { setDealerFilters(prev => ({ ...prev, zone: v })); setPage(1); }} placeholder="Zones" width="120px" />

              <FilterSelect options={filterOptions.dealerRegions} value={dealerFilters.region} onChange={v => { setDealerFilters(prev => ({ ...prev, region: v })); setPage(1); }} placeholder="Regions" width="130px" />

              <FilterSelect options={filterOptions.dealerAreas} value={dealerFilters.area} onChange={v => { setDealerFilters(prev => ({ ...prev, area: v })); setPage(1); }} placeholder="Areas" width="140px" />

              <FilterSelect options={filterOptions.dealerTypes} value={dealerFilters.dealerType} onChange={v => { setDealerFilters(prev => ({ ...prev, dealerType: v })); setPage(1); }} placeholder="Types" width="120px" />

              <FilterSelect options={filterOptions.dealerStatuses} value={dealerFilters.status} onChange={v => { setDealerFilters(prev => ({ ...prev, status: v })); setPage(1); }} placeholder="Status" width="110px" />

              <div style={{ position: 'relative', width: '200px', minWidth: '200px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Search</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Customer / Code..."
                    value={dealerFilters.search}
                    onChange={(e) => { setDealerFilters(prev => ({ ...prev, search: e.target.value })); setPage(1); }}
                    style={{ paddingLeft: '28px', paddingRight: '8px', fontSize: '0.8rem', width: '100%' }}
                  />
                  <Search size={13} style={{ position: 'absolute', left: '9px', top: '9px', color: 'var(--text-muted)' }} />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SALES_HISTORY FIELD FILTERS WITH MONTH NAMES */}
          {activeTab === 'SALES_HISTORY' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                <Filter size={14} />
                <span>Filters:</span>
              </div>

              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                <PeriodFilterSelect
                  options={filterOptions.salesPeriods}
                  value={salesFilters.period}
                  onChange={v => { setSalesFilters(prev => ({ ...prev, period: v })); setPage(1); }}
                  placeholder="Select Month / All Data"
                  width="220px"
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Custom Month</label>
                  <input
                    type="month"
                    className="form-control"
                    style={{ width: '135px', minWidth: '135px', padding: '5px 8px', fontSize: '0.78rem', fontWeight: 600, height: '32px' }}
                    value={salesFilters.period === 'ALL' ? '' : salesFilters.period}
                    onChange={(e) => { setSalesFilters(prev => ({ ...prev, period: e.target.value || 'ALL' })); setPage(1); }}
                    title="Or pick custom month"
                  />
                </div>
              </div>

              <FilterSelect options={filterOptions.salesZones} value={salesFilters.zone} onChange={v => { setSalesFilters(prev => ({ ...prev, zone: v })); setPage(1); }} placeholder="Zones" width="130px" />

              <div style={{ position: 'relative', width: '250px', minWidth: '250px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Search</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search sub-dealer / linked dealer / SAP..."
                    value={salesFilters.search}
                    onChange={(e) => { setSalesFilters(prev => ({ ...prev, search: e.target.value })); setPage(1); }}
                    style={{ paddingLeft: '28px', paddingRight: '8px', fontSize: '0.8rem', width: '100%' }}
                  />
                  <Search size={13} style={{ position: 'absolute', left: '9px', top: '9px', color: 'var(--text-muted)' }} />
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: SFA_REPORT FIELD FILTERS */}
          {activeTab === 'SFA_REPORT' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                <Filter size={14} />
                <span>Filters:</span>
              </div>

              <FilterSelect options={filterOptions.logVisitDates.map(d => d && d.includes('T') ? d.split('T')[0] : d)} value={sfaFilters.visitDate} onChange={v => { setSfaFilters(prev => ({ ...prev, visitDate: v })); setPage(1); }} placeholder="Visit Dates" width="140px" />
              <FilterSelect options={filterOptions.logEmployees} value={sfaFilters.employeeName} onChange={v => { setSfaFilters(prev => ({ ...prev, employeeName: v })); setPage(1); }} placeholder="Employees" width="160px" />
              <FilterSelect options={filterOptions.logBranches} value={sfaFilters.branch} onChange={v => { setSfaFilters(prev => ({ ...prev, branch: v })); setPage(1); }} placeholder="Branches" width="130px" />
              <FilterSelect options={filterOptions.logRoutes} value={sfaFilters.route} onChange={v => { setSfaFilters(prev => ({ ...prev, route: v })); setPage(1); }} placeholder="Routes" width="140px" />
              <FilterSelect options={filterOptions.logStatuses} value={sfaFilters.visitStatus} onChange={v => { setSfaFilters(prev => ({ ...prev, visitStatus: v })); setPage(1); }} placeholder="Statuses" width="130px" />

              <div style={{ position: 'relative', width: '220px', minWidth: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Search</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search customer / code / employee..."
                    value={sfaFilters.search}
                    onChange={(e) => { setSfaFilters(prev => ({ ...prev, search: e.target.value })); setPage(1); }}
                    style={{ paddingLeft: '28px', paddingRight: '8px', fontSize: '0.8rem', width: '100%' }}
                  />
                  <Search size={13} style={{ position: 'absolute', left: '9px', top: '9px', color: 'var(--text-muted)' }} />
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: DEALER_PERFORMANCE FIELD FILTERS */}
          {activeTab === 'DEALER_PERFORMANCE' && (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-muted)' }}>
                <Filter size={14} />
                <span>Filters:</span>
              </div>

              {/* Dynamic Period Selector */}
              <div style={{ display: 'flex', gap: '6px', alignItems: 'flex-end' }}>
                <PeriodFilterSelect
                  options={filterOptions.dpPeriods}
                  value={dpFilters.period}
                  onChange={v => { setDpFilters(prev => ({ ...prev, period: v })); setPage(1); }}
                  placeholder="Select Month / All Data"
                  width="220px"
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Custom Month</label>
                  <input
                    type="month"
                    className="form-control"
                    style={{ width: '135px', minWidth: '135px', padding: '5px 8px', fontSize: '0.78rem', fontWeight: 600, height: '32px' }}
                    value={dpFilters.period === 'ALL' ? '' : dpFilters.period}
                    onChange={(e) => { setDpFilters(prev => ({ ...prev, period: e.target.value || 'ALL' })); setPage(1); }}
                    title="Or pick custom month"
                  />
                </div>
              </div>

              <FilterSelect options={filterOptions.dealerZones} value={dpFilters.zone} onChange={v => { setDpFilters(prev => ({ ...prev, zone: v })); setPage(1); }} placeholder="Zones" width="120px" />
              <FilterSelect options={filterOptions.dealerRegions} value={dpFilters.region} onChange={v => { setDpFilters(prev => ({ ...prev, region: v })); setPage(1); }} placeholder="Regions" width="130px" />
              <FilterSelect options={filterOptions.dealerAreas} value={dpFilters.area} onChange={v => { setDpFilters(prev => ({ ...prev, area: v })); setPage(1); }} placeholder="Areas" width="140px" />

              <div style={{ position: 'relative', width: '220px', minWidth: '220px', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '3px' }}>
                <label style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Search</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Search dealer / SAP / SFA..."
                    value={dpFilters.search}
                    onChange={(e) => { setDpFilters(prev => ({ ...prev, search: e.target.value })); setPage(1); }}
                    style={{ paddingLeft: '28px', paddingRight: '8px', fontSize: '0.8rem', width: '100%' }}
                  />
                  <Search size={13} style={{ position: 'absolute', left: '9px', top: '9px', color: 'var(--text-muted)' }} />
                </div>
              </div>
            </div>
          )}

          {/* Action Buttons: Reset & Refresh */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button
              className="btn btn-outline"
              onClick={handleResetCurrentFilters}
              title="Reset all filters for current dataset"
              style={{ padding: '6px 12px', fontSize: '0.8rem' }}
            >
              <X size={13} />
              <span>Reset</span>
            </button>

            <button
              className="btn btn-outline"
              onClick={loadCurrentData}
              title="Refresh dataset from database"
              style={{ padding: '6px 10px' }}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Dataset Table View */}
      <div className="table-wrapper">
        <div style={{
          padding: '14px 20px',
          background: '#FAFAFA',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>
            {activeTab === 'PJP_TRADE' && 'Full PJP Process Trade / Generated Visit Master'}
            {activeTab === 'DEALER_MAPPING' && 'Dealer - SO Territory Hierarchy Mapping'}
            {activeTab === 'PROSPECT_DEALERS' && 'Prospect Dealer List / Master Dealers'}
            {activeTab === 'SALES_HISTORY' && 'Period Sales History (RSAR / ERP)'}
            {activeTab === 'SFA_REPORT' && 'SFA Visit Execution Feedback'}
            {activeTab === 'DEALER_PERFORMANCE' && 'Dealer Performance & Historical Sales Analytics'}
            : <span style={{ color: 'var(--star-red)' }}> {currentDataset.total.toLocaleString()} records</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                className="btn btn-outline"
                style={{ padding: '4px 8px' }}
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className="btn btn-outline"
                style={{ padding: '4px 8px' }}
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="table-responsive">
          {/* TAB 1: PJP PROCESS TRADE / GENERATED VISIT MASTER */}
          {activeTab === 'PJP_TRADE' && (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Zone</th>
                  <th>Area</th>
                  <th>SO / SE Name</th>
                  <th>ASM Name</th>
                  <th>RSM Name</th>
                  <th>ZH Name</th>
                  <th>Customer Name</th>
                  <th>Customer Code</th>
                  <th>Category</th>
                  <th>Status Classification</th>
                  <th style={{ textAlign: 'center' }}>SO Visits</th>
                  <th style={{ textAlign: 'center' }}>ASM Visits</th>
                  <th style={{ textAlign: 'center' }}>RSM Visits</th>
                  <th style={{ textAlign: 'center' }}>ZH Visits</th>
                  <th style={{ textAlign: 'center' }}>Total Visits</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="16" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading PJP Process Trade Data...</td></tr>
                ) : currentDataset.items.length === 0 ? (
                  <tr><td colSpan="16" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No records found matching filters.</td></tr>
                ) : (
                  currentDataset.items.map((r, idx) => (
                    <tr key={r.id || idx}>
                      <td>{(page - 1) * pageSize + idx + 1}</td>
                      <td><b>{r.zone || 'NE 1'}</b></td>
                      <td><b>{r.area || '-'}</b></td>
                      <td><b>{r.so_name || '-'}</b></td>
                      <td>{r.asm_name || '-'}</td>
                      <td>{r.rsm_name || '-'}</td>
                      <td>{r.zh_name || '-'}</td>
                      <td><strong>{r.dealer_name}</strong></td>
                      <td><code>{r.sap_code || r.sfa_code || '-'}</code></td>
                      <td style={{ fontWeight: 800, color: 'var(--star-red)' }}>{r.category || 'A'}</td>
                      <td>
                        <span className={`status-badge ${getStatusBadgeClass(r.dealer_status || r.category)}`}>
                          {r.dealer_status || 'Active'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}><span className="visit-pill so">{r.so_visits || 0}</span></td>
                      <td style={{ textAlign: 'center' }}><span className="visit-pill asm">{r.asm_visits || 0}</span></td>
                      <td style={{ textAlign: 'center' }}><span className="visit-pill rsm">{r.rsm_visits || 0}</span></td>
                      <td style={{ textAlign: 'center' }}><span className="visit-pill zh">{r.zh_visits || 0}</span></td>
                      <td style={{ textAlign: 'center', fontWeight: 800 }}>{r.total_visits || 0}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {/* TAB 2: DEALER - SO TERRITORY HIERARCHY MAPPING */}
          {activeTab === 'DEALER_MAPPING' && (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>SAP CODE</th>
                  <th>SFA CODE</th>
                  <th>Customer Name</th>
                  <th>Cust Type</th>
                  <th>Branch Name</th>
                  <th>SO CODE</th>
                  <th>SO NAME</th>
                  <th>ASM CODE</th>
                  <th>ASM NAME</th>
                  <th>RSM CODE</th>
                  <th>RSM NAME</th>
                  <th>ZH CODE</th>
                  <th>ZH NAME</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="14" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading Dealer-SO Hierarchy Mapping...</td></tr>
                ) : currentDataset.items.length === 0 ? (
                  <tr><td colSpan="14" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No mapping records found matching filters.</td></tr>
                ) : (
                  currentDataset.items.map((m, idx) => (
                    <tr key={m.id || idx}>
                      <td>{(page - 1) * pageSize + idx + 1}</td>
                      <td><code>{m.sap_code || '-'}</code></td>
                      <td><code style={{ color: 'var(--star-red)' }}>{m.sfa_code || '-'}</code></td>
                      <td><strong>{m.dealer_name}</strong></td>
                      <td><span className="badge badge-needgrow">{m.dealer_type || 'DEALER'}</span></td>
                      <td>{m.branch || '-'}</td>
                      <td><code>{m.so_emp_code || '-'}</code></td>
                      <td><b>{m.so_name || '-'}</b></td>
                      <td><code>{m.asm_code || '-'}</code></td>
                      <td>{m.asm_name || '-'}</td>
                      <td><code>{m.rsm_code || '-'}</code></td>
                      <td>{m.rsm_name || '-'}</td>
                      <td><code>{m.zh_code || '-'}</code></td>
                      <td>{m.zh_name || '-'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {/* TAB 3: PROSPECT DEALER LIST */}
          {activeTab === 'PROSPECT_DEALERS' && (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Zone</th>
                  <th>Area</th>
                  <th>Customer Code</th>
                  <th>Customer Name</th>
                  <th>Name of SO</th>
                  <th>Potential</th>
                  <th>Expected Sale</th>
                  <th>Month</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="9" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading Prospect Dealer List...</td></tr>
                ) : currentDataset.items.length === 0 ? (
                  <tr><td colSpan="9" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No records found matching filters.</td></tr>
                ) : (
                  currentDataset.items.map((d, idx) => (
                    <tr key={d.id || idx}>
                      <td>{(page - 1) * pageSize + idx + 1}</td>
                      <td><b>{d.zone || '-'}</b></td>
                      <td><b>{d.area || '-'}</b></td>
                      <td><code>{d.sfa_code || '-'}</code></td>
                      <td><strong>{d.dealer_name}</strong></td>
                      <td>{d.so_name || 'N/A'}</td>
                      <td>{d.counter_potential || 0}</td>
                      <td>{d.expected_sale || 0}</td>
                      <td>-</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {/* TAB 4: PERIOD SALES HISTORY (RSAR / ERP) WITH MONTH NAMES */}
          {activeTab === 'SALES_HISTORY' && (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>SAP Code</th>
                  <th>RSSDCode</th>
                  <th>Sub-Dealer Name</th>
                  <th>LinkedDealerCode</th>
                  <th>Linked Dealer Name</th>
                  <th>Branch as per RSSD Master</th>
                  <th>Zone</th>
                  <th>Period (Month)</th>
                  <th style={{ textAlign: 'right' }}>Quantity (MT)</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading Period Sales History...</td></tr>
                ) : currentDataset.items.length === 0 ? (
                  <tr><td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No sales records found matching filters.</td></tr>
                ) : (
                  currentDataset.items.map((s, idx) => (
                    <tr key={s.id || idx}>
                      <td>{(page - 1) * pageSize + idx + 1}</td>
                      <td><code>{s.sap_code || '-'}</code></td>
                      <td><code>{s.rssd_code || '-'}</code></td>
                      <td><strong>{s.sub_dealer_name || '-'}</strong></td>
                      <td><code>{s.linked_dealer_code || '-'}</code></td>
                      <td>{s.linked_dealer_name || '-'}</td>
                      <td>{s.branch || '-'}</td>
                      <td>{s.zone || '-'}</td>
                      <td><b style={{ color: '#0F172A' }}>{formatPeriodMonthName(s.period_year_month)}</b></td>
                      <td style={{ textAlign: 'right', fontWeight: 800, color: 'var(--star-red)' }}>
                        {s.quantity_mt ? Number(s.quantity_mt).toFixed(2) : '0.00'} MT
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}

          {/* TAB 5: SFA VISIT EXECUTION FEEDBACK */}
          {activeTab === 'SFA_REPORT' && (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Visit Date</th>
                  <th>Customer Code</th>
                  <th>Customer Name</th>
                  <th>Customer Type</th>
                  <th>Employee Name</th>
                  <th>Employee Code</th>
                  <th>Route</th>
                  <th>Branch</th>
                  <th>Check In Time</th>
                  <th>Check Out Time</th>
                  <th>Duration</th>
                  <th>Visit Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="13" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading SFA Visit Feedback Logs...</td></tr>
                ) : currentDataset.items.length === 0 ? (
                  <tr><td colSpan="13" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No visit log records found matching filters.</td></tr>
                ) : (
                  currentDataset.items.map((v, idx) => {
                    let displayDate = v.visit_date;
                    if (displayDate && displayDate.includes('T')) {
                      displayDate = displayDate.split('T')[0];
                    }
                    if (!displayDate || displayDate === '0000-00-00') {
                      displayDate = '-';
                    }

                    return (
                      <tr key={v.id || idx}>
                        <td>{(page - 1) * pageSize + idx + 1}</td>
                        <td><b>{displayDate}</b></td>
                        <td><code>{v.customer_code}</code></td>
                        <td><strong>{v.customer_name || '-'}</strong></td>
                        <td><span className="badge badge-needgrow">{v.customer_type || 'DEALER'}</span></td>
                        <td>{v.employee_name || '-'}</td>
                        <td><code>{v.employee_code}</code></td>
                        <td>{v.route || '-'}</td>
                        <td>{v.branch || '-'}</td>
                        <td><code style={{ fontWeight: 700, color: 'var(--color-primary)' }}>{formatTimeFraction(v.check_in_time)}</code></td>
                        <td><code style={{ fontWeight: 700, color: '#0369A1' }}>{formatTimeFraction(v.check_out_time)}</code></td>
                        <td>{v.duration || '-'}</td>
                        <td>
                          <span className="status-badge approved">{v.visit_status || 'COMPLETED'}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}

          {/* TAB 6: DEALER PERFORMANCE PIVOT */}
          {activeTab === 'DEALER_PERFORMANCE' && (
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Region</th>
                  <th>Area</th>
                  <th>CODE</th>
                  <th>SAP</th>
                  <th>DEALERS NAME</th>
                  <th>DOA</th>
                  <th>Targeted Dealer</th>
                  <th>EXCLUSIVE DEALER</th>
                  <th>{currentDataset.periodInfo?.isAll || dpFilters.period === 'ALL' ? 'All Months Tgt' : (currentDataset.periodInfo?.current ? `${formatPeriodMonthName(currentDataset.periodInfo.current)} Tgt` : 'Target')}</th>
                  <th>Prorata Tgt</th>
                  <th>{currentDataset.periodInfo?.isAll || dpFilters.period === 'ALL' ? 'All Months SALE' : (currentDataset.periodInfo?.salesPeriod ? `${formatPeriodMonthName(currentDataset.periodInfo.salesPeriod)} SALE` : (currentDataset.periodInfo?.current ? `${formatPeriodMonthName(currentDataset.periodInfo.current)} SALE` : 'Current SALE'))}</th>
                  <th>Shortfall</th>
                  <th>Prorata Achv %</th>
                  <th>{currentDataset.periodInfo?.m1 ? `${formatPeriodMonthName(currentDataset.periodInfo.m1)} SALE` : 'M-1 SALE'}</th>
                  <th>VARIENCE</th>
                  <th>GROWTH %</th>
                  <th>{currentDataset.periodInfo?.isAll || dpFilters.period === 'ALL' ? 'Latest Vs M-1' : ((currentDataset.periodInfo?.salesPeriod || currentDataset.periodInfo?.current) && currentDataset.periodInfo?.m1 ? `${formatShortMonthYear(currentDataset.periodInfo?.salesPeriod || currentDataset.periodInfo?.current)} Vs ${formatShortMonthYear(currentDataset.periodInfo.m1)}` : 'M Vs M-1')}</th>
                  <th>{currentDataset.periodInfo?.lysm ? `${formatPeriodMonthName(currentDataset.periodInfo.lysm)} SALE` : 'LYSM SALE'}</th>
                  <th>LYSM VARIENCE</th>
                  <th>LYSM GROWTH %</th>
                  <th>6 month avg sales</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan="22" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>Loading Dealer Performance...</td></tr>
                ) : currentDataset.items.length === 0 ? (
                  <tr><td colSpan="22" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No records found matching filters.</td></tr>
                ) : (
                  currentDataset.items.map((r, idx) => (
                    <tr key={r.id || idx}>
                      <td>{(page - 1) * pageSize + idx + 1}</td>
                      <td><b>{r.region || '-'}</b></td>
                      <td><b>{r.area || '-'}</b></td>
                      <td><code>{r.sfa_code || '-'}</code></td>
                      <td><code>{r.sap_code || '-'}</code></td>
                      <td><strong>{r.dealer_name}</strong></td>
                      <td>{r.doa || '-'}</td>
                      <td>{r.targeted_dealer || '-'}</td>
                      <td>{r.exclusive_dealer || '-'}</td>

                      <td style={{ textAlign: 'right' }}>{Number(r.tgt_m || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>{Number(r.prorata_tgt || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 700 }}>{Number(r.sale_m || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', color: Number(r.shortfall) > 0 ? 'var(--star-red)' : 'inherit' }}>{Number(r.shortfall || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right' }}>{r.prorata_achv}%</td>

                      <td style={{ textAlign: 'right' }}>{Number(r.sale_m1 || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', color: Number(r.variance_m1) < 0 ? 'var(--star-red)' : 'var(--color-success)' }}>{Number(r.variance_m1 || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', color: Number(r.growth_m1) < 0 ? 'var(--star-red)' : 'var(--color-success)' }}>{r.growth_m1}%</td>
                      <td>
                        <span className={`badge ${Number(r.variance_m1) > 0 ? 'badge-growing' : Number(r.variance_m1) < 0 ? 'badge-degrowing' : 'badge-stable'}`}>
                          {Number(r.variance_m1) > 0 ? 'Growing' : Number(r.variance_m1) < 0 ? 'De-growing' : 'Stable'}
                        </span>
                      </td>

                      <td style={{ textAlign: 'right' }}>{Number(r.sale_lysm || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', color: Number(r.variance_lysm) < 0 ? 'var(--star-red)' : 'var(--color-success)' }}>{Number(r.variance_lysm || 0).toFixed(2)}</td>
                      <td style={{ textAlign: 'right', color: Number(r.growth_lysm) < 0 ? 'var(--star-red)' : 'var(--color-success)' }}>{r.growth_lysm}%</td>

                      <td style={{ textAlign: 'right', fontWeight: 600 }}>{Number(r.sale_6m_avg || 0).toFixed(2)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
