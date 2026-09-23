import React, { useState } from 'react';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Toast from './components/Toast';
import SpinnerOverlay from './components/SpinnerOverlay';
import GeneratePlanModal from './components/GeneratePlanModal';

import VisitsGridView from './views/VisitsGridView';
import FormulaSettingsView from './views/FormulaSettingsView';
import MonthlyIngestionView from './views/MonthlyIngestionView';
import MasterDataRepositoryView from './views/MasterDataRepositoryView';
import TerritoryMappingView from './views/TerritoryMappingView';
import PlanGenerationView from './views/PlanGenerationView';
import PlanApprovalsView from './views/PlanApprovalsView';
import OfficerPlansView from './views/OfficerPlansView';
import MasterSheetView from './views/MasterSheetView';
import LoginView from './views/LoginView';
import ErrorBoundary from './components/ErrorBoundary';

import { api } from './services/api';
import { useAuth } from './contexts/AuthContext';

export default function App() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem('star_active_tab') || 'visits';
  });
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [spinner, setSpinner] = useState({ visible: false, title: '', message: '' });
  const [reloadTrigger, setReloadTrigger] = useState(0);
  const [selectedPeriod, setSelectedPeriod] = useState(() => {
    return localStorage.getItem('star_selected_period') || new Date().toISOString().slice(0, 7);
  });
  const [selectedCycle, setSelectedCycle] = useState(() => {
    return localStorage.getItem('star_selected_cycle') || 'C1';
  });

  const handleSetActiveTab = (tab) => {
    setActiveTab(tab);
    localStorage.setItem('star_active_tab', tab);
    if (tab === 'plan-gen' || tab === 'plan-appr') {
      setSidebarCollapsed(true);
    } else {
      setSidebarCollapsed(false);
    }
  };

  const showToast = (message, type = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  };

  const dismissToast = (id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  // DJP Generation — ask which month first. The header period defaults to the
  // CURRENT calendar month, so running straight off it produced September plans
  // from June data. The modal defaults to (latest sales month + 1) instead.
  const [djpPromptOpen, setDjpPromptOpen] = useState(false);
  const handleTriggerDjp = () => setDjpPromptOpen(true);

  const runDjpForMonth = async (planMonth) => {
    setDjpPromptOpen(false);

    setSpinner({
      visible: true,
      title: `Generating C1 + C2 plans for ${planMonth}...`,
      message: 'Running the DJP engine for both cycles, then building officer plans for every SO, ASM, RSM and ZH. On a full population this takes a few minutes — please leave this tab open.'
    });

    try {
      const res = await api.generateDjp(planMonth);
      const plans = res.officerPlans
        ? Object.values(res.officerPlans).reduce((s, c) => s + (c?.totalPlans || 0), 0)
        : null;
      showToast(
        `DJP complete for ${planMonth} — ${res.totalDealerTargets || 0} dealer targets, ` +
        `${res.totalDjpSlots || 0} DJP slots${plans !== null ? `, ${plans} officer plans` : ''}.`,
        'success'
      );
      // Follow the month that was actually generated, so every screen lines up with it
      setSelectedPeriod(planMonth);
      localStorage.setItem('star_selected_period', planMonth);
      setReloadTrigger(prev => prev + 1);
    } catch (err) {
      showToast(err.message || 'DJP Engine execution failed', 'error');
    } finally {
      setSpinner({ visible: false, title: '', message: '' });
    }
  };

  // Regenerate C2 Plans after SFA feedback
  const handleRegenerateC2 = async (periodMonth) => {
    setSpinner({
      visible: true,
      title: 'Regenerating C2 Plans (SFA Adherence)...',
      message: 'Analysing C1 visit adherence from SFA feedback and recalibrating C2 plans for missed dealers.'
    });
    try {
      const pm = periodMonth || selectedPeriod;
      const res = await api.regenerateC2Plans(pm);
      showToast(
        `C2 plans regenerated for ${pm}. ${res.adherenceSummary?.missedC1Visits || 0} missed C1 dealers prioritised.`,
        'success'
      );
      setReloadTrigger(prev => prev + 1);
    } catch (err) {
      showToast(err.message || 'C2 regeneration failed', 'error');
    } finally {
      setSpinner({ visible: false, title: '', message: '' });
    }
  };

  // CSV Export
  const handleExportCsv = async () => {
    try {
      showToast('Preparing CSV export...', 'info');
      const data = await api.getVisitTargets({ cycleCode: selectedCycle, periodMonth: selectedPeriod });
      const rows = data.targets || [];
      if (rows.length === 0) {
        showToast('No records to export', 'error');
        return;
      }

      let csv = 'Zone,Area,SO Name,Customer Name,Customer Code,Category,Status,SO Visits,ASM Visits,RSM Visits,ZH Visits,Total Visits\n';
      rows.forEach(r => {
        csv += `"${r.zone || ''}","${r.area || ''}","${r.so_name || ''}","${r.dealer_name || ''}","${r.sap_code || r.sfa_code || ''}","${r.category || ''}","${r.dealer_status || ''}",${r.so_visits || 0},${r.asm_visits || 0},${r.rsm_visits || 0},${r.zh_visits || 0},${r.total_visits || 0}\n`;
      });

      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Star_Cement_Master_Visits_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('CSV exported successfully!', 'success');
    } catch (err) {
      showToast('Failed to export CSV', 'error');
    }
  };

  // Excel Export
  const handleExportExcel = async () => {
    try {
      showToast('Generating official 16-column PJP/DJP Excel file...', 'info');
      const period = selectedPeriod || '2026-06';
      const cycle = selectedCycle || 'C1';
      const res = await fetch(`/api/djp/export-pjp-trade?periodMonth=${encodeURIComponent(period)}&cycleCode=${encodeURIComponent(cycle)}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to download Excel file');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `PJP_TRADE_${period}_${cycle}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Excel downloaded successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to download Excel', 'error');
    }
  };

  // Master Report Export
  const handleExportMaster = async () => {
    try {
      showToast('Preparing Master Report Excel file...', 'info');
      const period = selectedPeriod || '2026-09';
      const cycle = selectedCycle || 'C1';
      const res = await fetch(`/api/djp/export-master?periodMonth=${encodeURIComponent(period)}&cycleCode=${encodeURIComponent(cycle)}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to download Master Excel file');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `M_${period}_${cycle}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Master Report Excel downloaded successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to download Master Report Excel', 'error');
    }
  };

  // Visits Planned Export
  const handleExportVisits = async () => {
    try {
      showToast('Preparing Visits Planned Report Excel file...', 'info');
      const period = selectedPeriod || '2026-09';
      const cycle = selectedCycle || 'C1';
      const res = await fetch(`/api/djp/export-visits?periodMonth=${encodeURIComponent(period)}&cycleCode=${encodeURIComponent(cycle)}`);
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || 'Failed to download Visits Planned Excel file');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `visits-To_Be_Achieved_${period}_${cycle}.xlsx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      showToast('Visits Planned Excel downloaded successfully!', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to download Visits Planned Excel', 'error');
    }
  };

  const getPageTitle = () => {
    switch (activeTab) {
      case 'visits': return 'Master Visits Grid';
      case 'formulas': return 'Rule Engine Settings';
      case 'upload': return 'Master Excel Ingestion';
      case 'master-data': return 'Master Data Hub';
      case 'mapping': return 'Territory Hierarchy';
      case 'plan-gen': return 'Plan Generation';
      case 'plan-appr': return 'Plan Approvals';
      case 'officer-plans': return 'Officer Plans & Adherence';
      default: return 'Star Cement | DJP';
    }
  };

  if (!user) {
    return <LoginView />;
  }

  return (
    <div className="app-container">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={handleSetActiveTab}
        collapsed={sidebarCollapsed}
      />

      <div className="main-wrapper">
        <Header
          title={getPageTitle()}
          onToggleSidebar={() => setSidebarCollapsed(prev => !prev)}
          onTriggerDjp={handleTriggerDjp}
          onExportCsv={handleExportCsv}
          onExportExcel={handleExportExcel}
          onExportMaster={handleExportMaster}
          onExportVisits={handleExportVisits}
          onOpenUpload={() => handleSetActiveTab('upload')}
          selectedPeriod={selectedPeriod}
          onPeriodChange={setSelectedPeriod}
          selectedCycle={selectedCycle}
          onCycleChange={setSelectedCycle}
        />

        <main className="app-content">
          <ErrorBoundary key={activeTab}>
            {activeTab === 'visits' && (
              <VisitsGridView
                onShowToast={showToast}
                triggerReload={reloadTrigger}
                onOpenUpload={() => handleSetActiveTab('upload')}
              />
            )}

            {activeTab === 'master-sheet' && (
              <MasterSheetView
                onShowToast={showToast}
                selectedPeriod={selectedPeriod}
                selectedCycle={selectedCycle}
              />
            )}

            {activeTab === 'formulas' && (
              <FormulaSettingsView
                onShowToast={showToast}
                onRulesUpdated={() => setReloadTrigger(prev => prev + 1)}
              />
            )}

            {activeTab === 'upload' && (
              <MonthlyIngestionView
                onShowToast={showToast}
                onTriggerDjp={handleTriggerDjp}
                onRegenerateC2={handleRegenerateC2}
                selectedPeriod={selectedPeriod}
                onPeriodChange={setSelectedPeriod}
                selectedCycle={selectedCycle}
                onCycleChange={setSelectedCycle}
                triggerReload={reloadTrigger}
              />
            )}

            {activeTab === 'master-data' && (
              <MasterDataRepositoryView
                onShowToast={showToast}
              />
            )}

            {activeTab === 'mapping' && (
              <TerritoryMappingView
                onShowToast={showToast}
              />
            )}

            {activeTab === 'plan-gen' && (
              <PlanGenerationView
                onShowToast={showToast}
                onPlanSubmitted={() => setReloadTrigger(prev => prev + 1)}
              />
            )}

            {activeTab === 'plan-appr' && (
              <PlanApprovalsView
                onShowToast={showToast}
              />
            )}

            {activeTab === 'officer-plans' && (
              <OfficerPlansView
                onShowToast={showToast}
                selectedPeriod={selectedPeriod}
                selectedCycle={selectedCycle}
              />
            )}
          </ErrorBoundary>
        </main>
      </div>

      <GeneratePlanModal
        open={djpPromptOpen}
        initialMonth={selectedPeriod}
        onClose={() => setDjpPromptOpen(false)}
        onConfirm={runDjpForMonth}
      />

      <Toast toasts={toasts} onDismiss={dismissToast} />
      <SpinnerOverlay visible={spinner.visible} title={spinner.title} message={spinner.message} />
    </div>
  );
}
