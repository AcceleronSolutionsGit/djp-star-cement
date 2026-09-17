import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Users, Search, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react';

export default function TerritoryMappingView({ onShowToast }) {
  const [mappings, setMappings] = useState([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const loadMappings = async () => {
    setLoading(true);
    try {
      const data = await api.getTerritoryMapping(search, pageSize, (page - 1) * pageSize);
      setMappings(data.mappings || []);
      setTotal(data.total || 0);
    } catch (err) {
      onShowToast('Failed to load territory mappings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMappings();
  }, [page, search]);

  const totalPages = Math.ceil(total / pageSize) || 1;

  return (
    <div>
      {/* Search Header Card */}
      <div className="content-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '15px' }}>
          <div>
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Users size={20} />
              SFA Dealer - Sales Officer Territory Hierarchy Mapping
            </h3>
            <p className="card-subtitle">
              Synced directly from the master territory hierarchy repository.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '280px' }}>
              <input
                type="text"
                className="form-control"
                placeholder="Search Dealer / SO Name / Code..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                style={{ paddingLeft: '32px' }}
              />
              <Search size={14} style={{ position: 'absolute', left: '10px', top: '12px', color: 'var(--text-muted)' }} />
            </div>
            <button className="btn btn-outline" onClick={loadMappings} title="Refresh table">
              <RotateCcw size={14} />
              <span>Refresh</span>
            </button>
          </div>
        </div>
      </div>

      {/* Mapping Table */}
      <div className="table-wrapper">
        <div style={{
          padding: '14px 20px',
          background: '#FAFAFA',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}>
          <div style={{ fontSize: '0.88rem', fontWeight: 700 }}>
            Territory Mappings: <span style={{ color: 'var(--star-red)' }}>{total.toLocaleString()} total dealers</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                className="btn btn-outline"
                style={{ padding: '4px 8px' }}
                disabled={page <= 1}
                onClick={() => setPage(p => Math.max(1, p - 1))}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className="btn btn-outline"
                style={{ padding: '4px 8px' }}
                disabled={page >= totalPages}
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        </div>

        <div className="table-responsive">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>SAP CODE</th>
                <th>SFA CODE</th>
                <th>Customer Name</th>
                <th>Cust Type</th>
                <th>Branch Name</th>
                <th>SO CODE</th>
                <th>SO NAME</th>
                <th>ASM CODE</th>
                <th>ASM NAME</th>
                <th>RSM CODE</th>
                <th>RSM NAME</th>
                <th>ZH CODE</th>
                <th>ZH NAME</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan="14" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    Loading territory mappings...
                  </td>
                </tr>
              ) : mappings.length === 0 ? (
                <tr>
                  <td colSpan="14" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                    No mapping records found matching your search.
                  </td>
                </tr>
              ) : (
                mappings.map((m, idx) => (
                  <tr key={m.id || idx}>
                    <td>{(page - 1) * pageSize + idx + 1}</td>
                    <td><code>{m.sap_code || '-'}</code></td>
                    <td><code style={{ color: 'var(--star-red)' }}>{m.sfa_code || '-'}</code></td>
                    <td><strong>{m.dealer_name}</strong></td>
                    <td><span className="badge badge-needgrow">{m.dealer_type || 'DEALER'}</span></td>
                    <td>{m.branch || '-'}</td>
                    <td><code>{m.so_emp_code || '-'}</code></td>
                    <td><b>{m.so_name || '-'}</b></td>
                    <td><code>{m.asm_code || '-'}</code></td>
                    <td>{m.asm_name || '-'}</td>
                    <td><code>{m.rsm_code || '-'}</code></td>
                    <td>{m.rsm_name || '-'}</td>
                    <td><code>{m.zh_code || '-'}</code></td>
                    <td>{m.zh_name || '-'}</td>
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
