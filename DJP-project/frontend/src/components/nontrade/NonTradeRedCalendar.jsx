import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, Search, Filter,
  CheckSquare, Clock, X, Building, Users, User, MapPin, Layers, RefreshCw,
  ArrowLeft, ArrowRight, Briefcase, CheckCircle2
} from 'lucide-react';
import { api } from '../../services/api';

/**
 * STRICT RED COLOR PALETTE
 * Non-Trade Plan Calendar exclusively uses shades of Star Cement Red,
 * Crimson, Maroon, Rose, Soft Tinted Red, and Contrast White.
 */
const RED = {
  deepMaroon: '#7F1D1D',     // Darkest crimson for headers and prominent tags
  maroon: '#991B1B',         // Primary crimson
  starRed: '#DC2626',        // Vibrant brand red
  lightRed: '#EF4444',       // Soft accent red
  borderDark: '#B91C1C',     // Dark red border
  borderMedium: '#F87171',   // Medium red border
  borderLight: '#FCA5A5',    // Light red border
  borderSubtle: '#FECACA',   // Very light divider
  bgDark: '#7F1D1D',         // Dark red background
  bgMedium: '#991B1B',       // Medium red background
  bgLight: '#FEE2E2',        // Light red badge background
  bgSoft: '#FEF2F2',         // Tinted soft red card background
  bgUltraLight: '#FFF5F5',   // Very pale red table/cell background
  textDarkest: '#450A0A',    // Near-black crimson for maximum readability
  textDark: '#7F1D1D',       // Dark crimson text
  textMedium: '#991B1B',     // Medium red text
  textLight: '#B91C1C',      // Light red text
  white: '#FFFFFF',          // High-contrast white
  overlay: 'rgba(69, 10, 10, 0.75)' // Red-tinted dark modal backdrop
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Helper to get officer initials
function getInitials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase() || 'SO';
}

export default function NonTradeRedCalendar({
  periodMonth,
  onPeriodChange,
  initialRole = 'Officer',
  initialEmpCode = 'ALL',
  onShowToast
}) {
  const [currentPeriod, setCurrentPeriod] = useState(() => {
    return periodMonth || localStorage.getItem('star_selected_period') || localStorage.getItem('star_nontrade_period') || '2026-10';
  });
  const [roleFilter, setRoleFilter] = useState(initialRole);
  const [empCodeFilter, setEmpCodeFilter] = useState(() => {
    return initialEmpCode !== 'ALL' ? initialEmpCode : (localStorage.getItem('star_nontrade_emp_filter') || 'ALL');
  });
  const [bucketFilter, setBucketFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // View mode: 'list' (Officer Directory) vs 'calendar' (Individual / Team Plan Calendar)
  const [viewMode, setViewMode] = useState(() => {
    return initialEmpCode !== 'ALL' ? 'calendar' : (localStorage.getItem('star_nontrade_cal_viewmode') || 'list');
  });
  const [officerSearch, setOfficerSearch] = useState('');

  // Calendar data from backend
  const [calendarData, setCalendarData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Day detail modal state
  const [selectedDay, setSelectedDay] = useState(null);
  const [modalSearch, setModalSearch] = useState('');
  const [modalBucketFilter, setModalBucketFilter] = useState('ALL');

  // Persist view mode and emp filter
  useEffect(() => {
    if (empCodeFilter) {
      localStorage.setItem('star_nontrade_emp_filter', empCodeFilter);
    }
  }, [empCodeFilter]);

  useEffect(() => {
    if (viewMode) {
      localStorage.setItem('star_nontrade_cal_viewmode', viewMode);
    }
  }, [viewMode]);

  // Sync external periodMonth changes
  useEffect(() => {
    if (periodMonth && periodMonth !== currentPeriod) {
      setCurrentPeriod(periodMonth);
      localStorage.setItem('star_nontrade_period', periodMonth);
      localStorage.setItem('star_selected_period', periodMonth);
    }
  }, [periodMonth]);

  // Sync initialRole changes
  useEffect(() => {
    if (initialRole) {
      setRoleFilter(initialRole);
    }
  }, [initialRole]);

  // Sync initialEmpCode changes
  useEffect(() => {
    if (initialEmpCode) {
      setEmpCodeFilter(initialEmpCode);
      if (initialEmpCode !== 'ALL') {
        setViewMode('calendar');
      }
    }
  }, [initialEmpCode]);

  // Fetch calendar data from backend (silent = true does not flicker UI)
  const fetchCalendar = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api.getNonTradeCalendar({
        periodMonth: currentPeriod,
        roleType: roleFilter,
        empCode: empCodeFilter !== 'ALL' ? empCodeFilter : undefined,
        bucket: bucketFilter !== 'ALL' ? bucketFilter : undefined,
        search: searchQuery || undefined
      });
      setCalendarData(res);
    } catch (err) {
      if (!silent) {
        console.error('[NonTradeRedCalendar] fetch error:', err);
        onShowToast?.(err.message || 'Failed to fetch Non-Trade calendar', 'error');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalendar();
  }, [currentPeriod, roleFilter, empCodeFilter, bucketFilter, searchQuery]);

  // Live Auto-Refresh: silent background sync every 12s + instant sync on window/tab focus
  useEffect(() => {
    const interval = setInterval(() => {
      fetchCalendar(true);
    }, 12000);

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        fetchCalendar(true);
      }
    };
    const onFocus = () => {
      fetchCalendar(true);
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
    };
  }, [currentPeriod, roleFilter, empCodeFilter, bucketFilter, searchQuery]);

  // Period navigation helpers
  const handlePrevMonth = () => {
    const [y, m] = currentPeriod.split('-').map(Number);
    let newY = y;
    let newM = m - 1;
    if (newM < 1) {
      newM = 12;
      newY -= 1;
    }
    const newPeriod = `${newY}-${String(newM).padStart(2, '0')}`;
    setCurrentPeriod(newPeriod);
    localStorage.setItem('star_nontrade_period', newPeriod);
    localStorage.setItem('star_selected_period', newPeriod);
    onPeriodChange?.(newPeriod);
  };

  const handleNextMonth = () => {
    const [y, m] = currentPeriod.split('-').map(Number);
    let newY = y;
    let newM = m + 1;
    if (newM > 12) {
      newM = 1;
      newY += 1;
    }
    const newPeriod = `${newY}-${String(newM).padStart(2, '0')}`;
    setCurrentPeriod(newPeriod);
    localStorage.setItem('star_nontrade_period', newPeriod);
    localStorage.setItem('star_selected_period', newPeriod);
    onPeriodChange?.(newPeriod);
  };

  const handlePeriodInput = (e) => {
    const val = e.target.value;
    if (val) {
      setCurrentPeriod(val);
      localStorage.setItem('star_nontrade_period', val);
      localStorage.setItem('star_selected_period', val);
      onPeriodChange?.(val);
    }
  };

  // Select an officer to view their calendar
  const handleSelectOfficer = (empCode) => {
    setEmpCodeFilter(empCode);
    setViewMode('calendar');
  };

  // Back to officer list
  const handleBackToList = () => {
    setViewMode('list');
  };

  // Selected officer profile object
  const currentOfficer = useMemo(() => {
    if (!calendarData?.allOfficers) return null;
    if (empCodeFilter === 'ALL') return null;
    return calendarData.allOfficers.find(o => String(o.emp_code).trim() === String(empCodeFilter).trim()) || null;
  }, [calendarData, empCodeFilter]);

  // Filtered officers list for directory
  const filteredOfficers = useMemo(() => {
    if (!calendarData?.allOfficers) return [];
    return calendarData.allOfficers.filter(o => {
      if (roleFilter !== 'ALL' && o.role_type !== roleFilter) return false;
      if (officerSearch) {
        const q = officerSearch.toLowerCase();
        const name = (o.emp_name || '').toLowerCase();
        const code = String(o.emp_code || '').toLowerCase();
        const asm = (o.asm_name || '').toLowerCase();
        if (!name.includes(q) && !code.includes(q) && !asm.includes(q)) return false;
      }
      return true;
    });
  }, [calendarData, roleFilter, officerSearch]);

  // Build 7-column calendar cells array
  const calendarCells = useMemo(() => {
    if (!calendarData) return [];
    const year = calendarData.year || 2026;
    const month = calendarData.month || 9;
    const daysInMonth = calendarData.daysInMonth || 30;

    // First day of month (0 = Sun, 1 = Mon, ..., 6 = Sat)
    const firstDay = new Date(year, month - 1, 1).getDay();

    const cells = [];
    // Leading blanks
    for (let i = 0; i < firstDay; i++) {
      cells.push({ isBlank: true, key: `lead-blank-${i}` });
    }

    // Days in month
    for (let d = 1; d <= daysInMonth; d++) {
      const isoDate = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dayData = calendarData.days?.[isoDate] || {
        date: isoDate,
        dayNumber: d,
        dayOfWeek: new Date(year, month - 1, d).getDay(),
        isSunday: new Date(year, month - 1, d).getDay() === 0,
        visits: [],
        visitCount: 0,
        executedCount: 0
      };
      cells.push({ isBlank: false, key: isoDate, ...dayData });
    }

    // Trailing blanks to complete 7-day rows
    const remainder = cells.length % 7;
    if (remainder !== 0) {
      for (let i = 0; i < 7 - remainder; i++) {
        cells.push({ isBlank: true, key: `trail-blank-${i}` });
      }
    }

    return cells;
  }, [calendarData]);

  // Filtered visits inside the day schedule modal
  const modalVisits = useMemo(() => {
    if (!selectedDay || !selectedDay.visits) return [];
    return selectedDay.visits.filter(v => {
      if (modalBucketFilter !== 'ALL' && v.bucket !== modalBucketFilter) return false;
      if (modalSearch) {
        const q = modalSearch.toLowerCase();
        const party = (v.party_name || '').toLowerCase();
        const ship = (v.ship_to_party_name || '').toLowerCase();
        const sap = (v.sap_code || '').toLowerCase();
        const dest = (v.destination_zone || '').toLowerCase();
        const emp = (v.emp_name || '').toLowerCase();
        if (!party.includes(q) && !ship.includes(q) && !sap.includes(q) && !dest.includes(q) && !emp.includes(q)) {
          return false;
        }
      }
      return true;
    });
  }, [selectedDay, modalSearch, modalBucketFilter]);

  return (
    <div style={{
      fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      color: RED.textDarkest
    }}>
      {/* ========================================================================= */}
      {/* 1. TOP RED HEADER BAR                                                     */}
      {/* ========================================================================= */}
      <div style={{
        background: `linear-gradient(135deg, ${RED.deepMaroon} 0%, ${RED.maroon} 50%, ${RED.starRed} 100%)`,
        borderRadius: '12px',
        padding: '20px 24px',
        color: RED.white,
        boxShadow: '0 4px 12px rgba(127, 29, 29, 0.25)',
        marginBottom: '20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '16px'
      }}>
        {/* Title & View Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{
            background: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            padding: '12px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <CalendarIcon size={26} color={RED.white} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h2 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em', color: RED.white }}>
                Non-Trade Plan Calendar
              </h2>
            </div>
            <p style={{ margin: '4px 0 0 0', fontSize: '0.84rem', color: '#FECACA' }}>
              {viewMode === 'list'
                ? 'Select an officer below to view their dedicated monthly plan calendar'
                : currentOfficer
                  ? `Viewing Plan Calendar for ${currentOfficer.emp_name} (${currentOfficer.emp_code})`
                  : 'Viewing Combined Non-Trade Team Plan Calendar'}
            </p>
          </div>
        </div>

        {/* View Switcher & Month Navigation Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          {/* List vs Calendar Mode Toggle */}
          <div style={{
            display: 'flex',
            borderRadius: '8px',
            background: 'rgba(255, 255, 255, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            overflow: 'hidden'
          }}>
            <button
              onClick={() => setViewMode('list')}
              style={{
                padding: '6px 12px',
                border: 'none',
                background: viewMode === 'list' ? RED.white : 'transparent',
                color: viewMode === 'list' ? RED.deepMaroon : RED.white,
                fontSize: '0.8rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s ease'
              }}
            >
              <Users size={14} />
              <span>Officers List</span>
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              style={{
                padding: '6px 12px',
                border: 'none',
                background: viewMode === 'calendar' ? RED.white : 'transparent',
                color: viewMode === 'calendar' ? RED.deepMaroon : RED.white,
                fontSize: '0.8rem',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                transition: 'all 0.15s ease'
              }}
            >
              <CalendarIcon size={14} />
              <span>Calendar</span>
            </button>
          </div>

          {/* Previous / Next Month Navigator */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.12)',
            borderRadius: '8px',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            padding: '4px'
          }}>
            <button
              onClick={handlePrevMonth}
              title="Previous Month"
              style={{
                background: 'transparent',
                border: 'none',
                color: RED.white,
                padding: '6px 10px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <ChevronLeft size={18} />
            </button>

            <span style={{
              padding: '0 10px',
              fontSize: '0.9rem',
              fontWeight: 800,
              letterSpacing: '0.03em',
              textTransform: 'uppercase',
              color: RED.white,
              minWidth: '140px',
              textAlign: 'center'
            }}>
              {calendarData ? `${calendarData.monthName} ${calendarData.year}` : currentPeriod}
            </span>

            <button
              onClick={handleNextMonth}
              title="Next Month"
              style={{
                background: 'transparent',
                border: 'none',
                color: RED.white,
                padding: '6px 10px',
                borderRadius: '6px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                transition: 'background 0.15s ease'
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Month Picker Input */}
          <input
            type="month"
            value={currentPeriod}
            onChange={handlePeriodInput}
            style={{
              padding: '7px 10px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.4)',
              background: 'rgba(255, 255, 255, 0.15)',
              color: RED.white,
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
              outline: 'none'
            }}
          />

          {/* Refresh Button */}
          <button
            onClick={fetchCalendar}
            disabled={loading}
            title="Refresh Calendar Data"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '7px 12px',
              borderRadius: '8px',
              border: '1px solid rgba(255, 255, 255, 0.35)',
              background: 'rgba(255, 255, 255, 0.2)',
              color: RED.white,
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'background 0.15s ease'
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 2. VIEW MODE A: LIST OF OFFICERS                                          */}
      {/* ========================================================================= */}
      {viewMode === 'list' && (
        <div>
          {/* Officers Directory Filter Bar */}
          <div style={{
            background: RED.white,
            borderRadius: '10px',
            padding: '16px 20px',
            border: `1.5px solid ${RED.borderLight}`,
            boxShadow: '0 1px 3px rgba(127, 29, 29, 0.04)',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '14px'
          }}>
            {/* Role Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 800, color: RED.deepMaroon, marginRight: '4px' }}>
                Role:
              </span>
              {[
                { id: 'Officer', label: 'Officers' },
                { id: 'ASM', label: 'ASMs' },
                { id: 'HOS', label: 'HOS' },
                { id: 'ALL', label: 'All Roles' }
              ].map(r => {
                const isActive = roleFilter === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => setRoleFilter(r.id)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '20px',
                      border: `1.5px solid ${isActive ? RED.maroon : RED.borderLight}`,
                      background: isActive ? RED.maroon : RED.bgUltraLight,
                      color: isActive ? RED.white : RED.deepMaroon,
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>

            {/* Officer Search Input */}
            <div style={{ position: 'relative', width: '280px' }}>
              <Search size={15} style={{ position: 'absolute', left: '10px', top: '9px', color: RED.maroon }} />
              <input
                type="text"
                placeholder="Search officer name, code, ASM..."
                value={officerSearch}
                onChange={e => setOfficerSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 12px 6px 32px',
                  borderRadius: '6px',
                  border: `1.5px solid ${RED.borderLight}`,
                  background: RED.bgUltraLight,
                  color: RED.textDarkest,
                  fontSize: '0.82rem',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          {/* Quick Card: Combined Team Calendar */}
          <div
            onClick={() => {
              setEmpCodeFilter('ALL');
              setViewMode('calendar');
            }}
            style={{
              background: `linear-gradient(135deg, ${RED.bgSoft} 0%, ${RED.bgLight} 100%)`,
              borderRadius: '10px',
              border: `2px dashed ${RED.starRed}`,
              padding: '16px 20px',
              marginBottom: '20px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '12px',
              transition: 'all 0.15s ease'
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = RED.maroon;
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(127, 29, 29, 0.12)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = RED.starRed;
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <div style={{
                background: RED.deepMaroon,
                color: RED.white,
                padding: '10px',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Layers size={22} color={RED.white} />
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h4 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: RED.deepMaroon }}>
                    View Combined Non-Trade Team Calendar
                  </h4>
                  <span style={{
                    background: RED.maroon,
                    color: RED.white,
                    fontSize: '0.7rem',
                    fontWeight: 800,
                    padding: '2px 8px',
                    borderRadius: '10px'
                  }}>
                    {calendarData?.totalVisits || 0} TOTAL VISITS
                  </span>
                </div>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.8rem', color: RED.textMedium }}>
                  Overview of all {filteredOfficers.length} field staff scheduled touches on one combined calendar grid
                </p>
              </div>
            </div>

            <button
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '6px',
                border: 'none',
                background: RED.maroon,
                color: RED.white,
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              <span>Open Combined Calendar</span>
              <ArrowRight size={15} />
            </button>
          </div>

          {/* Officers Roster Grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '16px'
          }}>
            {filteredOfficers.map(officer => {
              const initials = getInitials(officer.emp_name);
              const isSelected = empCodeFilter === officer.emp_code;

              return (
                <div
                  key={officer.emp_code}
                  onClick={() => handleSelectOfficer(officer.emp_code)}
                  style={{
                    background: RED.white,
                    borderRadius: '12px',
                    border: `1.5px solid ${isSelected ? RED.starRed : RED.borderLight}`,
                    padding: '18px 20px',
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(127, 29, 29, 0.04)',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    gap: '14px',
                    transition: 'all 0.15s ease'
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.borderColor = RED.starRed;
                    e.currentTarget.style.background = RED.bgUltraLight;
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(127, 29, 29, 0.12)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.borderColor = isSelected ? RED.starRed : RED.borderLight;
                    e.currentTarget.style.background = RED.white;
                    e.currentTarget.style.boxShadow = '0 2px 6px rgba(127, 29, 29, 0.04)';
                  }}
                >
                  {/* Officer Header: Avatar, Name, Code */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                    <div style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '50%',
                      background: `linear-gradient(135deg, ${RED.deepMaroon} 0%, ${RED.maroon} 100%)`,
                      color: RED.white,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '0.95rem',
                      fontWeight: 800,
                      flexShrink: 0,
                      boxShadow: '0 2px 6px rgba(127, 29, 29, 0.25)'
                    }}>
                      {initials}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        <h4 style={{
                          margin: 0,
                          fontSize: '0.98rem',
                          fontWeight: 800,
                          color: RED.deepMaroon,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis'
                        }} title={officer.emp_name}>
                          {officer.emp_name}
                        </h4>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' }}>
                        <span style={{
                          background: RED.bgLight,
                          color: RED.deepMaroon,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          fontFamily: 'monospace'
                        }}>
                          {officer.emp_code}
                        </span>
                        <span style={{
                          background: '#FFF5F5',
                          color: RED.textLight,
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          border: `1px solid ${RED.borderSubtle}`
                        }}>
                          {officer.role_type || 'Officer'}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.75rem', color: RED.textLight, marginTop: '4px' }}>
                        ASM: <strong style={{ color: RED.deepMaroon }}>{officer.asm_name || 'Direct / Head Office'}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Red KPI Metrics Strip */}
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: '6px',
                    background: RED.bgSoft,
                    padding: '8px 10px',
                    borderRadius: '8px',
                    border: `1px solid ${RED.borderSubtle}`,
                    textAlign: 'center'
                  }}>
                    <div>
                      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: RED.textLight, textTransform: 'uppercase' }}>
                        Planned
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 900, color: RED.deepMaroon, marginTop: '2px' }}>
                        {officer.totalVisits}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: RED.textLight, textTransform: 'uppercase' }}>
                        Days
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 900, color: RED.deepMaroon, marginTop: '2px' }}>
                        {officer.activeDays}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: RED.textLight, textTransform: 'uppercase' }}>
                        Executed
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 900, color: RED.deepMaroon, marginTop: '2px' }}>
                        {officer.executedVisits}
                      </div>
                    </div>

                    <div>
                      <div style={{ fontSize: '0.66rem', fontWeight: 700, color: RED.textLight, textTransform: 'uppercase' }}>
                        Adh %
                      </div>
                      <div style={{ fontSize: '1.05rem', fontWeight: 900, color: RED.maroon, marginTop: '2px' }}>
                        {officer.adherencePct}%
                      </div>
                    </div>
                  </div>

                  {/* Card Footer Button */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.74rem', color: RED.textLight }}>
                      Monthly non-trade route
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSelectOfficer(officer.emp_code);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '6px 12px',
                        borderRadius: '6px',
                        border: `1px solid ${RED.maroon}`,
                        background: RED.maroon,
                        color: RED.white,
                        fontSize: '0.76rem',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      <span>View Calendar</span>
                      <ArrowRight size={13} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 3. VIEW MODE B: DEDICATED OFFICER PLAN CALENDAR                           */}
      {/* ========================================================================= */}
      {viewMode === 'calendar' && (
        <div>
          {/* Top Officer Profile Ribbon & Fast Switcher */}
          <div style={{
            background: RED.white,
            borderRadius: '12px',
            padding: '16px 20px',
            border: `2px solid ${RED.borderLight}`,
            boxShadow: '0 2px 8px rgba(127, 29, 29, 0.05)',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '14px'
          }}>
            {/* Left: Back button & Officer Identity */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
              <button
                onClick={handleBackToList}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '7px 14px',
                  borderRadius: '6px',
                  border: `1.5px solid ${RED.maroon}`,
                  background: RED.bgLight,
                  color: RED.deepMaroon,
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#FECACA'}
                onMouseLeave={e => e.currentTarget.style.background = RED.bgLight}
              >
                <ArrowLeft size={16} />
                <span>← Back to Officers List</span>
              </button>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: RED.deepMaroon,
                  color: RED.white,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 800,
                  fontSize: '0.9rem'
                }}>
                  {currentOfficer ? getInitials(currentOfficer.emp_name) : 'ALL'}
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: RED.deepMaroon }}>
                      {currentOfficer ? currentOfficer.emp_name : 'All Non-Trade Officers'}
                    </h3>
                    <span style={{
                      background: RED.bgLight,
                      color: RED.deepMaroon,
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '0.74rem',
                      fontWeight: 800,
                      fontFamily: 'monospace'
                    }}>
                      {currentOfficer ? currentOfficer.emp_code : 'TEAM'}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: RED.textLight, marginTop: '2px' }}>
                    {currentOfficer
                      ? `Role: ${currentOfficer.role_type} • Reporting ASM: ${currentOfficer.asm_name || 'Direct'}`
                      : 'Combined team schedule of all field staff'}
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Quick Switcher Dropdown */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: RED.deepMaroon }}>
                Switch Officer:
              </span>
              <select
                value={empCodeFilter}
                onChange={e => setEmpCodeFilter(e.target.value)}
                style={{
                  padding: '7px 12px',
                  borderRadius: '6px',
                  border: `1.5px solid ${RED.borderLight}`,
                  background: RED.bgUltraLight,
                  color: RED.textDarkest,
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="ALL">All Officers Combined ({calendarData?.allOfficers?.length || 0})</option>
                {calendarData?.allOfficers?.map(o => (
                  <option key={o.emp_code} value={o.emp_code}>
                    {o.emp_name} ({o.totalVisits} visits)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Quick Horizontal Officer Chips Strip */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            overflowX: 'auto',
            paddingBottom: '12px',
            marginBottom: '12px'
          }}>
            <button
              onClick={() => setEmpCodeFilter('ALL')}
              style={{
                padding: '6px 14px',
                borderRadius: '16px',
                border: `1.5px solid ${empCodeFilter === 'ALL' ? RED.maroon : RED.borderLight}`,
                background: empCodeFilter === 'ALL' ? RED.maroon : RED.white,
                color: empCodeFilter === 'ALL' ? RED.white : RED.deepMaroon,
                fontSize: '0.78rem',
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
            >
              All Staff Combined
            </button>

            {calendarData?.allOfficers?.map(o => {
              const isSelected = empCodeFilter === o.emp_code;
              return (
                <button
                  key={o.emp_code}
                  onClick={() => setEmpCodeFilter(o.emp_code)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '16px',
                    border: `1.5px solid ${isSelected ? RED.maroon : RED.borderLight}`,
                    background: isSelected ? RED.maroon : RED.white,
                    color: isSelected ? RED.white : RED.deepMaroon,
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <span>{o.emp_name}</span>
                  <span style={{
                    background: isSelected ? 'rgba(255,255,255,0.25)' : RED.bgLight,
                    color: isSelected ? RED.white : RED.deepMaroon,
                    fontSize: '0.7rem',
                    padding: '1px 6px',
                    borderRadius: '10px',
                    fontWeight: 800
                  }}>
                    {o.totalVisits}
                  </span>
                </button>
              );
            })}
          </div>

          {/* KPI Summary Strip for this selected officer / all officers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: '14px',
            marginBottom: '20px'
          }}>
            {/* Card 1: Total Scheduled Visits */}
            <div style={{
              background: RED.bgSoft,
              borderRadius: '10px',
              padding: '16px',
              border: `1.5px solid ${RED.borderLight}`,
              boxShadow: '0 1px 3px rgba(127, 29, 29, 0.05)'
            }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: RED.textLight, textTransform: 'uppercase' }}>
                Total Scheduled Visits
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: RED.deepMaroon, marginTop: '4px' }}>
                {calendarData?.totalVisits || 0}
              </div>
              <div style={{ fontSize: '0.75rem', color: RED.textMedium, marginTop: '2px' }}>
                Planned counter touches
              </div>
            </div>

            {/* Card 2: Active Field Days */}
            <div style={{
              background: RED.bgSoft,
              borderRadius: '10px',
              padding: '16px',
              border: `1.5px solid ${RED.borderLight}`,
              boxShadow: '0 1px 3px rgba(127, 29, 29, 0.05)'
            }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: RED.textLight, textTransform: 'uppercase' }}>
                Active Field Days
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: RED.maroon, marginTop: '4px' }}>
                {calendarData?.activeDays || 0} <span style={{ fontSize: '0.9rem', fontWeight: 600, color: RED.textMedium }}>/ {calendarData?.daysInMonth || 30}</span>
              </div>
              <div style={{ fontSize: '0.75rem', color: RED.textMedium, marginTop: '2px' }}>
                Days with counter visits
              </div>
            </div>

            {/* Card 3: Executed Visits */}
            <div style={{
              background: RED.bgSoft,
              borderRadius: '10px',
              padding: '16px',
              border: `1.5px solid ${RED.borderLight}`,
              boxShadow: '0 1px 3px rgba(127, 29, 29, 0.05)'
            }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: RED.textLight, textTransform: 'uppercase' }}>
                Executed in SFA
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: RED.deepMaroon, marginTop: '4px' }}>
                {calendarData?.executedVisits || 0}
              </div>
              <div style={{ fontSize: '0.75rem', color: RED.textMedium, marginTop: '2px' }}>
                Logged visits matched
              </div>
            </div>

            {/* Card 4: Pending Execution */}
            <div style={{
              background: RED.bgSoft,
              borderRadius: '10px',
              padding: '16px',
              border: `1.5px solid ${RED.borderLight}`,
              boxShadow: '0 1px 3px rgba(127, 29, 29, 0.05)'
            }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: RED.textLight, textTransform: 'uppercase' }}>
                Pending Execution
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: RED.starRed, marginTop: '4px' }}>
                {calendarData?.pendingVisits || 0}
              </div>
              <div style={{ fontSize: '0.75rem', color: RED.textMedium, marginTop: '2px' }}>
                Remaining scheduled
              </div>
            </div>

            {/* Card 5: Schedule Adherence % */}
            <div style={{
              background: `linear-gradient(135deg, ${RED.deepMaroon} 0%, ${RED.maroon} 100%)`,
              borderRadius: '10px',
              padding: '16px',
              color: RED.white,
              boxShadow: '0 2px 6px rgba(127, 29, 29, 0.2)'
            }}>
              <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#FECACA', textTransform: 'uppercase' }}>
                Plan Adherence
              </div>
              <div style={{ fontSize: '1.75rem', fontWeight: 900, color: RED.white, marginTop: '4px' }}>
                {calendarData?.adherencePct || '0.0'}%
              </div>
              <div style={{ fontSize: '0.75rem', color: '#FEE2E2', marginTop: '2px' }}>
                {calendarData?.executedVisits || 0} of {calendarData?.totalVisits || 0} visited
              </div>
            </div>
          </div>

          {/* Sub-Filters: Bucket & Search */}
          <div style={{
            background: RED.white,
            borderRadius: '10px',
            padding: '12px 18px',
            border: `1.5px solid ${RED.borderLight}`,
            boxShadow: '0 1px 3px rgba(127, 29, 29, 0.04)',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 700, color: RED.deepMaroon }}>Category Filter:</span>
              <select
                value={bucketFilter}
                onChange={e => setBucketFilter(e.target.value)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: `1.5px solid ${RED.borderLight}`,
                  background: RED.bgUltraLight,
                  color: RED.textDarkest,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  outline: 'none'
                }}
              >
                <option value="ALL">All Categories</option>
                <option value="Zero-lifter">Zero-lifter</option>
                <option value="Penetrate">Penetrate</option>
                <option value="Retain">Retain</option>
                <option value="To be dorment">To be dorment</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: RED.maroon }} />
              <input
                type="text"
                placeholder="Search counter, ship-to, destination..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{
                  padding: '6px 12px 6px 30px',
                  borderRadius: '6px',
                  border: `1.5px solid ${RED.borderLight}`,
                  background: RED.bgUltraLight,
                  color: RED.textDarkest,
                  fontSize: '0.8rem',
                  width: '240px',
                  outline: 'none'
                }}
              />
            </div>
          </div>

          {/* 7-Column Red Calendar Grid */}
          <div style={{
            background: RED.white,
            borderRadius: '12px',
            border: `2px solid ${RED.borderLight}`,
            boxShadow: '0 4px 14px rgba(127, 29, 29, 0.06)',
            overflow: 'hidden'
          }}>
            {/* Day-of-Week Header Row (Strict Red Palette) */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              background: RED.bgLight,
              borderBottom: `2px solid ${RED.borderMedium}`
            }}>
              {SHORT_WEEKDAYS.map((wd, i) => {
                const isSunday = i === 0;
                return (
                  <div
                    key={wd}
                    style={{
                      padding: '12px 8px',
                      textAlign: 'center',
                      fontWeight: 800,
                      fontSize: '0.85rem',
                      letterSpacing: '0.04em',
                      textTransform: 'uppercase',
                      color: isSunday ? RED.maroon : RED.deepMaroon,
                      borderRight: i < 6 ? `1px solid ${RED.borderSubtle}` : 'none',
                      background: isSunday ? '#FEE2E2' : RED.bgLight
                    }}
                  >
                    {wd}
                  </div>
                );
              })}
            </div>

            {/* Calendar Grid Cells */}
            {loading ? (
              <div style={{
                padding: '80px 20px',
                textAlign: 'center',
                color: RED.maroon,
                background: RED.bgUltraLight
              }}>
                <RefreshCw size={28} className="animate-spin" style={{ margin: '0 auto 12px auto', color: RED.starRed }} />
                <div style={{ fontSize: '1rem', fontWeight: 700 }}>Loading Plan Calendar...</div>
                <div style={{ fontSize: '0.8rem', color: RED.textLight, marginTop: '4px' }}>
                  Fetching visits and SFA execution for {currentOfficer ? currentOfficer.emp_name : 'Team'}
                </div>
              </div>
            ) : (
              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                background: RED.borderSubtle,
                gap: '1px'
              }}>
                {calendarCells.map(cell => {
                  if (cell.isBlank) {
                    return (
                      <div
                        key={cell.key}
                        style={{
                          background: '#FFF8F8',
                          minHeight: '120px',
                          padding: '8px'
                        }}
                      />
                    );
                  }

                  const hasVisits = cell.visitCount > 0;
                  const hasExecuted = cell.executedCount > 0;
                  const isSunday = cell.isSunday;

                  return (
                    <div
                      key={cell.key}
                      onClick={() => cell.visitCount > 0 && setSelectedDay(cell)}
                      style={{
                        background: isSunday ? '#FFF9F9' : RED.white,
                        minHeight: '125px',
                        padding: '8px',
                        cursor: hasVisits ? 'pointer' : 'default',
                        display: 'flex',
                        flexDirection: 'column',
                        transition: 'all 0.15s ease',
                        position: 'relative'
                      }}
                      onMouseEnter={e => {
                        if (hasVisits) {
                          e.currentTarget.style.background = '#FEE2E2';
                          e.currentTarget.style.boxShadow = 'inset 0 0 0 1.5px #DC2626';
                        }
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.background = isSunday ? '#FFF9F9' : RED.white;
                        e.currentTarget.style.boxShadow = 'none';
                      }}
                    >
                      {/* Top Day Header: Date Number & Badges */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '6px'
                      }}>
                        {/* Date Number Badge */}
                        <span style={{
                          fontWeight: 800,
                          fontSize: '0.86rem',
                          color: hasVisits ? RED.deepMaroon : isSunday ? RED.borderDark : '#991B1B',
                          background: hasVisits ? RED.bgLight : 'transparent',
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: hasVisits ? `1px solid ${RED.borderMedium}` : 'none'
                        }}>
                          {cell.dayNumber}
                        </span>

                        {/* Visit Count Badge */}
                        {hasVisits && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{
                              background: RED.deepMaroon,
                              color: RED.white,
                              fontSize: '0.68rem',
                              fontWeight: 800,
                              padding: '1px 6px',
                              borderRadius: '10px',
                              boxShadow: '0 1px 2px rgba(127, 29, 29, 0.2)'
                            }}>
                              {cell.visitCount}
                            </span>

                            {hasExecuted && (
                              <span
                                title={`${cell.executedCount} visits executed in SFA`}
                                style={{
                                  background: '#FEE2E2',
                                  color: RED.deepMaroon,
                                  fontSize: '0.65rem',
                                  fontWeight: 800,
                                  padding: '1px 5px',
                                  borderRadius: '10px',
                                  border: `1px solid ${RED.borderMedium}`
                                }}
                              >
                                ✓ {cell.executedCount}
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Body: Preview of up to 3 Scheduled Counters */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                        {cell.visits.slice(0, 3).map((v, idx) => {
                          return (
                            <div
                              key={v.id || idx}
                              style={{
                                background: v.executed ? '#FEF2F2' : RED.bgUltraLight,
                                border: `1px solid ${v.executed ? RED.borderMedium : RED.borderLight}`,
                                borderRadius: '4px',
                                padding: '3px 6px',
                                fontSize: '0.7rem',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '2px',
                                transition: 'background 0.1s ease'
                              }}
                            >
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '4px'
                              }}>
                                <span style={{
                                  fontWeight: 700,
                                  color: RED.deepMaroon,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: '120px'
                                }} title={v.party_name}>
                                  {v.party_name}
                                </span>
                                {v.executed && (
                                  <span style={{
                                    color: RED.deepMaroon,
                                    fontWeight: 900,
                                    fontSize: '0.68rem'
                                  }} title="Executed">
                                    ✓
                                  </span>
                                )}
                              </div>

                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                fontSize: '0.65rem',
                                color: RED.textLight
                              }}>
                                <span>{v.destination_zone || v.ship_to_party}</span>
                                <span style={{
                                  background: RED.bgLight,
                                  color: RED.deepMaroon,
                                  padding: '0 4px',
                                  borderRadius: '3px',
                                  fontSize: '0.62rem',
                                  fontWeight: 700
                                }}>
                                  {v.bucket ? v.bucket.slice(0, 8) : 'Plan'}
                                </span>
                              </div>
                            </div>
                          );
                        })}

                        {/* More Counters Button */}
                        {cell.visitCount > 3 && (
                          <div style={{
                            marginTop: 'auto',
                            padding: '2px 4px',
                            textAlign: 'center',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: RED.deepMaroon,
                            background: RED.bgLight,
                            borderRadius: '4px',
                            border: `1px solid ${RED.borderLight}`
                          }}>
                            + {cell.visitCount - 3} more counters
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 4. INTERACTIVE RED DAY SCHEDULE MODAL                                     */}
      {/* ========================================================================= */}
      {selectedDay && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: RED.overlay,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            background: RED.white,
            borderRadius: '14px',
            border: `2px solid ${RED.starRed}`,
            width: '100%',
            maxWidth: '850px',
            maxHeight: '88vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 40px rgba(127, 29, 29, 0.4)',
            overflow: 'hidden',
            animation: 'fadeIn 0.15s ease'
          }}>
            {/* Modal Red Header */}
            <div style={{
              background: `linear-gradient(135deg, ${RED.deepMaroon} 0%, ${RED.maroon} 100%)`,
              padding: '16px 22px',
              color: RED.white,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <CalendarIcon size={20} color="#FECACA" />
                  <h3 style={{ margin: 0, fontSize: '1.2rem', fontWeight: 800, color: RED.white }}>
                    Schedule for {selectedDay.date}
                  </h3>
                  <span style={{
                    background: RED.white,
                    color: RED.deepMaroon,
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '0.72rem',
                    fontWeight: 800
                  }}>
                    {WEEKDAYS[selectedDay.dayOfWeek]}
                  </span>
                </div>
                <div style={{ fontSize: '0.8rem', color: '#FECACA', marginTop: '3px' }}>
                  Total {selectedDay.visitCount} Scheduled Counters • {selectedDay.executedCount} Executed • {selectedDay.visitCount - selectedDay.executedCount} Pending
                </div>
              </div>

              <button
                onClick={() => {
                  setSelectedDay(null);
                  setModalSearch('');
                  setModalBucketFilter('ALL');
                }}
                style={{
                  background: 'rgba(255, 255, 255, 0.2)',
                  border: 'none',
                  color: RED.white,
                  borderRadius: '8px',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'background 0.15s ease'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Filter Toolbar */}
            <div style={{
              padding: '12px 20px',
              background: RED.bgUltraLight,
              borderBottom: `1px solid ${RED.borderLight}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: '10px'
            }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
                <Search size={14} style={{ position: 'absolute', left: '10px', top: '9px', color: RED.maroon }} />
                <input
                  type="text"
                  placeholder="Filter day's counters by name, ship-to, officer..."
                  value={modalSearch}
                  onChange={e => setModalSearch(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '6px 12px 6px 30px',
                    borderRadius: '6px',
                    border: `1.5px solid ${RED.borderLight}`,
                    background: RED.white,
                    fontSize: '0.8rem',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: RED.deepMaroon }}>Category:</span>
                <select
                  value={modalBucketFilter}
                  onChange={e => setModalBucketFilter(e.target.value)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: '6px',
                    border: `1.5px solid ${RED.borderLight}`,
                    background: RED.white,
                    fontSize: '0.8rem',
                    fontWeight: 600
                  }}
                >
                  <option value="ALL">All Categories</option>
                  <option value="Zero-lifter">Zero-lifter</option>
                  <option value="Penetrate">Penetrate</option>
                  <option value="Retain">Retain</option>
                  <option value="To be dorment">To be dorment</option>
                </select>
              </div>
            </div>

            {/* Modal Body: Counter Cards List */}
            <div style={{
              padding: '16px 20px',
              overflowY: 'auto',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: '12px',
              background: '#FFFDFD'
            }}>
              {modalVisits.length === 0 ? (
                <div style={{
                  padding: '40px',
                  textAlign: 'center',
                  color: RED.maroon
                }}>
                  No counters match the search / category filter for this day.
                </div>
              ) : (
                modalVisits.map((v, idx) => {
                  return (
                    <div
                      key={v.id || idx}
                      style={{
                        background: RED.white,
                        borderRadius: '10px',
                        border: `1.5px solid ${v.executed ? RED.maroon : RED.borderLight}`,
                        padding: '14px 16px',
                        boxShadow: '0 2px 6px rgba(127, 29, 29, 0.04)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '10px'
                      }}
                    >
                      {/* Top Row: Counter Name & Status Badge */}
                      <div style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '12px'
                      }}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h4 style={{ margin: 0, fontSize: '0.98rem', fontWeight: 800, color: RED.deepMaroon }}>
                              {v.party_name}
                            </h4>
                            <span style={{
                              background: RED.bgLight,
                              color: RED.deepMaroon,
                              padding: '2px 8px',
                              borderRadius: '4px',
                              fontSize: '0.72rem',
                              fontWeight: 700,
                              fontFamily: 'monospace'
                            }}>
                              SAP: {v.sap_code}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: RED.textLight, marginTop: '2px' }}>
                            Ship-to: <strong style={{ color: RED.deepMaroon }}>{v.ship_to_party_name || v.party_name}</strong> ({v.ship_to_party})
                          </div>
                        </div>

                        {/* Executed vs Pending Status Badge */}
                        <div style={{ textAlign: 'right' }}>
                          {v.executed ? (
                            <span style={{
                              background: RED.deepMaroon,
                              color: RED.white,
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              boxShadow: '0 1px 3px rgba(127, 29, 29, 0.2)'
                            }}>
                              <CheckSquare size={13} />
                              <span>EXECUTED IN SFA</span>
                            </span>
                          ) : (
                            <span style={{
                              background: RED.bgLight,
                              color: RED.deepMaroon,
                              border: `1px solid ${RED.borderMedium}`,
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}>
                              <Clock size={13} />
                              <span>PENDING VISIT</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Details Grid */}
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                        gap: '8px',
                        background: RED.bgUltraLight,
                        padding: '10px 12px',
                        borderRadius: '6px',
                        fontSize: '0.76rem',
                        border: `1px solid ${RED.borderSubtle}`
                      }}>
                        <div>
                          <span style={{ color: RED.textLight, fontWeight: 600 }}>Field Officer: </span>
                          <strong style={{ color: RED.deepMaroon }}>{v.emp_name}</strong>
                          <span style={{ fontSize: '0.7rem', color: RED.textMedium }}> ({v.emp_code})</span>
                        </div>

                        <div>
                          <span style={{ color: RED.textLight, fontWeight: 600 }}>Reporting ASM: </span>
                          <strong style={{ color: RED.deepMaroon }}>{v.asm_name || 'NA'}</strong>
                        </div>

                        <div>
                          <span style={{ color: RED.textLight, fontWeight: 600 }}>Destination Zone: </span>
                          <strong style={{ color: RED.deepMaroon }}>{v.destination_zone || 'NA'}</strong>
                        </div>

                        <div>
                          <span style={{ color: RED.textLight, fontWeight: 600 }}>Category / Bucket: </span>
                          <span style={{
                            background: RED.bgLight,
                            color: RED.deepMaroon,
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontWeight: 700
                          }}>
                            {v.bucket || 'Standard'}
                          </span>
                        </div>

                        <div>
                          <span style={{ color: RED.textLight, fontWeight: 600 }}>Priority: </span>
                          <strong style={{ color: RED.deepMaroon }}>{v.priority || 1}</strong>
                        </div>

                        <div>
                          <span style={{ color: RED.textLight, fontWeight: 600 }}>Segment: </span>
                          <strong style={{ color: RED.deepMaroon }}>{v.segment || 'NON-TRADE'}</strong>
                        </div>
                      </div>

                      {/* Execution Details If Executed */}
                      {v.executed && v.execution && (
                        <div style={{
                          background: '#FFF5F5',
                          border: `1px dashed ${RED.borderMedium}`,
                          borderRadius: '6px',
                          padding: '8px 12px',
                          fontSize: '0.75rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '8px'
                        }}>
                          <div>
                            <span style={{ color: RED.textLight, fontWeight: 600 }}>SFA Punch: </span>
                            <strong style={{ color: RED.deepMaroon }}>
                              {v.execution.check_in_time} – {v.execution.check_out_time}
                            </strong>
                            <span style={{ color: RED.textMedium }}> ({v.execution.duration})</span>
                          </div>
                          <div>
                            <span style={{ color: RED.textLight, fontWeight: 600 }}>Visit Status: </span>
                            <span style={{
                              background: RED.bgLight,
                              color: RED.deepMaroon,
                              padding: '1px 6px',
                              borderRadius: '4px',
                              fontWeight: 700
                            }}>
                              {v.execution.visit_status}
                            </span>
                          </div>
                          {v.execution.remarks && (
                            <div style={{ width: '100%', color: RED.textMedium, fontSize: '0.72rem' }}>
                              <em>Remarks: {v.execution.remarks}</em>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Modal Footer */}
            <div style={{
              padding: '12px 20px',
              background: RED.bgLight,
              borderTop: `1.5px solid ${RED.borderLight}`,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }}>
              <span style={{ fontSize: '0.8rem', color: RED.deepMaroon, fontWeight: 600 }}>
                Showing {modalVisits.length} of {selectedDay.visitCount} scheduled counters
              </span>
              <button
                onClick={() => setSelectedDay(null)}
                style={{
                  padding: '7px 16px',
                  borderRadius: '6px',
                  border: `1.5px solid ${RED.maroon}`,
                  background: RED.maroon,
                  color: RED.white,
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer'
                }}
              >
                Close Schedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
