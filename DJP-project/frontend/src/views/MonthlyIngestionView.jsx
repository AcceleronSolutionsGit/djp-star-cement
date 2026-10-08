import React, { useState, useEffect } from 'react';
import { api, API_BASE } from '../services/api';
import { UploadCloud, Plus, Zap, FileSpreadsheet, CheckCircle2, Clock, X, Trash2, HelpCircle, RefreshCw, AlertCircle } from 'lucide-react';

const SCHEMAS = [
  { type: 'DEALER_MAPPING', name: 'Dealer - SO Territory Hierarchy Mapping', templateFile: '01_Dealer_Mapping_Template.xlsx', cols: ['SAP Code', 'SFA Code', 'Dealer Name', 'Cust Type', 'Area', 'Zone', 'Block', 'SO Name', 'SO Emp Code', 'ASM Name', 'ASM Code', 'RSM Name', 'RSM Code', 'ZH Name', 'ZH Code', 'Counter Potential', 'DOA'] },
  { type: 'DEALER_PERFORMANCE', name: 'Dealer Performance & Historical Sales', templateFile: '02_Dealer_Performance_Template.xlsx', cols: ['SAP', 'CODE', 'DEALERS NAME', 'AREA', 'REGION', 'DOA', 'Targeted Dealer', 'EXCLUSIVE DEALER', "June'26 Tgt", 'Prorata Tgt', "June'26 SALE", "May'26 DEALER", 'June-25 SALE', 'Jan-26 SALE', 'Feb-26 SALE', 'Mar-26 SALE', 'Apr-26 SALE', 'May-26 SALE', 'Jun-26 SALE', 'Last 6 Months Avg Sales'] },
  { type: 'SBG', name: 'SBG Dealer Master & Counter Potential', templateFile: '03_SBG_Master_Template.xlsx', cols: ['Customer Code', 'Dealer Name', 'Territory Code', 'Territory Name', 'Block (Taluka)', 'Counter Potential Average (MT)', 'Zone', 'SO Code', 'SO Name', 'ASM Code', 'ASM Name', 'RSM Code', 'RSM Name', 'ZH Code', 'ZH Name', 'Status in SAP', 'Dealer Start Date'] },
  { type: 'SALES_HISTORY', name: 'Period Sales History (RSAR / ERP)', templateFile: '04_Sales_History_RSAR_Template.xlsx', cols: ['SAP Code', 'Sub Dealer Name', 'LinkedDealerCode', 'Linked Dealer Name', 'Zone', 'Monthly Sales Columns (e.g. Jan-26, Feb-26, Mar-26, Apr-26, May-26, Jun-26)'] },
  { type: 'PROSPECT_DEALERS', name: 'Prospect Dealer Intake', templateFile: '05_Prospect_Dealers_Template.xlsx', cols: ['Prospective Dealer Name', 'SFA Code', 'Zone', 'Area', 'Taluka', 'Name of SO', 'SO Emp Code', 'Potential', 'Expected Sale', 'Status'] },
  { type: 'SFA_REPORT', name: 'SFA Visit Execution Feedback', templateFile: null, cols: ['Visit Date', 'Customer Code', 'Customer Name', 'Employee Code', 'Employee Name', 'Check In Time', 'Duration'] },
  { type: 'VISIT_TARGETS_OVERRIDE', name: 'Generated Visit Targets (Bulk Edit)', templateFile: null, cols: ['Customer Code', 'SO Visits', 'ASM Visits', 'RSM Visits', 'ZH Visits'] }
];

export default function MonthlyIngestionView({ 
  onShowToast, 
  onTriggerDjp,
  onRegenerateC2,
  selectedPeriod,
  onPeriodChange,
  selectedCycle,
  onCycleChange,
  triggerReload
}) {
  const fileInputRef = React.useRef(null);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showSchemaGuide, setShowSchemaGuide] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [purging, setPurging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');

  const [uploadType, setUploadType] = useState('');
  const [periodMonth, setPeriodMonth] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [reconciliation, setReconciliation] = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [sfaUploadResult, setSfaUploadResult] = useState(null); // tracks last SFA upload result

  const [generatedPlans, setGeneratedPlans] = useState([]);
  const [loadingPlans, setLoadingPlans] = useState(false);

  const fetchGeneratedPlans = async () => {
    if (!selectedPeriod) return;
    setLoadingPlans(true);
    try {
      const res = await api.getAllOfficerPlans({ month: selectedPeriod, cycle: selectedCycle, role: 'ALL' });
      setGeneratedPlans(res.plans || []);
    } catch (err) {
      console.error('Failed to load generated plans:', err);
    } finally {
      setLoadingPlans(false);
    }
  };

  useEffect(() => {
    fetchGeneratedPlans();
  }, [selectedPeriod, selectedCycle, triggerReload]);

  const loadBatches = async () => {
    setLoading(true);
    try {
      const [data, reconData, readinessData] = await Promise.allSettled([
        api.getBatches(),
        api.getReconciliation('2026-06', 'C1'),
        api.getInputReadiness()
      ]);
      if (data.status === 'fulfilled') setBatches(data.value.batches || []);
      if (reconData.status === 'fulfilled') setReconciliation(reconData.value.reconciliationReport || reconData.value);
      if (readinessData.status === 'fulfilled') setReadiness(readinessData.value);
    } catch (err) {
      onShowToast('Failed to load upload batches', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBatches();
  }, []);

  const autoDetectType = (file) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    
    let detected = '';
    if (name.includes('sbg')) detected = 'SBG';
    else if (name.includes('performance')) detected = 'DEALER_PERFORMANCE';
    else if (name.includes('mapping') || name.includes('hierarchy') || name.includes('dealer_map') || name.includes('relationship') || name.includes('territory') || name.includes('master_test')) detected = 'DEALER_MAPPING';
    else if (name.includes('prospect')) detected = 'PROSPECT_DEALERS';
    else if (name.includes('rsar') || name.includes('sale') || name.includes('history')) detected = 'SALES_HISTORY';
    else if (name.includes('visit') || name.includes('pjp') || name.includes('djp') || name.includes('trade')) detected = 'PJP_TRADE';
    else if (name.includes('sfa') || name.includes('feedback')) detected = 'SFA_REPORT';

    if (detected) {
      setUploadType(detected);
    }
  };

  const handleFileDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setSelectedFile(file);
      autoDetectType(file);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      autoDetectType(file);
    }
  };

  const handleUploadSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!selectedFile) {
      fileInputRef.current?.click();
      return;
    }
    if (!uploadType) {
      onShowToast('Please select which Ingestion Data Type this file represents.', 'warning');
      return;
    }
    if (uploadType === 'PJP_TRADE' && !periodMonth) {
      onShowToast('Period Month is required for PJP_TRADE uploads. Select the PJP reporting month before uploading.', 'error');
      return;
    }

    setUploading(true);
    setProgress(0);
    setProgressText('Uploading file...');
    
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) return prev;
        return prev + Math.floor(Math.random() * 10) + 5;
      });
    }, 300);

    const formData = new FormData();
    formData.append('uploadType', uploadType);
    if (uploadType === 'PJP_TRADE' && periodMonth) {
      formData.append('periodMonth', periodMonth);
    }
    formData.append('file', selectedFile);

    try {
      const res = await api.uploadFile(formData);
      clearInterval(progressInterval);
      setProgressText('Processing complete!');
      setProgress(100);
      
      setTimeout(() => {
        const { batchCode, rowsProcessed, counts, batchStatus, monthsFound, sfaFeedbackTriggered, c2RegenerationPeriod } = res;
        const dupInfo = counts?.duplicateRows > 0 ? `, ${counts.duplicateRows} duplicates skipped` : '';
        const invalidInfo = counts?.invalidRows > 0 ? `, ${counts.invalidRows} invalid rows` : '';
        const monthInfo = monthsFound?.length > 0 ? ` | Months: ${monthsFound.slice(0, 3).join(', ')}${monthsFound.length > 3 ? '...' : ''}` : '';
        
        const toastType = batchStatus === 'PARTIAL' ? 'warning' : 'success';
        const toastMsg = `Batch ${batchCode}: ${rowsProcessed} rows ingested${dupInfo}${invalidInfo}${monthInfo}`;
        onShowToast(toastMsg, toastType);

        // Track SFA feedback upload for the banner
        if (uploadType === 'SFA_REPORT' && batchStatus !== 'FAILED') {
          setSfaUploadResult({
            batchCode,
            period: c2RegenerationPeriod,
            autoTriggered: sfaFeedbackTriggered || false
          });
        }

        setShowModal(false);
        setSelectedFile(null);
        setUploadType('');
        setUploading(false);
        setProgress(0);
        loadBatches();
      }, 600);
    } catch (err) {
      clearInterval(progressInterval);
      setUploading(false);
      setProgress(0);
      const errMsg = err.response?.data?.error || err.message || 'File upload failed';
      onShowToast(`Upload failed: ${errMsg}`, 'error');
    }
  };
  const [syncing, setSyncing] = useState(false);

  const handleSfaSync = async () => {
    if (!window.confirm("Trigger a manual SFA API sync now? This will fetch the active month's data.")) return;
    setSyncing(true);
    setProgress(0);
    setProgressText('Syncing live SFA data day-by-day (this takes about 5-7 minutes)...');
    
    // Simulate a 5-minute progress bar
    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 95) return prev;
        return prev + 1; // 1% every 3 seconds = 5 minutes to reach 100%
      });
    }, 3000);

    onShowToast('Syncing SFA execution logs from live API in the background...', 'info');
    
    let is504 = false;
    try {
      const res = await fetch(`${API_BASE}/sfa/sync`, { method: 'POST' });
      if (!res.ok) {
        if (res.status === 504) {
          // It's a timeout. NGINX dropped us but backend is still running.
          is504 = true;
          console.log("NGINX Timeout reached, but backend is still working.");
          // We will clear it automatically after roughly 5.5 minutes
          setTimeout(() => {
            clearInterval(progressInterval);
            setProgress(100);
            setProgressText('Sync Complete (Background tasks finished)!');
            setTimeout(() => {
              setProgress(0);
              setSyncing(false);
              loadBatches();
            }, 2000);
          }, 330000); // 5.5 minutes
        } else {
          let errorData;
          try { errorData = await res.json(); } catch(e) {}
          throw new Error(errorData?.error || 'API Sync Failed');
        }
      } else {
        onShowToast('SFA Sync completed successfully!', 'success');
        loadBatches();
        clearInterval(progressInterval);
        setProgress(100);
        setProgressText('Sync Complete!');
        setTimeout(() => {
          setProgress(0);
          setSyncing(false);
        }, 2000);
      }
    } catch (err) {
      onShowToast(err.message || 'Failed to sync SFA data', 'error');
      clearInterval(progressInterval);
      setProgress(0);
      setSyncing(false);
    } finally {
      if (!is504 && progress < 100) {
        // If it was NOT a 504 and it didn't finish normally (e.g., error), we clear it
      }
    }
  };

  const handlePurge = async () => {
    if (!window.confirm('Are you sure you want to purge all old master data? This cannot be undone.')) {
      return;
    }
    setPurging(true);
    setProgress(0);
    setProgressText('Purging master records...');

    const progressInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 90) return prev;
        return prev + 15;
      });
    }, 200);

    try {
      const res = await api.purgeData();
      clearInterval(progressInterval);
      setProgress(100);
      setProgressText('Purge complete!');
      setTimeout(() => {
        setPurging(false);
        setProgress(0);
        onShowToast(`Purged: ${res.deletedTargets || 0} targets, ${res.deletedMappings || 0} mappings, ${res.deletedProspects || 0} prospects.`, 'success');
        loadBatches();
      }, 400);
    } catch (err) {
      clearInterval(progressInterval);
      setPurging(false);
      setProgress(0);
      onShowToast(err.message || 'Purge failed', 'error');
    }
  };

  const handleDeleteBatch = async (batchCode) => {
    if (!window.confirm(`Delete upload record for batch ${batchCode}?`)) return;
    try {
      await api.deleteBatch(batchCode);
      onShowToast(`Batch ${batchCode} record deleted`, 'success');
      setBatches(prev => prev.filter(b => b.batch_code !== batchCode));
    } catch (err) {
      onShowToast(err.message || 'Failed to delete batch log', 'error');
    }
  };

  const getUploadHint = () => {
    const found = SCHEMAS.find(s => s.type === uploadType);
    if (found) {
      return (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '4px' }}>
          {found.cols.map(c => (
            <span key={c} style={{ background: '#E2E8F0', padding: '2px 6px', borderRadius: '4px', fontSize: '0.7rem', color: '#334155', fontWeight: 600 }}>{c}</span>
          ))}
        </div>
      );
    }
    return <div style={{ marginTop: '4px' }}>Select a document category above or browse a file to auto-detect its required schema.</div>;
  };

  return (
    <div>
      {/* Top Card */}
      <div className="content-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <UploadCloud size={20} />
              Monthly Master Excel Ingestion Logs
            </h3>
            <p className="card-subtitle">
              Manage source Excel/CSV files parsed into the DJP system.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button className="btn btn-outline" onClick={() => setShowSchemaGuide(true)} style={{ color: '#475569', borderColor: '#CBD5E1' }}>
              <HelpCircle size={16} />
              <span>Excel Schema Guide</span>
            </button>
            <a 
              href={`${API_BASE}/djp/export-master`} 
              className="btn btn-outline" 
              target="_blank" 
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#16a34a', borderColor: '#16a34a', fontWeight: 600 }}
              title="Download 22-column Master Report Excel"
            >
              <FileSpreadsheet size={16} />
              <span>Download Masters Excel</span>
            </a>
            <a 
              href={`${API_BASE}/djp/export-visits`} 
              className="btn btn-outline" 
              target="_blank" 
              rel="noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#2563eb', borderColor: '#2563eb', fontWeight: 600 }}
              title="Download Visits Planned Excel"
            >
              <FileSpreadsheet size={16} />
              <span>Download Visits Planned</span>
            </a>
            <button className="btn btn-outline" onClick={handleSfaSync} disabled={syncing} style={{ color: '#16A34A', borderColor: '#16A34A' }}>
              <RefreshCw size={16} className={syncing ? 'spin' : ''} />
              <span>{syncing ? 'Syncing...' : 'Sync Live SFA Report'}</span>
            </button>
            <button className="btn btn-outline" onClick={handlePurge} disabled={purging} style={{ color: 'var(--star-red)', borderColor: 'var(--star-red)' }}>
              <Trash2 size={16} />
              <span>{purging ? 'Purging...' : 'Purge Old Data'}</span>
            </button>
            <button className="btn btn-primary" onClick={() => { setUploadType(''); setSelectedFile(null); setShowModal(true); }} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <UploadCloud size={16} />
              <span>Upload Excel</span>
            </button>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              background: '#F8FAFC',
              padding: '4px 8px',
              borderRadius: '6px',
              border: '1px solid #CBD5E1'
            }}>
              <span style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                Plan Month:
              </span>
              <input
                type="month"
                value={selectedPeriod || '2026-06'}
                onChange={(e) => {
                  if (e.target.value && onPeriodChange) {
                    onPeriodChange(e.target.value);
                    localStorage.setItem('star_selected_period', e.target.value);
                  }
                }}
                style={{
                  border: '1px solid #CBD5E1',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: '#fff',
                  height: '28px'
                }}
                title="Select month for plan creation"
              />
              <select
                value={selectedCycle || 'C1'}
                onChange={(e) => {
                  if (onCycleChange) {
                    onCycleChange(e.target.value);
                    localStorage.setItem('star_selected_cycle', e.target.value);
                  }
                }}
                style={{
                  border: '1px solid #CBD5E1',
                  borderRadius: '4px',
                  padding: '2px 6px',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  background: '#fff',
                  height: '28px'
                }}
                title="Select plan cycle (C1: 1-15, C2: 16-End)"
              >
                <option value="C1">C1</option>
                <option value="C2">C2</option>
              </select>
            </div>

              <button 
              className="btn btn-generate" 
              onClick={onTriggerDjp}
              style={{
                opacity: readiness && !readiness.allAvailable ? 0.7 : 1,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px'
              }}
              title={readiness && !readiness.allAvailable ? `Missing inputs: ${readiness.missing.join(', ')}` : `Generate PJP & DJP for both C1 and C2 — ${selectedPeriod || '2026-06'}`}
            >
              <Zap size={15} />
              <span>Generate C1 + C2 Plans {selectedPeriod ? `(${selectedPeriod})` : ''} {readiness ? (readiness.allAvailable ? '✓ 5/5 Ready' : `(${readiness.required.filter(r => r.uploaded).length}/5 Excels)`) : ''}</span>
            </button>
          </div>
        </div>
      </div>

      {/* 5 Required Input Excels Checklist */}
      <div className="content-card" style={{ marginTop: '16px', borderLeft: readiness?.allAvailable ? '4px solid #16a34a' : '4px solid #f59e0b', background: '#F8FAFC' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <div>
            <h4 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span>Required Input Excel Datasets (5/5)</span>
              {readiness?.allAvailable ? (
                <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: '#DCFCE7', color: '#166534', fontWeight: 700 }}>
                  ✓ All 5 Excels Uploaded & Ready for DJP Generation
                </span>
              ) : (
                <span style={{ fontSize: '0.75rem', padding: '2px 8px', borderRadius: '12px', background: '#FEF3C7', color: '#92400E', fontWeight: 700 }}>
                  ⚠️ Upload Missing Files Before Generating DJP
                </span>
              )}
            </h4>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              DJP is generated strictly after clicking &apos;Generate DJP Plans&apos; once all 5 Excel files are uploaded and validated.
            </p>
          </div>
          <div>
            <span style={{ fontSize: '0.85rem', fontWeight: 700, color: readiness?.allAvailable ? '#16a34a' : '#d97706' }}>
              {readiness ? `${readiness.required.filter(r => r.uploaded).length} of ${readiness.required.length} Inputs Available` : 'Checking...'}
            </span>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '10px', marginTop: '12px' }}>
          {readiness?.required?.map(req => (
            <div 
              key={req.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                borderRadius: '6px',
                background: req.uploaded ? '#F0FDF4' : '#FFFBEB',
                border: `1px solid ${req.uploaded ? '#BBF7D0' : '#FDE68A'}`
              }}
            >
              {req.uploaded ? (
                <CheckCircle2 size={16} color="#16a34a" />
              ) : (
                <Clock size={16} color="#d97706" />
              )}
              <div style={{ overflow: 'hidden' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: req.uploaded ? '#166534' : '#92400E', textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                  {req.label}
                </div>
                <div style={{ fontSize: '0.7rem', color: req.uploaded ? '#15803d' : '#b45309' }}>
                  {req.uploaded ? 'Validated & Ready' : 'Pending Upload'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      {/* SFA Feedback Banner — appears after SFA upload */}
      {sfaUploadResult && (
        <div className="content-card" style={{
          marginTop: '16px',
          border: '2px solid #6366F1',
          background: 'linear-gradient(135deg, #EEF2FF 0%, #F0FDF4 100%)',
          position: 'relative'
        }}>
          <button
            onClick={() => setSfaUploadResult(null)}
            style={{ position: 'absolute', top: '12px', right: '12px', background: 'none', border: 'none', cursor: 'pointer', color: '#64748B' }}
            title="Dismiss"
          >
            <X size={16} />
          </button>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '10px',
              background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0
            }}>
              <RefreshCw size={22} color="white" />
            </div>
            <div style={{ flex: 1 }}>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '1rem', fontWeight: 700, color: '#3730A3' }}>
                SFA Feedback Uploaded — C2 Plans Being Recalibrated
              </h4>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.83rem', color: '#4338CA', lineHeight: 1.5 }}>
                {sfaUploadResult.autoTriggered
                  ? `C2 plans for ${sfaUploadResult.period || selectedPeriod} are being regenerated in the background using SFA adherence data. Dealers missed in C1 will be prioritised in C2 schedules.`
                  : `SFA data uploaded. You can now generate DJP plans for C2.`
                }
              </p>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', color: '#6366F1', fontWeight: 600 }}>
                  Period: {sfaUploadResult.period || selectedPeriod}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}


      {reconciliation && (
        <div className="content-card" style={{ marginTop: '16px', background: '#F8FAFC', borderColor: '#CBD5E1' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
            <div>
              <h4 style={{ margin: '0 0 4px 0', fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                Multi-Source Reconciliation Status ({reconciliation.reportMonth || '2026-06'} / {reconciliation.cycleCode || 'C1'})
              </h4>
              <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                Deterministic alignment across 5 input sources: Dealer Mapping, Prospects, RSAR, SBG, and Performance.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <div style={{ textAlign: 'center', padding: '6px 14px', background: '#fff', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'block' }}>Total Received</span>
                <strong style={{ fontSize: '1.1rem', color: '#0F172A' }}>{reconciliation.totalReceived ?? 0}</strong>
              </div>
              <div style={{ textAlign: 'center', padding: '6px 14px', background: '#fff', borderRadius: '6px', border: '1px solid #BBF7D0' }}>
                <span style={{ fontSize: '0.75rem', color: '#16A34A', display: 'block' }}>Canonical Trade Dealers</span>
                <strong style={{ fontSize: '1.1rem', color: '#15803D' }}>{reconciliation.normalizedCount ?? 0}</strong>
              </div>
              <div style={{ textAlign: 'center', padding: '6px 14px', background: '#fff', borderRadius: '6px', border: '1px solid #FED7AA' }}>
                <span style={{ fontSize: '0.75rem', color: '#EA580C', display: 'block' }}>Unmatched Prospects</span>
                <strong style={{ fontSize: '1.1rem', color: '#C2410C' }}>{reconciliation.unmatchedCount ?? 0}</strong>
              </div>
              <div style={{ textAlign: 'center', padding: '6px 14px', background: '#fff', borderRadius: '6px', border: '1px solid #E2E8F0' }}>
                <span style={{ fontSize: '0.75rem', color: '#64748B', display: 'block' }}>Audit Issues</span>
                <strong style={{ fontSize: '1.1rem', color: '#475569' }}>{reconciliation.issues ? reconciliation.issues.length : 0}</strong>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batches Table */}
      <div className="table-wrapper">
        <div style={{
          padding: '14px 20px',
          background: '#FAFAFA',
          borderBottom: '1px solid var(--border-subtle)',
          fontWeight: 700,
          fontSize: '0.88rem'
        }}>
          Ingestion History Logs ({batches.length} batches logged)
        </div>

        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Batch Code</th>
                <th>Data Type</th>
                <th>File Name</th>
                <th>Status</th>
                <th>Rows Processed</th>
                <th>Valid / Invalid</th>
                <th>Uploaded Timestamp</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    Loading ingestion logs...
                  </td>
                </tr>
              ) : batches.length === 0 ? (
                <tr>
                  <td colSpan="8" style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    No Excel ingestion batches logged yet. Click "+ Upload Excel" above.
                  </td>
                </tr>
              ) : (
                batches.map((b) => (
                  <tr key={b.batch_code}>
                    <td>
                      <code style={{ fontSize: '0.8rem', background: 'var(--bg-app)', padding: '2px 6px', borderRadius: '4px' }}>
                        {b.batch_code}
                      </code>
                    </td>
                    <td>
                      <span className="badge badge-growing">{b.file_type}</span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{b.file_name}</div>
                      {b.period_month && (
                        <small style={{ color: 'var(--text-muted)' }}>Period: {b.period_month}</small>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${b.status === 'VALIDATED' ? 'badge-validated' : b.status === 'PARTIAL' ? 'badge-degrowing' : 'badge-danger'}`}>
                        {b.status}
                      </span>
                    </td>
                    <td><strong>{b.total_rows || 0}</strong></td>
                    <td>
                      <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>{b.valid_rows || 0}</span>
                      {' / '}
                      <span style={{ color: b.invalid_rows > 0 ? 'var(--color-danger)' : 'var(--text-muted)', fontWeight: 600 }}>
                        {b.invalid_rows || 0}
                      </span>
                    </td>
                    <td>{new Date(b.uploaded_at).toLocaleString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn-icon"
                        onClick={() => handleDeleteBatch(b.batch_code)}
                        title="Delete this batch log"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => !uploading && setShowModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ width: '800px', maxWidth: '90vw' }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UploadCloud size={20} color="var(--star-red)" />
                Upload Excel File
              </h3>
              <button 
                className="btn-icon" 
                onClick={() => setShowModal(false)}
                disabled={uploading}
                type="button"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit}>
              <div className="modal-body">
                {/* Drag and Drop Zone First */}
                <div
                  onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed',
                    borderRadius: 'var(--radius-md)',
                    padding: '30px 20px',
                    textAlign: 'center',
                    backgroundColor: selectedFile ? '#FEF2F2' : '#F8FAFC',
                    borderColor: selectedFile ? 'var(--star-red)' : '#CBD5E1',
                    cursor: 'pointer',
                    transition: 'all 0.2s ease',
                    marginBottom: '16px'
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    id="fileInputUpload"
                    accept=".xlsx, .xls, .csv"
                    style={{ display: 'none' }}
                    onChange={handleFileChange}
                    onClick={(e) => {
                      e.stopPropagation();
                      e.target.value = null;
                    }}
                  />
                  <UploadCloud size={42} style={{ color: selectedFile ? 'var(--star-red)' : '#94A3B8', margin: '0 auto 8px' }} />
                  {selectedFile ? (
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--star-red)', fontSize: '1rem', marginBottom: '4px' }}>
                        ✓ {selectedFile.name}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '8px' }}>
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ padding: '4px 12px', fontSize: '0.78rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                      >
                        Change File
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontWeight: 700, color: '#334155', marginBottom: '4px', fontSize: '0.95rem' }}>
                        Click to browse or drag & drop Excel file here
                      </div>
                      <div style={{ color: '#64748B', fontSize: '0.8rem', marginBottom: '12px' }}>
                        Supports .xlsx, .xls, .csv (Max 50MB)
                      </div>
                      <button
                        type="button"
                        className="btn btn-outline"
                        style={{ padding: '6px 16px', fontSize: '0.82rem', borderColor: '#CBD5E1' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          fileInputRef.current?.click();
                        }}
                      >
                        Browse File
                      </button>
                    </div>
                  )}
                </div>

                <div className="form-group" style={{ marginBottom: '14px' }}>
                  <label className="form-label" style={{ fontWeight: 600 }}>
                    Ingestion Data Type
                    {selectedFile && uploadType && (
                      <span style={{ marginLeft: '8px', color: '#16a34a', fontSize: '0.75rem', fontWeight: 600 }}>
                        (Auto-detected)
                      </span>
                    )}
                  </label>
                  <select
                    className="form-control"
                    value={uploadType}
                    onChange={(e) => setUploadType(e.target.value)}
                  >
                    <option value="">-- Select or Auto-detect Type --</option>
                    <option value="SBG">SBG Dealer Master & Counter Potential (.xlsx)</option>
                    <option value="DEALER_PERFORMANCE">Dealer Performance & Historical Sales (.xlsx)</option>
                    <option value="DEALER_MAPPING">Dealer - SO Territory Hierarchy Mapping (.xlsx)</option>
                    <option value="PROSPECT_DEALERS">Prospect Dealer Intake (.xlsx)</option>
                    <option value="SALES_HISTORY">Period Sales History (RSAR / ERP) (.xlsx)</option>
                    <option value="PJP_TRADE">Full PJP Process Trade / Generated Visit Master (.xlsx)</option>
                    <option value="SFA_REPORT">SFA Visit Execution Feedback (.xlsx)</option>
                    <option value="VISIT_TARGETS_OVERRIDE">Generated Visit Targets (Bulk Edit) (.xlsx)</option>
                  </select>
                </div>

                {(uploadType === 'PJP_TRADE' || uploadType === 'DEALER_PERFORMANCE' || uploadType === 'SALES_HISTORY') && (
                  <div className="form-group" style={{ marginBottom: '14px' }}>
                    <label className="form-label" style={{ color: 'var(--star-red)', fontWeight: 600 }}>
                      Reporting / Target Month (Required)
                    </label>
                    <input
                      type="month"
                      className="form-control"
                      value={periodMonth}
                      onChange={(e) => setPeriodMonth(e.target.value)}
                      style={{ borderColor: 'var(--star-red)' }}
                    />
                    <small style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '4px', display: 'block' }}>
                      Select the exact month this dataset covers (e.g., June 2026).
                    </small>
                  </div>
                )}

                <div style={{
                  fontSize: '0.78rem',
                  color: 'var(--text-secondary)',
                  background: '#F8FAFC',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid #E2E8F0'
                }}>
                  <strong style={{ color: 'var(--text-primary)' }}>Expected Columns:</strong> {getUploadHint()}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)} disabled={uploading}>
                  Cancel
                </button>
                <button 
                  type={selectedFile ? 'submit' : 'button'} 
                  className="btn btn-primary" 
                  disabled={uploading} 
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  onClick={() => {
                    if (!selectedFile) {
                      fileInputRef.current?.click();
                    }
                  }}
                >
                  <UploadCloud size={16} />
                  <span>
                    {uploading 
                      ? 'Uploading...' 
                      : selectedFile 
                        ? 'Upload Selected Excel' 
                        : 'Select & Upload Excel'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Schema Guide Modal */}
      {showSchemaGuide && (
        <div className="modal-overlay" onClick={() => setShowSchemaGuide(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ width: '800px', maxWidth: '95vw', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <FileSpreadsheet size={20} color="var(--star-red)" />
                Expected Excel Fields (Format Guide)
              </h3>
              <button className="btn-icon" onClick={() => setShowSchemaGuide(false)} type="button">
                <X size={20} />
              </button>
            </div>
            <div className="modal-body" style={{ overflowY: 'auto', padding: '0' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#F1F5F9', borderBottom: '2px solid #E2E8F0' }}>
                    <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155', width: '35%' }}>Data Type</th>
                    <th style={{ padding: '12px 16px', fontWeight: 700, color: '#334155' }}>Required Columns</th>
                  </tr>
                </thead>
                <tbody>
                  {SCHEMAS.map(s => (
                    <tr key={s.type} style={{ borderBottom: '1px solid #E2E8F0' }}>
                      <td style={{ padding: '16px', verticalAlign: 'top' }}>
                        <div style={{ fontWeight: 700, color: '#0F172A', marginBottom: '4px' }}>{s.name}</div>
                        <code style={{ fontSize: '0.75rem', color: 'var(--star-red)', background: '#FEF2F2', padding: '2px 6px', borderRadius: '4px' }}>{s.type}</code>
                        {s.templateFile && (
                          <div style={{ marginTop: '10px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <a
                              href={`${API_BASE}/templates/${encodeURIComponent(s.templateFile)}`}
                              download={s.templateFile}
                              className="btn btn-outline"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.72rem',
                                padding: '3px 8px',
                                color: '#15803D',
                                borderColor: '#86EFAC',
                                background: '#F0FDF4',
                                fontWeight: 700
                              }}
                              title={`Download ${s.templateFile}`}
                            >
                              <FileSpreadsheet size={13} color="#16A34A" />
                              <span>Excel (.xlsx)</span>
                            </a>
                            <a
                              href={`${API_BASE}/templates/${encodeURIComponent(s.templateFile.replace('.xlsx', '.csv'))}`}
                              download={s.templateFile.replace('.xlsx', '.csv')}
                              className="btn btn-outline"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                fontSize: '0.72rem',
                                padding: '3px 8px',
                                color: '#0369A1',
                                borderColor: '#7DD3FC',
                                background: '#F0F9FF',
                                fontWeight: 700
                              }}
                              title={`Download CSV`}
                            >
                              <FileSpreadsheet size={13} color="#0284C7" />
                              <span>CSV (.csv)</span>
                            </a>
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                          {s.cols.map(c => (
                            <span key={c} style={{ background: '#F8FAFC', border: '1px solid #E2E8F0', padding: '3px 8px', borderRadius: '6px', fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>
                              {c}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={() => setShowSchemaGuide(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Progress Bar Overlay for Upload / Purge / Sync */}
      {(uploading || purging || syncing) && (
        <div className="modal-overlay" style={{ zIndex: 10000, background: 'rgba(0, 0, 0, 0.7)' }}>
          <div style={{
            background: 'white',
            padding: '30px 40px',
            borderRadius: '12px',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            width: '400px',
            textAlign: 'center'
          }}>
            <h3 style={{ marginBottom: '16px', fontSize: '1.2rem', fontWeight: 700, color: '#1e293b' }}>
              {progressText}
            </h3>
            <div style={{
              width: '100%',
              height: '10px',
              backgroundColor: '#e2e8f0',
              borderRadius: '5px',
              overflow: 'hidden',
              marginBottom: '12px'
            }}>
              <div style={{
                height: '100%',
                backgroundColor: 'var(--star-red)',
                width: `${progress}%`,
                transition: 'width 0.2s ease-out'
              }}></div>
            </div>
            <div style={{ fontWeight: 800, color: 'var(--star-red)', fontSize: '1.4rem' }}>
              {Math.min(progress, 100)}%
            </div>
            <p style={{ marginTop: '8px', fontSize: '0.85rem', color: '#64748b' }}>
              Please wait, this might take a moment.
            </p>
          </div>
        </div>
      )}

      {/* Generated Plans List */}
      <div className="table-wrapper" style={{ marginTop: '24px' }}>
        <div style={{
          padding: '14px 20px',
          background: '#FAFAFA',
          borderBottom: '1px solid var(--border-subtle)',
          fontWeight: 700,
          fontSize: '0.88rem'
        }}>
          Generated Plans ({generatedPlans.length})
        </div>

        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>Plan ID</th>
                <th>Employee Name</th>
                <th>Role</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {loadingPlans ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    Loading plans...
                  </td>
                </tr>
              ) : generatedPlans.length === 0 ? (
                <tr>
                  <td colSpan="4" style={{ textAlign: 'center', padding: '36px', color: 'var(--text-muted)' }}>
                    No plans generated for {selectedPeriod} {selectedCycle} yet. Generate DJP to create plans.
                  </td>
                </tr>
              ) : (
                generatedPlans.map((p) => (
                  <tr key={p.plan_id}>
                    <td>
                      <code style={{ fontSize: '0.8rem', background: 'var(--bg-app)', padding: '2px 6px', borderRadius: '4px' }}>
                        {p.plan_id}
                      </code>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.employee?.emp_name}</div>
                      <small style={{ color: 'var(--text-muted)' }}>{p.employee?.emp_code}</small>
                    </td>
                    <td>{p.employee?.role}</td>
                    <td>
                      <span className={`badge badge-${(p.status || '').toLowerCase()}`}>
                        {p.status || 'DRAFT'}
                      </span>
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
