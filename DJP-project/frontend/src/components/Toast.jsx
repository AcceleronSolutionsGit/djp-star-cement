import React from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

export default function Toast({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => {
        let Icon = Info;
        if (t.type === 'success') Icon = CheckCircle2;
        if (t.type === 'error') Icon = AlertCircle;

        return (
          <div key={t.id} className={`toast ${t.type || 'info'}`}>
            <Icon size={18} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1 }}>{t.message}</div>
            <button
              onClick={() => onDismiss(t.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.7)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center'
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
