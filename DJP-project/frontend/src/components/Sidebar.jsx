import React from 'react';
import { 
  Grid3X3, 
  Sliders, 
  UploadCloud, 
  Users, 
  Database,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Layers,
  Table2
} from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab, collapsed }) {
  const navItems = [
    {
      group: 'Consolidated Engines',
      items: [
        { id: 'visits', label: 'Master Visits Grid', icon: Grid3X3, desc: 'All Zones & Cycles' },
        { id: 'master-sheet', label: 'Master Sheet (M.xlsx)', icon: Table2, desc: 'All 42 columns, as downloaded' },
        { id: 'formulas', label: 'Rule Engine Settings', icon: Sliders, desc: 'Formulas & Weights' },
        { id: 'upload', label: 'Monthly Excel Ingestion', icon: UploadCloud, desc: 'Source File Ingestion' }
      ]
    },
    {
      group: 'SFA Master Integration',
      items: [
        { id: 'master-data', label: 'Master Data Hub', icon: Database, desc: 'All Uploaded Master Records' },
        { id: 'mapping', label: 'Dealer / SO Mapping', icon: Users, desc: 'Territory Hierarchy' },
        { id: 'archives', label: 'Data Archives', icon: Database, desc: 'Historical Archive Records' }
      ]
    },
    {
      group: 'Sales Planning',
      items: [
        { id: 'plan-gen', label: 'Plan Generation', icon: CalendarDays, desc: 'Auto SO DJP Calendar' },
        { id: 'plan-appr', label: 'Plan Approvals', icon: CheckCircle2, desc: 'Manager Review & Actions' },
        { id: 'officer-plans', label: 'Officer Plans & Adherence', icon: ClipboardList, desc: 'All Roles + C1 Adherence' }
      ]
    }
  ];

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand-section">
        <div className="brand-logo-icon">★</div>
        <div>
          <div className="brand-title">STAR CEMENT</div>
          <div className="brand-subtitle">DJP (Dynamic Journey Planner)</div>
        </div>
      </div>

      <div className="nav-section">
        {navItems.map((group, gIdx) => (
          <div key={gIdx}>
            <div className="nav-group-title">{group.group}</div>
            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  className={`nav-button ${isActive ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
                  title={item.label}
                >
                  <Icon size={18} />
                  <div>
                    <div>{item.label}</div>
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div style={{ padding: '16px 20px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', background: 'rgba(0,0,0,0.15)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94A3B8', fontSize: '0.75rem' }}>
          <Layers size={14} style={{ color: 'var(--star-red)' }} />
          <span>Star Cement DJP Engine • v1.0</span>
        </div>
      </div>
    </aside>
  );
}
