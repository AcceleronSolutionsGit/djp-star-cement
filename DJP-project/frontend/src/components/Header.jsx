import React, { useState, useRef, useEffect } from 'react';
import { Menu, Zap, Download, FileSpreadsheet, ShieldCheck, LogOut, UserCircle, ChevronDown } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Header({ 
  title, 
  onToggleSidebar, 
  onTriggerDjp, 
  onExportCsv, 
  onExportExcel,
  onExportMaster,
  onExportVisits,
  onOpenUpload,
  selectedPeriod,
  onPeriodChange,
  selectedCycle,
  onCycleChange
}) {
  const { user, logout } = useAuth();
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="app-header">
      <div className="header-left">
        <button 
          className="toggle-sidebar-btn" 
          onClick={onToggleSidebar}
          title="Toggle Navigation"
        >
          <Menu size={18} />
        </button>
        <div style={{ minWidth: 0 }}>
          <h1 className="page-heading">{title}</h1>
        </div>
      </div>

      <div className="header-actions">
        {/* Target Month & Cycle for DJP Creation */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          background: '#F8FAFC',
          padding: '3px 8px',
          borderRadius: '6px',
          border: '1px solid #CBD5E1'
        }}>
          <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Month:
          </span>
          <input
            type="month"
            value={selectedPeriod || '2026-06'}
            onChange={(e) => {
              if (e.target.value) {
                if (onPeriodChange) onPeriodChange(e.target.value);
                localStorage.setItem('star_selected_period', e.target.value);
              }
            }}
            style={{
              border: '1px solid #CBD5E1',
              borderRadius: '4px',
              padding: '2px 5px',
              fontSize: '0.78rem',
              fontWeight: 600,
              background: '#fff',
              height: '26px'
            }}
            title="Select target month for DJP creation"
          />
          <select
            value={selectedCycle || 'C1'}
            onChange={(e) => {
              if (onCycleChange) onCycleChange(e.target.value);
              localStorage.setItem('star_selected_cycle', e.target.value);
            }}
            style={{
              border: '1px solid #CBD5E1',
              borderRadius: '4px',
              padding: '2px 5px',
              fontSize: '0.78rem',
              fontWeight: 600,
              background: '#fff',
              height: '26px'
            }}
            title="Select Plan Cycle (C1: 1–15, C2: 16–End)"
          >
            <option value="C1">C1</option>
            <option value="C2">C2</option>
          </select>
        </div>

        <button 
          className="btn btn-generate" 
          onClick={onTriggerDjp}
          title={`Run Multi-Role PJP & DJP Engine for ${selectedPeriod || '2026-06'} (${selectedCycle || 'C1'})`}
          style={{ padding: '6px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
        >
          <Zap size={14} />
          <span>Generate DJP Data</span>
        </button>

        {/* Consolidated Export Dropdown */}
        <div style={{ position: 'relative' }} ref={exportRef}>
          <button 
            className="btn btn-outline" 
            onClick={() => setExportOpen(prev => !prev)}
            title="Download Excel Reports"
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              color: '#0f766e', 
              borderColor: '#14b8a6', 
              fontWeight: 600,
              padding: '6px 12px',
              fontSize: '0.8rem',
              whiteSpace: 'nowrap'
            }}
          >
            <FileSpreadsheet size={15} />
            <span>Exports</span>
            <ChevronDown size={13} style={{ transform: exportOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>

          {exportOpen && (
            <div style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              right: 0,
              background: '#FFFFFF',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1), 0 8px 10px -6px rgba(0,0,0,0.1)',
              zIndex: 9999,
              minWidth: '220px',
              padding: '6px',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px'
            }}>
              <button
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-primary)',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#F0FDF4'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => { onExportExcel(); setExportOpen(false); }}
                title="Official 16-column PJP/DJP format"
              >
                <FileSpreadsheet size={15} color="#16a34a" />
                <span>16-Col PJP/DJP Excel</span>
              </button>

              <button
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-primary)',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#F0F9FF'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => { onExportMaster(); setExportOpen(false); }}
                title="Full 22-column Master Report"
              >
                <FileSpreadsheet size={15} color="#0284c7" />
                <span>22-Col Master Report</span>
              </button>

              <button
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-primary)',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#F5F3FF'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => { onExportVisits(); setExportOpen(false); }}
                title="Daily Visits Planned schedule"
              >
                <FileSpreadsheet size={15} color="#7c3aed" />
                <span>Visits Planned Schedule</span>
              </button>

              <button
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 12px',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  borderRadius: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  color: 'var(--text-primary)',
                  borderTop: '1px solid var(--border-subtle)',
                  marginTop: '2px',
                  paddingTop: '8px',
                  transition: 'background 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#FFFBEB'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                onClick={() => { onExportCsv(); setExportOpen(false); }}
                title="CSV Visit Allocations"
              >
                <Download size={15} color="#d97706" />
                <span>Export Allocations CSV</span>
              </button>
            </div>
          )}
        </div>

        <button 
          className="btn btn-primary" 
          onClick={onOpenUpload}
          title="Upload Excel File"
          style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
        >
          <FileSpreadsheet size={14} />
          <span>Upload Excel</span>
        </button>

        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '5px',
          background: '#FEF2F2',
          border: '1px solid #FECACA',
          color: 'var(--star-red)',
          padding: '4px 9px',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.7rem',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          whiteSpace: 'nowrap'
        }}>
          <UserCircle size={13} />
          <span>{user?.role || 'Admin'}</span>
        </div>

        <button 
          className="btn btn-outline" 
          onClick={logout}
          title="Sign Out"
          style={{ padding: '6px 10px', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
        >
          <LogOut size={14} />
          <span>Logout</span>
        </button>
      </div>
    </header>
  );
}
