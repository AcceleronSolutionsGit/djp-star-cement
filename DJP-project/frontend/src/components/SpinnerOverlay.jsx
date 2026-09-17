import React from 'react';
import { Loader2 } from 'lucide-react';

export default function SpinnerOverlay({ visible, title, message }) {
  if (!visible) return null;

  return (
    <div className="modal-overlay" style={{ zIndex: 99999 }}>
      <div style={{
        background: '#FFFFFF',
        padding: '36px 44px',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-xl)',
        textAlign: 'center',
        maxWidth: '440px'
      }}>
        <Loader2 
          size={48} 
          className="spin" 
          style={{ color: 'var(--star-red)', margin: '0 auto 16px' }} 
        />
        <h3 style={{ 
          fontFamily: 'var(--font-display)', 
          fontSize: '1.2rem', 
          color: 'var(--text-primary)', 
          marginBottom: '6px' 
        }}>
          {title || 'Running DJP Engine...'}
        </h3>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {message || 'Computing dealer classifications, visit targets, priority scores & daily schedule allocations in MySQL.'}
        </p>
      </div>
    </div>
  );
}
