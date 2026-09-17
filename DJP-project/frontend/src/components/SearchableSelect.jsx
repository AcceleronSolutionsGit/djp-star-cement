import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';

export default function SearchableSelect({
  options = [],
  value = '',
  onChange,
  placeholder = 'Select option...',
  searchPlaceholder = 'Search...',
  disabled = false,
  className = '',
  style = {}
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const containerRef = useRef(null);
  const inputRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    if (!isOpen) {
      setSearchTerm('');
    }
  }, [isOpen]);

  const selectedOption = options.find(opt => String(opt.value) === String(value));

  const filteredOptions = options.filter(opt => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase().trim();
    const label = (opt.label || '').toLowerCase();
    const subtext = (opt.subtext || '').toLowerCase();
    const val = String(opt.value || '').toLowerCase();
    return label.includes(term) || subtext.includes(term) || val.includes(term);
  });

  const handleSelect = (val) => {
    if (onChange) onChange(val);
    setIsOpen(false);
  };

  return (
    <div 
      className={`searchable-select-container ${className}`} 
      ref={containerRef}
      style={{ position: 'relative', width: '100%', ...style }}
    >
      {/* Trigger Button */}
      <button
        type="button"
        className="searchable-select-trigger"
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
        style={{
          width: '100%',
          height: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 10px',
          background: '#FFFFFF',
          border: '1px solid #CBD5E1',
          borderRadius: '6px',
          fontSize: '0.82rem',
          color: selectedOption ? '#0F172A' : '#94A3B8',
          cursor: disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left',
          boxSizing: 'border-box',
          outline: 'none',
          transition: 'all 0.15s ease'
        }}
      >
        <span style={{ 
          overflow: 'hidden', 
          textOverflow: 'ellipsis', 
          whiteSpace: 'nowrap',
          fontWeight: selectedOption ? 600 : 400
        }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={15} color="#64748B" style={{ flexShrink: 0, marginLeft: '6px' }} />
      </button>

      {/* Dropdown Menu Panel */}
      {isOpen && (
        <div 
          className="searchable-select-menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: '100%',
            minWidth: '220px',
            maxHeight: '280px',
            background: '#FFFFFF',
            borderRadius: '8px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
            border: '1px solid #E2E8F0',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Sticky Search Header */}
          <div style={{ padding: '8px', borderBottom: '1px solid #F1F5F9', background: '#F8FAFC', position: 'relative' }}>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search size={14} color="#94A3B8" style={{ position: 'absolute', left: '8px' }} />
              <input
                ref={inputRef}
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={searchPlaceholder}
                style={{
                  width: '100%',
                  height: '30px',
                  paddingLeft: '28px',
                  paddingRight: searchTerm ? '24px' : '8px',
                  fontSize: '0.8rem',
                  border: '1px solid #CBD5E1',
                  borderRadius: '4px',
                  outline: 'none',
                  background: '#FFFFFF',
                  boxSizing: 'border-box'
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  style={{
                    position: 'absolute',
                    right: '6px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94A3B8',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Option Items List */}
          <div style={{ overflowY: 'auto', flex: 1, maxHeight: '220px', padding: '4px' }}>
            {filteredOptions.length === 0 ? (
              <div style={{ padding: '12px', fontSize: '0.78rem', color: '#94A3B8', textAlign: 'center' }}>
                No options found
              </div>
            ) : (
              filteredOptions.map((opt) => {
                const isSelected = String(opt.value) === String(value);
                return (
                  <div
                    key={opt.value}
                    onClick={() => handleSelect(opt.value)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: isSelected ? '#FEE2E2' : 'transparent',
                      color: isSelected ? 'var(--star-red)' : '#1E293B',
                      fontWeight: isSelected ? 700 : 500,
                      transition: 'background 0.1s ease'
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) e.currentTarget.style.background = '#F8FAFC';
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: '6px' }}>
                      <div>{opt.label}</div>
                      {opt.subtext && (
                        <div style={{ fontSize: '0.72rem', color: '#64748B', fontWeight: 400 }}>
                          {opt.subtext}
                        </div>
                      )}
                    </div>
                    {isSelected && <Check size={14} color="var(--star-red)" style={{ flexShrink: 0 }} />}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
