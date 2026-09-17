import React, { useState, useEffect } from 'react';
import { CalendarDays, AlertTriangle, X, Zap } from 'lucide-react';
import { api } from '../services/api';

/**
 * Asks which month to plan before a DJP run.
 *
 * Previously the run silently used the header's period, which defaults to the
 * CURRENT calendar month. Uploading June data and pressing Generate therefore
 * produced September plans, because September is simply what today's date says —
 * nothing in the flow ever asked what you actually meant to plan.
 *
 * The default here is derived from the data instead: latest available sales month
 * + 1. Upload June sales and it offers July, which is what the DJP is for — you
 * plan the month ahead using the last closed month's sales.
 */

const addMonths = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

const monthsBetween = (a, b) => {
  const [ay, am] = a.split('-').map(Number);
  const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
};

const label = ym => {
  if (!/^\d{4}-\d{2}$/.test(ym || '')) return ym || '—';
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export default function GeneratePlanModal({ open, onClose, onConfirm, initialMonth }) {
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(initialMonth || '');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setTouched(false);

    api.getInputReadiness()
      .then(r => {
        if (cancelled) return;
        setReadiness(r);
        // Default to the month AFTER the latest sales data, not today's month.
        const latest = r?.latestAvailableSalesPeriod;
        setMonth(latest ? addMonths(latest, 1) : (initialMonth || new Date().toISOString().slice(0, 7)));
      })
      .catch(() => {
        if (cancelled) return;
        setReadiness(null);
        setMonth(initialMonth || new Date().toISOString().slice(0, 7));
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [open, initialMonth]);

  if (!open) return null;

  const latest = readiness?.latestAvailableSalesPeriod || null;
  const anchor = month ? addMonths(month, -1) : null;
  const gap = latest && month ? monthsBetween(latest, month) : null;
  const ready = readiness?.allAvailable !== false;

  // The engine anchors on min(planMonth - 1, latest sales). More than one month
  // ahead means the anchor silently falls back and the plan is built on older sales.
  const staleAnchor = gap !== null && gap > 1;
  const backwards = gap !== null && gap < 1;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="card-title">Generate C1 + C2 plans</div>
            <div className="card-subtitle">Choose the month you are planning for</div>
          </div>
          <button className="btn-icon" onClick={onClose}><X size={19} /></button>
        </div>

        <div className="modal-body">
          {loading && <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)' }}>Checking uploaded data…</div>}

          {!loading && (
            <>
              <div className="form-group">
                <label className="form-label">
                  <CalendarDays size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                  Plan month
                </label>
                <input
                  type="month"
                  className="form-control"
                  value={month}
                  onChange={e => { setMonth(e.target.value); setTouched(true); }}
                  style={{ fontSize: '1rem', fontWeight: 600 }}
                />
              </div>

              <div style={{
                background: 'var(--bg-hover)', borderRadius: 'var(--radius-md)',
                padding: '12px 14px', fontSize: '.82rem', lineHeight: 1.6
              }}>
                <div>
                  Sales data available through{' '}
                  <strong>{latest ? label(latest) : 'unknown — no sales history uploaded'}</strong>
                </div>
                <div>
                  Planning <strong>{label(month)}</strong>, anchored on{' '}
                  <strong>{label(anchor)}</strong> sales
                </div>
                {!touched && latest && (
                  <div style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>
                    Defaulted from your uploaded data, not from today's date.
                  </div>
                )}
              </div>

              {staleAnchor && (
                <div style={{
                  display: 'flex', gap: 10, marginTop: 12, padding: '11px 13px',
                  borderRadius: 'var(--radius-md)', fontSize: '.8rem', lineHeight: 1.5,
                  background: 'var(--color-warning-bg)', color: 'var(--color-warning)'
                }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {label(month)} is {gap} months after your latest sales data. The engine will fall
                    back to {label(latest)} as the sales anchor, so categories and volumes will be built
                    on {gap - 1} month(s)-old figures. Upload newer sales, or plan {label(addMonths(latest, 1))} instead.
                  </span>
                </div>
              )}

              {backwards && (
                <div style={{
                  display: 'flex', gap: 10, marginTop: 12, padding: '11px 13px',
                  borderRadius: 'var(--radius-md)', fontSize: '.8rem', lineHeight: 1.5,
                  background: 'var(--color-danger-bg)', color: 'var(--color-danger)'
                }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {label(month)} is not after your latest sales month ({label(latest)}). You would be
                    planning a month that has already been sold. Existing plans for {label(month)} will be replaced.
                  </span>
                </div>
              )}

              {!ready && (
                <div style={{
                  display: 'flex', gap: 10, marginTop: 12, padding: '11px 13px',
                  borderRadius: 'var(--radius-md)', fontSize: '.8rem', lineHeight: 1.5,
                  background: 'var(--color-danger-bg)', color: 'var(--color-danger)'
                }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>Missing inputs: {readiness.missing.join(', ')}. Upload all five files first.</span>
                </div>
              )}

              <div style={{ fontSize: '.78rem', color: 'var(--text-tertiary)', marginTop: 14, lineHeight: 1.5 }}>
                Both cycles are generated, then officer plans for every SO, ASM, RSM and ZH.
                Existing plans for {label(month)} are replaced. On a full population this takes a
                few minutes — leave the tab open.
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={loading || !/^\d{4}-\d{2}$/.test(month) || !ready}
            onClick={() => onConfirm(month)}
          >
            <Zap size={15} /> Generate for {label(month)}
          </button>
        </div>
      </div>
    </div>
  );
}
