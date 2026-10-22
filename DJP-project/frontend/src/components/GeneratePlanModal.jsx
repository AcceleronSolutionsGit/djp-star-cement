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

    api.getInputReadiness(initialMonth)
      .then(r => {
        if (cancelled) return;
        setReadiness(r);
        const latest = r?.latestAvailableSalesPeriod;
        // If initialMonth was explicitly supplied, preserve it; otherwise default to penultimate-friendly month (latest + 2) or latest + 1
        if (initialMonth) {
          setMonth(initialMonth);
        } else if (latest) {
          // Standard business cycle: RSAR data through penultimate month M-2 => plan month M (latest + 2)
          setMonth(addMonths(latest, 2));
        } else {
          setMonth(new Date().toISOString().slice(0, 7));
        }
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
  const planPrev = month ? addMonths(month, -1) : null;
  // Authoritative sales anchor: min(planPrev, latest) if latest is available, otherwise planPrev
  const anchor = (latest && planPrev) ? (latest < planPrev ? latest : planPrev) : planPrev;
  const gap = latest && month ? monthsBetween(latest, month) : null;
  const ready = readiness?.allAvailable !== false;

  // Penultimate month (gap = 2) is a standard valid sales anchor for plan month M.
  // Prior month (gap = 1) is also standard.
  // The mandatory 3-month threshold is removed — plans can be generated without restriction.
  const isPenultimate = gap === 2;
  const backwards = gap !== null && gap < 1;
  const olderThanPenultimate = gap !== null && gap > 2;

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
                  RSAR sales data available through{' '}
                  <strong>{latest ? label(latest) : 'unknown — no sales history uploaded'}</strong>
                </div>
                <div>
                  Planning <strong>{label(month)}</strong>: Dealer Performance anchored on <strong>{label(planPrev)}</strong> (prior month), RSAR sales anchored on <strong>{label(anchor)}</strong>
                  {isPenultimate && <span style={{ color: 'var(--star-blue, #1F5FA9)', marginLeft: 6, fontWeight: 600 }}>(Penultimate month anchor)</span>}
                  {gap === 1 && <span style={{ color: 'var(--color-success, #16a34a)', marginLeft: 6, fontWeight: 600 }}>(Prior month anchor)</span>}
                </div>
                {!touched && latest && (
                  <div style={{ color: 'var(--text-tertiary)', marginTop: 4 }}>
                    {isPenultimate
                      ? 'RSAR retail sales extends to penultimate month (' + label(latest) + ') while Dealer Performance evaluates against ' + label(planPrev) + '.'
                      : 'Derived from your uploaded sales data.'}
                  </div>
                )}
              </div>

              {olderThanPenultimate && (
                <div style={{
                  display: 'flex', gap: 10, marginTop: 12, padding: '11px 13px',
                  borderRadius: 'var(--radius-md)', fontSize: '.8rem', lineHeight: 1.5,
                  background: 'var(--bg-hover, #F8FAFC)', color: 'var(--text-secondary)'
                }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1, color: '#f59e0b' }} />
                  <span>
                    {label(month)} is {gap} months after latest sales data ({label(latest)}).
                    Calculations will anchor on {label(anchor)} sales without restriction.
                  </span>
                </div>
              )}

              {backwards && (
                <div style={{
                  display: 'flex', gap: 10, marginTop: 12, padding: '11px 13px',
                  borderRadius: 'var(--radius-md)', fontSize: '.8rem', lineHeight: 1.5,
                  background: 'var(--color-warning-bg, #FEF3C7)', color: 'var(--color-warning, #92400E)'
                }}>
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>
                    {label(month)} is on or before latest sales month ({label(latest)}). Existing plans for {label(month)} will be replaced upon regeneration.
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
