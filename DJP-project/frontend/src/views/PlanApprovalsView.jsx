import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import SearchableSelect from '../components/SearchableSelect';
import { 
  CheckCircle2, 
  XCircle, 
  Trash2, 
  Eye, 
  CalendarDays, 
  RotateCcw, 
  X, 
  Send,
  AlertTriangle,
  ShieldCheck,
  Building2,
  Briefcase,
  User,
  Calendar,
  Check,
  Layers,
  FileCheck,
  Rocket
} from 'lucide-react';

export default function PlanApprovalsView({ onShowToast }) {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlanIds, setSelectedPlanIds] = useState([]);

  // Fullscreen Review Modal State
  const [reviewPlan, setReviewPlan] = useState(null);
  const [reviewDaysMap, setReviewDaysMap] = useState({});
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewDayModal, setReviewDayModal] = useState(null);
  const [reviewAudit, setReviewAudit] = useState([]);
  const [approvalRemarks, setApprovalRemarks] = useState('');
  const [reviewBackdatedAlert, setReviewBackdatedAlert] = useState(null);

  const loadPlans = async () => {
    setLoading(true);
    try {
      const data = await api.getPlans();
      setPlans(data.plans || []);
      setSelectedPlanIds([]);
    } catch (err) {
      onShowToast('Failed to load sales plans', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
  }, []);

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedPlanIds(plans.map(p => p.id));
    } else {
      setSelectedPlanIds([]);
    }
  };

  const handleSelectOne = (id) => {
    setSelectedPlanIds(prev => 
      prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
    );
  };

  const handleBulkDelete = async () => {
    if (selectedPlanIds.length === 0) return;
    if (!window.confirm(`Are you sure you want to permanently delete ${selectedPlanIds.length} plan(s)?`)) return;

    try {
      const res = await api.bulkDeletePlans(selectedPlanIds);
      onShowToast(res.message || 'Plans deleted successfully', 'success');
      loadPlans();
    } catch (err) {
      onShowToast(err.message || 'Failed to delete plans', 'error');
    }
  };

  const handleDeleteSingle = async (planId) => {
    if (!window.confirm(`Are you sure you want to delete Plan #${planId}?`)) return;
    try {
      const res = await api.deletePlan(planId);
      onShowToast(res.message || 'Plan deleted', 'success');
      loadPlans();
    } catch (err) {
      onShowToast(err.message || 'Failed to delete plan', 'error');
    }
  };

  const handleApproveOrReject = async (planId, action) => {
    try {
      const userObj = (() => {
        try { return JSON.parse(localStorage.getItem('star_auth_user') || '{}'); } catch { return {}; }
      })();
      const approverCode = userObj.emp_code || userObj.username || 'MGR_CENTRAL';
      const res = await api.approvePlan(planId, approverCode, action, approvalRemarks || `Action ${action} taken by ${approverCode}.`);
      onShowToast(`Plan #${planId} ${action.toLowerCase()}!`, 'success');
      if (reviewPlan) setReviewPlan(null);
      setApprovalRemarks('');
      loadPlans();
    } catch (err) {
      onShowToast(err.message || 'Failed to update plan approval', 'error');
    }
  };

  const handleRolloutPlans = async () => {
    if (!window.confirm("Are you sure you want to rollout all PENDING_ROLLOUT plans? This will make them visible to the Officers as DRAFT.")) return;
    try {
      const pMonth = periodFilter !== 'ALL' ? periodFilter : undefined;
      const res = await api.rolloutPlans(pMonth);
      onShowToast(res.message || 'Plans rolled out', 'success');
      loadPlans();
    } catch (err) {
      onShowToast(err.message || 'Failed to rollout plans', 'error');
    }
  };

  const openReviewModal = async (plan) => {
    setReviewPlan(plan);
    setReviewLoading(true);
    setApprovalRemarks('');
    setReviewBackdatedAlert(null);
    try {
      const data = await api.getPlanDetails(plan.id);
      setReviewBackdatedAlert(data.backdatedAlert || null);
      const details = data.details || [];
      const map = {};
      const dealerVisitsCount = new Map();

      details.forEach(d => {
        if (!map[d.visit_date]) map[d.visit_date] = [];
        map[d.visit_date].push(d);

        const dKey = d.dealer_sap_code || d.dealer_name;
        dealerVisitsCount.set(dKey, (dealerVisitsCount.get(dKey) || 0) + 1);
      });

      setReviewDaysMap(map);

      // Build PJP reconciliation audit
      const auditRows = [];
      for (const [dKey, count] of dealerVisitsCount.entries()) {
        const dealerItem = details.find(d => (d.dealer_sap_code || d.dealer_name) === dKey);
        auditRows.push({
          dealerName: dealerItem?.dealer_name || dKey,
          dealerCode: dealerItem?.dealer_sap_code || 'N/A',
          scheduledCount: count,
          status: 'VALIDATED'
        });
      }
      setReviewAudit(auditRows);
    } catch (err) {
      onShowToast('Failed to load plan details for review', 'error');
    } finally {
      setReviewLoading(false);
    }
  };

  // Render Modern 7-Column Review Calendar
  const renderReviewCalendar = () => {
    if (!reviewPlan?.period_month) return null;
    const [yearStr, monthStr] = reviewPlan.period_month.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10) - 1;

    const monthNames = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'
    ];
    const currentMonthName = monthNames[month];

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const cells = [];
    for (let i = 0; i < firstDay; i++) {
      cells.push(<div key={`review-empty-${i}`} className="calendar-cell empty"></div>);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateObj = new Date(year, month, d);
      const dayOfWeek = dateObj.getDay();
      const offset = dateObj.getTimezoneOffset();
      const isoDate = new Date(dateObj.getTime() - (offset * 60 * 1000)).toISOString().split('T')[0];
      const displayDate = `${String(d).padStart(2, '0')}/${String(month + 1).padStart(2, '0')}/${year}`;

      let isSunday = dayOfWeek === 0;
      let isHoliday = isSunday;
      let holidayReason = isSunday ? 'Sunday' : null;
      // All Saturdays are working days per business rules

      const dayVisits = reviewDaysMap[isoDate] || [];
      const hasVisits = dayVisits.length > 0;
      const visitCount = dayVisits.length;

      let cellClass = 'calendar-cell';
      if (isHoliday && !hasVisits) cellClass += ' holiday';

      let capClass = 'available';
      if (isHoliday) capClass = 'holiday';
      else if (visitCount >= 8) capClass = 'max';
      else if (visitCount >= 6) capClass = 'warning';
      else if (visitCount > 0) capClass = 'normal';

      cells.push(
        <div 
          key={isoDate} 
          className={cellClass}
          onClick={() => hasVisits && setReviewDayModal({ isoDate, displayDate, visits: dayVisits })}
          title={isHoliday ? `${holidayReason} (Non-Working Day)` : `${visitCount}/8 visits scheduled`}
        >
          {/* Tile Header */}
          <div className="calendar-cell-top">
            <span className={`calendar-cell-date ${hasVisits ? 'has-visits' : ''}`}>
              {d}
            </span>

            {isHoliday ? (
              <span className="calendar-cap-pill holiday">{holidayReason}</span>
            ) : (
              <span className={`calendar-cap-pill ${capClass}`}>
                {visitCount === 8 ? '8/8 MAX' : `${visitCount}/8 visits`}
              </span>
            )}
          </div>

          {/* Chips */}
          <div className="calendar-chips-container">
            {dayVisits.slice(0, 3).map((v, idx) => (
              <div key={v.id || idx} className={`dealer-calendar-chip ${v.is_backdated ? 'backdated' : ''}`} title={`${v.dealer_name} (${v.dealer_sap_code || 'N/A'})${v.is_backdated ? ' - [BACKDATED VISIT]' : ''}`}>
                <span className="dealer-chip-name">{v.is_backdated ? '⚠️ ' : ''}{v.dealer_name}</span>
                <span className={`dealer-chip-badge ${(v.dealer_type || '').toLowerCase()}`}>{v.dealer_type || 'DEALER'}</span>
              </div>
            ))}

            {visitCount > 3 && (
              <div className="more-visits-chip">
                +{visitCount - 3} more visits (Total {visitCount}/8)
              </div>
            )}
          </div>
        </div>
      );
    }

    const totalScheduled = Object.values(reviewDaysMap).reduce((sum, list) => sum + list.length, 0);
    const activeDays = Object.keys(reviewDaysMap).filter(k => reviewDaysMap[k].length > 0).length;

    return (
      <div className="calendar-wrapper-card" style={{ padding: '16px' }}>
        <div className="calendar-month-bar">
          <div className="calendar-month-title">
            <CalendarDays size={20} color="var(--star-red)" />
            <span>{currentMonthName} {year}</span>
            <span className="badge" style={{ fontSize: '0.78rem', marginLeft: '6px', background: '#F1F5F9', color: '#334155' }}>
              Plan #{reviewPlan.id} • {reviewPlan.emp_name}
            </span>
          </div>

          <div style={{ display: 'flex', gap: '14px', alignItems: 'center', fontSize: '0.82rem' }}>
            <span>Total Visits: <b>{totalScheduled}</b></span>
            <span>Active Days: <b>{activeDays}</b></span>
            <span style={{ color: '#16A34A', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <ShieldCheck size={15} /> Max 8 Visits/Day Adhered
            </span>
          </div>
        </div>

        <div className="calendar-header-grid">
          {daysOfWeek.map((day, idx) => (
            <div key={day} className={`calendar-header-cell ${idx === 0 ? 'weekend' : ''}`}>
              {day}
            </div>
          ))}
        </div>

        <div className="calendar-body-grid">
          {cells}
        </div>
      </div>
    );
  };

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [periodFilter, setPeriodFilter] = useState('ALL');
  const [employeeFilter, setEmployeeFilter] = useState('ALL');

  const distinctPeriods = Array.from(new Set(plans.map(p => p.period_month).filter(Boolean))).sort().reverse();
  const distinctEmployees = Array.from(new Set(plans.map(p => p.emp_code).filter(Boolean))).map(code => {
    const p = plans.find(plan => plan.emp_code === code);
    return {
      emp_code: code,
      emp_name: p?.emp_name || code
    };
  });

  const filteredPlans = plans.filter(p => {
    if (statusFilter !== 'ALL' && (p.status || 'DRAFT') !== statusFilter) return false;
    if (periodFilter !== 'ALL' && p.period_month !== periodFilter) return false;
    if (employeeFilter !== 'ALL' && p.emp_code !== employeeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase().trim();
      const matchId = String(p.id).includes(q);
      const matchCode = (p.emp_code || '').toLowerCase().includes(q);
      const matchName = (p.emp_name || '').toLowerCase().includes(q);
      const matchMonth = (p.period_month || '').toLowerCase().includes(q);
      if (!matchId && !matchCode && !matchName && !matchMonth) return false;
    }
    return true;
  });

  return (
    <div style={{ maxWidth: '100%', overflowX: 'hidden' }}>
      {/* Top Header Card */}
      <div className="content-card" style={{ padding: '16px 20px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FileCheck size={20} color="var(--star-red)" />
              Plan Review & Manager Approvals (DJP)
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              Inspect dated dealer schedules, validate visit allocations against PJP frequency requirements, and execute approvals.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            {plans.some(p => p.status === 'PENDING_ROLLOUT') && (
              <button
                className="btn btn-success"
                onClick={handleRolloutPlans}
                style={{ height: '36px', padding: '0 14px', fontSize: '0.82rem', display: 'flex', gap: '6px', alignItems: 'center' }}
                title="Rollout generated plans to officers"
              >
                <Rocket size={14} />
                <span>Rollout Pending Plans</span>
              </button>
            )}
            {selectedPlanIds.length > 0 && (
              <button
                className="btn btn-danger-outline"
                onClick={handleBulkDelete}
                style={{ height: '36px', padding: '0 14px', fontSize: '0.82rem' }}
              >
                <Trash2 size={14} />
                <span>Delete ({selectedPlanIds.length})</span>
              </button>
            )}
            <button className="btn btn-outline" onClick={loadPlans} title="Refresh plans" style={{ height: '36px', padding: '0 14px' }}>
              <RotateCcw size={14} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Search & Filter Toolbar with Searchable Dropdowns */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)', flexWrap: 'wrap' }}>
          {/* Search Box */}
          <div className="form-group" style={{ flex: 1, minWidth: '200px', marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Search Plans</label>
            <input
              type="text"
              className="form-control"
              placeholder="Type keyword, code, name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ height: '36px' }}
            />
          </div>

          {/* Searchable Employee Filter Dropdown */}
          <div className="form-group" style={{ minWidth: '220px', flex: 1, marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Filter Employee</label>
            <SearchableSelect
              options={[
                { value: 'ALL', label: 'All Employees' },
                ...distinctEmployees.map(e => ({
                  value: e.emp_code,
                  label: e.emp_name,
                  subtext: `Code: ${e.emp_code}`
                }))
              ]}
              value={employeeFilter}
              onChange={(val) => setEmployeeFilter(val)}
              placeholder="Search employee..."
              searchPlaceholder="Type name or code..."
            />
          </div>

          {/* Searchable Status Filter */}
          <div className="form-group" style={{ minWidth: '150px', marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Status</label>
            <SearchableSelect
              options={[
                { value: 'ALL', label: 'All Statuses' },
                { value: 'DRAFT', label: 'Draft (Editable)' },
                { value: 'PENDING_ROLLOUT', label: 'Pending Rollout' },
                { value: 'SUBMITTED', label: 'Submitted' },
                { value: 'APPROVED', label: 'Approved' },
                { value: 'REJECTED', label: 'Rejected' }
              ]}
              value={statusFilter}
              onChange={(val) => setStatusFilter(val)}
              placeholder="Filter status..."
              searchPlaceholder="Type status..."
            />
          </div>

          {/* Searchable Period Filter */}
          <div className="form-group" style={{ minWidth: '140px', marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Period Month</label>
            <SearchableSelect
              options={[
                { value: 'ALL', label: 'All Periods' },
                ...distinctPeriods.map(p => ({ value: p, label: p }))
              ]}
              value={periodFilter}
              onChange={(val) => setPeriodFilter(val)}
              placeholder="Filter period..."
              searchPlaceholder="Type month..."
            />
          </div>

          {/* Clear Filters */}
          {(searchQuery || statusFilter !== 'ALL' || periodFilter !== 'ALL' || employeeFilter !== 'ALL') && (
            <button
              className="btn btn-outline"
              onClick={() => { setSearchQuery(''); setStatusFilter('ALL'); setPeriodFilter('ALL'); setEmployeeFilter('ALL'); }}
              style={{ height: '36px', padding: '0 12px', fontSize: '0.8rem' }}
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Plans Table */}
      <div className="content-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{
          padding: '12px 18px',
          background: '#F8FAFC',
          borderBottom: '1px solid var(--border-subtle)',
          fontWeight: 800,
          fontSize: '0.85rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <span>Filtered Plans ({filteredPlans.length} of {plans.length})</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>
            Click 'Review Calendar' to inspect dated customer allocations
          </span>
        </div>

        <div className="table-responsive" style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: '40px', textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={filteredPlans.length > 0 && selectedPlanIds.length === filteredPlans.length}
                    onChange={handleSelectAll}
                  />
                </th>
                <th>Plan ID</th>
                <th>Employee Code</th>
                <th>Employee Name</th>
                <th>Role</th>
                <th>Period</th>
                <th>Superior Approver</th>
                <th>Status</th>
                <th>Submitted At</th>
                <th style={{ textAlign: 'center' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    Loading sales plans...
                  </td>
                </tr>
              ) : filteredPlans.length === 0 ? (
                <tr>
                  <td colSpan="10" style={{ textAlign: 'center', padding: '50px', color: 'var(--text-muted)' }}>
                    <CalendarDays size={36} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
                    <p>No sales plans match the current search / filter criteria.</p>
                  </td>
                </tr>
              ) : (
                filteredPlans.map(plan => (
                  <tr key={plan.id}>
                    <td style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={selectedPlanIds.includes(plan.id)}
                        onChange={() => handleSelectOne(plan.id)}
                      />
                    </td>
                    <td style={{ fontWeight: 800 }}>
                      #{plan.id}
                      {plan.backdated_visits_count > 0 && (
                        <span 
                          title={`${plan.backdated_visits_count} backdated visit(s) modified after date passed`}
                          style={{ 
                            display: 'inline-block', 
                            marginLeft: '6px', 
                            backgroundColor: '#FEF3C7', 
                            color: '#B45309', 
                            padding: '2px 6px', 
                            borderRadius: '4px', 
                            fontSize: '0.68rem', 
                            fontWeight: 800 
                          }}
                        >
                          ⚠️ {plan.backdated_visits_count} Backdated
                        </span>
                      )}
                    </td>
                    <td><code>{plan.emp_code}</code></td>
                    <td style={{ fontWeight: 700 }}>{plan.emp_name}</td>
                    <td>
                      <span className="badge" style={{ background: '#F1F5F9', fontSize: '0.72rem' }}>
                        {plan.emp_role || 'SO'}
                      </span>
                    </td>
                    <td>
                      <span className="badge" style={{ background: '#F1F5F9' }}>
                        {plan.period_month} ({plan.cycle_code || 'C1'})
                      </span>
                    </td>
                    <td>
                      {plan.l1_approver_name ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ fontWeight: 600, fontSize: '0.82rem' }}>{plan.l1_approver_name}</span>
                          <span className="badge" style={{ fontSize: '0.68rem', background: '#EEF2FF', color: '#4F46E5' }}>
                            {plan.l1_approver_role || 'L1'}
                          </span>
                        </div>
                      ) : plan.l1_approver_role ? (
                        <span className="badge" style={{ fontSize: '0.72rem', background: '#F1F5F9', color: '#475569' }}>
                          {plan.l1_approver_role}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Admin / Direct</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${plan.status ? plan.status.toLowerCase() : 'draft'}`}>
                        {plan.status === 'PENDING_ROLLOUT' ? 'PENDING ROLLOUT' : (plan.status || 'DRAFT')}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {plan.submitted_at ? new Date(plan.submitted_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => openReviewModal(plan)}
                          title="Review dated calendar schedule"
                          style={{ padding: '4px 10px', fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <Eye size={13} /> Review Calendar
                        </button>

                        {plan.status === 'SUBMITTED' && (
                          <>
                            <button
                              className="btn btn-sm btn-primary"
                              onClick={() => handleApproveOrReject(plan.id, 'APPROVED')}
                              title="Approve Plan"
                              style={{ padding: '4px 8px', background: '#16A34A', borderColor: '#16A34A' }}
                            >
                              <Check size={13} />
                            </button>
                            <button
                              className="btn btn-sm btn-danger-outline"
                              onClick={() => handleApproveOrReject(plan.id, 'REJECTED')}
                              title="Reject Plan"
                              style={{ padding: '4px 8px' }}
                            >
                              <X size={13} />
                            </button>
                          </>
                        )}

                        <button
                          className="btn-icon danger"
                          onClick={() => handleDeleteSingle(plan.id)}
                          title="Delete Plan"
                          style={{ padding: '4px' }}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Fullscreen Plan Review Modal */}
      {reviewPlan && (
        <div className="modal-overlay" onClick={() => setReviewPlan(null)}>
          <div className="modal-dialog fullscreen" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '1150px', width: '95vw', height: '92vh' }}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <CalendarDays size={20} color="var(--star-red)" />
                  Schedule Review: Plan #{reviewPlan.id} ({reviewPlan.emp_name})
                </h3>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  Period: <b>{reviewPlan.period_month}</b> | Status: <b>{reviewPlan.status}</b> | Max 8 visits/day constraint adhered
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {reviewPlan.status === 'SUBMITTED' && (
                  <>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleApproveOrReject(reviewPlan.id, 'APPROVED')}
                      style={{ background: '#16A34A', borderColor: '#16A34A', fontWeight: 700 }}
                    >
                      <CheckCircle2 size={16} /> Approve Plan
                    </button>
                    <button
                      className="btn btn-danger-outline"
                      onClick={() => handleApproveOrReject(reviewPlan.id, 'REJECTED')}
                      style={{ fontWeight: 700 }}
                    >
                      <XCircle size={16} /> Reject Plan
                    </button>
                  </>
                )}

                <button
                  onClick={() => setReviewPlan(null)}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
                >
                  <X size={22} />
                </button>
              </div>
            </div>

            <div className="modal-body" style={{ padding: '16px 20px', overflowY: 'auto' }}>
              {reviewLoading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--text-muted)' }}>
                  Loading schedule details...
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Approver Alert for Backdated Edited Data */}
                  {reviewBackdatedAlert?.hasBackdatedVisits && (
                    <div style={{
                      display: 'flex',
                      gap: '12px',
                      alignItems: 'center',
                      padding: '12px 16px',
                      backgroundColor: '#FEF2F2',
                      border: '1.5px solid #F87171',
                      borderRadius: '8px',
                      boxShadow: '0 1px 3px rgba(220, 38, 38, 0.1)'
                    }}>
                      <AlertTriangle size={24} color="#DC2626" style={{ flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, color: '#991B1B', fontSize: '0.92rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          ⚠️ APPROVER ALERT: Edited Backdated Visits Detected ({reviewBackdatedAlert.count})
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#7F1D1D', marginTop: '3px', lineHeight: 1.4 }}>
                          {reviewBackdatedAlert.count} visit(s) in this plan were scheduled or edited for dates that have already passed (Backdated). Please review these visits carefully before approving.
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Calendar Grid */}
                  {renderReviewCalendar()}

                  {/* PJP Reconciliation Audit Table */}
                  <div className="content-card" style={{ padding: '16px', marginBottom: 0 }}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 800, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <ShieldCheck size={16} color="#16A34A" />
                      PJP Target vs DJP Schedule Reconciliation
                    </div>

                    <table style={{ fontSize: '0.8rem' }}>
                      <thead>
                        <tr>
                          <th>Customer Code</th>
                          <th>Customer Name</th>
                          <th style={{ textAlign: 'center' }}>Plan Scheduled Visits</th>
                          <th style={{ textAlign: 'center' }}>Max Constraint</th>
                          <th style={{ textAlign: 'center' }}>Reconciliation Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reviewAudit.map((a, idx) => (
                          <tr key={idx}>
                            <td><code>{a.dealerCode}</code></td>
                            <td style={{ fontWeight: 700 }}>{a.dealerName}</td>
                            <td style={{ textAlign: 'center', fontWeight: 800, color: 'var(--star-red)' }}>
                              {a.scheduledCount} visit(s)
                            </td>
                            <td style={{ textAlign: 'center', color: '#16A34A', fontWeight: 600 }}>
                              ≤ 8 / day
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              <span className="status-badge approved" style={{ fontSize: '0.72rem' }}>
                                ✅ Exact Match
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

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setReviewPlan(null)}>
                Close Review
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Review Day Itinerary Modal */}
      {reviewDayModal && (
        <div className="modal-overlay" onClick={() => setReviewDayModal(null)} style={{ zIndex: 1100 }}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                <Calendar size={18} color="var(--star-red)" />
                Schedule for {reviewDayModal.displayDate}
              </h3>
              <button
                onClick={() => setReviewDayModal(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {reviewDayModal.visits.map((v, idx) => (
                  <div 
                    key={v.id || idx}
                    style={{
                      padding: '10px 14px',
                      borderRadius: '6px',
                      border: '1px solid var(--border-subtle)',
                      background: '#F8FAFC',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px'
                    }}
                  >
                    <div 
                      style={{ 
                        width: '24px', 
                        height: '24px', 
                        borderRadius: '50%', 
                        background: '#FEE2E2', 
                        color: 'var(--star-red)', 
                        fontWeight: 800, 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        fontSize: '0.78rem'
                      }}
                    >
                      {idx + 1}
                    </div>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A' }}>
                        {v.dealer_name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                        Code: <b>{v.dealer_sap_code || 'N/A'}</b> | Type: <b style={{ color: v.dealer_type === 'RSAR' ? '#7C3AED' : '#2563EB' }}>{v.dealer_type || 'DEALER'}</b> | {v.purpose_of_visit}
                        {v.is_backdated === 1 && (
                          <span style={{ marginLeft: '8px', color: '#DC2626', fontWeight: 800 }}>
                            ⚠️ [EDITED BACKDATED VISIT]
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setReviewDayModal(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
