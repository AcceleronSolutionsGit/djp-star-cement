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

        {/* Global Period/Cycle Picker is kept here so it's accessible across views like Master Sheet */}

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
