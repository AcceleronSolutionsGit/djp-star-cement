import React, { useState, useEffect, useMemo } from 'react';
import { api, API_BASE } from '../services/api';
import { 
  Building2, 
  UserCheck, 
  Users, 
  Target, 
  Award, 
  RotateCcw, 
  Search, 
  ChevronLeft, 
  ChevronRight,
  Filter,
  FileSpreadsheet,
  Edit2,
  Save,
  X
} from 'lucide-react';

export default function VisitsGridView({ onShowToast, triggerReload, onOpenUpload }) {
  const [stats, setStats] = useState({
    totalDealers: 0,
    totalAreas: 0,
    soVisits: 0,
    asmVisits: 0,
    rsmVisits: 0,
    zhVisits: 0
  });

  const [filterOptions, setFilterOptions] = useState({
    zones: [],
    areas: [],
    salesOfficers: [],
    dealerStatuses: []
  });

  const [filters, setFilters] = useState({
    zone: 'ALL',
    area: 'ALL',
    dealerStatus: 'ALL',
    custType: 'ALL',
    so: 'ALL',
    periodMonth: '2026-06',
    cycleCode: 'C1',
    search: ''
  });

  const [targets, setTargets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  // Editing state
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({
    so_visits: 0,
    asm_visits: 0,
    rsm_visits: 0,
    zh_visits: 0
  });

  const handleEditClick = (r) => {
    setEditingId(r.id);
    setEditForm({
      so_visits: r.so_visits || 0,
      asm_visits: r.asm_visits || 0,
      rsm_visits: r.rsm_visits || 0,
      zh_visits: r.zh_visits || 0
    });
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  const handleSaveEdit = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/djp/dealer-targets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm)
      });
      if (!res.ok) throw new Error('Failed to save');
      
      onShowToast('Target updated', 'success');
      setEditingId(null);
      loadTargets();
    } catch (err) {
      onShowToast(err.message, 'error');
    }
  };

  // Load KPI Stats
  const loadStats = async () => {
    try {
      const data = await api.getStats();
      if (data.stats) setStats(data.stats);
    } catch (err) {
      console.error('Error fetching stats:', err);
    }
  };

  // Load Filter Options
  const loadFilterOptions = async () => {
    try {
      const data = await api.getFilters();
      setFilterOptions({
        zones: data.zones || [],
        areas: data.areas || [],
        salesOfficers: data.salesOfficers || [],
        dealerStatuses: data.dealerStatuses || []
      });
    } catch (err) {
      console.error('Error fetching filters:', err);
    }
  };

  // Load Targets
  const loadTargets = async () => {
    setLoading(true);
    try {
      const data = await api.getVisitTargets({
        periodMonth: filters.periodMonth,
        cycleCode: filters.cycleCode,
        dealerStatus: filters.dealerStatus,
        custType: filters.custType,
        search: filters.search,
        zone: filters.zone,
        area: filters.area,
        soName: filters.so,
        limit: pageSize,
        offset: (page - 1) * pageSize
      });
      setTargets(data.targets || []);
      // If backend returns total count, calculate totalPages here if we lift state up, 
      // but we're still doing client-side pagination over the fetched chunk for now, 
      // or we can just show the chunk. The backend returns { total, targets }
      // To fully switch to server-side, we'd need a totalCount state.
      // For now, let's keep the existing logic structure since we're passing limit/offset.
    } catch (err) {
      onShowToast('Failed to load visit targets', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStats();
    loadFilterOptions();
  }, [triggerReload]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      loadTargets();
      setPage(1);
    }, 400); // 400ms debounce for search

    return () => clearTimeout(delayDebounceFn);
  }, [
    filters.periodMonth,
    filters.cycleCode, 
    filters.dealerStatus, 
    filters.search, 
    filters.zone, 
    filters.area, 
    filters.so, 
    page,
    triggerReload
  ]);

  // Client-side filtering is no longer needed since we pass all to backend,
  // but we can keep it as a passthrough to avoid breaking existing pagination logic.
  const filteredTargets = useMemo(() => {
    return targets;
  }, [targets]);

  // Pagination
  const totalPages = Math.ceil(filteredTargets.length / pageSize) || 1;
  const paginatedData = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredTargets.slice(start, start + pageSize);
  }, [filteredTargets, page]);

  const resetFilters = () => {
    setFilters({
      zone: 'ALL',
      area: 'ALL',
      dealerStatus: 'ALL',
      custType: 'ALL',
      so: 'ALL',
      periodMonth: new Date().toISOString().slice(0, 7),
      cycleCode: 'C1',
      search: ''
    });
  };

  const handleDownloadExcel = async () => {
    try {
      onShowToast('Preparing official 16-column Excel file...', 'info');
      const pMonth = filters.periodMonth || '2026-06';
      const cCode = filters.cycleCode || 'C1';
      const res = await fetch(`${API_BASE}/djp/export-pjp-trade?periodMonth=${encodeURIComponent(pMonth)}&cycleCode=${encodeURIComponent(cCode)}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to download Excel file');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `PJP_TRADE_${pMonth}_${cCode}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      onShowToast('Excel downloaded successfully!', 'success');
    } catch (err) {
      onShowToast(err.message || 'Failed to download Excel', 'error');
    }
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

  return (
    <div>
      {/* 5 KPI Metric Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-label">Total Target Dealers</div>
          <div className="kpi-value">{stats.totalDealers?.toLocaleString()}</div>
          <div className="kpi-subtext">Across {stats.totalAreas || 0} Operating Areas</div>
        </div>
        <div className="kpi-card blue">
          <div className="kpi-label">SO Visits Generated</div>
          <div className="kpi-value">{stats.soVisits?.toLocaleString()}</div>
          <div className="kpi-subtext">8 visits/day capacity limit</div>
        </div>
        <div className="kpi-card orange">
          <div className="kpi-label">ASM Joint Visits</div>
          <div className="kpi-value">{stats.asmVisits?.toLocaleString()}</div>
          <div className="kpi-subtext">Planned co-travels</div>
        </div>
        <div className="kpi-card purple">
          <div className="kpi-label">RSM Strategic Audits</div>
          <div className="kpi-value">{stats.rsmVisits?.toLocaleString()}</div>
          <div className="kpi-subtext">Key Cat-A focus accounts</div>
        </div>
        <div className="kpi-card green">
          <div className="kpi-label">ZH Top Accounts</div>
          <div className="kpi-value">{stats.zhVisits?.toLocaleString()}</div>
          <div className="kpi-subtext">Direct Zonal Head visits</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="filter-card">
        <div className="filter-grid">
          <div className="form-group">
            <label className="form-label">Zone / Region</label>
            <select
              className="form-control"
              value={filters.zone}
              onChange={(e) => setFilters({ ...filters, zone: e.target.value })}
            >
              <option value="ALL">All Zones ({(filterOptions.zones || []).length})</option>
              {(filterOptions.zones || []).map(z => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Area</label>
            <select
              className="form-control"
              value={filters.area}
              onChange={(e) => setFilters({ ...filters, area: e.target.value })}
            >
              <option value="ALL">All Areas ({(filterOptions.areas || []).length})</option>
              {(filterOptions.areas || []).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Cust Type</label>
            <select
              className="form-control"
              value={filters.custType}
              onChange={(e) => setFilters({ ...filters, custType: e.target.value })}
            >
              <option value="ALL">All Cust Types</option>
              <option value="STAR">STAR</option>
              <option value="NON-STAR">NON-STAR</option>
              <option value="DEALER">DEALER</option>
              <option value="PROSPECTIVE">PROSPECTIVE</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Dealer Status</label>
            <select
              className="form-control"
              value={filters.dealerStatus}
              onChange={(e) => setFilters({ ...filters, dealerStatus: e.target.value })}
            >
              <option value="ALL">All Statuses ({(filterOptions.dealerStatuses || []).length})</option>
              {(filterOptions.dealerStatuses || []).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Assigned SO</label>
            <select
              className="form-control"
              value={filters.so}
              onChange={(e) => setFilters({ ...filters, so: e.target.value })}
            >
              <option value="ALL">All Sales Officers ({(filterOptions.salesOfficers || []).length})</option>
              {(filterOptions.salesOfficers || []).map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Report Month</label>
            <input
              type="month"
              className="form-control"
              value={filters.periodMonth || new Date().toISOString().slice(0, 7)}
              onChange={(e) => setFilters({ ...filters, periodMonth: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Planning Cycle</label>
            <select
              className="form-control"
              value={filters.cycleCode}
              onChange={(e) => setFilters({ ...filters, cycleCode: e.target.value })}
            >
              <option value="C1">Cycle 1: 1st – 15th</option>
              <option value="C2">Cycle 2: 16th – EOM</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Search Keyword</label>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                className="form-control"
                placeholder="Customer / Code..."
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                style={{ paddingLeft: '32px' }}
              />
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '12px', color: 'var(--text-muted)' }} />
            </div>
          </div>

          <div>
            <button className="btn btn-outline" onClick={resetFilters} title="Reset all filters">
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
          </div>
        </div>
      </div>

      {/* Master Visits Table */}
      <div className="table-wrapper">
        <div style={{
          padding: '14px 20px',
          background: '#FAFAFA',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            Master Visit Allocations: <span style={{ color: 'var(--star-red)' }}>{filteredTargets.length.toLocaleString()} records</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              style={{ padding: '5px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={onOpenUpload}
              title="Upload new Excel master or sales data"
            >
              <FileSpreadsheet size={15} />
              <span>Upload Excel</span>
            </button>
            <a
              href={`${API_BASE}/djp/export-master${filters.periodMonth && filters.periodMonth !== 'ALL' ? `?periodMonth=${encodeURIComponent(filters.periodMonth)}&cycleCode=${encodeURIComponent(filters.cycleCode || 'C1')}` : ''}`}
              className="btn btn-outline"
              style={{ padding: '5px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', color: '#16a34a', borderColor: '#16a34a', fontWeight: 600 }}
              title="Download 22-column Master Report Excel"
              target="_blank"
              rel="noreferrer"
            >
              <FileSpreadsheet size={15} />
              <span>Masters Excel</span>
            </a>
            <a
              href={`${API_BASE}/djp/export-visits${filters.periodMonth && filters.periodMonth !== 'ALL' ? `?periodMonth=${encodeURIComponent(filters.periodMonth)}&cycleCode=${encodeURIComponent(filters.cycleCode || 'C1')}` : ''}`}
              className="btn btn-outline"
              style={{ padding: '5px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px', color: '#2563eb', borderColor: '#2563eb', fontWeight: 600 }}
              title="Download Visits Planned Excel"
              target="_blank"
              rel="noreferrer"
            >
              <FileSpreadsheet size={15} />
              <span>Visits Planned</span>
            </a>
            <button
              className="btn btn-success"
              style={{ padding: '5px 12px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '6px' }}
              onClick={handleDownloadExcel}
              title="Download official 16-column PJP/DJP Excel file"
            >
              <FileSpreadsheet size={15} />
              <span>16-Col Excel</span>
            </button>
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
                <th style={{ textAlign: 'center' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="16" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    Loading visit targets...
                  </td>
                </tr>
              ) : paginatedData.length === 0 ? (
                <tr>
                  <td colSpan="16" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    No visit target records found matching the current filters.
                  </td>
                </tr>
              ) : (
                paginatedData.map((r, idx) => (
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
                    <td style={{ textAlign: 'center' }}>
                      {editingId === r.id ? (
                        <input type="number" min="0" max="31" className="form-control" style={{ width: '60px', padding: '2px 4px', height: '24px' }} value={editForm.so_visits} onChange={e => setEditForm({...editForm, so_visits: parseInt(e.target.value) || 0})} />
                      ) : (
                        <span className="visit-pill so">{r.so_visits || 0}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {editingId === r.id ? (
                        <input type="number" min="0" max="31" className="form-control" style={{ width: '60px', padding: '2px 4px', height: '24px' }} value={editForm.asm_visits} onChange={e => setEditForm({...editForm, asm_visits: parseInt(e.target.value) || 0})} />
                      ) : (
                        <span className="visit-pill asm">{r.asm_visits || 0}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {editingId === r.id ? (
                        <input type="number" min="0" max="31" className="form-control" style={{ width: '60px', padding: '2px 4px', height: '24px' }} value={editForm.rsm_visits} onChange={e => setEditForm({...editForm, rsm_visits: parseInt(e.target.value) || 0})} />
                      ) : (
                        <span className="visit-pill rsm">{r.rsm_visits || 0}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {editingId === r.id ? (
                        <input type="number" min="0" max="31" className="form-control" style={{ width: '60px', padding: '2px 4px', height: '24px' }} value={editForm.zh_visits} onChange={e => setEditForm({...editForm, zh_visits: parseInt(e.target.value) || 0})} />
                      ) : (
                        <span className="visit-pill zh">{r.zh_visits || 0}</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'center', fontWeight: 800 }}>
                      {editingId === r.id 
                        ? (editForm.so_visits + editForm.asm_visits + editForm.rsm_visits + editForm.zh_visits)
                        : (r.total_visits || 0)}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      {editingId === r.id ? (
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'center' }}>
                          <button className="btn btn-success" style={{ padding: '2px 6px' }} onClick={() => handleSaveEdit(r.id)} title="Save"><Save size={14}/></button>
                          <button className="btn btn-outline" style={{ padding: '2px 6px' }} onClick={handleCancelEdit} title="Cancel"><X size={14}/></button>
                        </div>
                      ) : (
                        <button className="btn btn-outline" style={{ padding: '2px 6px' }} onClick={() => handleEditClick(r)} title="Edit Targets"><Edit2 size={14}/></button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
