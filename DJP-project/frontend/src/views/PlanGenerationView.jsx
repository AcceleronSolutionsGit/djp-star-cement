import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import SearchableSelect from '../components/SearchableSelect';
import { 
  CalendarDays, 
  Send, 
  Plus, 
  Trash2, 
  User, 
  Calendar, 
  X, 
  CheckCircle2, 
  AlertCircle,
  Briefcase,
  Layers,
  MapPin,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Building2,
  Sparkles,
  Clock,
  Check
} from 'lucide-react';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

function formatMonthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  const idx = parseInt(m, 10) - 1;
  return `${MONTH_NAMES[idx] || m} ${y}`;
}

const monthOptions = [];
const startYear = 2025;
const endYear = 2027;
for (let y = startYear; y <= endYear; y++) {
  for (let m = 1; m <= 12; m++) {
    const val = `${y}-${String(m).padStart(2, '0')}`;
    monthOptions.push({
      value: val,
      label: `${MONTH_NAMES[m - 1]} ${y}`
    });
  }
}

export default function PlanGenerationView({ onShowToast, onPlanSubmitted }) {
  const [employees, setEmployees] = useState([]);
  const [selectedRole, setSelectedRole] = useState('ALL');
  const [empCode, setEmpCode] = useState('');
  const [periodMonth, setPeriodMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [cycleCode, setCycleCode] = useState('C1');
  const [latestSalesPeriod, setLatestSalesPeriod] = useState(null);
  
  const [currentPlan, setCurrentPlan] = useState(null);
  const [daysMap, setDaysMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Day Details Modal State
  const [selectedDay, setSelectedDay] = useState(null); // { isoDate, displayDate, visits }
  const [assignedDealers, setAssignedDealers] = useState([]);
  const [addDealerInput, setAddDealerInput] = useState('');
  const [addingVisit, setAddingVisit] = useState(false);

  useEffect(() => {
    loadEmployees(selectedRole);
  }, [selectedRole]);

  useEffect(() => {
    api.getInputReadiness().then(res => {
      if (res?.latestAvailableSalesPeriod) {
        setLatestSalesPeriod(res.latestAvailableSalesPeriod);
      }
    }).catch(() => {});
  }, []);

  const loadEmployees = async (roleFilter) => {
    try {
      const data = await api.getEmployees(roleFilter);
      const emps = data.employees || [];
      setEmployees(emps);
      if (emps.length > 0 && !emps.some(e => e.emp_code === empCode)) {
        setEmpCode(emps[0].emp_code);
      }
    } catch (err) {
      console.error('Error fetching employees:', err);
    }
  };

  const handleGeneratePlan = async () => {
    if (!empCode || !periodMonth) {
      onShowToast('Please select an Employee and Period Month', 'error');
      return;
    }

    const matchedEmp = employees.find(e => e.emp_code === empCode);
    const roleToUse = matchedEmp?.role || (selectedRole !== 'ALL' ? selectedRole : 'SO');

    setGenerating(true);
    try {
      const res = await api.generateAutoPlan(empCode, periodMonth, roleToUse, cycleCode);
      if (res.success && res.planId) {
        onShowToast(res.message || 'DJP Plan generated successfully!', 'success');
        await loadPlanDetails(res.planId);
      } else {
        onShowToast(res.error || res.message || 'No visit targets required for this employee/role in selected period.', 'warning');
      }
    } catch (err) {
      onShowToast(err.message || 'Error generating auto plan', 'error');
    } finally {
      setGenerating(false);
    }
  };

  const loadPlanDetails = async (planId) => {
    setLoading(true);
    try {
      const data = await api.getPlanDetails(planId);
      const details = data.details || [];
      
      const map = {};
      details.forEach(d => {
        if (!map[d.visit_date]) map[d.visit_date] = [];
        map[d.visit_date].push(d);
      });

      setDaysMap(map);
      setCurrentPlan({ id: planId, status: 'DRAFT', empCode, periodMonth, cycleCode });
      loadDealersForEmp(empCode);
    } catch (err) {
      onShowToast('Failed to load plan details', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadDealersForEmp = async (code) => {
    try {
      const matchedEmp = employees.find(e => e.emp_code === code);
      const roleToUse = matchedEmp?.role || 'SO';
      const data = await api.getDealersForSO(code, roleToUse);
      setAssignedDealers(data.dealers || []);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSubmitPlan = async () => {
    if (!currentPlan?.id) return;
    try {
      const res = await api.submitPlan(currentPlan.id);
      onShowToast(res.message || 'Plan submitted for approval!', 'success');
      setCurrentPlan(prev => ({ ...prev, status: 'SUBMITTED' }));
      if (onPlanSubmitted) onPlanSubmitted();
    } catch (err) {
      onShowToast(err.message || 'Failed to submit plan', 'error');
    }
  };

  const openDayModal = (isoDate, displayDate) => {
    const visits = daysMap[isoDate] || [];
    setSelectedDay({ isoDate, displayDate, visits });
    setAddDealerInput('');
  };

  const handleAddVisit = async () => {
    if (!addDealerInput) {
      onShowToast('Please select a dealer to add', 'error');
      return;
    }

    const currentDayVisits = daysMap[selectedDay.isoDate] || [];
    if (currentDayVisits.length >= 8) {
      onShowToast('Maximum 8 visits per day allowed.', 'error');
      return;
    }

    const matchedDealer = assignedDealers.find(d => 
      String(d.sap_code) === String(addDealerInput) || 
      String(d.dealer_id) === String(addDealerInput) || 
      `${d.dealer_name} (${d.sap_code})` === addDealerInput || 
      d.dealer_name === addDealerInput
    );
    if (!matchedDealer) {
      onShowToast('Please select a valid dealer from the dropdown list', 'error');
      return;
    }

    const alreadyOnDay = currentDayVisits.some(v => 
      (matchedDealer.dealer_id && v.dealer_id === matchedDealer.dealer_id) || 
      (matchedDealer.sap_code && v.dealer_sap_code === matchedDealer.sap_code) || 
      v.dealer_name === matchedDealer.dealer_name
    );
    if (alreadyOnDay) {
      onShowToast('This dealer is already scheduled on this day. Each visit must be to a different customer.', 'error');
      return;
    }

    setAddingVisit(true);
    try {
      await api.addPlanVisit({
        planId: currentPlan.id,
        visitDate: selectedDay.isoDate,
        dealerId: matchedDealer.dealer_id,
        dealerSapCode: matchedDealer.sap_code,
        dealerName: matchedDealer.dealer_name,
        dealerType: 'STAR',
        purposeOfVisit: 'Ad-hoc PJP Visit'
      });

      onShowToast('Visit added to day schedule!', 'success');
      await loadPlanDetails(currentPlan.id);
      
      const updatedVisits = (daysMap[selectedDay.isoDate] || []);
      setSelectedDay(prev => ({
        ...prev,
        visits: updatedVisits
      }));
      setAddDealerInput('');
    } catch (err) {
      onShowToast(err.message || 'Failed to add visit', 'error');
    } finally {
      setAddingVisit(false);
    }
  };

  const handleRemoveVisit = async (detailId) => {
    if (!window.confirm('Are you sure you want to remove this visit from the plan?')) return;
    try {
      await api.removePlanVisit(detailId);
      onShowToast('Visit removed successfully', 'success');
      await loadPlanDetails(currentPlan.id);

      setSelectedDay(prev => ({
        ...prev,
        visits: prev.visits.filter(v => v.id !== detailId)
      }));
    } catch (err) {
      onShowToast(err.message || 'Failed to remove visit', 'error');
    }
  };

  // Month stats calculations
  const totalVisitsCount = Object.values(daysMap).reduce((sum, list) => sum + list.length, 0);
  const activeDaysCount = Object.keys(daysMap).filter(k => daysMap[k].length > 0).length;
  const avgVisitsPerDay = activeDaysCount > 0 ? (totalVisitsCount / activeDaysCount).toFixed(1) : 0;
  const selectedEmpObj = employees.find(e => e.emp_code === empCode);

  // Render Full Interactive Calendar Grid
  const renderCalendar = () => {
    if (!periodMonth) return null;
    const [yearStr, monthStr] = periodMonth.split('-');
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
      cells.push(<div key={`empty-${i}`} className="calendar-cell empty"></div>);
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

      if (dayOfWeek === 6) {
        const nth = Math.ceil(d / 7);
        if (nth === 2) { isHoliday = true; holidayReason = '2nd Sat'; }
        if (nth === 4) { isHoliday = true; holidayReason = '4th Sat'; }
      }

      // Check Cycle bounds (C1 = 1-15, C2 = 16-End)
      const inCycle = cycleCode === 'C1' ? (d <= 15) : (d >= 16);

      const dayVisits = daysMap[isoDate] || [];
      const hasVisits = dayVisits.length > 0;
      const visitCount = dayVisits.length;

      let cellClass = 'calendar-cell';
      if (!inCycle) cellClass += ' out-of-cycle';
      if (isHoliday && !hasVisits) cellClass += ' holiday';

      // Capacity pill color
      let capClass = 'available';
      if (isHoliday) capClass = 'holiday';
      else if (visitCount >= 8) capClass = 'max';
      else if (visitCount >= 6) capClass = 'warning';
      else if (visitCount > 0) capClass = 'normal';

      cells.push(
        <div 
          key={isoDate} 
          className={cellClass}
          onClick={() => inCycle && !isHoliday && openDayModal(isoDate, displayDate)}
          title={isHoliday ? `${holidayReason} (Non-Working Day)` : `Click to inspect ${visitCount}/8 visits`}
        >
          {/* Top Bar of Day Tile */}
          <div className="calendar-cell-top">
            <span className={`calendar-cell-date ${hasVisits ? 'has-visits' : ''}`}>
              {d}
            </span>

            {isHoliday ? (
              <span className="calendar-cap-pill holiday">{holidayReason}</span>
            ) : inCycle ? (
              <span className={`calendar-cap-pill ${capClass}`}>
                {visitCount === 8 ? '8/8 MAX' : `${visitCount}/8 visits`}
              </span>
            ) : (
              <span className="calendar-cap-pill available">Cycle {cycleCode === 'C1' ? '2' : '1'}</span>
            )}
          </div>

          {/* Chips Container */}
          <div className="calendar-chips-container">
            {dayVisits.slice(0, 3).map((v, idx) => (
              <div key={v.id || idx} className="dealer-calendar-chip" title={`${v.dealer_name} (${v.dealer_sap_code || 'N/A'})`}>
                <span className="dealer-chip-name">{v.dealer_name}</span>
                <span className="dealer-chip-badge">{v.dealer_type || 'STAR'}</span>
              </div>
            ))}

            {visitCount > 3 && (
              <div className="more-visits-chip">
                +{visitCount - 3} more visits (Total {visitCount}/8)
              </div>
            )}
          </div>

          {/* Quick Add Button if under 8 visits and working day */}
          {inCycle && !isHoliday && visitCount < 8 && currentPlan?.status === 'DRAFT' && (
            <button 
              className="calendar-empty-add-btn"
              onClick={(e) => { e.stopPropagation(); openDayModal(isoDate, displayDate); }}
              title="Add customer visit"
            >
              <Plus size={11} /> Add Visit
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="calendar-wrapper-card">
        {/* Calendar Title Bar */}
        <div className="calendar-month-bar">
          <div className="calendar-month-title">
            <CalendarDays size={20} color="var(--star-red)" />
            <span>{currentMonthName} {year}</span>
            <span className="badge" style={{ fontSize: '0.78rem', marginLeft: '6px', background: '#F1F5F9', color: '#334155' }}>
              Cycle {cycleCode} ({cycleCode === 'C1' ? '1st – 15th' : '16th – End'})
            </span>
          </div>

          <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', color: '#16A34A', fontSize: '0.82rem', fontWeight: 700 }}>
              <ShieldCheck size={16} /> Max 8 Visits/Day (Enforced)
            </span>
          </div>
        </div>

        {/* 7-Column Header */}
        <div className="calendar-header-grid">
          {daysOfWeek.map((day, idx) => (
            <div key={day} className={`calendar-header-cell ${idx === 0 ? 'weekend' : ''}`}>
              {day}
            </div>
          ))}
        </div>

        {/* 7-Column Grid Body */}
        <div className="calendar-body-grid">
          {cells}
        </div>
      </div>
    );
  };

  const [employeeSearch, setEmployeeSearch] = useState('');

  const filteredEmployees = employees.filter(emp => {
    if (!employeeSearch) return true;
    const q = employeeSearch.toLowerCase().trim();
    const nameMatch = (emp.emp_name || '').toLowerCase().includes(q);
    const codeMatch = (emp.emp_code || '').toLowerCase().includes(q);
    const areaMatch = (emp.area || '').toLowerCase().includes(q);
    const regionMatch = (emp.region || '').toLowerCase().includes(q);
    return nameMatch || codeMatch || areaMatch || regionMatch;
  });

  return (
    <div style={{ maxWidth: '100%', overflowX: 'hidden' }}>
      {/* 1. Top Controls Bar */}
      <div className="content-card" style={{ padding: '16px 20px', marginBottom: '16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 800, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CalendarDays size={20} color="var(--star-red)" />
              Plan Generation & Daily Itinerary (DJP Calendar)
            </h3>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>
              Select Role and Employee to generate dated customer itineraries from approved PJP visit targets. Max 8 visits/day.
            </p>
          </div>

          {currentPlan?.status === 'DRAFT' && (
            <button className="btn btn-generate" onClick={handleSubmitPlan} style={{ padding: '8px 16px', fontWeight: 700 }}>
              <Send size={15} />
              <span>Submit Plan for Approval</span>
            </button>
          )}

          {currentPlan?.status === 'SUBMITTED' && (
            <span className="status-badge submitted" style={{ fontSize: '0.82rem', padding: '6px 14px' }}>
              <CheckCircle2 size={15} /> Submitted for Manager Approval
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {/* Role Filter */}
          <div className="form-group" style={{ minWidth: '150px', marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Role Stream</label>
            <select
              className="form-control"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
              style={{ height: '36px' }}
            >
              <option value="ALL">All Roles ({employees.length})</option>
              <option value="SO">Sales Officer (SO)</option>
              <option value="ASM">Area Sales Mgr (ASM)</option>
              <option value="RSM">Regional Sales Mgr (RSM)</option>
              <option value="ZH">Zonal Head (ZH)</option>
            </select>
          </div>

          {/* Searchable Employee Dropdown */}
          <div className="form-group" style={{ flex: 1, minWidth: '280px', marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>
              Assigned Employee ({employees.length})
            </label>
            <SearchableSelect
              options={employees.map(emp => ({
                value: emp.emp_code,
                label: `[${emp.role}] ${emp.emp_name} (${emp.emp_code})`,
                subtext: emp.area ? `Area: ${emp.area}` : emp.region ? `Region: ${emp.region}` : `Role: ${emp.role}`
              }))}
              value={empCode}
              onChange={(val) => setEmpCode(val)}
              placeholder="Search or select employee..."
              searchPlaceholder="Type employee name, code, or area..."
            />
          </div>

          {/* Plan Month */}
          <div className="form-group" style={{ minWidth: '175px', marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Plan Month</label>
            <select
              className="form-control"
              value={periodMonth}
              onChange={(e) => setPeriodMonth(e.target.value)}
              style={{ height: '36px', fontWeight: 600 }}
            >
              {monthOptions.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Cycle Code */}
          <div className="form-group" style={{ minWidth: '110px', marginBottom: 0 }}>
            <label className="form-label" style={{ fontSize: '0.75rem', fontWeight: 700 }}>Plan Cycle</label>
            <select
              className="form-control"
              value={cycleCode}
              onChange={(e) => setCycleCode(e.target.value)}
              style={{ height: '36px' }}
            >
              <option value="C1">Cycle 1 (1–15)</option>
              <option value="C2">Cycle 2 (16–End)</option>
            </select>
          </div>

          <button
            className="btn btn-primary"
            onClick={handleGeneratePlan}
            disabled={generating || !empCode}
            style={{ height: '36px', padding: '0 18px', fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            {generating ? 'Generating DJP...' : '⚡ Generate Dated DJP Plan'}
          </button>
        </div>

        {/* Pre-Generation Clarity Banner */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: '#F8FAFC',
          border: '1px solid #E2E8F0',
          borderRadius: '8px',
          padding: '10px 16px',
          marginTop: '14px',
          flexWrap: 'wrap',
          gap: '12px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CalendarDays size={16} color="var(--star-red)" />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Plan Month:</span>
              <span style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                {formatMonthLabel(periodMonth)}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={16} color="#2563EB" />
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Latest Available Sales Data:</span>
              <span style={{ fontSize: '0.92rem', fontWeight: 700, color: '#1D4ED8' }}>
                {latestSalesPeriod ? formatMonthLabel(latestSalesPeriod) : 'None uploaded'}
              </span>
            </div>
          </div>
          {latestSalesPeriod && periodMonth > latestSalesPeriod && (
            <span style={{ fontSize: '0.75rem', background: '#EFF6FF', color: '#1E40AF', padding: '4px 12px', borderRadius: '12px', border: '1px solid #BFDBFE', fontWeight: 600 }}>
              ℹ️ Planning future month: Sales calculations anchor on {formatMonthLabel(latestSalesPeriod)}
            </span>
          )}
        </div>
      </div>

      {/* 2. Summary KPI Ribbon (if plan is active) */}
      {currentPlan && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '16px' }}>
          <div className="content-card" style={{ padding: '12px 16px', marginBottom: 0 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Total Planned Visits
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--star-red)', marginTop: '2px', fontFamily: 'var(--font-display)' }}>
              {totalVisitsCount} Visits
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Targeted across working days
            </div>
          </div>

          <div className="content-card" style={{ padding: '12px 16px', marginBottom: 0 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Working Days Active
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0284C7', marginTop: '2px', fontFamily: 'var(--font-display)' }}>
              {activeDaysCount} Days
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Sundays & 2nd/4th Sat excluded
            </div>
          </div>

          <div className="content-card" style={{ padding: '12px 16px', marginBottom: 0 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Daily Average Load
            </div>
            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#16A34A', marginTop: '2px', fontFamily: 'var(--font-display)' }}>
              {avgVisitsPerDay} / day
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Max Limit: <b>8 Visits / day</b>
            </div>
          </div>

          <div className="content-card" style={{ padding: '12px 16px', marginBottom: 0 }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Assigned Employee
            </div>
            <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {selectedEmpObj ? `${selectedEmpObj.emp_name}` : currentPlan.empCode}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              Role: <b>{selectedEmpObj?.role || 'SO'}</b> | {currentPlan.periodMonth} ({currentPlan.cycleCode})
            </div>
          </div>
        </div>
      )}

      {/* 3. Monthly Calendar Grid */}
      {Object.keys(daysMap).length > 0 ? (
        renderCalendar()
      ) : (
        <div className="content-card" style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--text-muted)' }}>
          <CalendarDays size={48} style={{ margin: '0 auto 12px', opacity: 0.3, color: 'var(--star-red)' }} />
          <h4 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', marginBottom: '4px' }}>
            No Active DJP Calendar Itinerary
          </h4>
          <p style={{ maxWidth: '460px', margin: '0 auto', fontSize: '0.85rem' }}>
            Select an Employee and Period above and click <b>Generate Dated DJP Plan</b> to calculate the balanced itinerary with max 8 visits/day.
          </p>
        </div>
      )}

      {/* 4. Day Details Inspector Modal */}
      {selectedDay && (
        <div className="modal-overlay" onClick={() => setSelectedDay(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                  <Calendar size={18} color="var(--star-red)" />
                  Day Itinerary: {selectedDay.displayDate}
                </h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                  {selectedDay.visits.length}/8 customer visits scheduled (Max 8 visits to different customers)
                </div>
              </div>
              <button
                onClick={() => setSelectedDay(null)}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}
              >
                <X size={20} />
              </button>
            </div>

            <div className="modal-body">
              {selectedDay.visits.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px', color: 'var(--text-muted)' }}>
                  No customer visits currently scheduled on this day.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {selectedDay.visits.map((visit, idx) => (
                    <div 
                      key={visit.id || idx}
                      style={{
                        padding: '10px 14px',
                        borderRadius: '6px',
                        border: '1px solid var(--border-subtle)',
                        background: '#F8FAFC',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
                          {visit.sequence || idx + 1}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0F172A' }}>
                            {visit.dealer_name}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64748B', marginTop: '1px' }}>
                            Code: <b>{visit.dealer_sap_code || 'N/A'}</b> | Type: <b>{visit.dealer_type || 'STAR'}</b> | {visit.purpose_of_visit}
                          </div>
                        </div>
                      </div>

                      {currentPlan?.status === 'DRAFT' && (
                        <button
                          className="btn-icon danger"
                          onClick={() => handleRemoveVisit(visit.id)}
                          title="Remove visit"
                          style={{ padding: '6px' }}
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Add Customer Section (DRAFT mode only) */}
              {currentPlan?.status === 'DRAFT' && (
                <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }}>
                  {selectedDay.visits.length >= 8 ? (
                    <div style={{ padding: '10px 12px', background: '#FEF3C7', color: '#92400E', borderRadius: '6px', fontSize: '0.8rem', fontWeight: 600 }}>
                      ⚠️ Daily limit of 8 visits reached for this day. Remove an existing visit to add a new customer.
                    </div>
                  ) : (
                    <div>
                      <label className="form-label" style={{ fontWeight: 700, fontSize: '0.8rem' }}>
                        Add Customer Visit ({selectedDay.visits.length}/8 Max)
                      </label>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                          <SearchableSelect
                            options={assignedDealers
                              .filter(d => !selectedDay.visits.some(v => v.dealer_id === d.dealer_id || v.dealer_sap_code === d.sap_code))
                              .map(d => ({
                                value: d.sap_code || d.dealer_id,
                                label: d.dealer_name,
                                subtext: `SAP: ${d.sap_code || 'N/A'} | Area: ${d.area || d.branch || '—'}`
                              }))
                            }
                            value={addDealerInput}
                            onChange={(val) => setAddDealerInput(val)}
                            placeholder="Search & select customer to add..."
                            searchPlaceholder="Type customer name or code..."
                          />
                        </div>

                        <button
                          className="btn btn-primary"
                          onClick={handleAddVisit}
                          disabled={addingVisit || !addDealerInput}
                          style={{ whiteSpace: 'nowrap', fontWeight: 700, height: '36px', padding: '0 16px' }}
                        >
                          <Plus size={14} />
                          <span>Add</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setSelectedDay(null)} style={{ padding: '6px 16px' }}>
                Close Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
